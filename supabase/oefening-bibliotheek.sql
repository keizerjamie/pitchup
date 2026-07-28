-- ============================================================
-- Pitchup — Oefening-bibliotheek (migration)
-- Run this in the Supabase SQL Editor.
--
-- Maakt van `oefeningen` een event-onafhankelijke BIBLIOTHEEK en introduceert
-- de koppeltabel `training_oefeningen` (oefening <-> training). Bestaande data
-- wordt transactioneel gebackfilld VÓÓR de oude kolommen sneuvelen.
-- ============================================================

BEGIN;

-- 1a. Nieuwe bibliotheek-kolommen op `oefeningen`.
ALTER TABLE oefeningen
  ADD COLUMN IF NOT EXISTS teams JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS aantal_neutralen SMALLINT NOT NULL DEFAULT 0
    CHECK (aantal_neutralen BETWEEN 0 AND 30);

-- Optioneel DB-vangnet: maximaal 6 teams per oefening.
ALTER TABLE oefeningen DROP CONSTRAINT IF EXISTS oefeningen_teams_max;
ALTER TABLE oefeningen
  ADD CONSTRAINT oefeningen_teams_max CHECK (jsonb_array_length(teams) <= 6);

-- 1b. Koppeltabel (analoog aan attendance).
CREATE TABLE IF NOT EXISTS training_oefeningen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  oefening_id UUID NOT NULL REFERENCES oefeningen(id) ON DELETE CASCADE,
  volgorde SMALLINT NOT NULL DEFAULT 0,
  stap_override SMALLINT,
  genest_in UUID REFERENCES training_oefeningen(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, oefening_id)
);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_event ON training_oefeningen(event_id, volgorde);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_oefening ON training_oefeningen(oefening_id);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_team ON training_oefeningen(team_id);
ALTER TABLE training_oefeningen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_oefeningen: own team only" ON training_oefeningen;
CREATE POLICY "training_oefeningen: own team only" ON training_oefeningen FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());

-- 2. Backfill: elke bestaande oefening wordt één koppeling aan haar training.
INSERT INTO training_oefeningen (team_id, event_id, oefening_id, volgorde, stap_override)
SELECT team_id, event_id, id, volgorde, stap_override
FROM oefeningen;

-- 3. Nesting vertalen naar de OUDER-KOPPELING binnen dezelfde training.
UPDATE training_oefeningen k
SET genest_in = pk.id
FROM oefeningen o, training_oefeningen pk
WHERE k.oefening_id = o.id
  AND o.genest_in IS NOT NULL
  AND pk.oefening_id = o.genest_in
  AND pk.event_id = k.event_id;

-- 4. teams='[]' / aantal_neutralen=0 voor bestaande rijen — defaults dekken dit al.

-- 5. Pas ná de backfill: de oude event-gebonden kolommen droppen.
DROP INDEX IF EXISTS idx_oefeningen_event;
ALTER TABLE oefeningen
  DROP COLUMN IF EXISTS event_id,
  DROP COLUMN IF EXISTS volgorde,
  DROP COLUMN IF EXISTS stap_override,
  DROP COLUMN IF EXISTS genest_in,
  DROP COLUMN IF EXISTS aantal_teams;

COMMIT;
