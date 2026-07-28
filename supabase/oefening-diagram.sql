-- ============================================================
-- Pitchup — Oefening tactiekbord (diagram) (migration)
-- Run this in the Supabase SQL Editor.
-- Voegt een optionele JSONB-tekening toe aan bibliotheek-oefeningen.
-- Backfill: geen — bestaande rijen blijven NULL (= geen opgeslagen tekening).
-- ============================================================

BEGIN;

ALTER TABLE oefeningen ADD COLUMN IF NOT EXISTS diagram JSONB;   -- NULL = geen opgeslagen tekening

-- Groottelimiet: houd de tekening klein genoeg (< 64 KiB) zodat een geknutselde
-- payload de rij niet laat exploderen. Idempotent: eerst droppen, dan opnieuw.
ALTER TABLE oefeningen DROP CONSTRAINT IF EXISTS oefeningen_diagram_size;
ALTER TABLE oefeningen ADD CONSTRAINT oefeningen_diagram_size
  CHECK (diagram IS NULL OR pg_column_size(diagram) < 65536);

COMMIT;
