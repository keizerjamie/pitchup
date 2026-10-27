-- ============================================================
-- Pitchup — inzichten-metrics fase 2a (spelers)
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor. Idempotent;
-- mag opnieuw.
-- Alleen vier LEES-RPC's; geen tabel, kolom, index of policy.
-- Raakt GEEN bestaande functie (inzichten-team-id.sql en inzichten-metrics.sql
-- NIET opnieuw draaien). Daarna: supabase/team-rls-verificatie.sql blok 27.
--
-- Elke functie: security invoker + is_team_member(p_team_id) +
-- `<alias>.team_id = p_team_id` op ELKE echte tabel (patroon
-- supabase/inzichten-metrics.sql). Geen `limit`: alles wordt in SQL
-- geaggregeerd (hooguit één rij per speler of per maand), dus er kan niets
-- stil worden afgekapt.
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan tonen vier
-- kaarten op /inzichten een foutmelding (PGRST202 per kaart afgevangen); de
-- rest blijft werken.
--
-- LET OP: zowel `events` als `players` heeft een kolom `type`; de aliassen e/p
-- houden dat uit elkaar. Daarom heten de uitvoerkolommen naam/gast/noemer en
-- is er geen kolom `type`.
-- ============================================================
begin;

-- ── RPC 1: speelkansen per speler (W2, W3, O2, O6) ──
-- Noemer = wedstrijden MET selectie (>=1 match_squad-rij) binnen het venster,
-- per speler vanaf zijn eerste voorkomen (selectie, opstelling of aanwezigheid
-- <> 'unknown' bij een wedstrijd), ook als dat vóór het venster ligt.
-- O2: voor een INACTIEVE speler (p.active = false) stopt de noemer bij zijn
-- laatste voorkomen; voor een actieve speler loopt hij door tot p_end.
-- Basis = speler met player_id in het opgeslagen plan, alleen in
-- noemer-wedstrijden. BEWUST geen p.active- en geen p.type-filter op de rijen
-- (W3): gasten en inactieven doen mee, (p.type = 'guest') markeert de gast.
create or replace function public.inzichten_speelkansen(p_team_id uuid, p_start date, p_end date)
returns table (player_id uuid, naam text, gast boolean, noemer int, selectie int, basis int)
language sql stable security invoker set search_path = public
as $$
  with wedstrijden as (
    select e.id, e.date
    from events e
    where is_team_member(p_team_id)
      and e.team_id = p_team_id
      and e.type = 'match'
      and e.date <= p_end
  ),
  selectie as (
    select ms.event_id, ms.player_id
    from match_squad ms
    join players p on p.id = ms.player_id
    where ms.team_id = p_team_id
      and p.team_id = p_team_id
  ),
  basis as (
    select distinct l.event_id, p.id as player_id
    from lineups l
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(l.positions) = 'array' then l.positions else '[]'::jsonb end
    ) as pos(elem)
    -- tenant-grens: het player_id uit de JSONB telt alleen als het een speler
    -- van DIT team is. Bewust tekstvergelijking en geen uuid-cast: een
    -- ongeldige string zou anders de hele RPC laten falen.
    join players p on p.id::text = pos.elem ->> 'player_id'
    where l.team_id = p_team_id
      and p.team_id = p_team_id
  ),
  aanwezigheid as (
    select a.event_id, a.player_id
    from attendance a
    join players p on p.id = a.player_id
    where a.team_id = p_team_id
      and p.team_id = p_team_id
      and a.status <> 'unknown'
  ),
  voorkomen as (
    select v.player_id, min(w.date) as eerste, max(w.date) as laatste
    from (select s.event_id, s.player_id from selectie s
          union select b.event_id, b.player_id from basis b
          union select a.event_id, a.player_id from aanwezigheid a) v
    join wedstrijden w on w.id = v.event_id
    group by v.player_id
  ),
  noemer_wedstrijden as (
    select w.id, w.date
    from wedstrijden w
    where w.date >= p_start
      and exists (select 1 from selectie s where s.event_id = w.id)
  )
  select p.id, p.name, (p.type = 'guest'),
         count(nw.id)::int,
         count(nw.id) filter (where exists (
           select 1 from selectie s where s.event_id = nw.id and s.player_id = p.id))::int,
         count(nw.id) filter (where exists (
           select 1 from basis b where b.event_id = nw.id and b.player_id = p.id))::int
  from voorkomen f
  join players p on p.id = f.player_id
  -- Vanaf het eerste voorkomen; O2: een inactieve speler alleen t/m zijn
  -- laatste voorkomen (active null telt als actief, zoals de kolomdefault).
  left join noemer_wedstrijden nw
    on nw.date >= f.eerste
   and (p.active is distinct from false or nw.date <= f.laatste)
  where is_team_member(p_team_id)
    and p.team_id = p_team_id
  group by p.id, p.name, p.type
  order by p.name, p.id;
