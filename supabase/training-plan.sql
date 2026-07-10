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

-- 4. Exercises per training
CREATE TABLE IF NOT EXISTS oefeningen (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  naam         TEXT NOT NULL,
  beschrijving TEXT,
  categorie    TEXT NOT NULL CHECK (categorie IN (
    'partijen_groot','partijen_midden','partijen_klein',
    'sprints_weinig_rust','sprints_veel_rust','steigerungs','overig'
  )),
  stap_override SMALLINT,
  breedte_m    NUMERIC(5,1),
  lengte_m     NUMERIC(5,1),
  orientatie   TEXT DEFAULT 'vrij' CHECK (orientatie IN ('breedte','lengte','vrij')),
  veldzone     TEXT CHECK (veldzone IN (
    'links','midden','rechts','strafschopgebied_links','strafschopgebied_rechts'
  )),
  aantal_teams SMALLINT DEFAULT 0,
  genest_in    UUID REFERENCES oefeningen(id) ON DELETE SET NULL,
  volgorde     SMALLINT DEFAULT 0,
  duur_min     SMALLINT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_metingen_team_date
  ON metingen(team_id, event_id);
CREATE INDEX IF NOT EXISTS idx_oefeningen_event
  ON oefeningen(event_id, volgorde);

-- 6. RLS
ALTER TABLE metingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metingen: own team only"
  ON metingen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());

ALTER TABLE oefeningen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oefeningen: own team only"
  ON oefeningen FOR ALL
  USING (team_id = auth.uid())
  WITH CHECK (team_id = auth.uid());
