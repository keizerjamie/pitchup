// Today's date as YYYY-MM-DD in the *local* timezone.
// new Date().toISOString() would give the UTC date, which is yesterday
// between midnight and ~02:00 in NL.
export function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Whole days between local-midnight today and the given date (0 = today, 1 = tomorrow).
export function daysUntil(dateStr: string): number {
  const today = new Date(todayLocal() + 'T00:00:00')
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function formatDate(dateStr: string, locale = 'nl-NL'): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatDateLong(dateStr: string, locale = 'nl-NL'): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Kloktijd in 'HH:MM' (24-uurs, met leidende nul). Eén bron van waarheid voor
// tijd-validatie in de server actions (createEvent, updateGatherTime);
// naamgeving en vorm spiegelen isDateString() in lib/season-dates.ts.
//
// Bewust géén tijdzone-conversie: events.time en events.gather_time zijn kale
// lokale wandkloktijden (TIME-kolommen), precies zoals de trainer ze invoert.
//
// Naast het formaat wordt ook het BEREIK gecontroleerd: '24:00' en '25:00'
// passen wel in /^\d{2}:\d{2}$/ maar zijn geen geldige kloktijd. Zonder die
// controle zou zo'n waarde pas in Postgres stuklopen en als generieke
// databasefout bij de gebruiker landen in plaats van als nette invoerfout.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

export function formatTime(timeStr: string | null): string {
  if (!timeStr) return ''
  return timeStr.slice(0, 5)
}

export function isUpcoming(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const eventDate = new Date(dateStr + 'T00:00:00')
  return eventDate >= today
}

export function isPast(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const eventDate = new Date(dateStr + 'T00:00:00')
  return eventDate < today
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
