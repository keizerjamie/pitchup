-- ============================================================
-- Pitchup — Extra oefening-categorieën (migration)
-- Run this in the Supabase SQL Editor.
-- Voegt 'warming_up', 'positiespel' en 'pass_trap' toe aan de toegestane
-- categorieën van oefeningen.categorie. Idempotent + transactioneel.
-- ============================================================

BEGIN;

-- De categorie-CHECK is in supabase/training-plan.sql als inline kolom-CHECK
-- gedefinieerd; Postgres noemt die automatisch <tabel>_<kolom>_check.
ALTER TABLE oefeningen DROP CONSTRAINT IF EXISTS oefeningen_categorie_check;
ALTER TABLE oefeningen ADD CONSTRAINT oefeningen_categorie_check
  CHECK (categorie IN (
    'warming_up',
    'partijen_groot','partijen_midden','partijen_klein',
    'positiespel','pass_trap',
    'sprints_weinig_rust','sprints_veel_rust','steigerungs','overig'
  ));

COMMIT;
