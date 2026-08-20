// Pure logica, types en constanten voor de inzichtenpagina (/inzichten).
//
// Alles hier is zonder databasetoegang en zonder React: de server action
// (app/actions/inzichten.ts) en de pagina leveren de rijen aan, dit bestand
// rekent ze om naar weergave-vorm. Zelfde scheiding als lib/match-form.ts.
//
// De zware aggregatie gebeurt in Postgres (supabase/inzichten.sql) omdat deze
// pagina over een heel seizoen kijkt; hier blijft alleen het rekenwerk over dat
// op de al samengevatte rijen slaat.

import { matchResult } from '@/lib/match-analysis.mjs'
import { isDateString, toUtcMs } from '@/lib/season-dates'
import { addDays, todayLocal } from '@/lib/utils'
import type { MatchResult, MatchType } from '@/lib/types'

// Bovengrens op het aantal wedstrijdrijen dat de doelpuntengrafiek ophaalt.
// Zonder grens bepaalt de (door de gebruiker gekozen) seizoenslengte hoeveel
// rijen er in het geheugen komen — zelfde gedachte als MAX_SEASON_DAYS in
// lib/season-dates.ts. 200 wedstrijden is ruim meer dan een echt seizoen.
export const MAX_SEIZOEN_WEDSTRIJDEN = 200

// Standaard lengte van de top-/worst-lijstjes (top 5 / worst 5).
export const TOP_WORST_AANTAL = 5

// ── Rijtypes van de zes RPC's (supabase/inzichten.sql) ────────────────
// De Supabase-client is ongetypeerd (lib/supabase/server.ts:7), dus elk
// rpc()-resultaat krijgt bij de aanroep een expliciete `as <RijType>[]`.

// inzichten_aanwezigheid — altijd precies één rij, ook als er geen data is
// (dan 0/0). Telt over type <> 'meting', dus training + wedstrijd samen,
// precies zoals het dashboard (app/page.tsx:107-114).
export interface AanwezigheidRij {
  aanwezig: number
  afwezig: number
}

// inzichten_training_opkomst_per_maand — alleen maanden waarin daadwerkelijk
// trainingsaanwezigheid staat, oplopend op `maand`.
export interface MaandOpkomstRij {
  maand: string // 'YYYY-MM'
  aanwezig: number
  afwezig: number
}

// inzichten_rating_team_per_wedstrijd — één rij per wedstrijd met minstens één
// rating van een actieve speler, oplopend op datum.
export interface TeamRatingRij {
  event_id: string
  datum: string // 'YYYY-MM-DD'
  tegenstander: string | null
  gemiddelde: number
  aantal: number
}

// inzichten_rating_speler — één rij per beoordeelde wedstrijd van één speler,
// oplopend op datum. Tegelijk het retourtype van getSpelerRatingReeks().
export interface SpelerRatingPunt {
  event_id: string
  datum: string // 'YYYY-MM-DD'
  tegenstander: string | null
  rating: number
}

// inzichten_rating_per_speler — één rij per actieve speler met minstens één
// rating binnen het venster, oplopend op naam.
export interface RatingPerSpelerRij {
  player_id: string
  naam: string
  gemiddelde: number
  aantal: number
}

// inzichten_aanwezigheid_per_speler — één rij per actieve speler met minstens
// één aanwezigheidsregistratie binnen het (geclampte) venster, oplopend op
// naam. Alleen 'unknown'-registraties levert 0/0 op: dan is er geen percentage.
export interface AanwezigheidPerSpelerRij {
  player_id: string
  naam: string
  aanwezig: number
  afwezig: number
}

// ── Overige weergavetypes ────────────────────────────────────────────

// Eén wedstrijd in de doelpunten-/vormgrafiek. Komt uit een gewone
// events-query (niet uit een RPC), dus de veldnamen zijn die van de kolommen.
export interface DoelpuntItem {
  id: string
  date: string // 'YYYY-MM-DD'
  opponent: string | null
  match_type: MatchType | null
  goals_for: number | null
  goals_against: number | null
}

