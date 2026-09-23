-- ============================================================
-- Pitchup — M3a: inzichten-RPC's met een expliciete p_team_id
--
-- WANNEER DRAAIEN: VÓÓR deploy 1a (de deploy waarin app/inzichten/page.tsx en
-- app/actions/inzichten.ts de nieuwe signatuur aanroepen). Run dit eenmalig in
-- de Supabase SQL Editor.
--
--   M1  supabase/teams-en-leden.sql            vóór deploy
--   M3a supabase/inzichten-team-id.sql         vóór deploy  (dit bestand)
--   M2b supabase/team-rls-gevolgacties.sql     vóór deploy
--       deploy
--   ==> backfill uit M1 sectie 6 nogmaals draaien, direct ná de deploy
--   M2  supabase/team-rls.sql                  ná  deploy
--   M3b supabase/inzichten-team-id-opruimen.sql ná deploy
--
-- WAAROM EEN OVERLOAD EN GEEN VERVANGING: de functie-identiteit in Postgres is
-- (naam + argumenttypen). `create or replace` kan een signatuur niet wijzigen,
-- dus hieronder ontstaat een OVERLOAD NAAST de bestaande functie. Dat is
-- precies wat we willen: tussen deze SQL-run en de deploy draait de live app
-- nog op de oude signatuur. De oude versies worden pas ná de deploy gedropt
-- (M3b). Omdraaien breekt /inzichten en het spelersprofiel live.
--
-- PostgREST kiest een overload op PARAMETERNAAM, niet op positie. Een aanroep
-- zonder p_team_id landt dus op de oude functie, een aanroep mét p_team_id op
-- de nieuwe. Er is geen moment waarop "function is not unique" kan optreden.
--
-- WAT ER INHOUDELIJK VERANDERT: elke `= auth.uid()` wordt `= p_team_id`, plus
-- een expliciete lidmaatschapscheck `is_team_member(p_team_id)`. Die check is
-- de tweede laag naast RLS (security invoker blijft staan): geeft iemand een
-- vreemd team-id op, dan komt er een LEGE set terug in plaats van data.
-- Verder is elke functie regel voor regel gelijk aan de huidige versie uit
-- supabase/gastspelers.sql + supabase/speler-statistieken.sql — inclusief
-- p.active, p.type = 'regular' en e.type <> 'meting'.
--
-- LET OP: zowel `events` als `players` heeft een kolom `type`; de aliassen e/p
-- houden dat uit elkaar. Een gemiste alias geeft geen fout maar een stil
-- verkeerd filter.
-- ============================================================

-- 1. Team-breed opkomstpercentage.
create or replace function public.inzichten_aanwezigheid(
  p_team_id uuid, p_start date, p_end date
)
returns table (aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end;
$$;

-- 2. Opkomst per maand.
create or replace function public.inzichten_training_opkomst_per_maand(
  p_team_id uuid, p_start date, p_end date
)
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
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.type = 'regular'
    and e.type = 'training'
    and e.date >= p_start
    and e.date <= p_end
  group by 1
  order by 1;
$$;

-- 3. Teamrating per wedstrijd.
create or replace function public.inzichten_rating_team_per_wedstrijd(
  p_team_id uuid, p_start date, p_end date
)
returns table (event_id uuid, datum date, tegenstander text, gemiddelde float8, aantal int)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.opponent, avg(r.rating)::float8, count(*)::int
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where is_team_member(p_team_id)
    and r.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  group by e.id, e.date, e.opponent
  order by e.date, e.id;
$$;

-- 4. Ratingreeks van één speler.
create or replace function public.inzichten_rating_speler(
  p_team_id uuid, p_player uuid, p_start date, p_end date
)
returns table (event_id uuid, datum date, tegenstander text, rating smallint)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.opponent, r.rating
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where is_team_member(p_team_id)
    and r.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.id = p_player
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  order by e.date, e.id;
$$;

-- 5. Gemiddelde rating per speler (top/worst).
create or replace function public.inzichten_rating_per_speler(
  p_team_id uuid, p_start date, p_end date
)
returns table (player_id uuid, naam text, gemiddelde float8, aantal int)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, avg(r.rating)::float8, count(*)::int
  from match_ratings r
  join events  e on e.id = r.event_id
  join players p on p.id = r.player_id
  where is_team_member(p_team_id)
    and r.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.active = true
    and p.type = 'regular'
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  group by p.id, p.name
  order by p.name, p.id;
$$;

-- 6. Aanwezigheid per speler (top/worst én de Statistieken-tab van één speler).
--    p_player blijft optioneel: NULL = alle spelers (het /inzichten-gedrag),
--    een waarde = precies één speler (het spelersprofiel).
create or replace function public.inzichten_aanwezigheid_per_speler(
  p_team_id uuid, p_start date, p_end date, p_player uuid default null
)
returns table (player_id uuid, naam text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    p.id,
    p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
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
    and e.date <= p_end
    and (p_player is null or p.id = p_player)
  group by p.id, p.name
  order by p.name, p.id;
$$;

-- Rechten gelden PER SIGNATUUR en gaan niet mee met een nieuwe overload.
revoke all on function public.inzichten_aanwezigheid(uuid, date, date) from public, anon;
revoke all on function public.inzichten_training_opkomst_per_maand(uuid, date, date) from public, anon;
revoke all on function public.inzichten_rating_team_per_wedstrijd(uuid, date, date) from public, anon;
revoke all on function public.inzichten_rating_speler(uuid, uuid, date, date) from public, anon;
revoke all on function public.inzichten_rating_per_speler(uuid, date, date) from public, anon;
revoke all on function public.inzichten_aanwezigheid_per_speler(uuid, date, date, uuid) from public, anon;

grant execute on function public.inzichten_aanwezigheid(uuid, date, date) to authenticated;
grant execute on function public.inzichten_training_opkomst_per_maand(uuid, date, date) to authenticated;
grant execute on function public.inzichten_rating_team_per_wedstrijd(uuid, date, date) to authenticated;
grant execute on function public.inzichten_rating_speler(uuid, uuid, date, date) to authenticated;
grant execute on function public.inzichten_rating_per_speler(uuid, date, date) to authenticated;
grant execute on function public.inzichten_aanwezigheid_per_speler(uuid, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- Er horen nu van elke naam TWEE varianten te staan (oud + nieuw):
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'inzichten%'
-- order by 1, 2;
