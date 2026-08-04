// Eenvoudige app-side throttling voor auth-endpoints (inloggen, wachtwoord
// vergeten). Bewust in-memory en zonder extra dependency: het doel is het
// afremmen van geautomatiseerd raden vanaf één bron, niet een gedistribueerde
// rate-limiter.
//
// Let op de grenzen hiervan:
// - De teller leeft per server-instantie. Op Vercel draaien meerdere lambdas,
//   dus een aanvaller die over instanties heen spreidt krijgt effectief meer
//   pogingen. Dit staat LOS van de rate-limits in het Supabase-dashboard; die
//   blijven de tweede verdedigingslinie en moeten daar apart gecontroleerd
//   worden.
// - Bij een herstart is de teller leeg.

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

type Entry = {
  count: number
  windowStart: number
  blockedUntil: number
}

const entries = new Map<string, Entry>()

// Bovengrens tegen ongelimiteerde geheugengroei bij een aanval met steeds
// nieuwe sleutels. Bij overschrijding wordt eerst opgeruimd, en als dat niet
// genoeg oplevert de oudste helft weggegooid.
const MAX_ENTRIES = 10_000

// Langste telvenster van alle policies; een teller mag pas opgeruimd worden als
// hij voor élke policy verlopen is.
const LONGEST_WINDOW_MS = Math.max(
  SIGN_IN_POLICY.windowMs,
  SIGN_IN_IP_POLICY.windowMs,
  SIGN_UP_POLICY.windowMs,
  SIGN_UP_IP_POLICY.windowMs,
  PASSWORD_RESET_POLICY.windowMs,
)

export type RateLimitState = {
  blocked: boolean
  retryAfterMs: number
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
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitState {
  const entry = entries.get(key)
  if (!entry) return { blocked: false, retryAfterMs: 0 }

  if (entry.blockedUntil > now) {
    return { blocked: true, retryAfterMs: entry.blockedUntil - now }
  }
  return { blocked: false, retryAfterMs: 0 }
}

// Telt één poging mee en geeft de status ná die poging terug. Callers roepen
// eerst checkRateLimit aan (mag ik nog?) en daarna recordAttempt (dit was er
// één): zodra de `limit`-ste poging binnen het venster geteld is, gaat de
// sleutel `blockMs` op slot.
export function recordAttempt(
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): RateLimitState {
  sweep(now)

  const existing = entries.get(key)

  // Nieuw venster wanneer er nog geen teller is, het venster verlopen is, of een
  // eerdere blokkade is uitgezeten.
  const stale = !existing
    || now - existing.windowStart >= policy.windowMs
    || (existing.blockedUntil > 0 && existing.blockedUntil <= now)

  if (!stale && existing.blockedUntil > now) {
    return { blocked: true, retryAfterMs: existing.blockedUntil - now }
  }

  const entry: Entry = stale ? { count: 0, windowStart: now, blockedUntil: 0 } : existing
  entry.count += 1
  if (entry.count >= policy.limit) entry.blockedUntil = now + policy.blockMs
  entries.set(key, entry)

  return entry.blockedUntil > now
    ? { blocked: true, retryAfterMs: entry.blockedUntil - now }
    : { blocked: false, retryAfterMs: 0 }
}

// Wist de teller, bijvoorbeeld na een geslaagde inlog.
export function clearRateLimit(key: string): void {
  entries.delete(key)
}

// Alleen voor tests: begin met een lege teller.
export function resetRateLimits(): void {
  entries.clear()
}

// Verwijdert verlopen tellers; alleen aangeroepen bij schrijven.
function sweep(now: number): void {
  if (entries.size < MAX_ENTRIES) return

  for (const [key, entry] of entries) {
    const expired = entry.blockedUntil <= now && now - entry.windowStart >= LONGEST_WINDOW_MS
    if (expired) entries.delete(key)
  }

  // Nog steeds vol: gooi de oudste helft weg (Map bewaart invoegvolgorde).
  if (entries.size >= MAX_ENTRIES) {
    const toDrop = Math.ceil(entries.size / 2)
    let dropped = 0
    for (const key of entries.keys()) {
      entries.delete(key)
      if (++dropped >= toDrop) break
    }
  }
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