// Optie in de spelerselector van de individuele ratinggrafiek.
export interface SpelerOptie {
  id: string
  name: string
}

export interface MaandOpkomst extends MaandOpkomstRij {
  // null = geen datapunten in deze maand. Bewust géén 0% (O2): 0% zou
  // "iedereen was afwezig" betekenen, en dat is iets anders dan "geen data".
  percentage: number | null
}

export type DoelpuntFilter = 'all' | MatchType

export interface VormTelling {
  win: number
  gelijk: number
  verlies: number
  onbekend: number
}

export interface Seizoensvenster {
  start: string // 'YYYY-MM-DD'
  end: string // 'YYYY-MM-DD'
}

// Eén speler in de aanwezigheids-top/worst. `percentage` is hier bewust NIET
// nullable: rijen zonder enige aanwezig/afwezig-registratie hebben geen
// zinvol cijfer om op te ranken en vallen al in topWorstAanwezigheid() weg.
export interface AanwezigheidPerSpeler extends AanwezigheidPerSpelerRij {
  percentage: number
}

// Twee lijstjes uit dezelfde dataset: de n hoogste en de n laagste.
export interface TopWorst<T> {
  top: T[]
  worst: T[]
}

// Rij-vorm waar telVorm() genoeg aan heeft: zowel DoelpuntItem als de
// "laatste 5 wedstrijden"-rijen passen hierop.
type UitslagRij = Pick<DoelpuntItem, 'goals_for' | 'goals_against'>

// ── Berekeningen ─────────────────────────────────────────────────────

// Aanwezigheidspercentage, afgerond op hele procenten — exact dezelfde
// afronding als het dashboard (app/page.tsx:112-114), zodat hetzelfde seizoen
// nooit op twee plekken een ander getal geeft.
//
// null bij noemer 0: zonder aanwezig- én afwezig-registraties is er geen
// percentage. 0% teruggeven zou "iedereen afwezig" suggereren.
//
// LET OP (O3, bewuste asymmetrie): de aanwezigheidscijfers filteren NIET op
// players.active — consistent met het bestaande dashboard, dat ook niet
// filtert. Alleen de ratinggrafieken kijken naar actieve spelers
// (supabase/inzichten.sql). Verzin dit niet stilzwijgend anders.
//
// Die asymmetrie geldt ALLEEN voor `active`. Gastspelers (players.type =
// 'guest') worden wél overal weggefilterd: alle zes RPC's in
// supabase/inzichten.sql filteren op p.type = 'regular', en het dashboard doet
// hetzelfde in JS (app/page.tsx). Een gast telt dus nergens mee in teller of
// noemer.
export function berekenAanwezigheidPercentage(aanwezig: number, afwezig: number): number | null {
  if (!Number.isFinite(aanwezig) || !Number.isFinite(afwezig)) return null
  if (aanwezig < 0 || afwezig < 0) return null
  const totaal = aanwezig + afwezig
  if (totaal <= 0) return null
  return Math.round((aanwezig / totaal) * 100)
}

// Voegt per maand het percentage toe. Maanden zonder enige registratie levert
// de RPC al niet op; een geretourneerde maand met 0 aanwezig én 0 afwezig
// krijgt percentage null (O2), niet 0%.
//
// Bewust geen sortering of filtering: de RPC levert de maanden al oplopend en
// dit blijft daarmee één bron van waarheid. De invoer wordt niet gemuteerd.
export function toMaandOpkomst(rows: MaandOpkomstRij[]): MaandOpkomst[] {
  return rows.map((row) => ({
    maand: row.maand,
    aanwezig: row.aanwezig,
    afwezig: row.afwezig,
    percentage: berekenAanwezigheidPercentage(row.aanwezig, row.afwezig),
  }))
}

