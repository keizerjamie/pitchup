'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EventType, MatchType, HomeAway, VALID_TRAININGSTYPES, type TrainingsType } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { assertOwnMatchEvent, assertOwnTrainingEvent } from '@/lib/authz'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { genericError, logError, rpcEventError } from '@/lib/errors'
import { isTimeString } from '@/lib/utils'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'
import { buildAttendanceRow } from '@/lib/attendance-rows'

// Er maakt geen enkele code nog 'meting'-events aan: de nulmeting van de
// periodisering leeft sinds de per-onderdeel-migratie in de eigen tabel
// categorie_metingen (app/actions/periodisering.ts). Bestaande meting-events
// blijven staan en zijn nog leesbaar via het legacy meting-scherm.
const VALID_EVENT_TYPES: EventType[] = ['training', 'match']
const VALID_MATCH_TYPES: MatchType[] = ['friendly', 'league', 'cup']
const VALID_HOME_AWAY: HomeAway[] = ['home', 'away']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function createEvent(formData: FormData) {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'agenda')

  const type = formData.get('type') as EventType
  if (!VALID_EVENT_TYPES.includes(type)) throw new Error('Ongeldig event type')

  const date = formData.get('date') as string
  if (!date || !DATE_RE.test(date)) throw new Error('Ongeldige datum')

  const timeRaw = (formData.get('time') as string) || null
  if (timeRaw && !isTimeString(timeRaw)) throw new Error('Ongeldig tijdstip')

  const location = ((formData.get('location') as string) || null)?.slice(0, 200) ?? null
  const notes = ((formData.get('notes') as string) || null)?.slice(0, 2000) ?? null

  const payload: Record<string, unknown> = { type, date, time: timeRaw, location, notes, team_id: ctx.teamId }

  if (type === 'training') {
    const trainingstype = formData.get('trainingstype') as TrainingsType
    // Ontbrekend veld = VCT (de DB-default), een ONGELDIGE waarde wordt
    // geweigerd — nooit stil naar de default terugvallen, zelfde lijn als
    // match_type hieronder.
    if (formData.has('trainingstype') && !VALID_TRAININGSTYPES.includes(trainingstype)) {
      throw new Error('Ongeldig trainingstype')
    }
    payload.trainingstype = formData.has('trainingstype') ? trainingstype : 'vct'
  }

  if (type === 'match') {
    const match_type = formData.get('match_type') as MatchType
    if (!VALID_MATCH_TYPES.includes(match_type)) throw new Error('Ongeldig wedstrijdtype')
    const home_away = formData.get('home_away') as HomeAway
    if (!VALID_HOME_AWAY.includes(home_away)) throw new Error('Ongeldig thuis/uit')
    const opponent = ((formData.get('opponent') as string) || '').slice(0, 100)
    // Verzameltijd hoort alleen bij een wedstrijd; een training krijgt de kolom
    // daarom nooit mee, ook niet als het veld toch wordt meegestuurd.
    const gatherTimeRaw = (formData.get('gather_time') as string) || null
    if (gatherTimeRaw && !isTimeString(gatherTimeRaw)) throw new Error('Ongeldig tijdstip')
    payload.match_type = match_type
    payload.opponent = opponent
    payload.home_away = home_away
    payload.gather_time = gatherTimeRaw
  }

  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw genericError('events.createEvent', error)

  // Meting events have no attendance records
  if (type !== 'meting') {
    const [{ data: players, error: playersError }, defaultStatus, { data: periods, error: periodsError }] = await Promise.all([
      // `injured` hoort erbij: een geblesseerde speler moet ook op een NIEUW
      // event meteen op 'absent' komen, net als markInjured dat voor bestaande
      // events doet (markInjured in app/actions/players.ts). `type` idem voor
      // gastspelers: die staan altijd afwezig. Het active-filter blijft staan —
      // een gast is gewoon actief en krijgt dus wél een rij.
      supabase.from('players').select('id, injured, type').eq('active', true).eq('team_id', ctx.teamId),
      getDefaultAttendance().catch(() => 'present' as const),
      // Lopende afmeldperiodes die déze datum dekken (grenzen inclusief):
      // from_date <= date <= to_date. Vaste sortering zodat de herkomst bij
      // overlappende periodes deterministisch is.
      supabase
        .from('absence_periods')
        .select('id, player_id, from_date, to_date')
        .eq('team_id', ctx.teamId)
        .lte('from_date', date)
        .gte('to_date', date)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ])

    // Bewust hard falen: stil doorgaan zou het event met standaard-aanwezigheid
    // opleveren, terwijl de trainer de speler al had afgemeld.
    if (periodsError) throw genericError('events.createEvent.periods', periodsError)
    // Zelfde reden voor de spelerslijst: zonder `injured` zou een geblesseerde
    // speler stilzwijgend op de standaardstatus belanden. Vóór de insert, zodat
    // er dan helemaal geen rijen worden weggeschreven.
    if (playersError) throw genericError('events.createEvent.players', playersError)

    if (players && players.length > 0) {
      const periodByPlayer = periodIdByPlayerForDate(periods ?? [], date)
      const { error: attendanceError } = await supabase.from('attendance').insert(
        // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
        // met afwijkende kolommen, dus buildAttendanceRow zet ze altijd alle zes.
        players.map((p) => buildAttendanceRow({
          eventId: data.id,
          playerId: p.id,
          teamId: ctx.teamId,
          defaultStatus,
          injured: p.injured === true,
          periodId: periodByPlayer.get(p.id) ?? null,
          isGuest: p.type === 'guest',
        }))
      )

      if (attendanceError) {
        // Deze fout werd eerder genegeerd. Een event zonder aanwezigheidsrijen
        // is een halve waarheid: de trainer ziet een lege aanwezigheidslijst en
        // weet niet dat er iets misging. Compensatie volgens het patroon dat al
        // in deze codebase staat (markAbsentForPeriod in
        // app/actions/attendance.ts draait de zojuist gemaakte
        // absence_periods-rij terug bij een mislukte upsert): het net gemaakte
        // event weer weg, tenant-gescoped, en dan zichtbaar falen.
        //
        // Staat vóór de redirect() hieronder, dus geen conflict met de
        // NEXT_REDIRECT-throw.
        const { error: compensatieError } = await supabase
          .from('events')
          .delete()
          .eq('id', data.id)
          .eq('team_id', ctx.teamId)
        // Mislukt óók de compensatie, dan blijft er een event zonder
        // aanwezigheidsrijen achter. Dat mag niet onzichtbaar zijn: alleen
        // loggen (de gebruiker krijgt hoe dan ook de generieke melding
        // hieronder, en een tweede, andere melding helpt hem niet), maar wél
        // met een eigen contextlabel zodat het in de logs terug te vinden is.
        if (compensatieError) logError('events.createEvent.compensatie', compensatieError)
        throw genericError('events.createEvent.attendance', attendanceError)
      }
    }
  }

  revalidatePath('/events')
  revalidatePath('/')
  redirect(`/events/${data.id}`)
}

