-- ============================================================
-- Pitchup — Afmeldperiodes (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Een geregistreerde afmeldperiode van één speler. De rij ZELF is de periode:
-- zolang hij bestaat, krijgt elk nieuw training-/wedstrijd-event binnen
-- [from_date, to_date] voor deze speler automatisch status 'absent'.
-- Intrekken = de rij verwijderen (harde delete, geen soft-delete: er is geen
-- historie-eis). Grenzen zijn INCLUSIEF, consistent met markAbsentForPeriod.
-- Datums zijn kale kalenderdatums (DATE), net als events.date — geen
-- tijdzone-conversie, vergelijking gebeurt als YYYY-MM-DD-string.
CREATE TABLE IF NOT EXISTS absence_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT absence_periods_range CHECK (from_date <= to_date)
);

-- Bewust GEEN unieke constraint op (player_id, from_date, to_date):
-- overlappende en identieke periodes zijn toegestaan en werken onafhankelijk.
CREATE INDEX IF NOT EXISTS idx_absence_periods_team   ON absence_periods(team_id);
CREATE INDEX IF NOT EXISTS idx_absence_periods_player ON absence_periods(player_id);
CREATE INDEX IF NOT EXISTS idx_absence_periods_dates  ON absence_periods(from_date, to_date);

ALTER TABLE absence_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "absence_periods: own team only" ON absence_periods;
CREATE POLICY "absence_periods: own team only" ON absence_periods FOR ALL
  USING (team_id = auth.uid()) WITH CHECK (team_id = auth.uid());

-- Herkomst van een absent-status: welke periode heeft deze rij op 'absent'
-- gezet? NULL = handmatig/blessure/default, en die rijen worden bij het
-- intrekken van een periode NOOIT aangeraakt. Zelfde gedachte als de
-- bestaande attendance.injury_set-vlag, maar als FK in plaats van een boolean:
-- bij overlappende periodes moet per rij vastliggen WELKE periode hem zette,
-- anders zou het intrekken van periode A ook de rijen van periode B terugzetten.
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS absence_period_id UUID
  REFERENCES absence_periods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_absence_period
  ON attendance(absence_period_id);