$$;

-- ── RPC 2: rating recent vs. seizoen per speler (W5; W3: alleen actieve vaste) ──
-- recent = de laatste p_recent beoordeelde wedstrijden (RATING_TREND_VENSTER in
-- lib/inzichten.ts). Gelijke datum: e.id als vaste tweede sleutel.
create or replace function public.inzichten_rating_vorm_per_speler(p_team_id uuid, p_start date, p_end date, p_recent int)
returns table (player_id uuid, naam text, aantal int, seizoen_gemiddelde float8, recent_gemiddelde float8)
language sql stable security invoker set search_path = public
as $$
  select x.player_id, x.naam, count(*)::int, avg(x.rating)::float8,
         avg(x.rating) filter (where x.volgnummer <= greatest(p_recent, 1))::float8
  from (
    select p.id as player_id, p.name as naam, r.rating,
           row_number() over (partition by p.id order by e.date desc, e.id desc) as volgnummer
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
      and e.date >= p_start and e.date <= p_end
  ) x
  group by x.player_id, x.naam
  order by x.naam, x.player_id;
$$;

-- ── RPC 3: trainingsopkomst per speler (W7: alleen trainingen; W3: gasten + inactieven) ──
-- afwezig = absent + injured (conventie van blessure-status.sql); unknown telt niet.
create or replace function public.inzichten_training_opkomst_per_speler(p_team_id uuid, p_start date, p_end date)
returns table (player_id uuid, naam text, gast boolean, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, (p.type = 'guest'),
         count(*) filter (where a.status = 'present')::int,
         count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and e.type = 'training'
    and e.date >= p_start and e.date <= p_end
  group by p.id, p.name, p.type
  order by p.name, p.id;
$$;

-- ── RPC 4: verschillende geblesseerde spelers per kalendermaand (W7, O4) ──
-- Eén rij per maand MET minstens één training/wedstrijd; 0 = events maar geen
-- blessure. Vaste spelers incl. nu-inactieve, geen gasten (O4).
-- Team-filters van attendance/players in de ON: in de WHERE zou de left join
-- stil een inner join worden en verdwijnen de maanden met 0.
create or replace function public.inzichten_blessures_per_maand(p_team_id uuid, p_start date, p_end date)
returns table (maand text, geblesseerd int)
language sql stable security invoker set search_path = public
as $$
  select to_char(e.date, 'YYYY-MM'), count(distinct p.id)::int
  from events e
  left join attendance a on a.event_id = e.id and a.team_id = p_team_id and a.status = 'injured'
  left join players p on p.id = a.player_id and p.team_id = p_team_id and p.type = 'regular'
  where is_team_member(p_team_id)
    and e.team_id = p_team_id
    and e.type <> 'meting'
    and e.date >= p_start and e.date <= p_end
  group by 1
  order by 1;
$$;

-- Rechten gelden PER SIGNATUUR.
revoke all on function public.inzichten_speelkansen(uuid, date, date)                 from public, anon;
revoke all on function public.inzichten_rating_vorm_per_speler(uuid, date, date, int) from public, anon;
revoke all on function public.inzichten_training_opkomst_per_speler(uuid, date, date) from public, anon;
revoke all on function public.inzichten_blessures_per_maand(uuid, date, date)         from public, anon;
grant execute on function public.inzichten_speelkansen(uuid, date, date)                 to authenticated;
grant execute on function public.inzichten_rating_vorm_per_speler(uuid, date, date, int) to authenticated;
grant execute on function public.inzichten_training_opkomst_per_speler(uuid, date, date) to authenticated;
grant execute on function public.inzichten_blessures_per_maand(uuid, date, date)         to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'inzichten_speelkansen','inzichten_rating_vorm_per_speler',
--   'inzichten_training_opkomst_per_speler','inzichten_blessures_per_maand')
-- order by 1;
