-- ============================================================
-- Pitchup — performance-indexen
-- Run dit eenmalig in de Supabase SQL Editor.
--
-- Elke query filtert (via RLS én expliciet) op team_id; zonder index
-- wordt dat een sequential scan zodra er meerdere teams zijn.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_events_team_date ON events(team_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_events_team_type_date ON events(team_id, type, date);
CREATE INDEX IF NOT EXISTS idx_attendance_team ON attendance(team_id);
CREATE INDEX IF NOT EXISTS idx_lineups_team ON lineups(team_id);
CREATE INDEX IF NOT EXISTS idx_settings_team ON settings(team_id);
CREATE INDEX IF NOT EXISTS idx_metingen_team ON metingen(team_id);
CREATE INDEX IF NOT EXISTS idx_oefeningen_team ON oefeningen(team_id);

-- Verificatie: toon alle indexen per tabel
-- select tablename, indexname from pg_indexes
-- where schemaname = 'public' order by tablename;
