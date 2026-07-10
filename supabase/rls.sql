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

-- ── settings (if exists) ─────────────────────────────────────
alter table settings enable row level security;

create policy "settings: team_id = auth.uid()"
  on settings for all
  using (team_id = auth.uid())
  with check (team_id = auth.uid());

-- ── Verification query ───────────────────────────────────────
-- Run this after enabling to verify all tables have RLS enabled:
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public'
-- order by tablename;
