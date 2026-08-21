// App-side throttling voor auth-endpoints (inloggen, registreren, wachtwoord
// vergeten). De teller staat in de database (supabase/rate-limit.sql,
// rate_limit_entries) en wordt atomisch bijgewerkt via RPC's — bewust niet
// in-memory: Vercel draait meerdere lambda's, en een teller per instantie zou
// een aanvaller die pogingen spreidt effectief meer pogingen geven dan de
// policy toestaat.
//
// Dit staat LOS van de rate-limits in het Supabase-dashboard; die blijven de
// tweede verdedigingslinie en moeten daar apart gecontroleerd worden.
//
// Faalt de databaseverbinding (geen service-role-key geconfigureerd, netwerk-
// storing), dan faalt dit bewust open (blocked=false) in plaats van elke
// login te weigeren: een uitval van de rate-limiter mag legitieme gebruikers
// niet buitensluiten. De fout wordt wel gelogd.

import { createAdminClient } from '@/lib/supabase/admin'
import { logError } from '@/lib/errors'

export type RateLimitPolicy = {
  // Aantal pogingen binnen `windowMs` waarna de sleutel op slot gaat.
  limit: number
  // Lengte van het telvenster in milliseconden.
  windowMs: number
  // Hoe lang er geblokkeerd wordt zodra `limit` overschreden is.
  blockMs: number
}

const MINUTE = 60_000

// Inloggen: na 5 mislukte pogingen binnen 15 minuten op hetzelfde e-mail+IP
// gaat die combinatie 15 minuten op slot.
export const SIGN_IN_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: 15 * MINUTE,
  blockMs: 15 * MINUTE,
}

// Inloggen per IP, ongeacht het e-mailadres. Zonder deze teller kan één bron
// eindeloos veel verschillende accounts één wachtwoord voeren (password
// spraying) zonder ooit de e-mail+IP-limiet te raken. Bewust ruimer dan
// SIGN_IN_POLICY zodat een gedeeld IP (club, school, NAT) niet meteen vastloopt.
export const SIGN_IN_IP_POLICY: RateLimitPolicy = {
  limit: 25,
  windowMs: 15 * MINUTE,
  blockMs: 15 * MINUTE,
}

// Registreren per e-mail+IP: 5 pogingen per uur.
export const SIGN_UP_POLICY: RateLimitPolicy = {
  limit: 5,
  windowMs: 60 * MINUTE,
  blockMs: 60 * MINUTE,
}

// Registreren per IP: een aanvaller kiest bij elke poging een nieuw adres, dus
// de e-mail+IP-teller alleen houdt massa-registratie niet tegen. Een team
// aanmaken is een zeldzame handeling, dus 10 per uur per IP is ruim.
export const SIGN_UP_IP_POLICY: RateLimitPolicy = {
  limit: 10,
  windowMs: 60 * MINUTE,
  blockMs: 60 * MINUTE,
}

// Wachtwoord-herstel: 3 mails per uur per e-mail+IP; verzoeken daarna worden een
// uur lang genegeerd.
export const PASSWORD_RESET_POLICY: RateLimitPolicy = {
  limit: 3,
  windowMs: 60 * MINUTE,
  blockMs: 60 * MINUTE,
}

export type RateLimitState = {
  blocked: boolean
  retryAfterMs: number
}

const NOT_BLOCKED: RateLimitState = { blocked: false, retryAfterMs: 0 }

type RpcRow = { blocked: boolean; retry_after_ms: number | string }

function toState(row: RpcRow): RateLimitState {
  return { blocked: row.blocked, retryAfterMs: Number(row.retry_after_ms) }
}

// Sleutel per actie + e-mail + IP. E-mail wordt genormaliseerd zodat
// "Bob@Example.com " en "bob@example.com" dezelfde teller delen.
// Het e-mailadres wordt ge-encodeerd zodat een adres met een dubbele punt de
// sleutelstructuur niet kan nabootsen (en dus geen andere teller kan raken).
export function rateLimitKey(scope: string, email: string, ip: string): string {
  return `${scope}:${encodeURIComponent(email.trim().toLowerCase())}:${ip}`
}

// Sleutel per actie + IP, ongeacht het e-mailadres. Op de plek van het adres
// staat een losse `%`: encodeURIComponent zet een ingevulde `%` altijd om naar
// `%25`, dus geen enkel e-mailveld kan deze sleutel nabootsen en zo een andere
// teller raken.
export function ipRateLimitKey(scope: string, ip: string): string {
  return `${scope}:%:${ip}`
}

