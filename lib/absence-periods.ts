// Pure helpers rond afmeldperiodes. Bewust géén 'use server' en géén
// Supabase-afhankelijkheid: dit is alleen datumlogica, zodat de server actions
// (createEvent, generateSeasonTrainings, revokeAbsencePeriod) er dezelfde regels
// uit halen en die regels los te testen zijn.
//
// Alle datums zijn kale kalenderdatums in YYYY-MM-DD (DATE-kolommen), net als
// events.date. Vergelijken gebeurt daarom als string — bij dit formaat is
// lexicografisch gelijk aan chronologisch — en NOOIT via Date-objecten: die
// zouden de tijdzone van de server laten meebeslissen, precies de val die
// lib/season-dates.ts al omzeilt.

export interface AbsencePeriodRange {
  id: string
  player_id: string
  from_date: string
  to_date: string
}

// Grenzen zijn INCLUSIEF: een event op exact from_date of to_date valt binnen de
// periode. Consistent met de gte/lte-filters van markAbsentForPeriod.
export function coversDate(
  period: Pick<AbsencePeriodRange, 'from_date' | 'to_date'>,
  date: string,
): boolean {
  return period.from_date <= date && date <= period.to_date
}

// De eerste periode uit de lijst die deze datum dekt, of null. De volgorde van
// de lijst bepaalt de uitkomst; de queries leveren hem gesorteerd op
// (created_at, id) aan zodat dit deterministisch is. Bij overlappende periodes
// is de keuze functioneel gelijkwaardig — elke dekkende periode houdt de speler
// afwezig — maar de herkomst moet wél eenduidig vastliggen.
export function findCoveringPeriod<T extends AbsencePeriodRange>(
  periods: T[],
  date: string,
): T | null {
  return periods.find((period) => coversDate(period, date)) ?? null
}

// Per speler het id van de periode die deze datum dekt. Spelers zonder dekkende
// periode staan bewust NIET in de map, zodat de aanroeper met `.get(id) ?? null`
// meteen de kolomwaarde heeft.
export function periodIdByPlayerForDate(
  periods: AbsencePeriodRange[],
  date: string,
): Map<string, string> {
  const byPlayer = new Map<string, string>()
  for (const period of periods) {
    if (!coversDate(period, date)) continue
    if (!byPlayer.has(period.player_id)) byPlayer.set(period.player_id, period.id)
  }
  return byPlayer
}
