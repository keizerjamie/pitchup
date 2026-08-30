-- ============================================================
-- Pitchup — Nulmeting per periodiseringsonderdeel (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================
--
-- Was: één rij `metingen` met vijf verplichte stapkolommen aan één events-rij
-- van type 'meting' — dus één gedeelde datum voor alle vijf de onderdelen.
-- Wordt: één rij per meting van één onderdeel op één datum, met geschiedenis.
-- Een meting is daarmee geen agenda-item meer; `metingen` en de bestaande
-- meting-events blijven staan (legacy MetingEditor).

BEGIN;

CREATE TABLE IF NOT EXISTS categorie_metingen (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    UUID NOT NULL,
  -- Bewuste duplicatie van MEETBARE_CATEGORIES (lib/types.ts): de app-laag is
  -- de bron van waarheid, deze CHECK is het vangnet in de database.
  categorie  TEXT NOT NULL CHECK (categorie IN (
    'partijen_groot','partijen_midden','partijen_klein',
    'sprints_weinig_rust','sprints_veel_rust'
  )),
  -- Kale kalenderdatum, net als events.date: geen tijd, geen tijdzone.
  datum      DATE NOT NULL,
  -- Ruim vangnet; het categorie-specifieke maximum wordt in de app-laag
  -- geclampt (clampStapOverride in lib/periodization-stappen.ts).
  stap       SMALLINT NOT NULL CHECK (stap BETWEEN 1 AND 99),
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Idempotentie-sleutel (dubbel versturen levert één rij op) én
  -- tie-break-eliminator: "de meting met de hoogste datum" is altijd uniek.
  -- team_id vóóraan, zodat een rij van een ander team de eigen upsert nooit
  -- kan blokkeren. Dekt ook de lookups; een extra index is overbodig.
  UNIQUE (team_id, categorie, datum)
);

ALTER TABLE categorie_metingen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categorie_metingen: own team only" ON categorie_metingen;
CREATE POLICY "categorie_metingen: own team only" ON categorie_metingen FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());

-- Backfill: elke bestaande alles-in-één nulmeting wordt vijf rijen,
-- met de OUDE gedeelde datum (events.date) en elk zijn EIGEN oude stap.
-- Notitie mee naar alle vijf. Her-draaibaar: teams die al een
-- per-onderdeel-meting hebben worden overgeslagen, zodat een tweede run geen
-- inmiddels verwijderde meting terugzet.
INSERT INTO categorie_metingen (team_id, categorie, datum, stap, notes)
SELECT m.team_id, x.categorie, e.date, x.stap, m.notes
FROM metingen m
JOIN events e ON e.id = m.event_id AND e.team_id = m.team_id
CROSS JOIN LATERAL (VALUES
  ('partijen_groot',      m.partijen_groot_stap),
  ('partijen_midden',     m.partijen_midden_stap),
  ('partijen_klein',      m.partijen_klein_stap),
  ('sprints_weinig_rust', m.sprints_weinig_rust_stap),
  ('sprints_veel_rust',   m.sprints_veel_rust_stap)
) AS x(categorie, stap)
WHERE e.type = 'meting'
  AND NOT EXISTS (SELECT 1 FROM categorie_metingen c WHERE c.team_id = m.team_id)
  AND x.stap BETWEEN 1 AND 99
ON CONFLICT (team_id, categorie, datum) DO NOTHING;

COMMIT;

-- ── Handmatige verificatie na het draaien ───────────────────────────────────
-- Per team en datum vijf onderdelen:
--   SELECT c.team_id, c.datum, count(*) AS onderdelen
--   FROM categorie_metingen c GROUP BY c.team_id, c.datum ORDER BY c.team_id, c.datum;
-- Geen enkele oude nulmeting overgeslagen (verwacht 0 rijen):
--   SELECT m.id, e.date FROM metingen m
--   JOIN events e ON e.id = m.event_id AND e.type = 'meting'
--   WHERE NOT EXISTS (SELECT 1 FROM categorie_metingen c
--     WHERE c.team_id = m.team_id AND c.datum = e.date);
--
-- Rollback = DROP TABLE categorie_metingen; `metingen` en de meting-events
-- blijven ongemoeid, dus er gaat geen oude data verloren.
