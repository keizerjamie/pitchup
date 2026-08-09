-- ============================================================
-- Pitchup — Row Level Security policies
-- Run this in the Supabase SQL Editor to secure all tables.
-- team_id = auth.uid() ensures each trainer only sees their own data.
-- ============================================================

-- ── players ──────────────────────────────────────────────────
alter table players enable row level security;

create policy "players: team_id = auth.uid()"
  on players for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── events ───────────────────────────────────────────────────
alter table events enable row level security;

create policy "events: team_id = auth.uid()"
  on events for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── attendance ───────────────────────────────────────────────
alter table attendance enable row level security;

create policy "attendance: team_id = auth.uid()"
  on attendance for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── lineups ──────────────────────────────────────────────────
alter table lineups enable row level security;

create policy "lineups: team_id = auth.uid()"
  on lineups for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── match_ratings ────────────────────────────────────────────
alter table match_ratings enable row level security;

create policy "match_ratings: own team only"
  on match_ratings for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── match_events ─────────────────────────────────────────────
alter table match_events enable row level security;

create policy "match_events: own team only"
  on match_events for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── task_overrides ───────────────────────────────────────────
alter table task_overrides enable row level security;

create policy "task_overrides: own team only"
  on task_overrides for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── match_squad ──────────────────────────────────────────────
alter table match_squad enable row level security;

create policy "match_squad: own team only"
  on match_squad for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── settings (if exists) ─────────────────────────────────────
alter table settings enable row level security;

create policy "settings: team_id = auth.uid()"
  on settings for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── storage.objects (team-logos) ─────────────────────────────
-- Ook opgenomen in supabase/team-logo.sql (zelfde dubbele-opname als
-- match_squad). Let op: hier hangt de isolatie NIET aan een team_id-KOLOM —
-- storage.objects heeft die niet — maar aan de padconventie
-- team-logos/<team_id>/logo. (storage.foldername(name))[1] is het eerste
-- padsegment en moet gelijk zijn aan auth.uid(). De bucket zelf is publiek
-- LEESBAAR (nodig voor <img src> in de zijbalk en de afdrukkop); schrijven en
-- verwijderen blijft afgeschermd door onderstaande policies.
--
-- GEEN "alter table storage.objects enable row level security" hier: die tabel
-- is eigendom van de interne supabase_storage_admin-rol, dus de SQL Editor
-- mag dat niet uitvoeren ("must be owner of table objects"). Niet nodig ook:
-- RLS staat op storage.objects in elk Supabase-project al standaard aan.
drop policy if exists "team-logos: insert own folder" on storage.objects;
create policy "team-logos: insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Een upload met upsert:true op een BESTAAND object is een UPDATE, geen INSERT:
-- zonder deze policy zou alleen de eerste upload slagen.
drop policy if exists "team-logos: update own folder" on storage.objects;
create policy "team-logos: update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "team-logos: delete own folder" on storage.objects;
create policy "team-logos: delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "team-logos: select own folder" on storage.objects;
create policy "team-logos: select own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Verification query ───────────────────────────────────────
-- Run this after enabling to verify all tables have RLS enabled:
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public'
-- order by tablename;