// Filtert wedstrijden op soort. 'all' geeft alles terug, inclusief
// wedstrijden zonder ingevuld match_type (null). Een specifiek filter matcht
// exact: een wedstrijd met match_type null valt daar dus buiten.
//
// Een onbekende filterwaarde matcht niets en levert een lege lijst op — er
// wordt bewust niet stilzwijgend teruggevallen op 'all', want dan zou een
// tikfout in de UI ongemerkt de verkeerde (te ruime) grafiek tonen. De pagina
// hoort de filterwaarde te valideren en standaard 'all' te gebruiken.
//
// Geeft altijd een nieuwe array terug; de invoer wordt niet gemuteerd.
export function filterDoelpunten(items: DoelpuntItem[], filter: DoelpuntFilter): DoelpuntItem[] {
  if (filter === 'all') return [...items]
  return items.filter((item) => item.match_type === filter)
}

// Telt W/G/V/onbekend over een lijst wedstrijden. De uitkomst per wedstrijd
// komt uit de bestaande matchResult() (lib/match-analysis.mjs) — dezelfde bron
// van waarheid als het dashboard en de vorm-strook (lib/match-form.ts:31),
// zodat de vorm nooit op twee plekken anders uitpakt.
export function telVorm(items: UitslagRij[]): VormTelling {
  const telling: VormTelling = { win: 0, gelijk: 0, verlies: 0, onbekend: 0 }
  for (const item of items) {
    const result = matchResult({
      goals_for: item.goals_for,
      goals_against: item.goals_against,
    }) as MatchResult
    if (result === 'win') telling.win++
    else if (result === 'draw') telling.gelijk++
    else if (result === 'loss') telling.verlies++
    else telling.onbekend++
  }
  return telling
}

// ── Top 5 / worst 5 per speler ───────────────────────────────────────

// Gedeelde snij-logica voor beide top/worst-lijstjes. `waarde` levert het
// getal waarop gesorteerd wordt.
//
// BEWUSTE, SIMPELE REGEL: bij minder dan 2n spelers mogen top en worst
// dezelfde speler bevatten. Met 3 spelers zijn "de beste 3" en "de slechtste
// 3" nu eenmaal dezelfde drie namen; er wordt niet stilzwijgend gededupliceerd
// of afgekapt, want dan zou de coach bij een kleine selectie een half lijstje
// zien zonder te weten waarom.
//
// Gelijke waarden krijgen een vaste tweede sleutel (naam, dan player_id), zodat
// dezelfde dataset altijd dezelfde volgorde geeft — anders zou een pagina-
// refresh de namen kunnen laten wisselen. De invoer wordt nooit gemuteerd.
function snijTopWorst<T extends { naam: string; player_id: string }>(
  rows: T[],
  waarde: (row: T) => number,
  n: number,
): TopWorst<T> {
  const aantal = Math.max(0, Math.trunc(n))
  const tieBreak = (a: T, b: T) =>
    a.naam === b.naam ? (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0)
      : a.naam < b.naam ? -1 : 1

  const oplopend = [...rows].sort((a, b) => {
    const verschil = waarde(a) - waarde(b)
    return verschil !== 0 ? verschil : tieBreak(a, b)
  })
  const aflopend = [...rows].sort((a, b) => {
    const verschil = waarde(b) - waarde(a)
    return verschil !== 0 ? verschil : tieBreak(a, b)
  })

  return { top: aflopend.slice(0, aantal), worst: oplopend.slice(0, aantal) }
}

// Top n en worst n op gemiddelde wedstrijdrating. Voedt zich met álle rijen
// van inzichten_rating_per_speler: één RPC-aanroep levert beide lijstjes.
export function topWorstRating(
  rows: RatingPerSpelerRij[],
  n: number = TOP_WORST_AANTAL,
): TopWorst<RatingPerSpelerRij> {
  return snijTopWorst(rows, (row) => row.gemiddelde, n)
}

// Top n en worst n op aanwezigheidspercentage. Het percentage komt uit de
// bestaande berekenAanwezigheidPercentage(), zodat het per speler exact zo
// wordt afgerond als de team-brede kaart en het dashboard.
//
// Spelers zonder enige aanwezig/afwezig-registratie (percentage null) doen NIET
// mee: die hebben geen cijfer om op te ranken en zouden anders als "0%" onderaan
// de worst-lijst belanden terwijl er gewoon geen data is.
export function topWorstAanwezigheid(
  rows: AanwezigheidPerSpelerRij[],
  n: number = TOP_WORST_AANTAL,
): TopWorst<AanwezigheidPerSpeler> {
  const metPercentage: AanwezigheidPerSpeler[] = []
  for (const row of rows) {
    const percentage = berekenAanwezigheidPercentage(row.aanwezig, row.afwezig)
    if (percentage === null) continue
    metPercentage.push({
      player_id: row.player_id,
      naam: row.naam,
      aanwezig: row.aanwezig,
      afwezig: row.afwezig,
      percentage,
    })
  }
  return snijTopWorst(metPercentage, (row) => row.percentage, n)
}

