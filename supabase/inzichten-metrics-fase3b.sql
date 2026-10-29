-- ============================================================
-- Pitchup — inzichten-metrics fase 3b (RPE en doelstelling-oordeel per training)
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor (of via de
-- Supabase-MCP). Idempotent; mag opnieuw.
-- NIEUW: tabel public.training_evaluaties (één rij per training; rpe en oordeel
-- elk nullable en los te schrijven) + 1 lees-RPC. Raakt GEEN bestaande functie
-- of policy (inzichten-team-id.sql en inzichten-metrics*.sql NIET opnieuw
-- draaien). Daarna: supabase/team-rls-verificatie.sql blok 2, 22 en 30.
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan toont de
-- trainingspagina "RPE en oordeel niet beschikbaar" in de eigen sectie en
-- geeft de RPC PGRST202 (alleen de fase-3b-kaarten en de disciplineregel op
-- /inzichten tonen een melding); de rest blijft werken.
--
-- Toekomstcheck en "oordeel alleen bij doelstelling" staan BEWUST in de app
-- (app/actions/training-evaluatie.ts), niet in RLS: productregels, geen
-- tenantgrens. Een doelstellingscheck hier zou bovendien R5.1 breken (het
-- oordeel blijft staan als de tekst later leeg wordt).
-- rpe 1..10 = RPE_MIN/RPE_MAX, oordeel = TRAINING_OORDELEN (lib/training-evaluatie.ts).
-- limit 901 = MAX_FASE3_RIJEN + 1 (lib/inzichten.ts); `totaal` = count(*) over ()
-- vóór de limit (isAfgekapt in lib/inzichten.ts).
-- Tijd: geen datums in de tabel; de trainingsdatum komt uit events.date (DATE),
-- de ISO-week wordt in TS bepaald. created_at is UTC (timestamptz), informatief.
-- ============================================================
begin;

-- ── Tabel ────────────────────────────────────────────────────
-- Eén rij per training (unique event_id). Beide kolommen nullable: de app
-- schrijft per kolom via upsert met ALLEEN die kolom in de payload, zodat RPE
-- opslaan het oordeel nooit wist en andersom (R.9). Wissen = die kolom op null
-- zetten, geen delete; een rij met beide null geldt als "niet ingevuld". Bewust
-- geen CHECK "minstens één niet-null": die zou het wissen van de laatste waarde
-- onmogelijk maken zonder delete. Een CHECK op NULL slaagt (unknown).
-- FK's met cascade: verdwijnt het team of de training, dan gaat de rij mee.
create table if not exists public.training_evaluaties (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id)  on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  rpe        smallint constraint training_evaluaties_rpe_check check (rpe between 1 and 10),
  oordeel    text     constraint training_evaluaties_oordeel_check check (oordeel in ('ja', 'deels', 'nee')),
  created_at timestamptz not null default now(),
  constraint training_evaluaties_event_key unique (event_id)
);
-- De unique constraint dekt event_id; team_id voor opruimen en RLS.
create index if not exists idx_training_evaluaties_team on public.training_evaluaties(team_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.training_evaluaties enable row level security;
drop policy if exists "training_evaluaties: lid mag lezen"      on public.training_evaluaties;
drop policy if exists "training_evaluaties: recht mag maken"    on public.training_evaluaties;
drop policy if exists "training_evaluaties: recht mag wijzigen" on public.training_evaluaties;
drop policy if exists "training_evaluaties: recht mag wissen"   on public.training_evaluaties;

create policy "training_evaluaties: lid mag lezen" on public.training_evaluaties
  for select using (is_team_member(team_id));
-- Upsert = insert én update: beide met dezelfde DB-grens bovenop
-- eigenGehoudenTraining in app/actions/training-evaluatie.ts. Een FK-check
-- negeert RLS, dus zonder deze exists-check zou een vervalst event_id van een
-- ander team hier een rij kunnen vastzetten (unique event_id).
create policy "training_evaluaties: recht mag maken" on public.training_evaluaties
  for insert with check (
    can_edit(team_id, 'training')
    and exists (select 1 from public.events e
                where e.id = training_evaluaties.event_id
                  and e.team_id = training_evaluaties.team_id
                  and e.type = 'training')
  );
create policy "training_evaluaties: recht mag wijzigen" on public.training_evaluaties
  for update using (can_edit(team_id, 'training'))
  with check (
    can_edit(team_id, 'training')
    and exists (select 1 from public.events e
                where e.id = training_evaluaties.event_id
                  and e.team_id = training_evaluaties.team_id
                  and e.type = 'training')
  );
-- Verwijderen alleen op recht: opruimen (ruimTeamOp) moet altijd kunnen.
create policy "training_evaluaties: recht mag wissen" on public.training_evaluaties
  for delete using (can_edit(team_id, 'training'));

-- ── RPC: één rij per training in het venster ─────────────────
-- Met (nullable) rpe/oordeel en de huidige doelstelling. Teamfilter van de
-- evaluatie in de ON (left join blijft left join: een training zonder
-- evaluatie geeft één rij met null). security invoker + is_team_member +
-- `<alias>.team_id = p_team_id` op elke echte tabel (patroon fase 3a).
create or replace function public.inzichten_training_evaluaties(p_team_id uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, doelstelling text, rpe int, oordeel text, totaal int)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.doelstelling, te.rpe::int, te.oordeel,
         (count(*) over ())::int
  from events e
  left join training_evaluaties te on te.event_id = e.id and te.team_id = p_team_id
  where is_team_member(p_team_id)
    and e.team_id = p_team_id
    and e.type = 'training'
    and e.date >= p_start and e.date <= p_end
  order by e.date, e.id
  limit 901;
$$;

revoke all on function public.inzichten_training_evaluaties(uuid, date, date) from public, anon;
grant execute on function public.inzichten_training_evaluaties(uuid, date, date) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'inzichten_training_evaluaties';
-- select policyname, cmd from pg_policies where tablename = 'training_evaluaties';
