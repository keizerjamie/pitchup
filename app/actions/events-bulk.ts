'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getDefaultAttendance } from '@/app/actions/settings'
import { genericError, logError } from '@/lib/errors'
import { isDateString, seasonTrainingDates } from '@/lib/season-dates'
import {
  MAX_BULK_FILE_BYTES,
  MAX_BULK_MATCHES,
  MAX_LOCATION_CHARS,
  MAX_NOTES_CHARS,
  MAX_PREVIEW_ROWS,
  validateBulkRow,
  type BulkCreateResult,
  type BulkField,
  type BulkMatchInput,
  type BulkParseResult,
  type BulkRowFields,
} from '@/lib/bulk-matches'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'
import { buildAttendanceRow } from '@/lib/attendance-rows'
import { todayLocal } from '@/lib/utils'
import { parseMatchesFromCsv } from '@/lib/bulk-matches-csv'
import { parseMatchesFromXlsx } from '@/lib/bulk-matches-xlsx'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'
import { parseEventBaseInput } from '@/lib/event-input'
import { VALID_TRAININGSTYPES, type TrainingsType } from '@/lib/types'
import {
  parseRepeatDays,
  planRecurringTrainings,
  resolveNewTrainingDefaults,
  type NewTrainingDefaults,
  type RecurringTrainingsResult,
} from '@/lib/recurring-trainings'

// Dit bestand exporteert UITSLUITEND async functies. Types, constanten en pure
// functies staan in lib/bulk-matches*.ts en lib/recurring-trainings.ts: een export van iets anders dan een
// async functie uit een 'use server'-bestand lekt in Turbopack als
// runtime-verwijzing (zelfde reden als lib/logo-upload.ts:11-14).

const NOT_LOGGED_IN = 'Niet ingelogd'

const FILE_MISSING_ERROR = 'Kies een .csv- of .xlsx-bestand.'
const FILE_TOO_BIG_ERROR = `Het bestand is te groot. Maximaal ${MAX_BULK_FILE_BYTES / 1024} KB.`
const FILE_EXTENSION_ERROR = 'Alleen .csv- en .xlsx-bestanden zijn toegestaan.'
const FILE_OLD_XLS_ERROR = 'Dit is een oud .xls-bestand. Sla het in Excel op als .xlsx en probeer het opnieuw.'
const FILE_NOT_XLSX_ERROR = 'Dit lijkt geen geldig .xlsx-bestand te zijn.'
const FILE_NOT_TEXT_ERROR = 'Dit bestand is geen leesbare tekst. Sla het op als CSV met UTF-8-codering.'
const FILE_UNREADABLE_ERROR = 'Dit bestand kon niet gelezen worden.'

// Aantal attendance-rijen per insert. 100 wedstrijden × 30 spelers is 3.000
// rijen; in blokken houden we het statement en het geheugengebruik voorspelbaar.
const ATTENDANCE_BATCH = 1000

