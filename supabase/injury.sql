-- ============================================================
-- Blessurefunctionaliteit — migratie
-- Run this in the Supabase SQL Editor
-- ============================================================

ALTER TABLE players    ADD COLUMN IF NOT EXISTS injured    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS injury_set BOOLEAN NOT NULL DEFAULT false;
