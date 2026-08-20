'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { AttendanceStatus } from '@/lib/types'
import { assertKnownPlayerId, assertOwnEvent, assertOwnPlayer, getOwnPlayerIds, isUuid } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import { findCoveringPeriod, type AbsencePeriodRange } from '@/lib/absence-periods'
import { isDateString } from '@/lib/season-dates'
import { getDefaultAttendance } from '@/app/actions/settings'
import { resolveAttendanceStatus } from '@/lib/attendance-rows'

// Maximale lengte van een `.in()`-lijst, gelijk aan de batchgrootte van
// generateSeasonTrainings (app/actions/settings.ts:174): een periode kan een
// heel seizoen beslaan, en een URL-filter met honderden ids loopt tegen de
// lengtegrens van PostgREST aan.
const ID_CHUNK = 50

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += ID_CHUNK) chunks.push(items.slice(i, i + ID_CHUNK))
  return chunks
}

export async function updateAttendance(
  eventId: string,
  playerId: string,
  status: AttendanceStatus
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const VALID_STATUSES: AttendanceStatus[] = ['present', 'absent', 'unknown']
  if (!VALID_STATUSES.includes(status)) throw new Error('Ongeldige status')

  await Promise.all([
    assertOwnEvent(supabase, eventId, user.id),
    assertOwnPlayer(supabase, playerId, user.id),
  ])

  const { error } = await supabase
    .from('attendance')
    .upsert(
      { event_id: eventId, player_id: playerId, status, team_id: user.id },
      { onConflict: 'event_id,player_id' }
    )

  if (error) throw genericError('attendance.updateAttendance', error)
  revalidatePath(`/events/${eventId}`)
  // De selectiepagina filtert de selecteerbare lijst op aanwezigheid; die hangt
  // van deze rijen af en moet dus mee-revalideren.
  revalidatePath(`/events/${eventId}/squad`)
}

// Meldt een speler af voor een periode én LEGT die periode vast. De rij in
// absence_periods blijft bestaan, zodat events die later binnen de periode
// worden aangemaakt automatisch op 'absent' komen (createEvent,
// generateSeasonTrainings). De bestaande events krijgen hier meteen hun rij,
// met de periode als herkomst (absence_period_id) zodat het intrekken later
// precies deze rijen — en alleen deze — kan terugdraaien.
export async function markAbsentForPeriod(
  playerId: string,
  fromDate: string,
  toDate: string,
): Promise<{ periodId: string; affected: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // isDateString weigert óók niet-bestaande datums als 2026-02-30, die een pure
  // vormcheck zou doorlaten en pas in de database zouden stranden.
  if (!isDateString(fromDate) || !isDateString(toDate)) throw new Error('Ongeldige datum')
  // Kale 'YYYY-MM-DD'-stringvergelijking: lexicografisch gelijk aan
  // chronologisch, zonder Date-conversie en dus zonder tijdzone-invloed.
  if (fromDate > toDate) throw new Error('Startdatum moet voor einddatum liggen')

  await assertOwnPlayer(supabase, playerId, user.id)

  const { data: period, error: periodError } = await supabase
    .from('absence_periods')
    .insert({ team_id: user.id, player_id: playerId, from_date: fromDate, to_date: toDate })
    .select('id')
    .single()

  if (periodError || !period) throw genericError('attendance.markAbsentForPeriod.period', periodError)
  const periodId = period.id as string

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, type')
    .gte('date', fromDate)
    .lte('date', toDate)
    .eq('team_id', user.id)
    .neq('type', 'meting')

  if (eventsError) {
    // Zonder deze lijst weten we niet welke events de periode had moeten raken.
    // Stil doorgaan zou `affected: 0` opleveren — niet te onderscheiden van "er
    // vielen geen events in de periode". Dus hard falen én compenseren, zoals bij
    // een mislukte upsert hieronder.
    await supabase.from('absence_periods').delete().eq('id', periodId).eq('team_id', user.id)
    throw genericError('attendance.markAbsentForPeriod.events', eventsError)
  }

  const affectedEvents = (events ?? []) as { id: string; type: string }[]

  // Zonder events in de periode is er niets bij te werken, maar de periode is
  // wél vastgelegd: hij geldt voor alles wat er later nog bij komt. Daarom hier
  // géén early return meer die de revalidatie overslaat.
  if (affectedEvents.length > 0) {
    const records = affectedEvents.map((e) => ({
      event_id: e.id,
      player_id: playerId,
      status: 'absent' as AttendanceStatus,
      team_id: user.id,
      absence_period_id: periodId,
    }))

    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'event_id,player_id' })

    if (error) {
      // Compenseren: zonder de attendance-rijen zou een blijvende periode een
      // halve waarheid zijn (wel "afgemeld" in de lijst, niet in de events).
      await supabase.from('absence_periods').delete().eq('id', periodId).eq('team_id', user.id)
      throw genericError('attendance.markAbsentForPeriod', error)
    }
  }

  revalidatePath(`/players/${playerId}/absence`)
  // De eventpagina toont de aanwezigheid per event en de selectiepagina filtert
  // de selecteerbare lijst erop; beide hangen van deze rijen af en moeten dus
  // mee-revalideren (zelfde patroon als updateAttendance). Deze actie raakt een
  // hele periode, dus per uniek event uit dezelfde query — een selectiepagina
  // hebben alleen wedstrijden.
  const seenEventIds = new Set<string>()
  for (const event of affectedEvents) {
    if (seenEventIds.has(event.id)) continue
    seenEventIds.add(event.id)
    revalidatePath(`/events/${event.id}`)
    if (event.type === 'match') revalidatePath(`/events/${event.id}/squad`)
  }
  return { periodId, affected: affectedEvents.length }
}

