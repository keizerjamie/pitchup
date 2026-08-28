-- ============================================================
-- Pitchup — Taak-overrides (To-do) (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Handmatig afgevinkte taken per event (squad/lineup/analysis/training_plan).
-- Een rij = deze taak is voor dit event handmatig als 'klaar' gemarkeerd.
CREATE TABLE IF NOT EXISTS task_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('squad','lineup','analysis','training_plan')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (team_id, event_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_task_overrides_event ON task_overrides(event_id);
CREATE INDEX IF NOT EXISTS idx_task_overrides_team  ON task_overrides(team_id);

ALTER TABLE task_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_overrides: own team only" ON task_overrides;
CREATE POLICY "task_overrides: own team only" ON task_overrides FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());

-- ── Splitsing wedstrijdselectie / opstelling ────────────────────────────────
-- Voor bestaande installaties: 'squad' toestaan in de CHECK-constraint, en
-- elke al afgevinkte 'lineup'-taak ook als 'squad' wegschrijven, zodat een
-- wedstrijd die de gebruiker al had afgevinkt niet ineens weer open staat.
ALTER TABLE task_overrides DROP CONSTRAINT IF EXISTS task_overrides_task_type_check;
ALTER TABLE task_overrides ADD CONSTRAINT task_overrides_task_type_check
  CHECK (task_type IN ('squad','lineup','analysis','training_plan'));

INSERT INTO task_overrides (team_id, event_id, task_type)
SELECT team_id, event_id, 'squad' FROM task_overrides WHERE task_type = 'lineup'
ON CONFLICT (team_id, event_id, task_type) DO NOTHING;
