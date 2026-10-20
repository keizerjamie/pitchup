-- ============================================================
-- Pitchup — Fase B (B-1): aanwezigheidsoverzicht per speler (/players)
--
-- WANNEER DRAAIEN: VÓÓR de push van fase B, en NÁ supabase/blessure-status.sql
-- (de CHECK moet 'injured' al kennen). Run dit eenmalig in de Supabase SQL
-- Editor. Idempotent. Zonder deze functie geeft PostgREST PGRST202 en toont de
-- overzichtsweergave de foutstaat; de lijstweergave blijft werken.
--
-- WAAROM EEN NIEUWE FUNCTIE: per speler zijn aanwezig, afwezig en geblesseerd
-- APART nodig. inzichten_aanwezigheid_per_speler voegt sinds blessure-status.sql
-- afwezig en geblesseerd samen; die uitbreiden zou een drop + nieuwe grants
-- vragen en /inzichten en het spelersprofiel raken.
--
-- Filters gelijk aan inzichten_aanwezigheid_per_speler (p.active,
-- p.type = 'regular', e.type <> 'meting', venster inclusief), zodat
-- aanwezig / (aanwezig + afwezig + geblesseerd) per constructie gelijk is aan
-- het percentage op /inzichten. 'unknown' telt nergens mee.
--
-- TENANT: security invoker (RLS blijft gelden) + is_team_member(p_team_id) +
-- drie team_id-filters. p_team_id komt in de app uitsluitend uit ctx.teamId.
--
-- LET OP: events én players hebben een kolom `type`; aliassen e/p bewaken.
-- Wijzigt de returns table ooit: eerst DROP FUNCTION, dan opnieuw + grants.
-- ============================================================

create or replace function public.aanwezigheidsoverzicht_per_speler(
  p_team_id uuid, p_start date, p_end date
)
returns table (player_id uuid, naam text, aanwezig int, afwezig int, geblesseerd int)
language sql stable security invoker set search_path = public
as $$
  select
    p.id,
    p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int,
    count(*) filter (where a.status = 'injured')::int
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
  group by p.id, p.name
  order by p.name, p.id;
$$;

revoke all on function public.aanwezigheidsoverzicht_per_speler(uuid, date, date) from public, anon;
grant execute on function public.aanwezigheidsoverzicht_per_speler(uuid, date, date) to authenticated;
notify pgrst, 'reload schema';
