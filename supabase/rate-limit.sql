-- ============================================================
-- Pitchup — Gedeelde rate-limit-tellers (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================
--
-- Vervangt de in-memory Map in lib/rate-limit.ts: die teller leefde per
-- server-instantie, en Vercel draait meerdere lambda's, dus een aanvaller die
-- pogingen over instanties spreidt kreeg effectief meer pogingen dan de
-- policy toestaat. Deze tabel + functies maken de teller gedeeld en atomisch.
--
-- Geen teamdata: dit zijn throttling-tellers voor acties die plaatsvinden
-- vóórdat er een sessie bestaat (inloggen, registreren, wachtwoord-reset),
-- dus RLS met auth.uid() kan hier niet op leunen. RLS staat aan zonder
-- policies (= dicht voor anon/authenticated); alleen de service-role-client
-- (lib/supabase/admin.ts, dezelfde die "Account verwijderen" gebruikt) mag
-- deze tabel en functies aanraken. EXECUTE wordt hieronder expliciet van
-- PUBLIC/anon/authenticated ingetrokken — anders zou PostgREST deze functies
-- ook aan niet-ingelogde bezoekers aanbieden, die dan bijvoorbeeld hun eigen
-- blokkade met rate_limit_clear() zouden kunnen opheffen.

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  blocked_until TIMESTAMPTZ
);

ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;

-- Telt één poging mee en geeft de status ná die poging terug. Spiegelt exact
-- het gedrag van recordAttempt() in lib/rate-limit.ts (vóór deze migratie):
-- - binnen het venster en nog niet geblokkeerd: teller +1
-- - venster verlopen, of een eerdere blokkade uitgezeten: nieuw venster (1)
-- - nog actief geblokkeerd: teller blijft ongewijzigd, blocked=true
-- - teller bereikt de limiet: blokkade gaat aan voor block_ms
--
-- FOR UPDATE zet een rij-lock zodat twee gelijktijdige pogingen op dezelfde
-- sleutel (bijv. twee tabbladen, of twee lambda's voor hetzelfde e-mail+IP)
-- elkaars poging niet kunnen overschrijven — dat is precies het gat dat de
-- oude in-memory Map open liet tussen instanties, nu ook binnen één instantie
-- dichtgezet.
CREATE OR REPLACE FUNCTION rate_limit_record_attempt(
  p_key TEXT,
  p_window_ms BIGINT,
  p_limit INT,
  p_block_ms BIGINT
) RETURNS TABLE(blocked BOOLEAN, retry_after_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row rate_limit_entries%ROWTYPE;
  v_stale BOOLEAN;
  v_count INT;
  v_window_start TIMESTAMPTZ;
  v_blocked_until TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_row FROM rate_limit_entries WHERE key = p_key FOR UPDATE;

  v_stale := v_row IS NULL
    OR v_now - v_row.window_start >= (p_window_ms::text || ' milliseconds')::interval
    OR (v_row.blocked_until IS NOT NULL AND v_row.blocked_until <= v_now);

  -- Nog binnen een actieve blokkade: niet meetellen, alleen de resterende tijd
  -- teruggeven (zelfde early-return als de oude JS-implementatie).
  IF NOT v_stale AND v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)) * 1000)::BIGINT;
    RETURN;
  END IF;

  IF v_stale THEN
    v_count := 1;
    v_window_start := v_now;
  ELSE
    v_count := v_row.count + 1;
    v_window_start := v_row.window_start;
  END IF;
  v_blocked_until := NULL;

  IF v_count >= p_limit THEN
    v_blocked_until := v_now + (p_block_ms::text || ' milliseconds')::interval;
  END IF;

  INSERT INTO rate_limit_entries (key, count, window_start, blocked_until)
  VALUES (p_key, v_count, v_window_start, v_blocked_until)
  ON CONFLICT (key) DO UPDATE
    SET count = EXCLUDED.count,
        window_start = EXCLUDED.window_start,
        blocked_until = EXCLUDED.blocked_until;

  IF v_blocked_until IS NOT NULL AND v_blocked_until > v_now THEN
    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_blocked_until - v_now)) * 1000)::BIGINT;
  ELSE
    RETURN QUERY SELECT false, 0::BIGINT;
  END IF;
END;
$$;

-- Leest de huidige status zonder de teller te wijzigen (spiegelt checkRateLimit()).
CREATE OR REPLACE FUNCTION rate_limit_check(p_key TEXT)
RETURNS TABLE(blocked BOOLEAN, retry_after_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_blocked_until TIMESTAMPTZ;
BEGIN
  SELECT blocked_until INTO v_blocked_until FROM rate_limit_entries WHERE key = p_key;

  IF v_blocked_until IS NOT NULL AND v_blocked_until > v_now THEN
    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_blocked_until - v_now)) * 1000)::BIGINT;
  ELSE
    RETURN QUERY SELECT false, 0::BIGINT;
  END IF;
END;
$$;

-- Wist de teller, bijvoorbeeld na een geslaagde inlog (spiegelt clearRateLimit()).
CREATE OR REPLACE FUNCTION rate_limit_clear(p_key TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  DELETE FROM rate_limit_entries WHERE key = p_key;
$$;

-- Alleen de service-role mag deze tabel en functies gebruiken. Zonder deze
-- REVOKE geeft Postgres/PostgREST standaard EXECUTE aan PUBLIC, en zou elke
-- bezoeker (ingelogd of niet) rate_limit_clear() of rate_limit_record_attempt()
-- rechtstreeks kunnen aanroepen en zo de throttling zelf kunnen manipuleren.
REVOKE ALL ON FUNCTION rate_limit_record_attempt(TEXT, BIGINT, INT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_limit_check(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION rate_limit_clear(TEXT) FROM PUBLIC;

-- ── Handmatige verificatie ──────────────────────────────────
-- Run dit na de migratie in de SQL Editor om het gedrag te controleren
-- (limit=2, window=60s, block=30s):
--
--   select * from rate_limit_record_attempt('test:demo', 60000, 2, 30000);
--   -- verwacht: blocked=false, retry_after_ms=0  (poging 1)
--   select * from rate_limit_record_attempt('test:demo', 60000, 2, 30000);
--   -- verwacht: blocked=true,  retry_after_ms ≈ 30000  (poging 2 bereikt de limiet)
--   select * from rate_limit_check('test:demo');
--   -- verwacht: blocked=true,  retry_after_ms ≈ 30000
--   select rate_limit_clear('test:demo');
--   select * from rate_limit_check('test:demo');
--   -- verwacht: blocked=false, retry_after_ms=0
--
--   -- Opruimen na het testen:
--   delete from rate_limit_entries where key = 'test:demo';
--
-- Optioneel, tegen ongelimiteerde groei: er is bewust geen automatische
-- opruiming (cron) toegevoegd — dat is nieuwe infrastructuur die niet is
-- gevraagd. Draai af en toe handmatig, of zet zelf een pg_cron-taak op:
--   delete from rate_limit_entries
--   where blocked_until is not null and blocked_until < now() - interval '1 day'
--      or (blocked_until is null and window_start < now() - interval '1 day');
