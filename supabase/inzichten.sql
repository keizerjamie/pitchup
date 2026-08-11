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

-- LET OP (venster): geen enkele functie hier kent "vandaag". De aanroeper
-- (app/inzichten/page.tsx) bepaalt het venster via p_start/p_end en klemt dat
-- voor de aanwezigheidsfuncties af op gisteren (verledenSeizoensVenster() in
-- lib/inzichten.ts), zodat al ingeplande maar nog niet gespeelde events de
-- opkomstcijfers niet omlaag trekken. Valt p_end vóór p_start (seizoen ligt
-- volledig in de toekomst), dan kan `e.date >= p_start and e.date <= p_end`
-- nooit waar zijn en komt er correct een lege set terug.

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

-- Gemiddelde wedstrijdrating per speler over het venster — voedt zowel de
-- "top 5" als de "worst 5" ratinglijst. Bewust GEEN order by/limit in SQL:
-- één aanroep levert alle spelers, topWorstRating() (lib/inzichten.ts) snijdt
-- er in JS beide lijstjes uit. Zelfde active-filter als
-- inzichten_rating_team_per_wedstrijd, zodat team- en spelerlijst nooit uit
-- elkaar lopen.
create or replace function public.inzichten_rating_per_speler(p_start date, p_end date)
returns table (player_id uuid, naam text, gemiddelde float8, aantal int)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.name, avg(r.rating)::float8, count(*)::int
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
  group by p.id, p.name
  order by p.name, p.id;
$$;

-- Aanwezig/afwezig per speler over het venster — voedt de "top 5"/"worst 5"
-- aanwezigheidslijst. De aanroeper geeft hier hetzelfde GECLAMPTE venster mee
-- als aan inzichten_aanwezigheid (zie de venster-notitie bovenaan).
--
-- BEWUST ANDERS dan inzichten_aanwezigheid: deze functie filtert WEL op
-- players.active. De team-brede aanwezigheidskaart telt bewust álle
-- registraties mee (O3, consistent met het dashboard — zie
-- lib/inzichten.ts:112-115), maar dit is een per-speler "wie presteert"-lijst;
-- een speler die niet meer in de selectie zit hoort daar niet in te staan.
--
-- Een speler met uitsluitend status 'unknown' komt terug als 0/0. Die krijgt
-- in JS percentage null en valt daar uit de top/worst — geen verzonnen 0%.
create or replace function public.inzichten_aanwezigheid_per_speler(p_start date, p_end date)
returns table (player_id uuid, naam text, aanwezig int, afwezig int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events e  on e.id = a.event_id
  join players p on p.id = a.player_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end
  group by p.id, p.name
  order by p.name, p.id;
$$;

revoke all on function public.inzichten_aanwezigheid(date, date) from public, anon;
revoke all on function public.inzichten_training_opkomst_per_maand(date, date) from public, anon;
revoke all on function public.inzichten_rating_team_per_wedstrijd(date, date) from public, anon;
revoke all on function public.inzichten_rating_speler(uuid, date, date) from public, anon;
revoke all on function public.inzichten_rating_per_speler(date, date) from public, anon;
revoke all on function public.inzichten_aanwezigheid_per_speler(date, date) from public, anon;

grant execute on function public.inzichten_aanwezigheid(date, date) to authenticated;
grant execute on function public.inzichten_training_opkomst_per_maand(date, date) to authenticated;
grant execute on function public.inzichten_rating_team_per_wedstrijd(date, date) to authenticated;
grant execute on function public.inzichten_rating_speler(uuid, date, date) to authenticated;
grant execute on function public.inzichten_rating_per_speler(date, date) to authenticated;
grant execute on function public.inzichten_aanwezigheid_per_speler(date, date) to authenticated;

create index if not exists idx_attendance_team_event   on attendance(team_id, event_id);
create index if not exists idx_match_ratings_team_event on match_ratings(team_id, event_id);
