-- ============================================================
-- Pitchup — Taak-overrides (To-do) (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Handmatig afgevinkte taken per event (lineup/analysis/training_plan).
-- Een rij = deze taak is voor dit event handmatig als 'klaar' gemarkeerd.
CREATE TABLE IF NOT EXISTS task_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('lineup','analysis','training_plan')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (team_id, event_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_task_overrides_event ON task_overrides(event_id);
CREATE INDEX IF NOT EXISTS idx_task_overrides_team  ON task_overrides(team_id);

ALTER TABLE task_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_overrides: own team only" ON task_overrides;
CREATE POLICY "task_overrides: own team only" ON task_overrides FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());
