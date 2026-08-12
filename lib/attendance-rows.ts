// Pure helper rond de opbouw van NIEUWE attendance-rijen. Bewust géén
// 'use server' en géén Supabase-afhankelijkheid: dit is alleen de beslisregel
// "welke status en welke markeringen hoort deze rij te krijgen", zodat de drie
// plekken die rijen aanmaken (createEvent, generateSeasonTrainings en de
// backfill op de eventpagina) dezelfde regel gebruiken en die regel los te
// testen is. Zelfde soort bestand als lib/absence-periods.ts.
//
// De regel zelf: een lopende afmeldperiode én een blessure houden de speler
// afwezig; alleen zonder beide geldt de standaardstatus van het team.

import { AttendanceStatus } from '@/lib/types'

export interface AttendanceRowInput {
  eventId: string
  playerId: string
  teamId: string
  defaultStatus: AttendanceStatus   // 'present' | 'unknown' — per aanroeper
  injured: boolean
  periodId: string | null
}

// Eén bron van waarheid voor status + markeringen van een NIEUWE attendance-rij.
// Alle sleutels staan er altijd op: PostgREST weigert een bulk-insert met
// afwijkende kolommen per object.
export function buildAttendanceRow(input: AttendanceRowInput) {
  const { eventId, playerId, teamId, defaultStatus, injured, periodId } = input
  return {
    event_id: eventId,
    player_id: playerId,
    team_id: teamId,
    status: (periodId || injured ? 'absent' : defaultStatus) as AttendanceStatus,
    injury_set: injured,
    absence_period_id: periodId,
  }
}
