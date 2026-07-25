-- Team Tracker Database Schema
-- Run this in the Supabase SQL Editor on a FRESH project.
-- Reflects the schema the app actually uses (multi-tenant, RLS enabled).
-- For the RLS policies themselves, see rls.sql.
-- For the trainingsplanner tables (metingen/oefeningen), see training-plan.sql.

CREATE TABLE IF NOT EXISTS players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN (
    'Keeper',
    'Linksachter', 'Centrale verdediger', 'Rechtsachter',
    'Defensieve middenvelder', 'Centrale middenvelder',
    'Linksmiddenvelder', 'Rechtsmiddenvelder', 'Aanvallende middenvelder',
    'Linksbuiten', 'Rechtsbuiten', 'Spits'
  )),
  secondary_positions TEXT[] NOT NULL DEFAULT '{}',
  jersey_number INT,
  rating INT CHECK (rating BETWEEN 1 AND 10),
  active BOOLEAN DEFAULT true,
  injured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('training', 'match', 'meting')),
  date DATE NOT NULL,
  time TIME,
  location TEXT,
  match_type TEXT CHECK (match_type IN ('friendly', 'league', 'cup')),
  opponent TEXT,
  home_away TEXT CHECK (home_away IN ('home', 'away')),
  notes TEXT,
  doelstelling TEXT,
  goals_for SMALLINT,
  goals_against SMALLINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('present', 'absent', 'unknown')),
  injury_set BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, player_id)
);

CREATE TABLE IF NOT EXISTS lineups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL UNIQUE,
  formation TEXT NOT NULL,
  positions JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Wedstrijd-rating per speler (apart van players.rating) — zie match-analysis.sql.
CREATE TABLE IF NOT EXISTS match_ratings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, player_id)
);

-- Losse wedstrijdgebeurtenissen (meerdere per speler) — zie match-analysis.sql.
CREATE TABLE IF NOT EXISTS match_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('goal','assist','yellow','red')),
  minute SMALLINT CHECK (minute IS NULL OR minute BETWEEN 0 AND 130),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id);
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_player ON attendance(player_id);
CREATE INDEX IF NOT EXISTS idx_players_active ON players(active);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_match_ratings_event ON match_ratings(event_id);
CREATE INDEX IF NOT EXISTS idx_match_ratings_team  ON match_ratings(team_id);
CREATE INDEX IF NOT EXISTS idx_match_events_event  ON match_events(event_id);
CREATE INDEX IF NOT EXISTS idx_match_events_team   ON match_events(team_id);

-- Row Level Security MUST be enabled — see rls.sql for the policies.
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
