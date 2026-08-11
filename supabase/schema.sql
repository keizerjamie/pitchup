-- Team Tracker Database Schema
-- Run this in the Supabase SQL Editor on a FRESH project.
-- Reflects the schema the app actually uses (multi-tenant, RLS enabled).
-- For the RLS policies themselves, see rls.sql.
-- For the trainingsplanner tables (metingen/oefeningen/training_oefeningen),
-- see training-plan.sql (fresh install) and oefening-bibliotheek.sql (migratie).
-- De inzichtenpagina (/inzichten) voegt geen tabellen of kolommen toe, maar wel
-- zes aggregatiefuncties (RPC) plus twee indexen — draai daarvoor ook
-- inzichten.sql; zonder dat bestaan de RPC's niet en blijft /inzichten leeg.

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
  -- Optionele verzameltijd bij wedstrijden, lokale wandkloktijd net als `time`
  -- — zie gather-time.sql.
  gather_time TIME,
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

-- Opgeroepen spelers per wedstrijd (wedstrijdselectie) — zie match-squad.sql.
-- Een rij = deze speler is voor dit event geselecteerd.
CREATE TABLE IF NOT EXISTS match_squad (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, player_id)
);

-- Handmatig afgevinkte taken per event (To-do) — zie task-overrides.sql.
CREATE TABLE IF NOT EXISTS task_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('lineup','analysis','training_plan')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (team_id, event_id, task_type)
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
CREATE INDEX IF NOT EXISTS idx_match_squad_event ON match_squad(event_id);
CREATE INDEX IF NOT EXISTS idx_match_squad_team  ON match_squad(team_id);
CREATE INDEX IF NOT EXISTS idx_task_overrides_event ON task_overrides(event_id);
CREATE INDEX IF NOT EXISTS idx_task_overrides_team  ON task_overrides(team_id);

-- ── Storage: clublogo-bucket (team-logos) ────────────────────
-- Structuur hoort hier (verse installatie), policies staan in rls.sql —
-- zie supabase/team-logo.sql voor de migratie én de toelichting.
-- Padconventie: team-logos/<team_id>/logo. Vaste, extensieloze bestandsnaam per
-- team; een nieuwe upload met upsert overschrijft hetzelfde object, dus er kan
-- per constructie geen wees-bestand ontstaan.
-- Publiek LEESBAAR (bewuste keuze): de zijbalk en de afdrukkop laden het logo via
-- een gewone <img src>; een signed URL zou tijdens/na het afdrukken verlopen.
-- SCHRIJVEN/VERWIJDEREN blijft afgeschermd door de policies in rls.sql.
-- file_size_limit en allowed_mime_types zijn het tweede, door de database zelf
-- afgedwongen vangnet naast de validatie in de server action.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-logos',
  'team-logos',
  true,
  2097152,                                              -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Row Level Security MUST be enabled — see rls.sql for the policies.
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_squad ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_overrides ENABLE ROW LEVEL SECURITY;
