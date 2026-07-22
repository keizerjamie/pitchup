// Pure, dependency-free calendar date helpers. Kept as .mjs so the
// dependency-free node test (scripts/calendar.test.mjs) imports the exact same
// code the UI runs. All dates are local YYYY-MM-DD strings, matching the
// convention in lib/utils.ts (parse with `${str}T00:00:00`, never a bare
// `new Date(str)`, to avoid the UTC off-by-one around midnight in NL).

/** Format a Date as a local YYYY-MM-DD string. */
export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Month grid as weeks of local YYYY-MM-DD strings, Monday-first.
 * Fills whole weeks with leading/trailing days from the adjacent months.
 * @param {number} year  full year, e.g. 2026
 * @param {number} month 1-12
 * @returns {string[][]} weeks, each exactly 7 date-strings (Mon → Sun)
 */
export function monthMatrix(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate()
  // JS getDay: 0=Sun..6=Sat. Convert to Monday-first: 0=Mon..6=Sun.
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const rows = Math.ceil((firstWeekday + daysInMonth) / 7)
  const cursor = new Date(year, month - 1, 1 - firstWeekday)
  const weeks = []
  for (let w = 0; w < rows; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      week.push(toDateStr(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** True if the local date-string falls in the given year and month (1-12). */
export function sameMonth(dateStr, year, month) {
  return dateStr.startsWith(`${year}-${String(month).padStart(2, '0')}-`)
}
