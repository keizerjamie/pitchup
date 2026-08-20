-- ============================================================
-- Pitchup — Dezelfde oefening meerdere keren in één training (migration)
-- Run this in the Supabase SQL Editor.
--
-- Haalt UNIQUE (event_id, oefening_id) van training_oefeningen af, zodat
-- dezelfde bibliotheek-oefening meerdere keren als APARTE koppelingsrij aan
-- dezelfde training gekoppeld kan worden — elk met eigen spelerindeling,
-- stap_override, volgorde en parallelle groep.
--
-- Constraint-naam: de constraint is inline in CREATE TABLE gedeclareerd
-- (supabase/training-plan.sql:67 / supabase/oefening-bibliotheek.sql:33), dus
-- Postgres heeft hem zelf benoemd (normaal
-- training_oefeningen_event_id_oefening_id_key). Het DO-blok zoekt de naam op
-- in de catalogus in plaats van hem te gokken; opnieuw draaien is veilig.
--
-- Datamigratie: GEEN. Er verdwijnt uitsluitend een beperking; alle bestaande
-- rijen blijven ongewijzigd geldig. Let op: dit is niet terug te draaien zodra
-- er duplicaten in de data staan.
-- RLS: ongewijzigd ("training_oefeningen: own team only", team_id = auth.uid()).
-- Indexen: idx_training_oefeningen_event/_oefening/_team blijven bestaan; de
-- unique index die BIJ de constraint hoorde verdwijnt mee (die was geen
-- zelfstandige performance-index).
-- ============================================================

BEGIN;

DO $$
DECLARE
  naam text;
BEGIN
  SELECT con.conname INTO naam
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'training_oefeningen'
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 2
    AND con.conkey @> ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'event_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'oefening_id')
    ]::smallint[];

  IF naam IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.training_oefeningen DROP CONSTRAINT %I', naam);
  END IF;
END $$;

COMMIT;
