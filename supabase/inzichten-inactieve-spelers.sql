-- ============================================================
-- Pitchup — inactieve spelers uit de team-aanwezigheidscijfers
--
-- WANNEER DRAAIEN: eenmalig, in de Supabase SQL Editor of via de Supabase-MCP,
-- pas na akkoord van Jamie. De volgorde ten opzichte van de push is technisch
-- irrelevant: signatuur en returns table blijven gelijk, de app roept de
-- functies vóór en ná exact hetzelfde aan.
--
-- WAT ER GEBEURT: inzichten_aanwezigheid en
-- inzichten_training_opkomst_per_maand tellen voortaan alleen ACTIEVE vaste
-- spelers (`and p.active = true`), net als inzichten_aanwezigheid_per_speler,
-- de hero en de agenda (teltMee/telAanwezigheid in lib/aanwezigheid-telling.ts).
--   - Het effect is terugwerkend: ook de registraties uit de actieve periode
--     van een nu-inactieve speler vallen uit de teamcijfers (geaccepteerd).
--   - Een speler weer op actief zetten telt hem direct weer mee.
--   - Er wordt geen data gewijzigd: alleen twee functie-bodies.
-- Bodies zijn letterlijk die uit supabase/blessure-status.sql, plus de regel
-- `and p.active = true` direct na `and p.team_id = p_team_id`. Signatuur,
-- returns table, `security invoker` en de grants blijven: `create or replace`,
-- geen drop.
--
-- BEWUST NIET: inzichten_training_opkomst_per_speler (W3) en
-- inzichten_blessures_per_maand (O4) blijven zonder active-filter.
--
-- NIET MEER DRAAIEN NA DIT BESTAND:
--   - supabase/inzichten-team-id.sql
--   - supabase/blessure-status.sql
-- Beide zetten deze twee functies terug naar een versie zonder active-filter,
-- zodat inactieve spelers stil weer meetellen. Moet een van beide toch
-- opnieuw: draai daarna dit bestand (supabase/inzichten-inactieve-spelers.sql)
-- nogmaals.
--
-- TENANT: ongewijzigd. is_team_member(p_team_id) plus `team_id = p_team_id`
-- op attendance, events én players; security invoker. LET OP: zowel `events`
-- als `players` heeft een kolom `type`; de aliassen e/p houden dat uit elkaar.
--
-- TIJDZONE: n.v.t. — events.date is een `date`, de grenzen p_start/p_end ook.
--
-- TERUGDRAAIEN: draai de blokken inzichten_aanwezigheid en
-- inzichten_training_opkomst_per_maand uit supabase/blessure-status.sql
-- opnieuw (alleen die twee, binnen begin/commit + notify pgrst).
-- ============================================================

-- ── Controle VÓÓR het draaien (los uitvoeren en de uitkomst bewaren) ───────
-- De RPC's geven in de SQL Editor een lege set (auth.uid() is daar null), dus
-- vergelijk rechtstreeks op de tabellen. Gebruik expliciete datums, geen
-- current_date (die is UTC).
--
--   select a.team_id,
--          count(*) filter (where a.status = 'present')                          as p_alle,
--          count(*) filter (where a.status in ('absent','injured'))              as a_alle,
--          count(*) filter (where a.status = 'present' and p.active)             as p_actief,
--          count(*) filter (where a.status in ('absent','injured') and p.active) as a_actief
--   from attendance a
--   join events  e on e.id = a.event_id  and e.team_id = a.team_id
--   join players p on p.id = a.player_id and p.team_id = a.team_id
--   where p.type = 'regular' and e.type <> 'meting'
--     and e.date between date 'YYYY-MM-DD' and date 'YYYY-MM-DD'
--   group by a.team_id order by a.team_id;
--
--   -- idem met e.type = 'training' en
--   -- group by a.team_id, to_char(e.date,'YYYY-MM') voor de maandopkomst

begin;

create or replace function public.inzichten_aanwezigheid(
  p_team_id uuid, p_start date, p_end date
)
returns table (aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.active = true
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end;
$$;

create or replace function public.inzichten_training_opkomst_per_maand(
  p_team_id uuid, p_start date, p_end date
)
returns table (maand text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    to_char(e.date, 'YYYY-MM') as maand,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.active = true
    and p.type = 'regular'
    and e.type = 'training'
    and e.date >= p_start
    and e.date <= p_end
  group by 1
  order by 1;
$$;

commit;
notify pgrst, 'reload schema';

-- ── Controle NÁ het draaien (los uitvoeren) ────────────────────────────────
--
-- a. De VÓÓR-query opnieuw: p_alle/a_alle exact gelijk aan de VÓÓR-uitkomst
--    (er is geen data gewijzigd); p_actief/a_actief zijn de waarden die de
--    RPC's nu voor dat team en venster opleveren.
--
-- b. Beide functies dragen het filter en zijn security invoker
--    (verwacht: 2 rijen, args `p_team_id uuid, p_start date, p_end date`,
--    active_filter true, prosecdef false):
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid),
--          pg_get_functiondef(p.oid) ilike '%p.active = true%' as active_filter,
--          p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('inzichten_aanwezigheid', 'inzichten_training_opkomst_per_maand');
--
-- c. Overloads: precies één signatuur per naam. Een extra signatuur zónder
--    p_team_id betekent dat inzichten.sql/gastspelers.sql opnieuw zijn
--    gedraaid (oude overloads, zonder dit filter).
--
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and (p.proname like 'inzichten_aanwezigheid%'
--          or p.proname like 'inzichten_training_opkomst%')
--   order by 1, 2;
--
-- d. Grants ongewijzigd (verwacht: authenticated true, anon false):
--
--   select f, has_function_privilege('authenticated', f, 'execute') as authenticated,
--             has_function_privilege('anon', f, 'execute')          as anon
--   from unnest(array[
--     'public.inzichten_aanwezigheid(uuid, date, date)',
--     'public.inzichten_training_opkomst_per_maand(uuid, date, date)'
--   ]) as f;
