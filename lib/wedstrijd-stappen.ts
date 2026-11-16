// De wedstrijd als één flow: de vier stappen (beschikbaar → selectie →
// opstelling → analyse) en hun status. Pure module, bewust géén 'use server',
// géén Supabase-import en géén klok: elke pagina haalt zelf haar teamgefilterde
// data op en geeft "vandaag" (todayLocal) mee, zodat dezelfde regel ook los te
// testen is. Zelfde soort bestand als lib/lineup-compleet.ts.
//
// De status per stap hergebruikt exact de "done"-regels van de To-do op het
// dashboard en de vroegere ActionCards op de eventdetailpagina:
//   selectie   = match_squad heeft ≥1 rij
//   opstelling = telOpstelling(...).compleet (lib/lineup-compleet.ts)
//   analyse    = analyseBestaat (lib/match-analysis.mjs)
// Anders lopen stapper-vinkjes en To-do uiteen. task_overrides tellen bewust
// NIET mee: de stapper volgt alleen de data.

import { telOpstelling } from '@/lib/lineup-compleet'
import { analyseBestaat } from '@/lib/match-analysis.mjs'
import { telAanwezigheid, vasteTelling } from '@/lib/aanwezigheid-telling'
import type { AttendanceStatus, PlayerType } from '@/lib/types'

export const WEDSTRIJD_STAPPEN = ['beschikbaar', 'selectie', 'opstelling', 'analyse'] as const
export type WedstrijdStap = (typeof WEDSTRIJD_STAPPEN)[number]
// 'onbekend' = de bronquery faalde: geen vinkje, maar ook geen vals "open".
export type StapVoortgang = 'klaar' | 'open' | 'onbekend'

export interface WedstrijdStapperData {
  eventId: string
  huidig: WedstrijdStap
  // Vaste actieve spelers, zie telBeschikbaarheid.
  aanwezigheid: { aanwezig: number; geenReactie: number }
  selectie: StapVoortgang
  opstelling: StapVoortgang
  analyse: StapVoortgang
  analyseVergrendeld: boolean
}

const STAP_PAD: Record<WedstrijdStap, string> = {
  beschikbaar: '',
  selectie: '/squad',
  opstelling: '/lineup',
  analyse: '/analysis',
}

// De bestaande paden blijven de stappen: deeplinks (To-do, Vandaag, PDF-route)
// breken dus niet.
export function stapHref(eventId: string, stap: WedstrijdStap): string {
  return `/events/${eventId}${STAP_PAD[stap]}`
}

export function volgendeStap(stap: WedstrijdStap): WedstrijdStap | null {
  const i = WEDSTRIJD_STAPPEN.indexOf(stap)
  if (i < 0 || i >= WEDSTRIJD_STAPPEN.length - 1) return null
  return WEDSTRIJD_STAPPEN[i + 1]
}

// DE ene regel voor "wedstrijddag bereikt/gespeeld". `vandaag` is todayLocal()
// (servertijd) van de aanroeper. events.date is een DATE-kolom en komt als
// 'YYYY-MM-DD'-string binnen; die stringvergelijking is tijdzone-onafhankelijk.
// Alles wat geen string is, geldt als "niet bereikt" (fail-safe: een toekomstige
// wedstrijd glipt er nooit door).
export function wedstrijdDatumBereikt(eventDate: unknown, vandaag: string): boolean {
  return typeof eventDate === 'string' && eventDate <= vandaag
}

// "x aanwezig · y geen reactie" onder de stapper. Dezelfde telling als de
// stat-cards en het dashboard (telAanwezigheid + vasteTelling): een aanwezige
// gast telt NIET mee in "aanwezig" (besluit V2), een niet-aanwezige gast
// bestaat niet voor de tellingen. Een speler zonder attendance-rij geeft de
// aanroeper als 'unknown' door en telt dus als geen reactie.
export function telBeschikbaarheid<T extends { id: string; type: PlayerType }>(
  actieveSpelers: T[],
  statusVan: (s: T) => AttendanceStatus,
): { aanwezig: number; geenReactie: number } {
  const telling = telAanwezigheid(actieveSpelers, statusVan)
  return { aanwezig: vasteTelling(telling).aanwezig, geenReactie: telling.onbekend }
}

export interface StapperInvoer {
  eventId: string
  huidig: WedstrijdStap
  aanwezigheid: { aanwezig: number; geenReactie: number }
  selectieRijen: number | null                                           // null = queryfout
  lineup: { formation: unknown; positions: unknown } | null | undefined  // null = geen rij, undefined = queryfout
  uitslag: { goals_for: unknown; goals_against: unknown }
  ratingCount: number | null                                             // null = queryfout
  eventCount: number | null                                              // null = queryfout
  eventDate: unknown
  vandaag: string
}

// Bouwt de stapperdata. Gooit nooit: elke invoer uit de database is als
// onbetrouwbaar behandeld (telOpstelling vangt een kapotte vorm zelf op).
export function bouwStapperData(invoer: StapperInvoer): WedstrijdStapperData {
  const { selectieRijen, lineup, uitslag, ratingCount, eventCount } = invoer

  const selectie: StapVoortgang =
    selectieRijen === null ? 'onbekend' : selectieRijen > 0 ? 'klaar' : 'open'

  const opstelling: StapVoortgang =
    lineup === undefined
      ? 'onbekend'
      : telOpstelling(lineup?.formation, lineup?.positions).compleet ? 'klaar' : 'open'

  const bestaat = analyseBestaat({
    goals_for: uitslag?.goals_for,
    goals_against: uitslag?.goals_against,
    ratingCount: ratingCount ?? 0,
    eventCount: eventCount ?? 0,
  })
  const analyse: StapVoortgang =
    bestaat ? 'klaar' : ratingCount === null || eventCount === null ? 'onbekend' : 'open'

  return {
    eventId: invoer.eventId,
    huidig: invoer.huidig,
    aanwezigheid: invoer.aanwezigheid,
    selectie,
    opstelling,
    analyse,
    // Letterlijk de regel van de vroegere analyse-ActionCard: vóór de
    // wedstrijddag valt er niets te analyseren, tenzij er al analyse is.
    analyseVergrendeld: !bestaat && !wedstrijdDatumBereikt(invoer.eventDate, invoer.vandaag),
  }
}
