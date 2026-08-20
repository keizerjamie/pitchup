// Pure helper rond de opbouw van NIEUWE attendance-rijen. Bewust géén
// 'use server' en géén Supabase-afhankelijkheid: dit is alleen de beslisregel
// "welke status en welke markeringen hoort deze rij te krijgen", zodat de vier
// plekken die rijen aanmaken (createEvent, generateSeasonTrainings,
// createAttendanceFor in events-bulk en de backfill op de eventpagina)
// dezelfde regel gebruiken en die regel los te testen is. Zelfde soort bestand
// als lib/absence-periods.ts.
//
// De regel zelf: een gastspeler staat ALTIJD afwezig; daarnaast houden een
// lopende afmeldperiode en een blessure de speler afwezig. Alleen zonder alle
// drie geldt de standaardstatus van het team.

import { AttendanceStatus } from '@/lib/types'

export interface AttendanceRowInput {
  eventId: string
  playerId: string
  teamId: string
  defaultStatus: AttendanceStatus   // 'present' | 'unknown' — per aanroeper
  injured: boolean
  periodId: string | null
  // Verplicht, zonder default: een nieuwe aanroeper moet bewust kiezen, anders
  // zou een gast stilzwijgend op de teamstandaard belanden.
  isGuest: boolean
}

// De statusregel op één plek. `isGuest` staat als EERSTE tak: gastschap weegt
// het zwaarst en overrulet zowel getDefaultAttendance() als elke combinatie met
// blessure of afmeldperiode. `injured`/`periodId` zijn optioneel omdat het
// terugzetten na herstel (markRecovered) en na het intrekken van een
// afmeldperiode (revokeAbsencePeriod) dezelfde regel zonder die context nodig
// heeft — de rij die daar wordt hersteld heeft per definitie geen blessure- of
// periodeherkomst meer.
export function resolveAttendanceStatus(input: {
  defaultStatus: AttendanceStatus
  isGuest: boolean
  injured?: boolean
  periodId?: string | null
}): AttendanceStatus {
  const { defaultStatus, isGuest, injured = false, periodId = null } = input
  if (isGuest) return 'absent'
  if (periodId) return 'absent'
  if (injured) return 'absent'
  return defaultStatus
}

// Eén bron van waarheid voor status + markeringen van een NIEUWE attendance-rij.
// Alle sleutels staan er altijd op: PostgREST weigert een bulk-insert met
// afwijkende kolommen per object.
export function buildAttendanceRow(input: AttendanceRowInput) {
  const { eventId, playerId, teamId, defaultStatus, injured, periodId, isGuest } = input
  return {
    event_id: eventId,
    player_id: playerId,
    team_id: teamId,
    status: resolveAttendanceStatus({ defaultStatus, isGuest, injured, periodId }),
    injury_set: injured,
    absence_period_id: periodId,
  }
}
