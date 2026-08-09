-- ============================================================
-- Pitchup — Verzameltijd bij wedstrijden (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Optionele verzameltijd, los van de bestaande (optionele) aftraptijd `time`.
-- Bewust plain TIME en geen timestamptz: dit domein gebruikt lokale wandkloktijd
-- (zelfde keuze als events.date DATE + events.time TIME). Er wordt niets naar UTC
-- geconverteerd; de waarde die de trainer invoert is de waarde die op papier komt.
-- Wordt uitsluitend gevuld voor events met type = 'match'; dat wordt in de
-- applicatielaag afgedwongen (createEvent / updateGatherTime), niet met een
-- CHECK-constraint, om het bestaande, constraint-arme events-patroon te volgen.
ALTER TABLE events ADD COLUMN IF NOT EXISTS gather_time TIME;

-- Geen RLS-wijziging nodig: de bestaande policy "events: team_id = auth.uid()"
-- (rls.sql) geldt FOR ALL op rijniveau en dekt daarmee automatisch elke nieuwe
-- kolom van deze tabel. Bewust genoteerd zodat dit geen vergeten stap lijkt.
