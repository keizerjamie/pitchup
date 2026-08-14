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
  // Bewust een inline literal union, GEEN import van het `HomeAway`-type uit
  // `@/lib/types` — zelfde keuze als de `homeAway`-prop in
  // components/MatchSquadPrintList.tsx, waar dit type wordt geconsumeerd. Dat
  // bestand heeft een harde importbeperking op `@/lib/types`; door hier
  // dezelfde vorm te gebruiken blijft het contract tussen lib en print-laag
  // letterlijk identiek. `null` = thuis/uit niet ingevuld.
  homeAway: 'home' | 'away' | null
}

interface MatchFormRow {
  id: string
  date: string
  opponent: string | null
  goals_for: number | null
  goals_against: number | null
  home_away: 'home' | 'away' | null
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
    homeAway: row.home_away,
  }))
}

// Zet de score in de volgorde die de voetbalconventie voorschrijft: thuisploeg
// eerst. Bij een uitwedstrijd is dat de tegenstander (`goalsAgainst`), bij een
// thuiswedstrijd het eigen team (`goalsFor`). Is thuis/uit niet bekend (`null`),
// dan blijft het eigen team eerst staan — het bestaande gedrag, zodat een
// ontbrekende waarde nooit stilzwijgend een omgedraaide score oplevert.
// Zelfde volgorde-regel als de matchup-regels in
// components/MatchSquadPrintList.tsx, hier puur numeriek.
// Geeft `null` als de uitslag (deels) ontbreekt: dan is er geen score om te
// tonen. Presentatie (streepje, opmaak) blijft aan de aanroeper.
export function orderedScore(item: MatchFormItem): { first: number; second: number } | null {
  if (item.goalsFor === null || item.goalsAgainst === null) return null
  return item.homeAway === 'away'
    ? { first: item.goalsAgainst, second: item.goalsFor }
    : { first: item.goalsFor, second: item.goalsAgainst }
}
