-- ============================================================
-- Pitchup — trainer-zelfreview (privé zelfreview per trainer per training)
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor (of via de
-- Supabase-MCP). Idempotent; mag opnieuw.
-- NIEUW: tabel public.trainer_zelfreviews (één rij per trainer per training;
-- vijf verplichte scores 1..5 en een optionele tekst) + 1 lees-RPC
-- public.inzichten_eigen_zelfreviews. Raakt GEEN bestaande tabel, functie of
-- policy (task_overrides, training_evaluaties en de inzichten-RPC's blijven
-- zoals ze zijn). Daarna: supabase/team-rls-verificatie.sql blok 2, 22 en 31.
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan toont de
-- trainingspagina "Je zelfreview is nu niet beschikbaar" in de eigen sectie,
-- geeft het dashboard geen reviewitems en geeft de RPC PGRST202 (alleen de
-- zelfreviewkaart op /inzichten toont een melding); de rest blijft werken.
--
-- PRIVACY: elke rij is alleen leesbaar voor de schrijver zelf — ook NIET voor
-- de hoofdtrainer of andere assistenten (select-policy op user_id =
-- auth.uid()). Daarom staat de tabel BEWUST NIET in TEAM_TABELLEN
-- (lib/team-opruimen.ts): de hoofdtrainer kan andermans rijen niet zien en dus
-- niet expliciet wissen. Opruimen gaat via de cascades: training weg, lid weg
-- (team_members-rij) of team weg → de zelfreviews gaan mee.
--
-- Er is GEEN delete-policy: de app wist nooit een zelfreview; verdwijnen gaat
-- alleen via de cascades hierboven.
--
-- De datumcheck "training niet in de toekomst" staat hier in RLS als vangnet
-- (bewuste afwijking van fase 3b, waar die alleen in de app staat): een
-- zelfreview over een training die nog moet komen heeft geen betekenis, en het
-- schrijven gebeurt per trainer zonder dat de hoofdtrainer het kan zien of
-- corrigeren. De vergelijking is op de Nederlandse kalenderdag; de app
-- (todayLocal(), app/actions/trainer-zelfreview.ts) is gelijk of strenger.
--
-- score_* 1..5 = ZELFREVIEW_SCORE_MIN/ZELFREVIEW_SCORE_MAX, de vijf kolommen =
-- ZELFREVIEW_STELLINGEN, meeneem <= 1000 = ZELFREVIEW_MEENEEM_MAX
-- (lib/trainer-zelfreview.ts).
-- limit 901 = MAX_FASE3_RIJEN + 1 (lib/inzichten.ts); `totaal` = count(*) over ()
-- vóór de limit (isAfgekapt in lib/inzichten.ts).
-- Tijd: created_at/updated_at zijn UTC (timestamptz); de app zet updated_at bij
-- elke upsert. De trainingsdatum komt uit events.date (DATE), de ISO-week wordt
-- in TS bepaald.
-- ============================================================
begin;

