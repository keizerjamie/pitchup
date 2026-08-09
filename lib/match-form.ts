import { matchResult } from '@/lib/match-analysis.mjs'
import type { MatchResult } from '@/lib/types'

// Eén wedstrijd in de vorm-strook, klaar voor weergave. `result` komt uit de
// bestaande matchResult() (lib/match-analysis.mjs) — dezelfde bron van waarheid
// als het dashboard, zodat W/G/V nooit op twee plekken anders uitpakt.
export interface MatchFormItem {
  id: string
  result: MatchResult
  goalsFor: number | null
  goalsAgainst: number | null
  opponent: string | null
  date: string // YYYY-MM-DD
}

interface MatchFormRow {
  id: string
  date: string
  opponent: string | null
  goals_for: number | null
  goals_against: number | null
}

// Zuivere mapping van databaserijen naar weergave-items. Bewust GEEN sortering,
// filtering of limiet: die regels horen bij de query die de rijen ophaalt.
// `opponent` blijft null als hij null is — een invaller-tekst ("Onbekend") is
// presentatielaag. De invoer wordt niet gemuteerd.
export function toMatchFormItems(rows: MatchFormRow[]): MatchFormItem[] {
  return rows.map((row) => ({
    id: row.id,
    result: matchResult({ goals_for: row.goals_for, goals_against: row.goals_against }) as MatchResult,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    opponent: row.opponent,
    date: row.date,
  }))
}