// Foutmeldingen per veld, in dezelfde formulering als createEvent
// (app/actions/events.ts:27-46), zodat de trainer overal hetzelfde leest.
const FIELD_MESSAGES: Record<BulkField, string> = {
  date: 'Ongeldige datum',
  time: 'Ongeldig tijdstip',
  gather_time: 'Ongeldig tijdstip',
  match_type: 'Ongeldig wedstrijdtype',
  home_away: 'Ongeldig thuis/uit',
  opponent: 'Ongeldige tegenstander',
  location: 'Ongeldige locatie',
  notes: 'Ongeldige notities',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Zet een binnenkomende (dus onvertrouwde) payload om naar de velden waar
// validateBulkRow op rekent. Alles wat geen string is, wordt leeg — en valt
// daarmee vanzelf om op 'required'/'invalid'.
function toFields(row: unknown): BulkRowFields {
  const value = (row ?? {}) as Record<string, unknown>
  return {
    date: text(value.date),
    time: text(value.time),
    opponent: text(value.opponent),
    home_away: text(value.home_away),
    match_type: text(value.match_type),
    location: text(value.location),
    gather_time: text(value.gather_time),
    notes: text(value.notes),
  }
}

// ────────────────────────────────────────────────
// Bestand inlezen
// ────────────────────────────────────────────────

// Leest een aangeleverd .csv- of .xlsx-bestand en geeft previewrijen terug.
// Dit is de enige echte poortwachter: de controle in de browser is puur UX.
// Geeft { ok: false, error } terug in plaats van te throwen — de melding hoort
// naast het uploadveld te verschijnen (zelfde contract als uploadTeamLogo,
// app/actions/team-logo.ts:19-20).
export async function parseBulkMatchFile(formData: FormData): Promise<BulkParseResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: NOT_LOGGED_IN }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: FILE_MISSING_ERROR }
  if (file.size > MAX_BULK_FILE_BYTES) return { ok: false, error: FILE_TOO_BIG_ERROR }

  const name = file.name.toLowerCase()
  const isCsv = name.endsWith('.csv')
  const isXlsx = name.endsWith('.xlsx')
  if (!isCsv && !isXlsx) return { ok: false, error: FILE_EXTENSION_ERROR }

  const bytes = new Uint8Array(await file.arrayBuffer())

  if (isXlsx) {
    // Magic bytes, niet file.type: die header stuurt de client zelf mee en is
    // triviaal te vervalsen (precedent: lib/logo-upload.ts:29-33).
    // Een .xlsx is een ZIP-container en begint dus met 'PK\x03\x04'.
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return { ok: false, error: FILE_OLD_XLS_ERROR }
    }
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
      return { ok: false, error: FILE_NOT_XLSX_ERROR }
    }

    try {
      return await parseMatchesFromXlsx(bytes)
    } catch (err) {
      logError('events.parseBulkMatchFile', err)
      return { ok: false, error: FILE_UNREADABLE_ERROR }
    }
  }

  // CSV: een NUL-byte in de kop verraadt een binair bestand (of UTF-16) dat
  // alleen de extensie .csv draagt.
  if (bytes.subarray(0, 4096).includes(0x00)) return { ok: false, error: FILE_NOT_TEXT_ERROR }

  let content: string
  try {
    // fatal: true → gooit bij bytes die geen geldige UTF-8 zijn, in plaats van
    // stilzwijgend U+FFFD in de tegenstandernamen te zetten.
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, error: FILE_NOT_TEXT_ERROR }
  }

  try {
    return parseMatchesFromCsv(content)
  } catch (err) {
    logError('events.parseBulkMatchFile', err)
    return { ok: false, error: FILE_UNREADABLE_ERROR }
  }
}

// ────────────────────────────────────────────────
// Duplicaatcontrole voor de preview
// ────────────────────────────────────────────────

// Geeft de bestaande wedstrijden van dit team op de opgegeven datums terug, als
// { date, opponent }-paren. De vergelijking op tegenstander gebeurt bewust
// client-side (markDuplicates in lib/bulk-matches.ts), hoofdletter- en
// spatie-ongevoelig; de query filtert alleen op datum.
export async function getExistingMatchKeys(
  dates: string[],
): Promise<{ date: string; opponent: string | null }[]> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  // Onvertrouwde invoer: ontdubbelen, alleen echte kalenderdatums, en nooit meer
  // dan een preview groot kan zijn.
  const unique = [...new Set((Array.isArray(dates) ? dates : []).filter(isDateString))]
    .slice(0, MAX_PREVIEW_ROWS)
  if (unique.length === 0) return []

  const { data, error } = await supabase
    .from('events')
    .select('date, opponent')
    // Tenant-grens, expliciet naast de RLS-policy "events: lid mag lezen"
    // (supabase/team-rls.sql).
    .eq('team_id', ctx.teamId)
    .eq('type', 'match')
    .in('date', unique)

  if (error) throw genericError('events.getExistingMatchKeys', error)

  return (data ?? []) as { date: string; opponent: string | null }[]
}

