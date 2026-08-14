-- ============================================================
-- Pitchup — Parallelle oefeningen binnen een training (migration)
-- Run this in the Supabase SQL Editor.
--
-- Voegt aan de koppeltabel `training_oefeningen` toe:
--  1) parallel_groep_id — groepssleutel; alle koppelingen met dezelfde waarde
--     binnen hetzelfde event zijn PARALLEL (naast elkaar) gepland. NULL =
--     gewone sequentiële koppeling. Bewust geen FK: dit is een vrije
--     groepssleutel, geen verwijzing naar een rij (anders sloopt een
--     ON DELETE SET NULL de hele groep bij het ontkoppelen van één lid).
--  2) parallel_spelers — welke spelers aan DEZE oefening binnen de groep zijn
--     toegewezen. Platte JSON-array van player_id-strings. Staat LOS van
--     `spelerindeling` (string[][], de teamindeling BINNEN een oefening) —
--     toewijzing aan een parallelle oefening plaatst een speler bewust NIET
--     automatisch in een team van die oefening.
--
-- Backfill: geen — NULL resp. '[]' dekt alle bestaande rijen.
-- RLS: geen nieuwe policy nodig; "training_oefeningen: own team only"
-- (team_id = auth.uid()) dekt beide kolommen.
-- ============================================================

BEGIN;

ALTER TABLE training_oefeningen
  ADD COLUMN IF NOT EXISTS parallel_groep_id UUID;

ALTER TABLE training_oefeningen
  ADD COLUMN IF NOT EXISTS parallel_spelers JSONB NOT NULL DEFAULT '[]';

-- Waarborg dat de waarde altijd een JSON-array is. Idempotent: eerst droppen,
-- dan opnieuw toevoegen.
ALTER TABLE training_oefeningen
  DROP CONSTRAINT IF EXISTS training_oefeningen_parallel_spelers_array;
ALTER TABLE training_oefeningen
  ADD CONSTRAINT training_oefeningen_parallel_spelers_array
  CHECK (jsonb_typeof(parallel_spelers) = 'array');

-- Spelers kunnen alleen aan een oefening BINNEN een groep worden toegewezen:
-- zonder groep hoort de lijst leeg te zijn (het loshalen uit een groep wist hem).
ALTER TABLE training_oefeningen
  DROP CONSTRAINT IF EXISTS training_oefeningen_parallel_spelers_alleen_in_groep;
ALTER TABLE training_oefeningen
  ADD CONSTRAINT training_oefeningen_parallel_spelers_alleen_in_groep
  CHECK (parallel_groep_id IS NOT NULL OR parallel_spelers = '[]'::jsonb);

CREATE INDEX IF NOT EXISTS idx_training_oefeningen_parallel_groep
  ON training_oefeningen(event_id, parallel_groep_id);

COMMIT;