// Trekt één afmeldperiode in: de rijen die déze periode op 'absent' zette gaan
// terug naar de standaardstatus, waarna de periode zelf verdwijnt. Rijen zonder
// herkomst (handmatig, blessure, default) blijven ongemoeid.
//
// Herstelt bewust ook rijen van verstreken events — een periode intrekken
// betekent "dit is nooit gebeurd", anders dan markRecovered() dat alleen
// toekomstige events aanraakt.
export async function revokeAbsencePeriod(periodId: string): Promise<{ restored: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Vormcheck vóór de query: een niet-UUID levert anders een ruwe 22P02 op.
  // Onbekend, van een ander team en ongeldig geven alle drie dezelfde melding,
  // zodat die niet verraadt of de periode bestaat.
  if (!isUuid(periodId)) throw new Error('Periode niet gevonden')

  const { data: period } = await supabase
    .from('absence_periods')
    .select('id, player_id, from_date, to_date')
    .eq('id', periodId)
    .eq('team_id', user.id)
    .maybeSingle()

  if (!period) throw new Error('Periode niet gevonden')
  const playerId = period.player_id as string

  const { data: rows, error: rowsError } = await supabase
    .from('attendance')
    .select('event_id, status, injury_set')
    .eq('team_id', user.id)
    .eq('absence_period_id', periodId)
  if (rowsError) throw genericError('attendance.revokeAbsencePeriod.rows', rowsError)

  const causedRows = (rows ?? []) as { event_id: string; status: string; injury_set: boolean }[]
  const touchedEventIds = new Set<string>()
  const matchEventIds = new Set<string>()
  let restored = 0

  if (causedRows.length > 0) {
    const eventIds = causedRows.map((row) => row.event_id)

    const events: { id: string; date: string; type: string }[] = []
    for (const chunk of chunked(eventIds)) {
      const { data, error } = await supabase
        .from('events')
        .select('id, date, type')
        .eq('team_id', user.id)
        .in('id', chunk)
      if (error) throw genericError('attendance.revokeAbsencePeriod.events', error)
      events.push(...((data ?? []) as { id: string; date: string; type: string }[]))
    }
    const eventById = new Map(events.map((e) => [e.id, e]))

    // De overige periodes van dezelfde speler: overlapt er nog één met de datum
    // van een event, dan blijft die speler afwezig en gaat alleen de herkomst
    // over. Zonder deze stap zou het intrekken van periode A ook de dekking van
    // periode B ongedaan maken.
    const { data: others, error: othersError } = await supabase
      .from('absence_periods')
      .select('id, player_id, from_date, to_date')
      .eq('team_id', user.id)
      .eq('player_id', playerId)
      .neq('id', periodId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (othersError) throw genericError('attendance.revokeAbsencePeriod.periods', othersError)
    const otherPeriods = (others ?? []) as AbsencePeriodRange[]

    const defaultStatus = await getDefaultAttendance()

    // Een gastspeler staat standaard afwezig: het intrekken van een periode mag
    // hem niet alsnog op de teamstandaard zetten — alleen de trainer zet hem
    // handmatig op 'present'. Zelfde regel als bij het aanmaken van een rij,
    // hergebruikt uit lib/attendance-rows.ts. Hard falen bij een fout, zoals de
    // queries hierboven: stil doorgaan zou de gast alsnog aanwezig melden.
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('type')
      .eq('id', playerId)
      .eq('team_id', user.id)
      .maybeSingle()
    if (playerError) throw genericError('attendance.revokeAbsencePeriod.player', playerError)
    const restoreStatus = resolveAttendanceStatus({
      defaultStatus,
      isGuest: player?.type === 'guest',
    })

    const transferByPeriod = new Map<string, string[]>()
    const clearOnly: string[] = []
    const toDefault: string[] = []

    for (const row of causedRows) {
      const event = eventById.get(row.event_id)
      touchedEventIds.add(row.event_id)
      if (event?.type === 'match') matchEventIds.add(row.event_id)

      const covering = event ? findCoveringPeriod(otherPeriods, event.date) : null
      if (covering) {
        const list = transferByPeriod.get(covering.id) ?? []
        list.push(row.event_id)
        transferByPeriod.set(covering.id, list)
      } else if (row.injury_set || row.status !== 'absent') {
        // Twee keer "iemand heeft dit al overruled, dus met rust laten": een
        // blessure houdt de speler afwezig ook zonder periode, en een rij die
        // ondanks de periode niet (meer) op 'absent' staat — 'present' of
        // 'unknown' — is handmatig door de coach gezet (updateAttendance laat
        // absence_period_id ongemoeid). In beide gevallen alleen de herkomst
        // wissen; de status blijft zoals hij is. Alleen rijen die nog écht
        // 'absent' zijn, zijn nog het resultaat van deze periode.
        clearOnly.push(row.event_id)
      } else {
        toDefault.push(row.event_id)
      }
    }
    restored = toDefault.length

    // Gebundeld per doel zodat er hooguit een handvol updates nodig is. Het
    // filter op absence_period_id houdt elke update begrensd tot precies de
    // rijen die déze periode zette — ook als er tussendoor iets verandert.
    for (const [targetPeriodId, ids] of transferByPeriod) {
      for (const chunk of chunked(ids)) {
        const { error } = await supabase
          .from('attendance')
          .update({ absence_period_id: targetPeriodId })
          .eq('team_id', user.id)
          .eq('absence_period_id', periodId)
          .in('event_id', chunk)
        if (error) throw genericError('attendance.revokeAbsencePeriod.transfer', error)
      }
    }

    for (const chunk of chunked(clearOnly)) {
      const { error } = await supabase
        .from('attendance')
        .update({ absence_period_id: null })
        .eq('team_id', user.id)
        .eq('absence_period_id', periodId)
        .in('event_id', chunk)
      if (error) throw genericError('attendance.revokeAbsencePeriod.clear', error)
    }

    for (const chunk of chunked(toDefault)) {
      const { error } = await supabase
        .from('attendance')
        .update({ status: restoreStatus, absence_period_id: null })
        .eq('team_id', user.id)
        .eq('absence_period_id', periodId)
        .in('event_id', chunk)
      if (error) throw genericError('attendance.revokeAbsencePeriod.restore', error)
    }
  }

  // Pas ná het herstellen: de FK staat op ON DELETE SET NULL, dus eerder
  // verwijderen zou de herkomst wissen en de rijen onherstelbaar op 'absent'
  // laten staan.
  const { error: deleteError } = await supabase
    .from('absence_periods')
    .delete()
    .eq('id', periodId)
    .eq('team_id', user.id)
  if (deleteError) throw genericError('attendance.revokeAbsencePeriod.delete', deleteError)

  revalidatePath(`/players/${playerId}/absence`)
  // Elk geraakt event toont de aanwezigheid van deze speler; de selectiepagina
  // bestaat alleen voor wedstrijden. Zelfde patroon als updateAttendance.
  for (const eventId of touchedEventIds) {
    revalidatePath(`/events/${eventId}`)
  }
  for (const matchEventId of matchEventIds) {
    revalidatePath(`/events/${matchEventId}/squad`)
  }
  return { restored }
}

export async function markAllPresent(eventId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const { error } = await supabase
    .from('attendance')
    .update({ status: 'present' })
    .eq('event_id', eventId)
    .eq('team_id', user.id)

  if (error) throw genericError('attendance.markAllPresent', error)
  revalidatePath(`/events/${eventId}`)
  // De selectiepagina filtert de selecteerbare lijst op aanwezigheid; die hangt
  // van deze rijen af en moet dus mee-revalideren.
  revalidatePath(`/events/${eventId}/squad`)
}

export async function saveLineup(
  eventId: string,
  formation: string,
  positions: { player_id: string | null; x: number; y: number; position_label: string; position_number?: number }[]
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  await assertOwnEvent(supabase, eventId, user.id)

  if (typeof formation !== 'string' || formation.length > 20) throw new Error('Ongeldige formatie')
  if (!Array.isArray(positions) || positions.length > 30) throw new Error('Ongeldige opstelling')

  // Elk player_id moet een eigen speler zijn: RLS beschermt de players-tabel,
  // maar de opstelling gaat als JSONB de lineups-rij in en zou anders een
  // vreemd (of willekeurig lang) id kunnen bevatten. Zelfde patroon als
  // saveSpelerindeling in app/actions/training-plan.ts.
  const ownPlayerIds = await getOwnPlayerIds(supabase, user.id)

  const cleanPositions = positions.map((p) => ({
    player_id: p.player_id === null || p.player_id === undefined
      ? null
      : assertKnownPlayerId(p.player_id, ownPlayerIds),
    x: Math.max(0, Math.min(100, Number(p.x) || 0)),
    y: Math.max(0, Math.min(100, Number(p.y) || 0)),
    position_label: String(p.position_label ?? '').slice(0, 10),
    position_number: Number.isInteger(p.position_number) ? p.position_number : undefined,
  }))

  const { error } = await supabase
    .from('lineups')
    .upsert(
      { event_id: eventId, formation, positions: cleanPositions, team_id: user.id },
      { onConflict: 'event_id' }
    )

  if (error) throw genericError('attendance.saveLineup', error)
  revalidatePath(`/events/${eventId}/lineup`)
}
