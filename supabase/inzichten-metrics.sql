-- ============================================================
-- Pitchup — inzichten-metrics fase 1
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor. Idempotent;
-- mag opnieuw.
-- Raakt GEEN bestaande functie of policy (inzichten-team-id.sql NIET opnieuw
-- draaien: dat zet de aanwezigheids-RPC's terug, zie de kop van dat bestand).
-- Daarna: supabase/team-rls-verificatie.sql blok 2, 22 en 26.
--
-- WAT ER BIJKOMT:
--   * tabel public.tegendoelpunten (minuut + soort per tegendoelpunt), met RLS
--     op onderdeel 'wedstrijd' — zelfde rechten als match_events
--     (supabase/team-rls.sql);
--   * vier lees-RPC's voor /inzichten, elk security invoker +
--     is_team_member(p_team_id) + `<alias>.team_id = p_team_id` op ELKE
--     gejoinde tabel (patroon supabase/inzichten-team-id.sql).
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan tonen de zes
-- nieuwe kaarten op /inzichten een foutmelding (PGRST202 per kaart afgevangen)
-- en geeft "tegendoelpunt toevoegen" een generieke fout; de rest blijft werken.
--
-- LET OP: zowel `events` als `players` heeft een kolom `type`; de aliassen e/p
-- houden dat uit elkaar. Daarom heet de soortkolom hier `soort` en niet `type`.
-- ============================================================
begin;

-- ── Tabel ────────────────────────────────────────────────────
-- FK naar teams wijkt bewust af van match_events (geen FK in schema.sql):
-- teams bestaat op productie al (M1/M5c) en dit bestand draait nooit op een
-- verse installatie vóór M1. De FK voorkomt weesrijen.
-- `minute` en zijn CHECK zijn gelijk aan match_events, zodat isValidMinute
-- (lib/match-analysis.mjs) de enige bron van het bereik blijft.
-- `created_at` is UTC (timestamptz) en wordt alleen voor sortering gebruikt.
create table if not exists public.tegendoelpunten (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  soort      text not null constraint tegendoelpunten_soort_check check (soort in ('set_piece','open_play')),
  minute     smallint constraint tegendoelpunten_minute_check check (minute is null or minute between 0 and 130),
  created_at timestamptz not null default now()
);
create index if not exists idx_tegendoelpunten_team  on public.tegendoelpunten(team_id);
create index if not exists idx_tegendoelpunten_event on public.tegendoelpunten(event_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.tegendoelpunten enable row level security;
drop policy if exists "tegendoelpunten: lid mag lezen"   on public.tegendoelpunten;
drop policy if exists "tegendoelpunten: recht mag maken" on public.tegendoelpunten;
drop policy if exists "tegendoelpunten: recht mag wissen" on public.tegendoelpunten;
create policy "tegendoelpunten: lid mag lezen" on public.tegendoelpunten
  for select using (is_team_member(team_id));
-- Naast het recht: het event moet een WEDSTRIJD van HETZELFDE team zijn. Dat
-- is de DB-laag bovenop assertOwnMatchEvent in app/actions/tegendoelpunten.ts.
create policy "tegendoelpunten: recht mag maken" on public.tegendoelpunten
  for insert with check (
    can_edit(team_id, 'wedstrijd')
    and exists (select 1 from public.events e
                where e.id = tegendoelpunten.event_id
                  and e.team_id = tegendoelpunten.team_id
                  and e.type = 'match')
  );
create policy "tegendoelpunten: recht mag wissen" on public.tegendoelpunten
  for delete using (can_edit(team_id, 'wedstrijd'));
-- Bewust GEEN update-policy: achteraf wijzigen valt buiten scope, dus een
-- update raakt altijd 0 rijen.

-- ── RPC 1: één rij per wedstrijd MET uitslag, met formatie (left join) ──
create or replace function public.inzichten_wedstrijd_uitslagen(p_team_id uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, home_away text, goals_for int, goals_against int, formatie text)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.home_away, e.goals_for::int, e.goals_against::int,
         nullif(btrim(l.formation), '')
  from events e
  -- team-filter in de ON-clausule: in de WHERE zou dit een inner join worden
  left join lineups l on l.event_id = e.id and l.team_id = p_team_id
  where is_team_member(p_team_id)
    and e.team_id = p_team_id
    and e.type = 'match'
    and e.goals_for is not null
    and e.goals_against is not null
    and e.date >= p_start and e.date <= p_end
  order by e.date, e.id
  limit 201;  -- = MAX_SEIZOEN_WEDSTRIJDEN + 1 (lib/inzichten.ts); 201 rijen = afgekapt
$$;

-- ── RPC 2: momenten per speler. BEWUST geen p.active- en geen p.type-filter (V2) ──
create or replace function public.inzichten_speler_momenten(p_team_id uuid, p_start date, p_end date)
returns table (player_id uuid, naam text, gast boolean, doelpunten int, assists int, geel int, rood int)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, (p.type = 'guest'),
         count(*) filter (where me.kind = 'goal')::int,
         count(*) filter (where me.kind = 'assist')::int,
         count(*) filter (where me.kind = 'yellow')::int,
         count(*) filter (where me.kind = 'red')::int
  from match_events me
  join events  e on e.id = me.event_id
  join players p on p.id = me.player_id
  where is_team_member(p_team_id)
    and me.team_id = p_team_id
    and e.team_id  = p_team_id
    and p.team_id  = p_team_id
    and e.type = 'match'
    and e.date >= p_start and e.date <= p_end
  group by p.id, p.name, p.type
  order by p.name, p.id;
$$;

-- ── RPC 3: eigen doelpunten per minuut (bakindeling in lib/inzichten.ts) ──
create or replace function public.inzichten_doelpunten_per_minuut(p_team_id uuid, p_start date, p_end date)
returns table (minuut int, aantal int)
language sql stable security invoker set search_path = public
as $$
  select me.minute::int, count(*)::int
  from match_events me
  join events  e on e.id = me.event_id
  join players p on p.id = me.player_id
  where is_team_member(p_team_id)
    and me.team_id = p_team_id
    and e.team_id  = p_team_id
    and p.team_id  = p_team_id
    and me.kind = 'goal'
    and e.type = 'match'
    and e.date >= p_start and e.date <= p_end
  group by me.minute
  order by me.minute nulls last;
$$;

-- ── RPC 4: tegendoelpunten per minuut en soort ──
create or replace function public.inzichten_tegendoelpunten(p_team_id uuid, p_start date, p_end date)
returns table (minuut int, soort text, aantal int)
language sql stable security invoker set search_path = public
as $$
  select t.minute::int, t.soort, count(*)::int
  from tegendoelpunten t
  join events e on e.id = t.event_id
  where is_team_member(p_team_id)
    and t.team_id = p_team_id
    and e.team_id = p_team_id
    and e.type = 'match'
    and e.date >= p_start and e.date <= p_end
  group by t.minute, t.soort
  order by t.minute nulls last, t.soort;
$$;

-- Rechten gelden PER SIGNATUUR.
revoke all on function public.inzichten_wedstrijd_uitslagen(uuid, date, date)  from public, anon;
revoke all on function public.inzichten_speler_momenten(uuid, date, date)      from public, anon;
revoke all on function public.inzichten_doelpunten_per_minuut(uuid, date, date) from public, anon;
revoke all on function public.inzichten_tegendoelpunten(uuid, date, date)      from public, anon;
grant execute on function public.inzichten_wedstrijd_uitslagen(uuid, date, date)  to authenticated;
grant execute on function public.inzichten_speler_momenten(uuid, date, date)      to authenticated;
grant execute on function public.inzichten_doelpunten_per_minuut(uuid, date, date) to authenticated;
grant execute on function public.inzichten_tegendoelpunten(uuid, date, date)      to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'inzichten_wedstrijd_uitslagen','inzichten_speler_momenten',
--   'inzichten_doelpunten_per_minuut','inzichten_tegendoelpunten')
-- order by 1;
--
-- select policyname, cmd from pg_policies
-- where schemaname = 'public' and tablename = 'tegendoelpunten' order by 1;