// Leest de huidige status zonder de teller te wijzigen.
export async function checkRateLimit(key: string): Promise<RateLimitState> {
  const admin = createAdminClient()
  if (!admin) {
    logError('rateLimit.checkRateLimit', { code: 'service_role_key_missing' })
    return NOT_BLOCKED
  }

  const { data, error } = await admin.rpc('rate_limit_check', { p_key: key }).single()
  if (error || !data) {
    logError('rateLimit.checkRateLimit', error ?? { code: 'no_data' })
    return NOT_BLOCKED
  }
  // De Supabase-client is ongetypeerd (lib/supabase/admin.ts), vandaar de
  // expliciete annotatie op het RPC-resultaat — zelfde patroon als
  // app/actions/inzichten.ts.
  return toState(data as RpcRow)
}

// Telt één poging mee en geeft de status ná die poging terug. Callers roepen
// eerst checkRateLimit aan (mag ik nog?) en daarna recordAttempt (dit was er
// één): zodra de `limit`-ste poging binnen het venster geteld is, gaat de
// sleutel `blockMs` op slot. De telling zelf gebeurt atomisch in de database
// (supabase/rate-limit.sql, rate_limit_record_attempt) zodat gelijktijdige
// pogingen op dezelfde sleutel — ook vanuit verschillende serverless-
// instanties — elkaar niet kunnen overschrijven.
export async function recordAttempt(key: string, policy: RateLimitPolicy): Promise<RateLimitState> {
  const admin = createAdminClient()
  if (!admin) {
    logError('rateLimit.recordAttempt', { code: 'service_role_key_missing' })
    return NOT_BLOCKED
  }

  const { data, error } = await admin
    .rpc('rate_limit_record_attempt', {
      p_key: key,
      p_window_ms: policy.windowMs,
      p_limit: policy.limit,
      p_block_ms: policy.blockMs,
    })
    .single()
  if (error || !data) {
    logError('rateLimit.recordAttempt', error ?? { code: 'no_data' })
    return NOT_BLOCKED
  }
  return toState(data as RpcRow)
}

// Wist de teller, bijvoorbeeld na een geslaagde inlog.
export async function clearRateLimit(key: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) {
    logError('rateLimit.clearRateLimit', { code: 'service_role_key_missing' })
    return
  }

  const { error } = await admin.rpc('rate_limit_clear', { p_key: key })
  if (error) logError('rateLimit.clearRateLimit', error)
}

// IP van de aanvrager uit de proxy-headers. Alleen een plausibel IP-adres wordt
// geaccepteerd; anders 'onbekend', zodat er geen vrije tekst in de sleutel of in
// een logregel belandt.
//
// Trusted proxy: `x-forwarded-for` en `x-real-ip` mag élke client zelf meesturen.
// Staat er geen vertrouwde proxy voor de app, dan kan een aanvaller die header
// per poging variëren en krijgt hij telkens een verse rate-limit-sleutel. Op
// Vercel zet het platform `x-vercel-forwarded-for` zélf en overschrijft het een
// meegestuurde waarde; die header is dus wél te vertrouwen en is daarom de
// primaire bron. Ontbreekt hij op Vercel, dan wordt bewust 'onbekend'
// teruggegeven (strenger: alle verkeer deelt dan één teller) in plaats van terug
// te vallen op een spoofbare header.
//
// `x-forwarded-for`/`x-real-ip` gebruiken we alleen buiten Vercel: lokale
// ontwikkeling en self-hosted draaien achter een eigen (vertrouwde) proxy. Draait
// dit ooit ergens anders, dan moet hier de header van díe proxy komen te staan.
export function clientIp(headers: Headers): string {
  const onVercel = Boolean(process.env.VERCEL)

  const platform = firstAddress(headers.get('x-vercel-forwarded-for'))
  const fallback = firstAddress(headers.get('x-forwarded-for')) ?? firstAddress(headers.get('x-real-ip'))
  const candidate = onVercel ? platform : (platform ?? fallback)

  if (!candidate || candidate.length > 45) return 'onbekend'
  if (!/^[0-9a-fA-F:.]+$/.test(candidate)) return 'onbekend'
  return candidate.toLowerCase()
}

// Eerste adres uit een (mogelijk komma-gescheiden) forwarding-header.
function firstAddress(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first ? first : null
}