// ────────────────────────────────────────────────
// Opslaan
// ────────────────────────────────────────────────

// Slaat de bevestigde previewrijen op als wedstrijden. Alles-of-niets: één
// insert-statement, dus bij een fout staat er niets half in de agenda.
//
// De aanwezigheidsregistratie is een losstaande vervolgstap: mislukt die, dan
// blijven de wedstrijden staan en meldt het resultaat attendanceFailed. Er wordt
// bewust NIET teruggedraaid — de trainer heeft dan wél zijn programma.
export async function createBulkMatches(rows: BulkMatchInput[]): Promise<BulkCreateResult> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'agenda')

  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Geen wedstrijden om op te slaan')
  if (rows.length > MAX_BULK_MATCHES) {
    throw new Error(`Maximaal ${MAX_BULK_MATCHES} wedstrijden tegelijk`)
  }

  // Hervalidatie met exact dezelfde regels als de preview: clientinvoer wordt
  // nooit vertrouwd. Eén ongeldige rij → niets opgeslagen.
  const fields = rows.map(toFields)
  for (const row of fields) {
    const errors = validateBulkRow(row)
    if (errors.length > 0) throw new Error(FIELD_MESSAGES[errors[0].field])
  }

  const payloads = fields.map((row) => ({
    // 'match' staat hardcoded: het type komt nooit uit de invoer.
    type: 'match',
    date: row.date.trim(),
    time: row.time.trim() || null,
    gather_time: row.gather_time.trim() || null,
    location: row.location.trim() || null,
    notes: row.notes.trim() || null,
    match_type: row.match_type.trim(),
    opponent: row.opponent.trim(),
    home_away: row.home_away.trim(),
    // Tenant-grens: altijd uit de sessie, nooit uit de payload.
    team_id: ctx.teamId,
  }))

  const { data: inserted, error } = await supabase
    .from('events')
    .insert(payloads)
    // Ook de datum terug: createAttendanceFor bepaalt per wedstrijd welke
    // afmeldperiode die dag dekt, en de batch bevat verschillende datums.
    .select('id, date')

  if (error) throw genericError('events.bulkCreate', error)

  const events = (inserted ?? []) as { id: string; date: string }[]
  const attendanceFailed = await createAttendanceFor(supabase, ctx.teamId, events)

  revalidatePath('/events')
  revalidatePath('/')

  // Bewust geen redirect(): die gooit een navigatie-exceptie, waardoor het
  // resultaat de client nooit bereikt. De pagina navigeert zelf.
  return { created: events.length, attendanceFailed }
}

// ────────────────────────────────────────────────
// Herhalende trainingen
// ────────────────────────────────────────────────

