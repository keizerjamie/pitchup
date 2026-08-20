-- ============================================================
-- Pitchup — Gastspelers (migratie)
-- Run dit eenmalig in de Supabase SQL Editor, VOOR de deploy van de code.
-- Idempotent + transactioneel.
--
-- Een gastspeler is een gewone, ACTIEVE speler met type = 'guest'. Het veld
-- staat los van `active`: hij blijft zichtbaar en selecteerbaar, maar staat
-- standaard afwezig (lib/attendance-rows.ts) en telt nooit mee in de
-- teambrede statistieken (de zes RPC's hieronder).
-- ============================================================

BEGIN;

ALTER TABLE players ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_type_check;
ALTER TABLE players ADD CONSTRAINT players_type_check
  CHECK (type IN ('regular', 'guest'));

COMMIT;

-- ============================================================
-- Inzichten-RPC's: gastspelers tellen nooit mee (AC10-AC12).
-- Alles is `create or replace`, dus herhaald draaien is veilig. De
-- revoke/grant-regels uit inzichten.sql hoeven niet mee: `create or replace
-- function` behoudt de rechten zolang de signatuur gelijk blijft.
--
-- LET OP: zowel events als players hebben een kolom `type`; de aliassen
-- e/p houden dat uit elkaar. Een gemiste alias geeft geen fout maar een
-- stil verkeerd filter.
-- ============================================================

-- 3a. Team-breed opkomstpercentage — players-join is NIEUW.
create or replace function public.inzichten_aanwezigheid(p_start date, p_end date)
returns table (aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end;
$$;

-- 3b. Opkomst per maand — players-join is NIEUW.
create or replace function public.inzichten_training_opkomst_per_maand(p_start date, p_end date)
returns table (maand text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    to_char(e.date, 'YYYY-MM') as maand,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.type = 'regular'
    and e.type = 'training'
    and e.date >= p_start
    and e.date <= p_end
  group by 1
  order by 1;
$$;

-- 3c. Teamrating per wedstrijd — joinde al op players; alleen filterregel erbij.
create or replace function public.inzichten_rating_team_per_wedstrijd(p_start date, p_end date)
returns table (event_id uuid, datum date, tegenstander text, gemiddelde float8, aantal int)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.opponent, avg(r.rating)::float8, count(*)::int
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where r.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  group by e.id, e.date, e.opponent
  order by e.date, e.id;
$$;

-- 3d. Ratingreeks van een speler.
create or replace function public.inzichten_rating_speler(p_player uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, tegenstander text, rating smallint)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.opponent, r.rating
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where r.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.id = p_player
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  order by e.date, e.id;
$$;

-- 3e. Gemiddelde rating per speler (top/worst).
create or replace function public.inzichten_rating_per_speler(p_start date, p_end date)
returns table (player_id uuid, naam text, gemiddelde float8, aantal int)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, avg(r.rating)::float8, count(*)::int
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where r.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  group by p.id, p.name
  order by p.name, p.id;
$$;

-- 3f. Aanwezigheid per speler (top/worst).
create or replace function public.inzichten_aanwezigheid_per_speler(p_start date, p_end date)
returns table (player_id uuid, naam text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    p.id, p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end
  group by p.id, p.name
  order by p.name, p.id;
$$;
