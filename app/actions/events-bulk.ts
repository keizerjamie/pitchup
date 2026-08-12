'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getDefaultAttendance } from '@/app/actions/settings'
import { genericError, logError } from '@/lib/errors'
import { isDateString } from '@/lib/season-dates'
import {
  MAX_BULK_FILE_BYTES,
  MAX_BULK_MATCHES,
  MAX_PREVIEW_ROWS,
  validateBulkRow,
  type BulkCreateResult,
  type BulkField,
  type BulkMatchInput,
  type BulkParseResult,
  type BulkRowFields,
} from '@/lib/bulk-matches'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'
import { parseMatchesFromCsv } from '@/lib/bulk-matches-csv'
import { parseMatchesFromXlsx } from '@/lib/bulk-matches-xlsx'

// Dit bestand exporteert UITSLUITEND async functies. Types, constanten en pure
// functies staan in lib/bulk-matches*.ts: een export van iets anders dan een
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error(NOT_LOGGED_IN)

  // Onvertrouwde invoer: ontdubbelen, alleen echte kalenderdatums, en nooit meer
  // dan een preview groot kan zijn.
  const unique = [...new Set((Array.isArray(dates) ? dates : []).filter(isDateString))]
    .slice(0, MAX_PREVIEW_ROWS)
  if (unique.length === 0) return []

  const { data, error } = await supabase
    .from('events')
    .select('date, opponent')
    // Tenant-grens, expliciet naast de RLS-policy (supabase/rls.sql:18-21).
    .eq('team_id', user.id)
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error(NOT_LOGGED_IN)

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
    team_id: user.id,
  }))

  const { data: inserted, error } = await supabase
    .from('events')
    .insert(payloads)
    // Ook de datum terug: createAttendanceFor bepaalt per wedstrijd welke
    // afmeldperiode die dag dekt, en de batch bevat verschillende datums.
    .select('id, date')

  if (error) throw genericError('events.bulkCreate', error)

  const events = (inserted ?? []) as { id: string; date: string }[]
  const attendanceFailed = await createAttendanceFor(supabase, user.id, events)

  revalidatePath('/events')
  revalidatePath('/')

  // Bewust geen redirect(): die gooit een navigatie-exceptie, waardoor het
  // resultaat de client nooit bereikt. De pagina navigeert zelf.
  return { created: events.length, attendanceFailed }
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// Zet voor elke nieuwe wedstrijd een aanwezigheidsrij per actieve speler klaar,
// met dezelfde afmeldperiode-regels als createEvent (app/actions/events.ts:62-99).
// Geeft true terug als dat mislukte; gooit nooit — de wedstrijden zijn dan al
// opgeslagen en die mogen niet alsnog als "mislukt" bij de trainer landen.
async function createAttendanceFor(
  supabase: SupabaseClient,
  userId: string,
  events: { id: string; date: string }[],
): Promise<boolean> {
  if (events.length === 0) return false

  try {
    // De batch beslaat meerdere datums, dus niet één dag zoals bij createEvent:
    // we halen alle periodes op die met het BEREIK overlappen (from_date <=
    // maxDate && to_date >= minDate) en filteren daarna per event in geheugen.
    // Kale YYYY-MM-DD-strings, lexicografisch te vergelijken — geen Date-object,
    // dus geen servertijdzone die meebeslist (zie lib/absence-periods.ts:6-10).
    const dates = events.map((event) => event.date)
    const minDate = dates.reduce((a, b) => (a <= b ? a : b))
    const maxDate = dates.reduce((a, b) => (a >= b ? a : b))

    // Spelerslijst één keer voor de hele batch (patroon uit
    // app/actions/events.ts:63-66 en app/actions/settings.ts:166-175).
    const [{ data: players, error: playersError }, defaultStatus, { data: periods, error: periodsError }] =
      await Promise.all([
        supabase.from('players').select('id').eq('active', true).eq('team_id', userId),
        getDefaultAttendance().catch(() => 'present' as const),
        // Tenant-grens expliciet, naast de RLS-policy. Vaste sortering zodat de
        // herkomst bij overlappende periodes deterministisch is, net als daar.
        supabase
          .from('absence_periods')
          .select('id, player_id, from_date, to_date')
          .eq('team_id', userId)
          .lte('from_date', maxDate)
          .gte('to_date', minDate)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      ])

    if (playersError) {
      logError('events.bulkCreate.attendance', playersError)
      return true
    }
    // Bewust ANDERS dan createEvent, dat hier hard faalt: daar staat het event
    // nog in dezelfde handeling, hier zijn de wedstrijden al opgeslagen. Gooien
    // zou de trainer een foutmelding geven terwijl zijn programma er wél staat.
    // Dus hetzelfde attendanceFailed-signaal als bij een mislukte spelerslijst:
    // de UI meldt dan dat de aanwezigheid nagelopen moet worden.
    if (periodsError) {
      logError('events.bulkCreate.attendance', periodsError)
      return true
    }
    if (!players || players.length === 0) return false

    const records = events.flatMap((event) => {
      const periodByPlayer = periodIdByPlayerForDate(periods ?? [], event.date)
      // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
      // met afwijkende kolommen, dus absence_period_id gaat altijd mee.
      return players.map((player: { id: string }) => {
        const periodId = periodByPlayer.get(player.id) ?? null
        return {
          event_id: event.id,
          player_id: player.id,
          status: periodId ? 'absent' : defaultStatus,
          team_id: userId,
          absence_period_id: periodId,
        }
      })
    })

    for (let i = 0; i < records.length; i += ATTENDANCE_BATCH) {
      const { error } = await supabase
        .from('attendance')
        .insert(records.slice(i, i + ATTENDANCE_BATCH))
      if (error) {
        logError('events.bulkCreate.attendance', error)
        return true
      }
    }

    return false
  } catch (err) {
    logError('events.bulkCreate.attendance', err)
    return true
  }
}