-- ── Tabel ────────────────────────────────────────────────────
-- Eén rij per trainer per training (unique event_id, user_id). Alle scores
-- verplicht; meeneem optioneel. GEEN FK naar auth.users (zie team_members in
-- supabase/teams-en-leden.sql); wel een samengestelde FK naar het
-- lidmaatschap, zodat een rij altijd bij een bestaand lid van dít team hoort en
-- meeverdwijnt als dat lidmaatschap verdwijnt.
create table if not exists public.trainer_zelfreviews (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references public.teams(id)  on delete cascade,
  user_id              uuid not null,
  event_id             uuid not null references public.events(id) on delete cascade,
  score_uitleg         smallint not null constraint trainer_zelfreviews_score_uitleg_check check (score_uitleg between 1 and 5),
  score_organisatie    smallint not null constraint trainer_zelfreviews_score_organisatie_check check (score_organisatie between 1 and 5),
  score_coaching       smallint not null constraint trainer_zelfreviews_score_coaching_check check (score_coaching between 1 and 5),
  score_sfeer          smallint not null constraint trainer_zelfreviews_score_sfeer_check check (score_sfeer between 1 and 5),
  score_tijdsbewaking  smallint not null constraint trainer_zelfreviews_score_tijdsbewaking_check check (score_tijdsbewaking between 1 and 5),
  meeneem              text constraint trainer_zelfreviews_meeneem_check check (meeneem is null or char_length(meeneem) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint trainer_zelfreviews_event_user_key unique (event_id, user_id),
  constraint trainer_zelfreviews_lid_fkey foreign key (team_id, user_id)
    references public.team_members(team_id, user_id) on delete cascade
);
-- De unique constraint dekt event_id; (team_id, user_id) voor de RPC, RLS en
-- de cascade vanuit team_members.
create index if not exists idx_trainer_zelfreviews_team_user on public.trainer_zelfreviews(team_id, user_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.trainer_zelfreviews enable row level security;
drop policy if exists "trainer_zelfreviews: alleen eigen rij lezen" on public.trainer_zelfreviews;
drop policy if exists "trainer_zelfreviews: eigen rij maken"        on public.trainer_zelfreviews;
drop policy if exists "trainer_zelfreviews: eigen rij wijzigen"     on public.trainer_zelfreviews;

-- Lezen: alleen de eigen rij, en alleen zolang je lid bent van het team. Ook
-- zonder trainingsrecht (V5: dan alleen-lezen).
create policy "trainer_zelfreviews: alleen eigen rij lezen" on public.trainer_zelfreviews
  for select using (user_id = auth.uid() and is_team_member(team_id));
-- Upsert = insert én update: beide met dezelfde DB-grens bovenop
-- eigenGehoudenTraining in app/actions/trainer-zelfreview.ts. Een FK-check
-- negeert RLS, dus zonder deze exists-check zou een vervalst event_id van een
-- ander team hier een rij kunnen vastzetten.
create policy "trainer_zelfreviews: eigen rij maken" on public.trainer_zelfreviews
  for insert with check (
    user_id = auth.uid()
    and can_edit(team_id, 'training')
    and exists (select 1 from public.events e
                where e.id = trainer_zelfreviews.event_id
                  and e.team_id = trainer_zelfreviews.team_id
                  and e.type = 'training'
                  and e.date <= (now() at time zone 'Europe/Amsterdam')::date)
  );
create policy "trainer_zelfreviews: eigen rij wijzigen" on public.trainer_zelfreviews
  for update using (user_id = auth.uid() and can_edit(team_id, 'training'))
  with check (
    user_id = auth.uid()
    and can_edit(team_id, 'training')
    and exists (select 1 from public.events e
                where e.id = trainer_zelfreviews.event_id
                  and e.team_id = trainer_zelfreviews.team_id
                  and e.type = 'training'
                  and e.date <= (now() at time zone 'Europe/Amsterdam')::date)
  );
-- Bewust GEEN delete-policy (zie de kop).

-- ── RPC: de eigen zelfreviews in het venster ─────────────────
-- Eén rij per eigen zelfreview over een training van dit team. meeneem zit er
-- BEWUST niet in: de kaart toont alleen scores. security invoker +
-- is_team_member + `<alias>.team_id = p_team_id` op elke echte tabel (patroon
-- fase 3a/3b), plus z.user_id = auth.uid() (de select-policy doet dat ook;
-- dit is de tweede laag).
create or replace function public.inzichten_eigen_zelfreviews(p_team_id uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, score_uitleg int, score_organisatie int, score_coaching int,
               score_sfeer int, score_tijdsbewaking int, totaal int)
language sql stable security invoker set search_path = public
as $$
  select z.event_id, e.date, z.score_uitleg::int, z.score_organisatie::int, z.score_coaching::int,
         z.score_sfeer::int, z.score_tijdsbewaking::int, (count(*) over ())::int
  from trainer_zelfreviews z
  join events e on e.id = z.event_id and e.team_id = p_team_id
  where is_team_member(p_team_id)
    and z.team_id = p_team_id
    and z.user_id = auth.uid()
    and e.type = 'training'
    and e.date >= p_start and e.date <= p_end
  order by e.date, e.id
  limit 901;
$$;

revoke all on function public.inzichten_eigen_zelfreviews(uuid, date, date) from public, anon;
grant execute on function public.inzichten_eigen_zelfreviews(uuid, date, date) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'inzichten_eigen_zelfreviews';
-- select policyname, cmd from pg_policies where tablename = 'trainer_zelfreviews';
