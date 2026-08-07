-- ============================================================
-- Pitchup — Wedstrijdselectie (match squad) (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Opgeroepen spelers per wedstrijd. Eén rij = deze speler is voor dit event
-- geselecteerd; de aanwezigheid van de rij ís de selectie. Bewust zelfstandig:
-- geen relatie met lineups of attendance.
CREATE TABLE IF NOT EXISTS match_squad (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_squad_event ON match_squad(event_id);
CREATE INDEX IF NOT EXISTS idx_match_squad_team  ON match_squad(team_id);

ALTER TABLE match_squad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_squad: own team only" ON match_squad;
CREATE POLICY "match_squad: own team only" ON match_squad FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());
