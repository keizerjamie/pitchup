-- ============================================================
-- Pitchup — Spelerindeling per trainingsoefening (migration)
-- Run this in the Supabase SQL Editor.
-- Voegt een TRAINING-SPECIFIEKE teamindeling toe aan de koppeltabel
-- `training_oefeningen` (niet aan de bibliotheek-oefening — anders zou een
-- indeling doorlekken naar andere trainingen die dezelfde oefening gebruiken).
--
-- Vorm: JSONB array-van-arrays. spelerindeling[i] = lijst player_id's (strings)
-- in team i, waarbij i = index in oefeningen.teams. Leeg [] = niemand ingedeeld;
-- een player_id in geen enkele sub-array = in de pool.
--
-- Backfill: geen — de default '[]' dekt bestaande rijen.
-- RLS: geen nieuwe policy nodig; de bestaande policy
-- "training_oefeningen: own team only" (team_id = auth.uid()) dekt de kolom.
-- ============================================================

BEGIN;

ALTER TABLE training_oefeningen
  ADD COLUMN IF NOT EXISTS spelerindeling JSONB NOT NULL DEFAULT '[]';

-- Waarborg dat de waarde altijd een JSON-array is. Idempotent: eerst droppen,
-- dan opnieuw toevoegen.
ALTER TABLE training_oefeningen
  DROP CONSTRAINT IF EXISTS training_oefeningen_spelerindeling_array;
ALTER TABLE training_oefeningen
  ADD CONSTRAINT training_oefeningen_spelerindeling_array
  CHECK (jsonb_typeof(spelerindeling) = 'array');

COMMIT;
