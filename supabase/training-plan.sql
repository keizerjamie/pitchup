-- ============================================================
-- Pitchup — Trainingsplanner & Periodisering (migration)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Allow 'meting' as event type
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN ('training', 'match', 'meting'));

-- 2. Training objective per event
ALTER TABLE events ADD COLUMN IF NOT EXISTS doelstelling TEXT;

-- 3. Nulmeting data per meting-event
CREATE TABLE IF NOT EXISTS metingen (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE UNIQUE,
  partijen_groot_stap      SMALLINT NOT NULL DEFAULT 1,
  partijen_midden_stap     SMALLINT NOT NULL DEFAULT 1,
  partijen_klein_stap      SMALLINT NOT NULL DEFAULT 1,
  sprints_weinig_rust_stap SMALLINT NOT NULL DEFAULT 1,
  sprints_veel_rust_stap   SMALLINT NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 3b. Nulmeting PER ONDERDEEL: één rij = één meting van één onderdeel op één
--     datum, met geschiedenis. Vervangt de alles-in-één nulmeting hierboven
--     (`metingen` blijft staan voor de legacy MetingEditor). Voor bestaande
--     installaties: draai supabase/nulmeting-per-onderdeel.sql (migratie +
--     backfill van de oude gedeelde nulmeting naar vijf rijen).
CREATE TABLE IF NOT EXISTS categorie_metingen (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    UUID NOT NULL,
  -- Bewuste duplicatie van MEETBARE_CATEGORIES (lib/types.ts): de app-laag is
  -- de bron van waarheid, deze CHECK is het vangnet in de database.
  categorie  TEXT NOT NULL CHECK (categorie IN (
    'partijen_groot','partijen_midden','partijen_klein',
    'sprints_weinig_rust','sprints_veel_rust'
  )),
  -- Kale kalenderdatum, net als events.date.
  datum      DATE NOT NULL,
  -- Ruim vangnet; het categorie-specifieke maximum wordt in de app-laag
  -- geclampt (clampStapOverride in lib/periodization-stappen.ts).
  stap       SMALLINT NOT NULL CHECK (stap BETWEEN 1 AND 99),
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Idempotentie-sleutel én tie-break-eliminator ("hoogste datum" is uniek).
  UNIQUE (team_id, categorie, datum)
);

-- 4. Oefening-BIBLIOTHEEK (event-onafhankelijk). De koppeling aan een training
--    loopt via training_oefeningen (zie 5). Voor bestaande installaties: draai
--    supabase/oefening-bibliotheek.sql (migratie + backfill).
CREATE TABLE IF NOT EXISTS oefeningen (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      UUID NOT NULL,
  naam         TEXT NOT NULL,
  beschrijving TEXT,
  categorie    TEXT NOT NULL CHECK (categorie IN (
    'warming_up',
    'partijen_groot','partijen_midden','partijen_klein',
    'positiespel','pass_trap',
    'sprints_weinig_rust','sprints_veel_rust','steigerungs','overig'
  )),
  breedte_m    NUMERIC(5,1),
  lengte_m     NUMERIC(5,1),
  orientatie   TEXT DEFAULT 'vrij' CHECK (orientatie IN ('breedte','lengte','vrij')),
  veldzone     TEXT CHECK (veldzone IN (
    'links','midden','rechts','strafschopgebied_links','strafschopgebied_rechts'
  )),
  teams            JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(teams) <= 6),
  aantal_neutralen SMALLINT NOT NULL DEFAULT 0 CHECK (aantal_neutralen BETWEEN 0 AND 30),
  -- Bovengrens van een flexibel aantal neutralen (NULL = vast aantal) hoort bij
  -- de elastische oefenvormen; de teamkant daarvan (grootteMax) leeft in de
  -- JSONB-kolom `teams`. Bestaande installaties: draai
  -- supabase/oefening-flexibel-aantal.sql.
  duur_min     SMALLINT,
  -- Optioneel tactiekbord (markers/materiaal/lijnen). NULL = geen tekening.
  -- Voor bestaande installaties: draai supabase/oefening-diagram.sql.
  diagram      JSONB CHECK (diagram IS NULL OR pg_column_size(diagram) < 65536),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 5. Koppeltabel oefening <-> training (analoog aan attendance).
CREATE TABLE IF NOT EXISTS training_oefeningen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  oefening_id UUID NOT NULL REFERENCES oefeningen(id) ON DELETE CASCADE,
  volgorde SMALLINT NOT NULL DEFAULT 0,
  stap_override SMALLINT,
  genest_in UUID REFERENCES training_oefeningen(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
  -- BEWUST GEEN UNIQUE (event_id, oefening_id): dezelfde bibliotheek-oefening
  -- mag meerdere keren als aparte koppelingsrij aan één training hangen (eigen
  -- spelerindeling, stap_override en volgorde per rij). Bestaande installaties:
  -- draai supabase/oefening-meerdere-keren.sql.
  --
  -- `aantallen_override` (JSONB, NULL = geen override) legt de TRAINING-
  -- specifieke bezetting van een flexibele oefening vast. Staat hier bewust
  -- niet in de fresh install, net als spelerindeling/parallel_*: draai
  -- supabase/oefening-flexibel-aantal.sql.
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_metingen_team_date
  ON metingen(team_id, event_id);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_event ON training_oefeningen(event_id, volgorde);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_oefening ON training_oefeningen(oefening_id);
CREATE INDEX IF NOT EXISTS idx_training_oefeningen_team ON training_oefeningen(team_id);

-- 7. RLS
ALTER TABLE metingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metingen: own team only"
  ON metingen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());

ALTER TABLE categorie_metingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categorie_metingen: own team only"
  ON categorie_metingen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());

ALTER TABLE oefeningen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oefeningen: own team only"
  ON oefeningen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());

ALTER TABLE training_oefeningen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "training_oefeningen: own team only"
  ON training_oefeningen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());
