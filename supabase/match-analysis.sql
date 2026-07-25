-- ============================================================
-- Pitchup — Wedstrijdanalyse (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Uitslag op events
ALTER TABLE events ADD COLUMN IF NOT EXISTS goals_for     SMALLINT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS goals_against SMALLINT;

-- Wedstrijd-rating per speler (apart van players.rating)
CREATE TABLE IF NOT EXISTS match_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, player_id)
);

-- Losse gebeurtenissen (meerdere per speler)
CREATE TABLE IF NOT EXISTS match_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('goal','assist','yellow','red')),
  minute SMALLINT CHECK (minute IS NULL OR minute BETWEEN 0 AND 130),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_ratings_event ON match_ratings(event_id);
CREATE INDEX IF NOT EXISTS idx_match_ratings_team  ON match_ratings(team_id);
CREATE INDEX IF NOT EXISTS idx_match_events_event  ON match_events(event_id);
CREATE INDEX IF NOT EXISTS idx_match_events_team   ON match_events(team_id);

ALTER TABLE match_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_ratings: own team only" ON match_ratings;
CREATE POLICY "match_ratings: own team only" ON match_ratings FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_events: own team only" ON match_events;
CREATE POLICY "match_events: own team only" ON match_events FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());