// Zet of wist de verzameltijd van één wedstrijd. `null` (of een lege string)
// wist de tijd. Gooit bij een fout in plaats van { error } terug te geven —
// zelfde contract als toggleSquadPlayer in app/actions/match-squad.ts, want de
// aanroeper is dezelfde selectiepagina.
export async function updateGatherTime(eventId: string, gatherTime: string | null): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  // Onderdeel WEDSTRIJD, niet agenda: de verzameltijd wordt op de
  // wedstrijdselectie-pagina gezet en is voor de gebruiker wedstrijdwerk. De
  // events-policy blijft wél op 'agenda', dus deze ene kolom loopt via de
  // kolom-begrensde RPC set_gather_time (supabase/team-rls-gevolgacties.sql),
  // die zelf can_edit(team,'wedstrijd') toetst.
  assertCanEdit(ctx, 'wedstrijd')

  // Checkt eigenaarschap én type = 'match' in één query, met een melding die
  // niet verraadt wélke van de twee misging.
  await assertOwnMatchEvent(supabase, eventId, ctx.teamId)

  // Lege string uit een leeggemaakt tijdveld betekent "wissen", niet "ongeldig".
  // Deze vormcheck blijft de eerste bron; de RPC heeft alleen het TIME-type als
  // tweede vangnet.
  const value = gatherTime === '' ? null : gatherTime
  if (value !== null && !isTimeString(value)) throw new Error('Ongeldig tijdstip')

  const { error } = await supabase.rpc('set_gather_time', {
    p_event_id: eventId,
    p_gather_time: value,
  })

  if (error) throw rpcEventError('events.updateGatherTime', error)

  revalidatePath(`/events/${eventId}/squad`)
  revalidatePath(`/events/${eventId}`)
}

// Zet het trainingstype van één training. Bepaalt of de oefeningen van deze
// training meetellen in de VCT-periodisering. Gooit bij een fout in plaats van
// { error } terug te geven — zelfde contract als updateGatherTime hierboven.
export async function updateTrainingstype(eventId: string, trainingstype: TrainingsType): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  // Onderdeel TRAINING, niet agenda: het trainingstype wordt op de
  // trainingsplan-pagina gezet en stuurt de periodisering. De events-policy
  // blijft op 'agenda', dus deze ene kolom loopt via de kolom-begrensde RPC
  // set_trainingstype (supabase/team-rls-gevolgacties.sql), die zelf
  // can_edit(team,'training') toetst.
  assertCanEdit(ctx, 'training')

  // Vóór elke query: een ongeldige waarde hoort de database nooit te bereiken.
  // De RPC herhaalt deze whitelist als tweede vangnet.
  if (!VALID_TRAININGSTYPES.includes(trainingstype)) throw new Error('Ongeldig trainingstype')

  // Checkt eigenaarschap én type = 'training' in één query, met een melding die
  // niet verraadt wélke van de twee misging.
  await assertOwnTrainingEvent(supabase, eventId, ctx.teamId)

  const { error } = await supabase.rpc('set_trainingstype', {
    p_event_id: eventId,
    p_trainingstype: trainingstype,
  })

  if (error) throw rpcEventError('events.updateTrainingstype', error)

  // Het type stuurt de telling op alle pagina's die de periodisering tonen; die
  // moeten dus alle vier opnieuw.
  revalidatePath(`/events/${eventId}/training-plan`)
  revalidatePath('/')
  revalidatePath('/periodisering')
  revalidatePath('/inzichten')
}

export async function deleteEvent(id: string) {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'agenda')

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('events.deleteEvent', error)
  revalidatePath('/events')
  revalidatePath('/')
}
