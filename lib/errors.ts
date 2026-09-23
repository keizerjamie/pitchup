// Generieke foutafhandeling voor server actions.
//
// Ruwe Supabase/PostgREST-fouten mogen nooit ongefilterd naar de client én niet
// naar de logs: hun `message`/`details`/`hint` bevatten regelmatig kolom- en
// constraintnamen én de aangeboden waarden (bijv. "Key (email)=(...) already
// exists"). Daarmee lekken ze zowel implementatiedetails als gebruikersdata.
// We loggen daarom alleen een eigen, statisch context-label plus de (waardevrije)
// foutcode, en geven de client één vaste, niet-onthullende melding.

export const GENERIC_ERROR_MESSAGE = 'Er ging iets mis. Probeer het opnieuw.'

// Alleen een korte, alfanumerieke code wordt gelogd (PostgREST '23505',
// Supabase-auth 'user_already_exists'). Alles wat daar niet aan voldoet laten we
// weg: zo kan er geen vrije tekst — en dus geen data of log-injectie — in de log
// belanden.
const SAFE_CODE_RE = /^[A-Za-z0-9_]{1,40}$/

export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  if (typeof code === 'string' && SAFE_CODE_RE.test(code)) return code
  return null
}

// Logt de fout server-side zonder ruwe melding, en geeft niets terug.
export function logError(context: string, error: unknown): void {
  const code = errorCode(error)
  console.error(`[${context}] fout${code ? ` (code ${code})` : ''}`)
}

// Logt de fout server-side en levert de Error op die naar de client mag.
export function genericError(context: string, error: unknown): Error {
  logError(context, error)
  return new Error(GENERIC_ERROR_MESSAGE)
}

// Vertaalt de fouten van de kolom-begrensde security-definer-RPC's
// (set_event_doelstelling, set_match_result, set_gather_time,
// set_trainingstype — supabase/team-rls-gevolgacties.sql) naar de meldingen
// die de rest van de app al gebruikt.
//
// Die RPC's bestaan omdat een assistent met alleen Training- of
// Wedstrijd-recht wél één kolom van een events-rij mag zetten, maar de
// events-policy zelf op 'agenda' blijft staan. Ze gooien met een eigen
// SQLSTATE zodat de aanroeper de twee gevallen uit elkaar kan houden:
//   42501 = wel gevonden, geen recht        -> 'Geen toegang'
//   P0002 = niet gevonden / verkeerd type   -> 'Event niet gevonden'
// Alles daarbuiten is een echte databasefout en gaat via genericError, dus
// zonder ruwe melding naar client of log.
export function rpcEventError(context: string, error: unknown): Error {
  const code = errorCode(error)
  if (code === '42501') return new Error('Geen toegang')
  // Bewust dezelfde melding als assertOwnEvent in lib/authz.ts: die verraadt
  // niet of het event niet bestaat, van een ander team is, of het verkeerde
  // type heeft.
  if (code === 'P0002') return new Error('Event niet gevonden')
  return genericError(context, error)
}
