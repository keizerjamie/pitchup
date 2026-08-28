-- ============================================================
-- Pitchup — Flexibel spelersaantal per oefening (migration)
-- Run this in the Supabase SQL Editor.
--
-- 1) oefeningen.aantal_neutralen_max — bovengrens van een flexibel aantal
--    neutralen. NULL = vast aantal (bestaand gedrag).
--    De teamkant (grootteMax) heeft GEEN migratie nodig: die leeft in de
--    bestaande JSONB-kolom `teams`, net als keeperInGrootte.
-- 2) training_oefeningen.aantallen_override — TRAINING-specifieke bezetting
--    binnen het door de bibliotheek toegestane bereik. Delta-object:
--    {"teams":[5,null],"neutralen":null} — null = basisvorm.
--    NULL (geen rij-waarde) = geen override; dat is ook wat kopieren oplevert.
--
-- Backfill: geen — NULL dekt alle bestaande rijen.
-- RLS: geen nieuwe policy nodig; "oefeningen: own team only" resp.
-- "training_oefeningen: own team only" (team_id = auth.uid()) dekken beide
-- kolommen (supabase/training-plan.sql).
-- ============================================================

BEGIN;

ALTER TABLE oefeningen
  ADD COLUMN IF NOT EXISTS aantal_neutralen_max SMALLINT;

ALTER TABLE oefeningen
  DROP CONSTRAINT IF EXISTS oefeningen_aantal_neutralen_max_bereik;
ALTER TABLE oefeningen
  ADD CONSTRAINT oefeningen_aantal_neutralen_max_bereik
  CHECK (aantal_neutralen_max IS NULL OR aantal_neutralen_max BETWEEN 0 AND 30);

-- Bovengrens mag nooit onder het basisaantal liggen. DB-vangnet naast de
-- applicatievalidatie in lib/oefening.ts (validateOefening).
ALTER TABLE oefeningen
  DROP CONSTRAINT IF EXISTS oefeningen_aantal_neutralen_max_niet_lager;
ALTER TABLE oefeningen
  ADD CONSTRAINT oefeningen_aantal_neutralen_max_niet_lager
  CHECK (aantal_neutralen_max IS NULL OR aantal_neutralen_max >= aantal_neutralen);

ALTER TABLE training_oefeningen
  ADD COLUMN IF NOT EXISTS aantallen_override JSONB;

ALTER TABLE training_oefeningen
  DROP CONSTRAINT IF EXISTS training_oefeningen_aantallen_override_object;
ALTER TABLE training_oefeningen
  ADD CONSTRAINT training_oefeningen_aantallen_override_object
  CHECK (aantallen_override IS NULL OR jsonb_typeof(aantallen_override) = 'object');

COMMIT;