// ── Seizoensvenster ──────────────────────────────────────────────────

// Is dit een bruikbaar seizoensvenster? Beide datums moeten bestaande
// kalenderdatums zijn (isDateString weigert ook 2026-02-30) en de einddatum
// mag niet vóór de startdatum liggen.
//
// O4: een omgekeerd venster (season_end < season_start) telt als "geen seizoen
// ingesteld" — geen crash, geen RPC-aanroep, gewoon geen data.
//
// De vergelijking gaat via toUtcMs (lib/season-dates.ts) en niet via Date:
// events.date is een kale kalenderdatum zonder tijdzone, en die mag ook nooit
// door de tijdzone van de server verschoven worden.
export function isGeldigSeizoensvenster(start: unknown, end: unknown): boolean {
  if (!isDateString(start) || !isDateString(end)) return false
  const startMs = toUtcMs(start)
  const endMs = toUtcMs(end)
  return startMs !== null && endMs !== null && endMs >= startMs
}

// Haalt het seizoensvenster uit een settings-map (zoals getAllSettings()
// oplevert: app/actions/settings.ts:22-31). null = niet ingesteld, onvolledig
// of ongeldig — de aanroeper toont dan simpelweg geen data.
export function seizoensVenster(
  settings: Record<string, string | undefined>,
): Seizoensvenster | null {
  const start = settings['season_start']
  const end = settings['season_end']
  if (!isDateString(start) || !isDateString(end)) return null
  if (!isGeldigSeizoensvenster(start, end)) return null
  return { start, end }
}

// Hetzelfde seizoensvenster, maar afgeknipt op gisteren: nooit een datum ná
// vandaag. De aanwezigheidscijfers (kaart "Aanwezigheid" en "Trainingsopkomst
// per maand") mogen niet meetellen wat nog niet gespeeld is — al ingeplande
// trainingen/wedstrijden hebben nog geen registraties en zouden de opkomst
// anders kunstmatig omlaag trekken.
//
// Waarom gisteren en niet vandaag: exact dezelfde grens als de vorm-/laatste-5-
// query op het dashboard en op deze pagina zelf (`.lt('date', today)`,
// app/inzichten/page.tsx). "Vandaag" telt daar ook niet mee, omdat de training
// van vanavond nog niet is afgevinkt. Eén conventie in de hele app.
//
// Tijdzone: bewust dezelfde semantiek als de rest van de app — `todayLocal()`
// (lib/utils.ts) leest de klok van de server/omgeving. Datzelfde bekende gat
// geldt al voor de vorm-cutoff; hier wordt het niet stilzwijgend anders gedaan.
//
// Ligt het hele seizoen nog in de toekomst, dan komt `end` vóór `start` te
// liggen. Dat is geen fout: zo'n venster levert in SQL nul rijen op
// (`e.date >= p_start and e.date <= p_end` kan niet waar zijn) en de kaarten
// tonen hun bestaande lege staat.
export function verledenSeizoensVenster(
  venster: Seizoensvenster,
  vandaag: string = todayLocal(),
): Seizoensvenster {
  const gisteren = addDays(vandaag, -1)
  // Onbruikbare klokwaarde: liever het rauwe venster dan 'NaN-NaN-NaN' naar de
  // database sturen.
  if (!isDateString(gisteren)) return { start: venster.start, end: venster.end }
  // 'YYYY-MM-DD' heeft een vaste breedte, dus alfabetisch = chronologisch.
  const end = gisteren < venster.end ? gisteren : venster.end
  return { start: venster.start, end }
}