// Maakt een wekelijks herhalende training aan: één training per gekozen
// weekdag van `date` t/m `repeat_until` (beide inclusief). Datums waarop het
// team al een training heeft, worden overgeslagen (alleen op datum).
//
// FormData: date, time, location, notes, trainingstype, repeat_until
// (YYYY-MM-DD) en repeat_days (kommalijst, 0 = zondag … 6 = zaterdag). `type`
// en `team_id` worden bewust NIET gelezen: het type is altijd 'training' en het
// team komt uit de sessie.
//
// Invoerfouten komen terug als { ok: false, error: <code> } (vertaald in de
// UI); de eerste fout wint, in de volgorde hieronder. Niet ingelogd, geen recht
// of een databasefout gooit (generieke melding, nooit de ruwe fout).
//
// Zelfde atomiciteit als createBulkMatches: de trainingen in één insert
// (alles-of-niets), de aanwezigheid daarna los. Mislukt die, dan blijven de
// trainingen staan en meldt het resultaat attendanceFailed.
export async function createRecurringTrainings(formData: FormData): Promise<RecurringTrainingsResult> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()
  assertCanEdit(ctx, 'agenda')

  // 1. Lengtes vóór parseEventBaseInput: die kapt te lange tekst stil af, en
  //    bij tientallen trainingen tegelijk merkt niemand die verminking (zelfde
  //    lijn als de bulk-wedstrijden, lib/bulk-matches.ts).
  const rawLocation = formData.get('location')
  if (typeof rawLocation === 'string' && rawLocation.length > MAX_LOCATION_CHARS) {
    return { ok: false, error: 'location_too_long' }
  }
  const rawNotes = formData.get('notes')
  if (typeof rawNotes === 'string' && rawNotes.length > MAX_NOTES_CHARS) {
    return { ok: false, error: 'notes_too_long' }
  }

  // 2. Datum (= startdatum), tijd, locatie en notities: dezelfde regels als
  //    createEvent.
  const parsed = parseEventBaseInput(formData, 'training')
  if (!parsed.ok) {
    return { ok: false, error: parsed.code === 'invalid_time' ? 'invalid_time' : 'invalid_date' }
  }
  const { date: start, time, location, notes } = parsed.value

  // 3. Ontbrekend trainingstype = VCT (de DB-default); een ONGELDIGE waarde wordt
  //    geweigerd, nooit stil teruggevallen — zelfde lijn als createEvent.
  const trainingstypeRaw = formData.get('trainingstype')
  let trainingstype: TrainingsType = 'vct'
  if (formData.has('trainingstype')) {
    if (!VALID_TRAININGSTYPES.includes(trainingstypeRaw as TrainingsType)) {
      return { ok: false, error: 'invalid_trainingstype' }
    }
    trainingstype = trainingstypeRaw as TrainingsType
  }

  // 4-6. Weekdagen, einddatum en bereik: dezelfde pure functie als de teller in
  //      het formulier, dus client en server rekenen exact dezelfde datums.
  const days = parseRepeatDays(formData.get('repeat_days'))
  const until = formData.get('repeat_until')
  const end = typeof until === 'string' ? until : ''
  const plan = planRecurringTrainings(start, end, days)
  if (!plan.ok) return { ok: false, error: plan.error }
  // Geldig bereik zonder één gekozen weekdag erin (bijv. alleen dinsdag, van
  // woensdag t/m maandag): niets aan te maken, geen database nodig.
  if (plan.dates.length === 0) return { ok: true, created: 0, skipped: 0, attendanceFailed: false }

  // Dubbel-detectie: bestaande trainingen van DIT team in het bereik. De
  // datums zijn kale YYYY-MM-DD-strings, dus geen tijdzone die meebeslist.
  const { data: existingRows, error: existingError } = await supabase
    .from('events')
    .select('date')
    // Tenant-grens, expliciet naast de RLS-policy.
    .eq('team_id', ctx.teamId)
    .eq('type', 'training')
    .gte('date', start)
    .lte('date', end)

  if (existingError) throw genericError('events.recurring.existing', existingError)

  const existing = new Set(((existingRows ?? []) as { date: string }[]).map((row) => row.date))
  const toCreate = plan.dates.filter((d) => !existing.has(d))
  const skipped = plan.dates.length - toCreate.length

  if (toCreate.length === 0) {
    return { ok: true, created: 0, skipped, attendanceFailed: false }
  }

  const payloads = toCreate.map((d) => ({
    // 'training' staat hardcoded: het type komt nooit uit de invoer.
    type: 'training',
    date: d,
    time,
    location,
    notes,
    trainingstype,
    // Tenant-grens: altijd uit de sessie, nooit uit de payload.
    team_id: ctx.teamId,
  }))

  const { data: inserted, error } = await supabase
    .from('events')
    .insert(payloads)
    .select('id, date')

  if (error) throw genericError('events.recurring', error)

  const events = (inserted ?? []) as { id: string; date: string }[]
  const attendanceFailed = await createAttendanceFor(
    supabase,
    ctx.teamId,
    events,
    'events.recurring.attendance',
  )

  revalidatePath('/events')
  revalidatePath('/')

  // Bewust geen redirect(): het formulier toont eerst de telling.
  return { ok: true, created: events.length, skipped, attendanceFailed }
}

