-- ============================================================
-- Pitchup — inzichten-metrics fase 2b (speelminuten en wissels)
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor (of via de
-- Supabase-MCP). Idempotent; mag opnieuw.
-- NIEUW: tabel public.speelminuten (één rij per wedstrijd per speler) + 1
-- lees-RPC. Raakt GEEN bestaande functie of policy (inzichten-team-id.sql,
-- inzichten-metrics.sql en inzichten-metrics-fase2.sql NIET opnieuw draaien).
-- Daarna: supabase/team-rls-verificatie.sql blok 2, 22 en 28.
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan toont de
-- wedstrijdanalyse "speelminuten niet beschikbaar" en de kaart op /inzichten
-- een foutmelding (PGRST202 afgevangen); de rest blijft werken.
--
-- LET OP: events en players hebben allebei een kolom `type`; aliassen e/p
-- houden dat uit elkaar. Daarom heten de kolommen hier `minuten`/`wissels`.
-- `minuten` 0..130 = isValidMinute/isValidSpeelminuten, `wissels` 0..99 =
-- MAX_WISSELS (lib/match-analysis.mjs).
-- ============================================================
begin;

-- ── Tabel ────────────────────────────────────────────────────
-- Eén rij per (event_id, player_id): de app schrijft via upsert op die sleutel
-- (laatste wint, nooit een dubbele rij). FK's met cascade: verdwijnt het team,
-- de wedstrijd of de speler, dan verdwijnen zijn rijen mee. Geen kloktijden;
-- `created_at` is UTC (timestamptz) en dient alleen het herstel na "Ongedaan
-- maken".
create table if not exists public.speelminuten (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id)   on delete cascade,
  event_id   uuid not null references public.events(id)  on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  minuten    smallint not null constraint speelminuten_minuten_check check (minuten between 0 and 130),
  wissels    smallint not null constraint speelminuten_wissels_check check (wissels between 0 and 99),
  created_at timestamptz not null default now(),
  constraint speelminuten_event_player_key unique (event_id, player_id)
);
-- De unique constraint dekt event_id; team_id voor opruimen en RLS, player_id
-- voor de cascade bij het verwijderen van een speler.
create index if not exists idx_speelminuten_team   on public.speelminuten(team_id);
create index if not exists idx_speelminuten_player on public.speelminuten(player_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.speelminuten enable row level security;
drop policy if exists "speelminuten: lid mag lezen"      on public.speelminuten;
drop policy if exists "speelminuten: recht mag maken"    on public.speelminuten;
drop policy if exists "speelminuten: recht mag wijzigen" on public.speelminuten;
drop policy if exists "speelminuten: recht mag wissen"   on public.speelminuten;

create policy "speelminuten: lid mag lezen" on public.speelminuten
  for select using (is_team_member(team_id));
-- Upsert = insert én update: beide met dezelfde DB-grens bovenop
-- eigenGespeeldeWedstrijd/assertOwnPlayer in app/actions/speelminuten.ts. Een
-- FK-check negeert RLS, dus zonder deze exists-checks zou een vervalst
-- event_id of player_id van een ander team hier een rij kunnen vastzetten.
create policy "speelminuten: recht mag maken" on public.speelminuten
  for insert with check (
    can_edit(team_id, 'wedstrijd')
    and exists (select 1 from public.events e
                where e.id = speelminuten.event_id
                  and e.team_id = speelminuten.team_id
                  and e.type = 'match')
    and exists (select 1 from public.players p
                where p.id = speelminuten.player_id
                  and p.team_id = speelminuten.team_id)
  );
create policy "speelminuten: recht mag wijzigen" on public.speelminuten
  for update using (can_edit(team_id, 'wedstrijd'))
  with check (
    can_edit(team_id, 'wedstrijd')
    and exists (select 1 from public.events e
                where e.id = speelminuten.event_id
                  and e.team_id = speelminuten.team_id
                  and e.type = 'match')
    and exists (select 1 from public.players p
                where p.id = speelminuten.player_id
                  and p.team_id = speelminuten.team_id)
  );
-- Verwijderen alleen op recht: opruimen moet altijd kunnen, ook als de speler
-- inactief is of het event intussen geen wedstrijd meer is.
create policy "speelminuten: recht mag wissen" on public.speelminuten
  for delete using (can_edit(team_id, 'wedstrijd'));

-- ── RPC: speelminuten per speler in het venster ──────────────
-- noemer = aantal wedstrijden in het venster met >=1 rij (M3). Rijen: elke
-- speler MET een rij (ook gast/inactief, M4) plus actieve vaste spelers zonder
-- rij (wedstrijden 0 → "geen gegevens", AC-K.4). Geen rij als noemer = 0 (lege
-- staat AC-K.9). Geen limit: hooguit één rij per speler.
-- security invoker + is_team_member(p_team_id) + `<alias>.team_id = p_team_id`
-- op ELKE echte tabel (patroon supabase/inzichten-metrics-fase2.sql).
create or replace function public.inzichten_speelminuten_per_speler(p_team_id uuid, p_start date, p_end date)
returns table (player_id uuid, naam text, gast boolean, wedstrijden int, minuten int, wissels int, noemer int)
language sql stable security invoker set search_path = public
as $$
  with rijen as (
    select sm.event_id, sm.player_id, sm.minuten, sm.wissels
    from speelminuten sm
    join events  e  on e.id  = sm.event_id
    join players pl on pl.id = sm.player_id
    where is_team_member(p_team_id)
      and sm.team_id = p_team_id
      and e.team_id  = p_team_id
      and pl.team_id = p_team_id
      and e.type = 'match'
      and e.date >= p_start and e.date <= p_end
  ),
  per_speler as (
    select r.player_id, count(*)::int as wedstrijden, sum(r.minuten)::int as minuten, sum(r.wissels)::int as wissels
    from rijen r
    group by r.player_id
  ),
  noemer as (
    select count(distinct r.event_id)::int as n from rijen r
  )
  select p.id, p.name, (p.type = 'guest'),
         coalesce(ps.wedstrijden, 0), ps.minuten, ps.wissels, nm.n
  from players p
  cross join noemer nm
  left join per_speler ps on ps.player_id = p.id
  where is_team_member(p_team_id)
    and p.team_id = p_team_id
    and nm.n > 0
    and (ps.player_id is not null or (p.active is distinct from false and p.type = 'regular'))
  order by p.name, p.id;
$$;

revoke all on function public.inzichten_speelminuten_per_speler(uuid, date, date) from public, anon;
grant execute on function public.inzichten_speelminuten_per_speler(uuid, date, date) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select polname, polcmd from pg_policy where polrelid = 'public.speelminuten'::regclass order by 1;
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'inzichten_speelminuten_per_speler';
