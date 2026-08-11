-- ============================================================
-- Pitchup — inzichtenpagina (/inzichten)
-- Run dit eenmalig in de Supabase SQL Editor.
--
-- Waarom SQL-aggregatie i.p.v. het bestaande "ophalen + JS-reduce"-patroon
-- (lib/periodization.ts:31-69, app/page.tsx:107-114): deze pagina aggregeert
-- over een HEEL seizoen. SQL-aggregatie stuurt alleen de samengevatte rijen
-- terug in plaats van honderden/duizenden losse rijen.
--
-- SECURITY INVOKER (niet DEFINER): RLS blijft gelden. Het expliciete
-- team_id = auth.uid() is de tweede laag. Geen enkele functie neemt een
-- team_id-parameter aan.
-- ============================================================

create or replace function public.inzichten_aanwezigheid(p_start date, p_end date)
returns table (aanwezig int, afwezig int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events e on e.id = a.event_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end;
$$;

create or replace function public.inzichten_training_opkomst_per_maand(p_start date, p_end date)
returns table (maand text, aanwezig int, afwezig int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(e.date, 'YYYY-MM') as maand,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events e on e.id = a.event_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and e.type = 'training'
    and e.date >= p_start
    and e.date <= p_end
  group by 1
  order by 1;
$$;

create or replace function public.inzichten_rating_team_per_wedstrijd(p_start date, p_end date)
returns table (event_id uuid, datum date, tegenstander text, gemiddelde float8, aantal int)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.date, e.opponent, avg(r.rating)::float8, count(*)::int
  from match_ratings r
  join events e  on e.id = r.event_id
  join players p on p.id = r.player_id
  where r.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  group by e.id, e.date, e.opponent
  order by e.date, e.id;
$$;

create or replace function public.inzichten_rating_speler(p_player uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, tegenstander text, rating smallint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.date, e.opponent, r.rating
  from match_ratings r
  join events e  on e.id = r.event_id
  join players p on p.id = r.player_id
  where r.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.id = p_player
    and p.active = true
    and e.type = 'match'
    and e.date >= p_start
    and e.date <= p_end
  order by e.date, e.id;
$$;

revoke all on function public.inzichten_aanwezigheid(date, date) from public, anon;
revoke all on function public.inzichten_training_opkomst_per_maand(date, date) from public, anon;
revoke all on function public.inzichten_rating_team_per_wedstrijd(date, date) from public, anon;
revoke all on function public.inzichten_rating_speler(uuid, date, date) from public, anon;

grant execute on function public.inzichten_aanwezigheid(date, date) to authenticated;
grant execute on function public.inzichten_training_opkomst_per_maand(date, date) to authenticated;
grant execute on function public.inzichten_rating_team_per_wedstrijd(date, date) to authenticated;
grant execute on function public.inzichten_rating_speler(uuid, date, date) to authenticated;

create index if not exists idx_attendance_team_event   on attendance(team_id, event_id);
create index if not exists idx_match_ratings_team_event on match_ratings(team_id, event_id);
