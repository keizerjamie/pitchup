// Pure helper rond de opbouw van NIEUWE attendance-rijen. Bewust géén
// 'use server' en géén Supabase-afhankelijkheid: dit is alleen de beslisregel
// "welke status en welke markeringen hoort deze rij te krijgen", zodat de vier
// plekken die rijen aanmaken (createEvent, generateSeasonTrainings,
// createAttendanceFor in events-bulk en de backfill op de eventpagina)
// dezelfde regel gebruiken en die regel los te testen is. Zelfde soort bestand
// als lib/absence-periods.ts.
//
// De regel zelf: een geblesseerde speler staat op een event vanaf vandaag op
// 'injured'; anders staat een gastspeler ALTIJD afwezig, en houdt een lopende
// afmeldperiode de speler afwezig. Alleen zonder dat alles geldt de
// standaardstatus van het team. Geen klok in dit bestand: `today` komt van de
// aanroeper (todayLocal()), zodat de regel puur en testbaar blijft.

import { AttendanceStatus } from '@/lib/types'

export interface AttendanceRowInput {
  eventId: string
  playerId: string
  teamId: string
  defaultStatus: AttendanceStatus   // 'present' | 'unknown' — per aanroeper
  // De huidige toestand van de speler (players.injured).
  injured: boolean
  // Kale 'YYYY-MM-DD'-strings, lexicografisch vergeleken: geen Date-object en
  // dus geen servertijdzone die meebeslist. Beide verplicht, zonder default:
  // elke aanroeper moet bewust kiezen, anders zou een verleden-event van een
  // nu geblesseerde speler stil op 'injured' belanden (of andersom).
  eventDate: string
  today: string
  periodId: string | null
  // Verplicht, zonder default: een nieuwe aanroeper moet bewust kiezen, anders
  // zou een gast stilzwijgend op de teamstandaard belanden.
  isGuest: boolean
}

// De statusregel op één plek. Volgorde:
//   1. injuredOnDate -> 'injured' (blessure weegt het zwaarst, ook bij een gast
//      en ook bij een lopende afmeldperiode);
//   2. isGuest       -> 'absent';
//   3. periodId      -> 'absent';
//   4. anders de standaardstatus.
// `injuredOnDate`/`periodId` zijn optioneel omdat het terugzetten na herstel
// (markRecovered) en na het intrekken van een afmeldperiode
// (revokeAbsencePeriod) dezelfde regel zonder die context nodig heeft — de rij
// die daar wordt hersteld heeft per definitie geen blessure- of
// periodeherkomst meer.
export function resolveAttendanceStatus(input: {
  defaultStatus: AttendanceStatus
  isGuest: boolean
  injuredOnDate?: boolean
  periodId?: string | null
}): AttendanceStatus {
  const { defaultStatus, isGuest, injuredOnDate = false, periodId = null } = input
  if (injuredOnDate) return 'injured'
  if (isGuest) return 'absent'
  if (periodId) return 'absent'
  return defaultStatus
}

// Eén bron van waarheid voor status + herkomst van een NIEUWE attendance-rij.
// Alle vijf sleutels staan er altijd op: PostgREST weigert een bulk-insert met
// afwijkende kolommen per object. `absence_period_id` wordt ook bij 'injured'
// gezet als er een periode dekt, zodat de rij na herstel terugvalt op 'absent'.
export function buildAttendanceRow(input: AttendanceRowInput): {
  event_id: string
  player_id: string
  team_id: string
  status: AttendanceStatus
  absence_period_id: string | null
} {
  const { eventId, playerId, teamId, defaultStatus, injured, eventDate, today, periodId, isGuest } = input
  return {
    event_id: eventId,
    player_id: playerId,
    team_id: teamId,
    // Een verleden-event krijgt géén 'injured': de blessure is de toestand van
    // NU en zegt niets over een datum die al voorbij is.
    status: resolveAttendanceStatus({
      defaultStatus,
      isGuest,
      injuredOnDate: injured && eventDate >= today,
      periodId,
    }),
    absence_period_id: periodId,
  }
}