// Datums (YYYY-MM-DD, uniek, oplopend) waarop dit team in [from, to] al een
// training heeft — voor de teller in het formulier. Onbruikbare invoer
// (geen kalenderdatum, to < from, langer dan MAX_SEASON_DAYS) → [] zonder
// databasevraag. Een databasefout gooit (generieke melding).
export async function getExistingTrainingDates(from: string, to: string): Promise<string[]> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  // Zelfde bereikregels als de herhaling zelf (kalenderdatums, to >= from,
  // hooguit MAX_SEASON_DAYS dagen); zonder weekdagen rekent dit alleen de
  // grenzen na en levert het geen datums op.
  if (!seasonTrainingDates(from, to, []).ok) return []

  const { data, error } = await supabase
    .from('events')
    .select('date')
    // Tenant-grens, expliciet naast de RLS-policy.
    .eq('team_id', ctx.teamId)
    .eq('type', 'training')
    .gte('date', from)
    .lte('date', to)

  if (error) throw genericError('events.getExistingTrainingDates', error)

  const dates = ((data ?? []) as { date: string }[]).map((row) => row.date)
  return [...new Set(dates)].sort()
}

// Voorinvulling voor /events/new: tijd en locatie van de laatst AANGEMAAKTE
// training van dit team (created_at, niet de trainingsdatum), per veld
// terugvallend op de teaminstellingen training_time/training_location, en het
// seizoenseinde als voorgestelde einddatum. Alleen lezen, team-gescoped; elk
// teamlid mag dit (de pagina zelf gate't op het agenda-recht).
export async function getNewTrainingDefaults(): Promise<NewTrainingDefaults> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  const [{ data: lastRows, error: lastError }, { data: settingRows, error: settingsError }] =
    await Promise.all([
      supabase
        .from('events')
        .select('time, location')
        .eq('team_id', ctx.teamId)
        .eq('type', 'training')
        // created_at is nullable: een rij zonder tijdstempel mag nooit als
        // "nieuwste" winnen (Postgres zet NULL bij DESC standaard vooraan).
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1),
      supabase
        .from('settings')
        .select('key, value')
        .eq('team_id', ctx.teamId)
        .in('key', ['training_time', 'training_location', 'season_end']),
    ])

  if (lastError) throw genericError('events.getNewTrainingDefaults', lastError)
  if (settingsError) throw genericError('events.getNewTrainingDefaults.settings', settingsError)

  const settings: Record<string, string> = {}
  for (const row of (settingRows ?? []) as { key: string; value: string }[]) settings[row.key] = row.value

  const last = ((lastRows ?? []) as { time: string | null; location: string | null }[])[0] ?? null
  return resolveNewTrainingDefaults(last, settings)
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// Zet voor elke nieuwe wedstrijd een aanwezigheidsrij per actieve speler klaar,
// met dezelfde afmeldperiode-regels als createEvent (app/actions/events.ts).
// Geeft true terug als dat mislukte; gooit nooit — de wedstrijden zijn dan al
// opgeslagen en die mogen niet alsnog als "mislukt" bij de trainer landen.
async function createAttendanceFor(
  supabase: SupabaseClient,
  // De TENANT-sleutel (ctx.teamId), niet de user-id van de ingelogde persoon —
  // sinds de assistent-trainers zijn dat twee verschillende dingen. Zelfde
  // afspraak als de teamId-parameter van de guards in lib/authz.ts.
  teamId: string,
  events: { id: string; date: string }[],
  // Statisch logcontext-label (nooit gebruikersdata), zodat een mislukte
  // aanwezigheidsstap in de logs aan de juiste flow te koppelen is.
  logLabel = 'events.bulkCreate.attendance',
): Promise<boolean> {
  if (events.length === 0) return false

  try {
    // De batch beslaat meerdere datums, dus niet één dag zoals bij createEvent:
    // we halen alle periodes op die met het BEREIK overlappen (from_date <=
    // maxDate && to_date >= minDate) en filteren daarna per event in geheugen.
    // Kale YYYY-MM-DD-strings, lexicografisch te vergelijken — geen Date-object,
    // dus geen servertijdzone die meebeslist (zie periodIdByPlayerForDate in
    // lib/absence-periods.ts).
    const dates = events.map((event) => event.date)
    const minDate = dates.reduce((a, b) => (a <= b ? a : b))
    const maxDate = dates.reduce((a, b) => (a >= b ? a : b))

    // Spelerslijst één keer voor de hele batch (zelfde patroon als createEvent
    // in app/actions/events.ts en generateSeasonTrainings in
    // app/actions/settings.ts).
    const [{ data: players, error: playersError }, defaultStatus, { data: periods, error: periodsError }] =
      await Promise.all([
        // `type` hoort erbij: een gastspeler staat altijd afwezig. `injured`
        // idem: een geblesseerde speler krijgt op een wedstrijd vanaf vandaag
        // 'injured', net als bij createEvent. Het active-filter blijft staan —
        // een gast is gewoon actief en krijgt dus wél een rij.
        supabase.from('players').select('id, injured, type').eq('active', true).eq('team_id', teamId),
        getDefaultAttendance().catch(() => 'present' as const),
        // Tenant-grens expliciet, naast de RLS-policy. Vaste sortering zodat de
        // herkomst bij overlappende periodes deterministisch is, net als daar.
        supabase
          .from('absence_periods')
          .select('id, player_id, from_date, to_date')
          .eq('team_id', teamId)
          .lte('from_date', maxDate)
          .gte('to_date', minDate)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      ])

    if (playersError) {
      logError(logLabel, playersError)
      return true
    }
    // Bewust ANDERS dan createEvent, dat hier hard faalt: daar staat het event
    // nog in dezelfde handeling, hier zijn de wedstrijden al opgeslagen. Gooien
    // zou de trainer een foutmelding geven terwijl zijn programma er wél staat.
    // Dus hetzelfde attendanceFailed-signaal als bij een mislukte spelerslijst:
    // de UI meldt dan dat de aanwezigheid nagelopen moet worden.
    if (periodsError) {
      logError(logLabel, periodsError)
      return true
    }
    if (!players || players.length === 0) return false

    // Eén keer bepaald voor de hele batch: alleen wedstrijden vanaf vandaag
    // krijgen bij een geblesseerde speler 'injured'.
    const today = todayLocal()
    const records = events.flatMap((event) => {
      const periodByPlayer = periodIdByPlayerForDate(periods ?? [], event.date)
      // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
      // met afwijkende kolommen, dus buildAttendanceRow zet ze altijd alle vijf.
      return players.map((player: { id: string; injured: boolean | null; type: string }) => buildAttendanceRow({
        eventId: event.id,
        playerId: player.id,
        teamId,
        defaultStatus,
        injured: player.injured === true,
        eventDate: event.date,
        today,
        periodId: periodByPlayer.get(player.id) ?? null,
        isGuest: player.type === 'guest',
      }))
    })

    for (let i = 0; i < records.length; i += ATTENDANCE_BATCH) {
      const { error } = await supabase
        .from('attendance')
        .insert(records.slice(i, i + ATTENDANCE_BATCH))
      if (error) {
        logError(logLabel, error)
        return true
      }
    }

    return false
  } catch (err) {
    logError(logLabel, err)
    return true
  }
}
