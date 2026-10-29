// Pure logica, types en constanten voor de inzichtenpagina (/inzichten).
//
// Alles hier is zonder databasetoegang en zonder React: de server action
// (app/actions/inzichten.ts) en de pagina leveren de rijen aan, dit bestand
// rekent ze om naar weergave-vorm. Zelfde scheiding als lib/match-form.ts.
//
// De zware aggregatie gebeurt in Postgres (supabase/inzichten.sql) omdat deze
// pagina over een heel seizoen kijkt; hier blijft alleen het rekenwerk over dat
// op de al samengevatte rijen slaat.

import { analyseBestaat, matchResult } from '@/lib/match-analysis.mjs'
import { hasTrainingPlanDone } from '@/lib/todos.mjs'
import { fromUtcMs, isDateString, isoWeek, maandagVanWeek, toUtcMs, wekenInVenster } from '@/lib/season-dates'
import { addDays, todayLocal } from '@/lib/utils'
import { blokkenVanKoppelingen } from '@/lib/parallel-groep'
import { berekenTijdlijn, effectieveDuurMin } from '@/lib/sessie-tijdlijn'
import { actueleMetingen, computeCurrentSteps } from '@/lib/periodization'
import { heeftDoelstelling, isTrainingOordeel, isValidRpe } from '@/lib/training-evaluatie'
import {
  MEETBARE_CATEGORIES,
  PERIODIZATION_CATEGORIES,
  POSITIONS,
  TEGENDOELPUNT_SOORTEN,
  berekenStap,
} from '@/lib/types'
import type {
  CategorieMeting,
  HomeAway,
  MatchResult,
  MatchType,
  OefeningCategorie,
  Position,
  TegendoelpuntSoort,
} from '@/lib/types'

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
// afronding als de opkomst-KPI van het dashboard (attendancePct in
// app/page.tsx), zodat hetzelfde seizoen nooit op twee plekken een ander getal
// geeft.
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
//
// Parallelle regel voor de UI-tellingen en -lijsten (stat-cards, hero-ring,
// afwezigenlijsten): die woont in teltMee/telAanwezigheid/splitsAanwezigheid in
// lib/aanwezigheid-telling.ts. Het verschil met hierboven zit in de
// ZICHTBAARHEID, niet in het percentage: een gast die handmatig op aanwezig is
// gezet staat daar wél tussen de aanwezigen, maar telt nog steeds niet mee in
// teller of noemer van het opkomstpercentage. telAanwezigheid roept daarvoor
// berekenAanwezigheidPercentage hieronder aan met UITSLUITEND de vaste
// selectie, zodat er maar één afronding en één null-bij-noemer-0 bestaat.
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

// ── Samenvattingscijfers en signalen (bovenste laag van /inzichten) ───
//
// Alles hieronder rekent op rijen die de pagina tóch al ophaalt: er komt geen
// enkele extra query of RPC bij. De pagina toonde die rijen alleen nog nergens
// als conclusie — een percentage zonder vergelijking of norm laat de trainer
// zelf alle interpretatie doen.

// Streefwaarde voor trainingsopkomst. Onderzoek naar jeugdopleidingen wijst
// 85% aan als de grens waarboven teams merkbaar sneller ontwikkelen; daaronder
// verwatert de opbouw tussen trainingen.
//
// BEWUST EEN VASTE CONSTANTE, geen teaminstelling: een instelbare drempel
// vraagt een kolom, een instellingenscherm en een migratie, en dat is een
// datamodel-wijziging die hier niet gevraagd is. Wordt dit ooit per team
// instelbaar, dan blijft deze waarde de standaard.
export const OPKOMST_DOEL = 85

// Onder dit percentage aanwezigheid noemt het signalenblok een speler
// expliciet "meer dan de helft gemist". Bewust ruim onder OPKOMST_DOEL: dit
// gaat niet over een team dat iets achterloopt maar over individuele spelers
// die structureel wegblijven.
export const SPELER_ZORGDREMPEL = 50

// Hoeveel signalen het blok maximaal toont. Meer dan drie leest als een lijst
// in plaats van als een conclusie.
export const MAX_SIGNALEN = 3

// Aantal recente wedstrijden waarover de ratingtrend wordt vergeleken: het
// gemiddelde van de laatste N tegen dat van de N daarvóór.
export const RATING_TREND_VENSTER = 5

// Vanaf welk verschil een ratingtrend het vermelden waard is. Onder deze
// waarde is het ruis: één wedstrijd met twee invallers verschuift het
// gemiddelde al met een tiende.
export const RATING_TREND_DREMPEL = 0.3

export interface MaandTrend {
  maand: string // 'YYYY-MM'
  percentage: number
  // null = er is geen eerdere maand met een percentage om mee te vergelijken.
  vorigePercentage: number | null
  delta: number | null
}

// De meest recente maand mét percentage, plus het verschil met de maand
// daarvóór die óók een percentage heeft. Maanden zonder data (percentage null)
// worden overgeslagen in plaats van als 0% meegeteld — zelfde regel als overal
// elders in dit bestand.
//
// null als er geen enkele maand met een percentage is.
export function laatsteMaandTrend(maanden: MaandOpkomst[]): MaandTrend | null {
  const metCijfer = maanden.filter(
    (m): m is MaandOpkomst & { percentage: number } => m.percentage !== null,
  )
  if (metCijfer.length === 0) return null
  const laatste = metCijfer[metCijfer.length - 1]
  const vorige = metCijfer.length > 1 ? metCijfer[metCijfer.length - 2] : null
  return {
    maand: laatste.maand,
    percentage: laatste.percentage,
    vorigePercentage: vorige ? vorige.percentage : null,
    delta: vorige ? laatste.percentage - vorige.percentage : null,
  }
}

export interface RatingTrend {
  gemiddelde: number
  aantal: number
  // null = te weinig wedstrijden om twee vensters te vergelijken.
  delta: number | null
}

// Teamgemiddelde over alle beoordeelde wedstrijden, plus de trend: het
// gemiddelde van de laatste `venster` wedstrijden min dat van de `venster`
// daarvóór. Zonder twee volle vensters is er geen eerlijke vergelijking en
// blijft delta null — een trend op basis van één wedstrijd tegen vier is geen
// trend.
//
// `rows` komt oplopend op datum uit de RPC; de invoer wordt niet gemuteerd.
export function teamRatingTrend(
  rows: TeamRatingRij[],
  venster: number = RATING_TREND_VENSTER,
): RatingTrend | null {
  if (rows.length === 0) return null
  const gemiddelde = rows.reduce((som, r) => som + r.gemiddelde, 0) / rows.length

  const breedte = Math.max(1, Math.trunc(venster))
  let delta: number | null = null
  if (rows.length >= breedte * 2) {
    const recent = rows.slice(-breedte)
    const daarvoor = rows.slice(-breedte * 2, -breedte)
    const gem = (deel: TeamRatingRij[]) => deel.reduce((som, r) => som + r.gemiddelde, 0) / deel.length
    delta = gem(recent) - gem(daarvoor)
  }
  return { gemiddelde, aantal: rows.length, delta }
}

export interface Doelsaldo {
  voor: number
  tegen: number
  saldo: number
  wedstrijden: number
}

// Doelpunten voor/tegen over de wedstrijden die een volledige uitslag hebben.
// Wedstrijden waarvan één van beide kanten leeg is tellen nergens mee: een
// half ingevulde uitslag zou het saldo stilzwijgend scheeftrekken.
export function doelsaldo(items: DoelpuntItem[]): Doelsaldo {
  let voor = 0
  let tegen = 0
  let wedstrijden = 0
  for (const item of items) {
    if (item.goals_for === null || item.goals_against === null) continue
    voor += item.goals_for
    tegen += item.goals_against
    wedstrijden++
  }
  return { voor, tegen, saldo: voor - tegen, wedstrijden }
}

// Toon van een signaal. Bepaalt uitsluitend de kleur/het icoon in de UI, niet
// de volgorde — die staat hieronder vast.
export type SignaalToon = 'goed' | 'letop' | 'zorg'

export interface Signaal {
  // Stabiele sleutel, bruikbaar als React-key en in tests.
  id: string
  toon: SignaalToon
  // Naam van de i18n-sleutel binnen `t.insights`. Het signaal draagt bewust
  // geen kant-en-klare zin: dit bestand is taalonafhankelijk, net als de rest
  // van lib/. De component vult de tekst in.
  tekstSleutel: string
  // Waarden voor de {placeholders} in die tekst.
  waarden: Record<string, string | number>
}

export interface SignaalInvoer {
  maanden: MaandOpkomst[]
  aanwezigheidPerSpeler: AanwezigheidPerSpelerRij[]
  teamRating: TeamRatingRij[]
  doelpunten: DoelpuntItem[]
}

// Bouwt de "wat valt op"-signalen op uit dezelfde rijen die de grafieken al
// gebruiken. Puur regelgebaseerd — geen model, geen externe aanroep, geheel
// deterministisch, en daarmee gewoon te testen.
//
// VOLGORDE IS DE PRIORITEIT: problemen eerst (zorg, dan let-op), complimenten
// als laatste. Bij meer dan MAX_SIGNALEN treffers vallen de laatste af, dus
// een zorgsignaal verdringt altijd een compliment en nooit andersom. Bij nul
// treffers geeft dit een lege lijst terug en hoort de aanroeper het hele blok
// weg te laten in plaats van "geen bijzonderheden" te tonen — dat laatste is
// een regel tekst die niets toevoegt.
export function bepaalSignalen(invoer: SignaalInvoer): Signaal[] {
  const zorg: Signaal[] = []
  const letop: Signaal[] = []
  const goed: Signaal[] = []

  // 1. Spelers die structureel wegblijven. Staat vooraan omdat dit het enige
  //    signaal is dat over individuele spelers gaat en dus direct tot een
  //    gesprek leidt.
  const wegblijvers = invoer.aanwezigheidPerSpeler.filter((rij) => {
    const percentage = berekenAanwezigheidPercentage(rij.aanwezig, rij.afwezig)
    return percentage !== null && percentage < SPELER_ZORGDREMPEL
  })
  if (wegblijvers.length > 0) {
    zorg.push({
      id: 'spelers-onder-drempel',
      toon: 'zorg',
      tekstSleutel: wegblijvers.length === 1 ? 'signaalSpelerWegblijver' : 'signaalSpelersWegblijvers',
      waarden: { aantal: wegblijvers.length, drempel: SPELER_ZORGDREMPEL, naam: wegblijvers[0].naam },
    })
  }

  // 2. Trainingsopkomst tegen de norm. Onder de norm is een let-op; erboven
  //    een compliment (dat pas getoond wordt als er ruimte over is).
  const trend = laatsteMaandTrend(invoer.maanden)
  if (trend) {
    if (trend.percentage < OPKOMST_DOEL) {
      letop.push({
        id: 'opkomst-onder-doel',
        toon: 'letop',
        tekstSleutel: trend.delta !== null && trend.delta < 0 ? 'signaalOpkomstOnderDoelDaling' : 'signaalOpkomstOnderDoel',
        waarden: {
          doel: OPKOMST_DOEL,
          percentage: trend.percentage,
          maand: trend.maand,
          daling: trend.delta !== null ? Math.abs(trend.delta) : 0,
        },
      })
    } else {
      goed.push({
        id: 'opkomst-boven-doel',
        toon: 'goed',
        tekstSleutel: 'signaalOpkomstBovenDoel',
        waarden: { doel: OPKOMST_DOEL, percentage: trend.percentage, maand: trend.maand },
      })
    }
  }

  // 3. Ratingtrend, alleen bij een verschil dat boven de ruisdrempel uitkomt.
  const rating = teamRatingTrend(invoer.teamRating)
  if (rating && rating.delta !== null && Math.abs(rating.delta) >= RATING_TREND_DREMPEL) {
    const verschil = Math.round(Math.abs(rating.delta) * 10) / 10
    if (rating.delta > 0) {
      goed.push({
        id: 'rating-stijging',
        toon: 'goed',
        tekstSleutel: 'signaalRatingStijging',
        waarden: { verschil, venster: RATING_TREND_VENSTER },
      })
    } else {
      letop.push({
        id: 'rating-daling',
        toon: 'letop',
        tekstSleutel: 'signaalRatingDaling',
        waarden: { verschil, venster: RATING_TREND_VENSTER },
      })
    }
  }

  // 4. Doelsaldo. Alleen vermeldenswaard als er genoeg wedstrijden zijn om er
  //    iets over te zeggen — bij twee wedstrijden zegt een saldo niets.
  const saldo = doelsaldo(invoer.doelpunten)
  if (saldo.wedstrijden >= RATING_TREND_VENSTER) {
    if (saldo.saldo < 0) {
      letop.push({
        id: 'doelsaldo-negatief',
        toon: 'letop',
        tekstSleutel: 'signaalDoelsaldoNegatief',
        waarden: { voor: saldo.voor, tegen: saldo.tegen, wedstrijden: saldo.wedstrijden },
      })
    } else if (saldo.saldo > 0) {
      goed.push({
        id: 'doelsaldo-positief',
        toon: 'goed',
        tekstSleutel: 'signaalDoelsaldoPositief',
        waarden: { saldo: saldo.saldo, voor: saldo.voor, tegen: saldo.tegen, wedstrijden: saldo.wedstrijden },
      })
    }
  }

  return [...zorg, ...letop, ...goed].slice(0, MAX_SIGNALEN)
}

// Leesbaar maandlabel uit 'YYYY-MM'. Stond eerder als lokale functie in
// components/inzichten/OpkomstPerMaandChart.tsx; verhuisd hierheen zodat de
// KPI-strook en het signalenblok exact dezelfde notatie tonen als de grafiek —
// twee schrijfwijzen van dezelfde maand op één pagina leest als twee
// verschillende maanden.
//
// Zelfde tijdzone-veilige aanpak als lib/season-dates.ts: 'YYYY-MM' gaat via
// Date.UTC naar een leesbaar maandlabel. timeZone:'UTC' is VERPLICHT bij het
// formatteren, anders kan de browser-tijdzone van de bezoeker de getoonde
// maand laten verschuiven (bv. eind/begin van de maand rond middernacht UTC).
export function maandLabel(maand: string, locale: string): string {
  const [jaar, maandNr] = maand.split('-').map(Number)
  const ms = Date.UTC(jaar, maandNr - 1, 1)
  const label = new Date(ms).toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// ── Periodefilter ────────────────────────────────────────────────────
//
// De pagina keek altijd naar het hele seizoen. "Hoe ging het de laatste vier
// weken" was daarmee onbeantwoordbaar, terwijl dat precies de vraag is die
// een trainer op dinsdagavond stelt.

export const PERIODES = ['4w', '8w', 'seizoen'] as const
export type Periode = (typeof PERIODES)[number]

// Standaardperiode. Ook de terugval bij een onbekende of ontbrekende waarde:
// het hele seizoen is de ruimste, minst verrassende lens, en een tikfout in
// de URL hoort nooit stilzwijgend een smaller (en dus misleidend leger)
// venster op te leveren.
export const PERIODE_STANDAARD: Periode = 'seizoen'

// Aantal dagen dat elke periode terugkijkt. 'seizoen' staat er bewust niet in:
// die knipt niets af.
const PERIODE_DAGEN: Record<Exclude<Periode, 'seizoen'>, number> = {
  '4w': 28,
  '8w': 56,
}

export function isPeriode(waarde: unknown): waarde is Periode {
  return typeof waarde === 'string' && (PERIODES as readonly string[]).includes(waarde)
}

// Knipt het seizoensvenster af op de gekozen periode. De einddatum blijft die
// van het seizoen — het afknippen op "niet later dan gisteren" gebeurt
// verderop in verledenSeizoensVenster(), precies zoals voorheen.
//
// De startdatum wordt nooit vroeger dan de seizoensstart: "laatste 8 weken"
// mag niet buiten het seizoen om data ophalen die er niet bij hoort.
//
// Ligt het hele seizoen in het verleden, dan levert een korte periode een
// venster op waarin niets valt. Dat is geen fout maar het juiste antwoord:
// er is in de laatste vier weken inderdaad niets gebeurd.
export function periodeVenster(
  venster: Seizoensvenster,
  periode: Periode,
  vandaag: string = todayLocal(),
): Seizoensvenster {
  if (periode === 'seizoen') return { start: venster.start, end: venster.end }

  const grens = addDays(vandaag, -(PERIODE_DAGEN[periode] - 1))
  // Onbruikbare klokwaarde: liever het volledige seizoen tonen dan
  // 'NaN-NaN-NaN' naar de database sturen. Zelfde voorzorg als
  // verledenSeizoensVenster().
  if (!isDateString(grens)) return { start: venster.start, end: venster.end }

  // 'YYYY-MM-DD' heeft een vaste breedte, dus alfabetisch = chronologisch.
  const start = grens > venster.start ? grens : venster.start
  return { start, end: venster.end }
}

// ── Spelersprofiel: statistieken van één speler ───────────────────────
//
// Het profiel (/players/[id], tab Statistieken) bundelt drie bestaande
// bronnen: de aanwezigheids-RPC per speler, de ratingreeks per speler en de
// match_events van die speler. De types en de pure telling staan hier — niet
// in app/actions/inzichten.ts, want een 'use server'-bestand mag alleen async
// functies exporteren (geheugen.md).

// Per-kind tellingen uit match_events binnen het seizoensvenster.
// Altijd alle vier de velden gevuld; 0 is een echte telling, geen "onbekend".
export interface MatchEventTelling {
  doelpunten: number
  assists: number
  geel: number
  rood: number
}

// Retourvorm van getSpelerStatistieken (app/actions/inzichten.ts).
export interface SpelerStatistieken {
  // Geklemd venster (t/m gisteren) — alleen voor de aanwezigheid. Zie
  // verledenSeizoensVenster: toekomstige, nog niet gespeelde events mogen het
  // percentage niet omlaag trekken (markInjured zet daar al 'injured' neer).
  aanwezig: number
  // 'absent' + 'injured': de RPC telt een blessure als afwezig.
  afwezig: number
  // null = geen enkele present/absent-registratie; NOOIT 0% — zelfde regel als
  // berekenAanwezigheidPercentage hierboven.
  aanwezigheidPercentage: number | null
  // Volledig seizoensvenster: een rating bestaat per definitie pas ná de
  // wedstrijd, dus die heeft het klemmen niet nodig.
  ratingReeks: SpelerRatingPunt[]
  // null = geen beoordeelde wedstrijden. Ongerond; de UI rondt af.
  gemiddeldeRating: number | null
  tellingen: MatchEventTelling
}

// Bovengrens op het aantal match_events-rijen dat één speler oplevert. Zelfde
// gedachte als MAX_SEIZOEN_WEDSTRIJDEN hierboven: de seizoenslengte is door de
// gebruiker bepaald en mag het geheugen niet sturen.
export const MAX_SPELER_MATCH_EVENTS = 500

// Telt match_events-rijen naar vier getallen. Puur, zonder databasetoegang, en
// de invoer wordt niet gemuteerd.
//
// Een onbekende `kind` wordt genegeerd: de CHECK-constraint op match_events
// (supabase/schema.sql) laat er geen toe, maar tellen is niet de plek om daar
// blind op te vertrouwen — een onbekende waarde mag nooit stilzwijgend als
// doelpunt meetellen.
export function telMatchEvents(rows: { kind: string }[]): MatchEventTelling {
  const telling: MatchEventTelling = { doelpunten: 0, assists: 0, geel: 0, rood: 0 }
  for (const row of rows) {
    switch (row?.kind) {
      case 'goal': telling.doelpunten++; break
      case 'assist': telling.assists++; break
      case 'yellow': telling.geel++; break
      case 'red': telling.rood++; break
      default: break
    }
  }
  return telling
}

// ── Inzichten-metrics fase 1 (supabase/inzichten-metrics.sql) ────────
// Vier RPC's leveren kleine, al gegroepeerde rijsets; hier gebeurt de uitkomst
// per wedstrijd (via matchResult, de enige bron van de uitslagregel), de
// punten en de bakindeling per kwartier. Alles puur: de invoer wordt nooit
// gemuteerd, en een niet-eindige of onbekende waarde wordt genegeerd in plaats
// van stil meegeteld (zelfde houding als telMatchEvents).

// inzichten_wedstrijd_uitslagen — één rij per wedstrijd MET uitslag binnen het
// venster, oplopend op datum en id. Hooguit MAX_SEIZOEN_WEDSTRIJDEN + 1 rijen:
// komen er meer dan MAX_SEIZOEN_WEDSTRIJDEN terug, dan is de set afgekapt en
// mag de pagina geen cijfers tonen.
export interface WedstrijdUitslagRij {
  event_id: string
  datum: string // 'YYYY-MM-DD'
  home_away: HomeAway | null
  goals_for: number
  goals_against: number
  formatie: string | null // al ge-btrimd; leeg → null (SQL)
}

// inzichten_speler_momenten — één rij per speler met minstens één moment,
// oplopend op naam en id. Bewust GEEN filter op active of type: gasten en
// inactieve spelers tellen mee (V2), `gast` markeert de gast.
export interface SpelerMomentenRij {
  player_id: string
  naam: string
  gast: boolean
  doelpunten: number
  assists: number
  geel: number
  rood: number
}

// inzichten_doelpunten_per_minuut — eigen doelpunten gegroepeerd per minuut;
// minuut null = vastgelegd zonder minuut.
export interface DoelpuntMinuutRij {
  minuut: number | null
  aantal: number
}

// inzichten_tegendoelpunten — tegendoelpunten gegroepeerd per minuut en soort.
export interface TegendoelpuntMinuutRij {
  minuut: number | null
  soort: TegendoelpuntSoort
  aantal: number
}

// Punten per uitslag (V8): 3 voor winst, 1 voor gelijk, 0 voor verlies.
export const PUNTEN_PER_UITSLAG = { win: 3, draw: 1, loss: 0 } as const

// Kwartierbakken (V4). '90+' vangt blessuretijd van de tweede helft en
// verlenging (91..130). Blessuretijd van de eerste helft heeft geen eigen bak:
// 45+2 wordt als minuut 47 vastgelegd en valt dus in '46-60'.
export const KWARTIER_BAKKEN = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90', '90+'] as const
export type KwartierBak = (typeof KWARTIER_BAKKEN)[number]

// Minuut → bak. Grenzen: 0..15 → '1-15' (minuut 0 = aftrap), 16..30, 31..45,
// 46..60, 61..75, 76..90 per bak, 91..130 → '90+'. null, een niet-geheel getal
// of iets buiten 0..130 (de CHECK op minute) → null.
export function kwartierBak(minuut: unknown): KwartierBak | null {
  if (typeof minuut !== 'number' || !Number.isInteger(minuut)) return null
  if (minuut < 0 || minuut > 130) return null
  if (minuut <= 15) return '1-15'
  if (minuut <= 30) return '16-30'
  if (minuut <= 45) return '31-45'
  if (minuut <= 60) return '46-60'
  if (minuut <= 75) return '61-75'
  if (minuut <= 90) return '76-90'
  return '90+'
}

// Resultaten van een groep wedstrijden (thuis, uit, een formatie, ...).
// puntenPerWedstrijd is ongerond en null bij 0 wedstrijden (nooit NaN); de UI
// rondt af.
export interface ResultaatGroep {
  wedstrijden: number
  win: number
  gelijk: number
  verlies: number
  punten: number
  puntenPerWedstrijd: number | null
  voor: number
  tegen: number
  saldo: number
}

export interface ThuisUitTotaal extends ResultaatGroep {
  cleanSheets: number // wedstrijden met 0 tegendoelpunten
  zonderEigenDoelpunt: number // wedstrijden met 0 eigen doelpunten
}

export interface ThuisUitSplitsing {
  thuis: ResultaatGroep
  uit: ResultaatGroep
  // null als er geen enkele wedstrijd zonder thuis/uit is (V1): dan geen rij
  // "Onbekend" tonen.
  onbekend: ResultaatGroep | null
  totaal: ThuisUitTotaal
}

export interface FormatieResultaat extends ResultaatGroep {
  formatie: string
}

export type SpelerBetrokkenheid = SpelerMomentenRij & { betrokken: number }

export interface Topscorers {
  spelers: SpelerBetrokkenheid[]
  doelpunten: number
  assists: number
  // Benadering assists ÷ doelpunten (er is geen goal↔assist-koppeling, V5),
  // afgerond en begrensd op 100. null bij 0 doelpunten — nooit NaN.
  assistPercentage: number | null
}

export interface KwartierTelling {
  perBak: Record<KwartierBak, number>
  metMinuut: number // doelpunten met een geldige minuut (= som van perBak)
  totaal: number // alle vastgelegde doelpunten, ook zonder minuut
}

export interface TegendoelpuntTelling {
  perBak: Record<KwartierBak, Record<TegendoelpuntSoort, number>>
  perSoort: Record<TegendoelpuntSoort, number>
  metMinuut: number
  totaal: number
}

// Een tel-waarde uit een RPC-rij: alleen een eindig geheel getal ≥ 0 telt,
// al het andere wordt als 0 behandeld.
function telwaarde(waarde: unknown): number {
  return typeof waarde === 'number' && Number.isInteger(waarde) && waarde >= 0 ? waarde : 0
}

function isDoelpuntGetal(waarde: unknown): waarde is number {
  return typeof waarde === 'number' && Number.isFinite(waarde)
}

function legeGroep(): ResultaatGroep {
  return { wedstrijden: 0, win: 0, gelijk: 0, verlies: 0, punten: 0, puntenPerWedstrijd: null, voor: 0, tegen: 0, saldo: 0 }
}

// Telt één wedstrijd bij een groep op. Geeft false als de wedstrijd geen
// bruikbare uitslag heeft (dan is er niets geteld).
function telWedstrijd(groep: ResultaatGroep, rij: Pick<WedstrijdUitslagRij, 'goals_for' | 'goals_against'>): boolean {
  if (!isDoelpuntGetal(rij.goals_for) || !isDoelpuntGetal(rij.goals_against)) return false
  const uitkomst = matchResult({ goals_for: rij.goals_for, goals_against: rij.goals_against }) as MatchResult
  if (uitkomst === 'unknown') return false
  groep.wedstrijden++
  if (uitkomst === 'win') groep.win++
  else if (uitkomst === 'draw') groep.gelijk++
  else groep.verlies++
  groep.punten += PUNTEN_PER_UITSLAG[uitkomst]
  groep.voor += rij.goals_for
  groep.tegen += rij.goals_against
  groep.saldo = groep.voor - groep.tegen
  groep.puntenPerWedstrijd = groep.punten / groep.wedstrijden
  return true
}

// Thuis / uit / onbekend / totaal over de wedstrijden met uitslag. Een
// wedstrijd zonder home_away telt als "onbekend" (V1) en wél in het totaal;
// hij wordt nooit stil als thuis geteld. Het totale saldo is daardoor gelijk
// aan doelsaldo() over dezelfde wedstrijden (de KPI "Doelsaldo").
export function splitsThuisUit(rows: WedstrijdUitslagRij[]): ThuisUitSplitsing {
  const thuis = legeGroep()
  const uit = legeGroep()
  const onbekend = legeGroep()
  const totaal: ThuisUitTotaal = { ...legeGroep(), cleanSheets: 0, zonderEigenDoelpunt: 0 }
  for (const rij of rows) {
    if (!rij || !telWedstrijd(totaal, rij)) continue
    if (rij.goals_against === 0) totaal.cleanSheets++
    if (rij.goals_for === 0) totaal.zonderEigenDoelpunt++
    if (rij.home_away === 'home') telWedstrijd(thuis, rij)
    else if (rij.home_away === 'away') telWedstrijd(uit, rij)
    else telWedstrijd(onbekend, rij)
  }
  return { thuis, uit, onbekend: onbekend.wedstrijden > 0 ? onbekend : null, totaal }
}

// Resultaten per formatie, alleen voor wedstrijden met uitslag én opstelling.
// Een lege of ontbrekende formatie wordt overgeslagen; de ruwe waarde is de
// groepssleutel, zodat een onbekende vrije-tekstformatie letterlijk blijft
// staan (AC-4.3). Volgorde: meeste wedstrijden eerst, dan formatie oplopend
// met </> (deterministisch, onafhankelijk van de locale).
export function resultatenPerFormatie(rows: WedstrijdUitslagRij[]): FormatieResultaat[] {
  const groepen = new Map<string, FormatieResultaat>()
  for (const rij of rows) {
    if (!rij || typeof rij.formatie !== 'string' || rij.formatie.trim() === '') continue
    const groep = groepen.get(rij.formatie) ?? { ...legeGroep(), formatie: rij.formatie }
    if (telWedstrijd(groep, rij)) groepen.set(rij.formatie, groep)
  }
  return [...groepen.values()].sort((a, b) => {
    if (a.wedstrijden !== b.wedstrijden) return b.wedstrijden - a.wedstrijden
    return a.formatie < b.formatie ? -1 : a.formatie > b.formatie ? 1 : 0
  })
}

// Vaste tweede sleutel bij gelijke stand: naam, dan player_id (zelfde regel
// als snijTopWorst), zodat een refresh de namen niet laat wisselen.
function opNaamDanId(a: { naam: string; player_id: string }, b: { naam: string; player_id: string }): number {
  if (a.naam !== b.naam) return a.naam < b.naam ? -1 : 1
  return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0
}

function schoneMomenten(rij: SpelerMomentenRij): SpelerMomentenRij {
  return {
    player_id: rij.player_id,
    naam: rij.naam,
    gast: rij.gast === true,
    doelpunten: telwaarde(rij.doelpunten),
    assists: telwaarde(rij.assists),
    geel: telwaarde(rij.geel),
    rood: telwaarde(rij.rood),
  }
}

// Topscorers en betrokkenheid (doelpunten + assists). Een speler met alleen
// assists doet mee; gasten doen mee met `gast: true` (V2). Volgorde:
// doelpunten aflopend, betrokken aflopend, naam, player_id.
export function bepaalTopscorers(rows: SpelerMomentenRij[]): Topscorers {
  const spelers: SpelerBetrokkenheid[] = []
  let doelpunten = 0
  let assists = 0
  for (const ruw of rows) {
    if (!ruw) continue
    const rij = schoneMomenten(ruw)
    doelpunten += rij.doelpunten
    assists += rij.assists
    const betrokken = rij.doelpunten + rij.assists
    if (betrokken > 0) spelers.push({ ...rij, betrokken })
  }
  spelers.sort((a, b) => {
    if (a.doelpunten !== b.doelpunten) return b.doelpunten - a.doelpunten
    if (a.betrokken !== b.betrokken) return b.betrokken - a.betrokken
    return opNaamDanId(a, b)
  })
  const assistPercentage = doelpunten === 0 ? null : Math.min(100, Math.round((assists / doelpunten) * 100))
  return { spelers, doelpunten, assists, assistPercentage }
}

// Spelers met minstens één kaart. Volgorde: totaal aantal kaarten aflopend,
// dan rood aflopend, naam, player_id (AC-5.3).
export function kaartenPerSpeler(rows: SpelerMomentenRij[]): SpelerMomentenRij[] {
  const metKaart: SpelerMomentenRij[] = []
  for (const ruw of rows) {
    if (!ruw) continue
    const rij = schoneMomenten(ruw)
    if (rij.geel + rij.rood > 0) metKaart.push(rij)
  }
  return metKaart.sort((a, b) => {
    const totaal = (b.geel + b.rood) - (a.geel + a.rood)
    if (totaal !== 0) return totaal
    if (a.rood !== b.rood) return b.rood - a.rood
    return opNaamDanId(a, b)
  })
}

function legeBakken<T>(maak: () => T): Record<KwartierBak, T> {
  const bakken = {} as Record<KwartierBak, T>
  for (const bak of KWARTIER_BAKKEN) bakken[bak] = maak()
  return bakken
}

function legeSoorten(): Record<TegendoelpuntSoort, number> {
  const soorten = {} as Record<TegendoelpuntSoort, number>
  for (const soort of TEGENDOELPUNT_SOORTEN) soorten[soort] = 0
  return soorten
}

// Eigen doelpunten per kwartier. Alle zeven bakken staan er altijd in (ook
// bij 0). Een doelpunt zonder (geldige) minuut telt in `totaal` maar niet in
// een bak — de UI toont dat als "x van y met minuut".
export function telPerKwartier(rows: DoelpuntMinuutRij[]): KwartierTelling {
  const perBak = legeBakken(() => 0)
  let metMinuut = 0
  let totaal = 0
  for (const rij of rows) {
    if (!rij) continue
    const aantal = telwaarde(rij.aantal)
    totaal += aantal
    const bak = kwartierBak(rij.minuut)
    if (bak === null) continue
    perBak[bak] += aantal
    metMinuut += aantal
  }
  return { perBak, metMinuut, totaal }
}

// Tegendoelpunten per kwartier en soort. Een onbekende soort telt nergens mee
// (ook niet in het totaal); zonder minuut telt wel in totaal en perSoort.
export function telTegendoelpunten(rows: TegendoelpuntMinuutRij[]): TegendoelpuntTelling {
  const perBak = legeBakken(legeSoorten)
  const perSoort = legeSoorten()
  let metMinuut = 0
  let totaal = 0
  for (const rij of rows) {
    if (!rij || !(TEGENDOELPUNT_SOORTEN as string[]).includes(rij.soort)) continue
    const aantal = telwaarde(rij.aantal)
    totaal += aantal
    perSoort[rij.soort] += aantal
    const bak = kwartierBak(rij.minuut)
    if (bak === null) continue
    perBak[bak][rij.soort] += aantal
    metMinuut += aantal
  }
  return { perBak, perSoort, metMinuut, totaal }
}

// ── Inzichten-metrics fase 2a: spelers (supabase/inzichten-metrics-fase2.sql) ──
// Vier RPC's tellen per speler of per maand in SQL (elk hooguit één rij per
// speler/maand, geen `limit`); hier gebeuren alleen rangorde, drempels,
// noemer-null en de maandreeks. Positiedekking komt uit een gewone
// players-select. Alles puur: de invoer wordt nooit gemuteerd, telwaarden gaan
// door telwaarde(), gelijke stand via opNaamDanId.

// inzichten_speelkansen — één rij per speler met minstens één voorkomen
// (selectie, opstelling of aanwezigheid <> 'unknown') t/m p_end, ook als
// `noemer` 0 is. Gasten en inactieven doen mee (W3); `gast` markeert de gast.
// `noemer` = wedstrijden MET selectie in het venster vanaf het eerste voorkomen;
// voor een INACTIEVE speler stopt die bij zijn laatste voorkomen (O2) — dat
// gebeurt al in SQL, hier staat dus gewoon de juiste noemer.
// `basis` = in het opgeslagen plan, alleen in noemer-wedstrijden.
export interface SpeelkansenRij {
  player_id: string
  naam: string
  gast: boolean
  noemer: number
  selectie: number
  basis: number
}

// inzichten_rating_vorm_per_speler — alleen actieve vaste spelers met ≥1
// rating in het venster (de pagina geeft het hele seizoen mee, W5).
// `recent_gemiddelde` = gemiddelde over de laatste p_recent beoordeelde
// wedstrijden (RATING_TREND_VENSTER).
export interface RatingVormRij {
  player_id: string
  naam: string
  aantal: number
  seizoen_gemiddelde: number
  recent_gemiddelde: number
}

// inzichten_training_opkomst_per_speler — alleen trainingen (W7), inclusief
// gasten en inactieven (W3). `afwezig` = absent + injured; unknown telt niet.
export interface TrainingOpkomstPerSpelerRij {
  player_id: string
  naam: string
  gast: boolean
  aanwezig: number
  afwezig: number
}

// inzichten_blessures_per_maand — één rij per maand MET minstens één training
// of wedstrijd; `geblesseerd` = verschillende vaste spelers (ook nu-inactieve,
// geen gasten, O4) met minstens één 'injured'-registratie. 0 = wel events,
// geen blessure.
export interface BlessuresPerMaandRij {
  maand: string // 'YYYY-MM'
  geblesseerd: number
}

// Gewone players-select (actief, vast, eigen team) voor positiedekking.
export interface SpelerPositieRij {
  id: string
  name: string
  position: string
  secondary_positions: string[] | null
  injured: boolean | null
}

// Minimum aantal beoordelingen in het seizoen voordat een speler als stijger
// of daler kan verschijnen (W5). Daaronder zegt een verschil van 0,3 niets.
export const STIJGER_MIN_BEOORDELINGEN = 8

// teller ÷ noemer begrensd op 1, ongerond — alleen voor de meterbreedte; de
// tekst blijft "x van y". null bij een noemer ≤ 0 of een niet-eindige waarde:
// nooit NaN en nooit een verzonnen 0% (AC-A8).
export function aandeel(teller: number, noemer: number): number | null {
  if (!Number.isFinite(teller) || !Number.isFinite(noemer)) return null
  if (noemer <= 0) return null
  return Math.min(1, teller / noemer)
}

export type SpeelkansRegel = SpeelkansenRij & {
  selectieAandeel: number | null
  basisAandeel: number | null
}

// null-aandelen achteraan; anders aflopend.
function aflopendMetNull(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

// Speelkansen per speler met aandelen. Volgorde (O5): spelers met een noemer
// eerst, dan selectie-aandeel aflopend, basis-aandeel aflopend, naam, id. Geen
// rangnummers of oordelen — dat is aan de UI (W4).
export function verdeelSpeelkansen(rows: SpeelkansenRij[]): SpeelkansRegel[] {
  const regels: SpeelkansRegel[] = []
  for (const rij of rows) {
    if (!rij) continue
    const noemer = telwaarde(rij.noemer)
    const selectie = telwaarde(rij.selectie)
    const basis = telwaarde(rij.basis)
    regels.push({
      player_id: rij.player_id,
      naam: rij.naam,
      gast: rij.gast === true,
      noemer,
      selectie,
      basis,
      selectieAandeel: aandeel(selectie, noemer),
      basisAandeel: aandeel(basis, noemer),
    })
  }
  return regels.sort((a, b) => {
    const metNoemer = Number(b.noemer > 0) - Number(a.noemer > 0)
    if (metNoemer !== 0) return metNoemer
    const sel = aflopendMetNull(a.selectieAandeel, b.selectieAandeel)
    if (sel !== 0) return sel
    const bas = aflopendMetNull(a.basisAandeel, b.basisAandeel)
    if (bas !== 0) return bas
    return opNaamDanId(a, b)
  })
}

export type StijgerRegel = RatingVormRij & { verschil: number }

export interface StijgersDalers {
  stijgers: StijgerRegel[]
  dalers: StijgerRegel[]
  // Spelers met ≥ minimum beoordelingen (en eindige gemiddelden): 0 → lege
  // staat "te weinig", > 0 met twee lege lijsten → "niemand wijkt af".
  meegeteld: number
}

// Stijgers en dalers: recent gemiddelde tegenover het seizoensgemiddelde (W5).
// verschil wordt op 2 decimalen afgerond, zodat float-ruis (7,3 − 7,0 =
// 0,2999…) niet over de grens van 0,3 valt. Zelfde `>=` als de signalen.
export function bepaalStijgersDalers(
  rows: RatingVormRij[],
  drempel: number = RATING_TREND_DREMPEL,
  minimum: number = STIJGER_MIN_BEOORDELINGEN,
): StijgersDalers {
  const stijgers: StijgerRegel[] = []
  const dalers: StijgerRegel[] = []
  let meegeteld = 0
  for (const rij of rows) {
    if (!rij) continue
    const aantal = telwaarde(rij.aantal)
    if (aantal < minimum) continue
    if (!Number.isFinite(rij.seizoen_gemiddelde) || !Number.isFinite(rij.recent_gemiddelde)) continue
    meegeteld++
    const verschil = Math.round((rij.recent_gemiddelde - rij.seizoen_gemiddelde) * 100) / 100
    const regel: StijgerRegel = {
      player_id: rij.player_id,
      naam: rij.naam,
      aantal,
      seizoen_gemiddelde: rij.seizoen_gemiddelde,
      recent_gemiddelde: rij.recent_gemiddelde,
      verschil,
    }
    if (verschil >= drempel) stijgers.push(regel)
    else if (verschil <= -drempel) dalers.push(regel)
  }
  stijgers.sort((a, b) => (a.verschil !== b.verschil ? b.verschil - a.verschil : opNaamDanId(a, b)))
  dalers.sort((a, b) => (a.verschil !== b.verschil ? a.verschil - b.verschil : opNaamDanId(a, b)))
  return { stijgers, dalers, meegeteld }
}

export interface PositieDekkingSpeler {
  player_id: string
  naam: string
  secundair: boolean
}

export interface PositieDekking {
  positie: Position
  spelers: PositieDekkingSpeler[]
}

function isPositie(waarde: unknown): waarde is Position {
  return typeof waarde === 'string' && (POSITIONS as string[]).includes(waarde)
}

// Fitte spelers per positie (W6), altijd alle posities in de volgorde van
// POSITIONS. Geblesseerd (injured === true) valt af. Primair telt op
// `position`, secundair op `secondary_positions`; dezelfde positie primair én
// secundair telt één keer als primair. Bewust GEEN POSITION_FALLBACKS. Een
// onbekende positiewaarde wordt genegeerd. Binnen een positie: primair vóór
// secundair, elk op naam en id. De invoer is al gefilterd op actief + vast.
export function dekkingPerPositie(spelers: SpelerPositieRij[]): PositieDekking[] {
  const perPositie = new Map<Position, PositieDekkingSpeler[]>()
  for (const positie of POSITIONS) perPositie.set(positie, [])
  for (const speler of spelers) {
    if (!speler || speler.injured === true) continue
    const gezien = new Set<Position>()
    const voegToe = (positie: unknown, secundair: boolean) => {
      if (!isPositie(positie) || gezien.has(positie)) return
      gezien.add(positie)
      perPositie.get(positie)!.push({ player_id: speler.id, naam: speler.name, secundair })
    }
    voegToe(speler.position, false)
    for (const positie of Array.isArray(speler.secondary_positions) ? speler.secondary_positions : []) {
      voegToe(positie, true)
    }
  }
  return POSITIONS.map((positie) => ({
    positie,
    spelers: perPositie.get(positie)!.sort((a, b) =>
      a.secundair !== b.secundair ? Number(a.secundair) - Number(b.secundair) : opNaamDanId(a, b),
    ),
  }))
}

// Opkomst van een vaste speler: x van y trainingen + percentage.
export interface OpkomstMetNoemer {
  aanwezig: number
  totaal: number
  percentage: number
}

// Opkomst van een GAST (O3): alleen "x keer aanwezig". Gasten staan standaard
// op afwezig voor elke training, dus een noemer of percentage zou een
// structureel lage opkomst suggereren. totaal en percentage zijn daarom
// altijd null.
export interface OpkomstGast {
  aanwezig: number
  totaal: null
  percentage: null
}

export interface NaastElkaarRegel {
  player_id: string
  naam: string
  gast: boolean
  // null = geen gegevens. Een gast krijgt altijd de OpkomstGast-vorm
  // (percentage === null), nooit een noemer.
  opkomst: OpkomstMetNoemer | OpkomstGast | null
  // null bij noemer 0.
  selectie: { selectie: number; noemer: number } | null
  // null zonder rating (gasten en inactieven hebben er nooit één: de RPC kijkt
  // alleen naar actieve vaste spelers, AC-4.4).
  rating: { gemiddelde: number; aantal: number } | null
}

// Opkomst, selectie en rating per speler naast elkaar (W4): geen rangorde en
// geen verband — volgorde naam, dan id. Alleen spelers met minstens één
// niet-null kolom.
//
// Opkomst: vaste speler → percentage via berekenAanwezigheidPercentage
// (null-percentage → opkomst null). Gast → alleen het aantal keer aanwezig
// (O3), en alleen als dat > 0 is: omdat afwezig de standaard is voor een gast,
// zegt "0 keer aanwezig" niets en zou het elke gast een regel geven.
export function naastElkaarPerSpeler({
  opkomst,
  speelkansen,
  ratings,
}: {
  opkomst: TrainingOpkomstPerSpelerRij[]
  speelkansen: SpeelkansenRij[]
  ratings: RatingPerSpelerRij[]
}): NaastElkaarRegel[] {
  const regels = new Map<string, NaastElkaarRegel>()
  const opkomstTelling = new Map<string, { aanwezig: number; afwezig: number }>()
  const regel = (player_id: string, naam: string): NaastElkaarRegel => {
    let r = regels.get(player_id)
    if (!r) {
      r = { player_id, naam, gast: false, opkomst: null, selectie: null, rating: null }
      regels.set(player_id, r)
    }
    return r
  }

  for (const rij of opkomst) {
    if (!rij) continue
    const r = regel(rij.player_id, rij.naam)
    if (rij.gast === true) r.gast = true
    opkomstTelling.set(rij.player_id, { aanwezig: telwaarde(rij.aanwezig), afwezig: telwaarde(rij.afwezig) })
  }
  for (const rij of speelkansen) {
    if (!rij) continue
    const r = regel(rij.player_id, rij.naam)
    if (rij.gast === true) r.gast = true
    const noemer = telwaarde(rij.noemer)
    r.selectie = noemer > 0 ? { selectie: Math.min(telwaarde(rij.selectie), noemer), noemer } : null
  }
  for (const rij of ratings) {
    if (!rij) continue
    const aantal = telwaarde(rij.aantal)
    if (aantal <= 0 || !Number.isFinite(rij.gemiddelde)) continue
    regel(rij.player_id, rij.naam).rating = { gemiddelde: rij.gemiddelde, aantal }
  }

  // Opkomst pas hier, als de gastvlag uit álle bronnen bekend is: een speler
  // die in één bron als gast staat, krijgt nooit een opkomst met noemer (O3).
  for (const [player_id, { aanwezig, afwezig }] of opkomstTelling) {
    const r = regels.get(player_id)!
    if (r.gast) {
      r.opkomst = aanwezig > 0 ? { aanwezig, totaal: null, percentage: null } : null
    } else {
      const percentage = berekenAanwezigheidPercentage(aanwezig, afwezig)
      r.opkomst = percentage === null ? null : { aanwezig, totaal: aanwezig + afwezig, percentage }
    }
  }

  return [...regels.values()]
    .filter((r) => r.opkomst !== null || r.selectie !== null || r.rating !== null)
    .sort(opNaamDanId)
}

const MAAND_RE = /^(\d{4})-(\d{2})/

// 'YYYY-MM' van de maand van `start` t/m die van `end`. De reeks zelf wordt
// puur op strings/getallen opgebouwd (geen Date, dus geen tijdzone); alleen de
// validatie hergebruikt isDateString (lib/season-dates.ts), die in UTC rekent.
// Ongeldige invoer of end < start → [].
export function maandenInVenster(start: string, end: string): string[] {
  if (!isDateString(start) || !isDateString(end) || end < start) return []
  const [, sj, sm] = start.match(MAAND_RE)!
  const [, ej, em] = end.match(MAAND_RE)!
  let jaar = Number(sj)
  let maand = Number(sm)
  const eindJaar = Number(ej)
  const eindMaand = Number(em)
  const maanden: string[] = []
  while (jaar < eindJaar || (jaar === eindJaar && maand <= eindMaand)) {
    maanden.push(`${String(jaar).padStart(4, '0')}-${String(maand).padStart(2, '0')}`)
    maand++
    if (maand > 12) {
      maand = 1
      jaar++
    }
  }
  return maanden
}

// Elke maand van het venster, met het aantal verschillende geblesseerde
// spelers. Een maand zonder rij (geen enkele training of wedstrijd) krijgt
// null = "geen gegevens" (AC-5.4); een maand met rij krijgt het aantal, ook 0.
export function blessuresPerMaand(
  rows: BlessuresPerMaandRij[],
  venster: Seizoensvenster,
): { maand: string; geblesseerd: number | null }[] {
  const perMaand = new Map<string, number>()
  for (const rij of rows) {
    if (!rij || typeof rij.maand !== 'string' || perMaand.has(rij.maand)) continue
    perMaand.set(rij.maand, telwaarde(rij.geblesseerd))
  }
  return maandenInVenster(venster.start, venster.end).map((maand) => ({
    maand,
    geblesseerd: perMaand.has(maand) ? perMaand.get(maand)! : null,
  }))
}

// ── Inzichten-metrics fase 2b: speelminuten (supabase/inzichten-metrics-fase2b.sql) ──
// inzichten_speelminuten_per_speler telt in SQL per speler (hooguit één rij
// per speler, geen `limit`); hier gebeuren alleen gemiddelde, meterbreedte en
// volgorde. Puur: de invoer wordt nooit gemuteerd, telwaarden gaan door
// telwaarde(), gelijke stand via opNaamDanId.

// Eén rij per speler MET een speelminuten-rij in het venster (ook gast of
// inactief, M4) plus elke actieve vaste speler zonder rij (`wedstrijden` 0,
// `minuten`/`wissels` null). `noemer` = wedstrijden in het venster met ≥1 rij
// (M3), op elke rij gelijk. Geen rijen als er geen enkele zo'n wedstrijd is.
export interface SpeelminutenRij {
  player_id: string
  naam: string
  gast: boolean
  wedstrijden: number
  minuten: number | null
  wissels: number | null
  noemer: number
}

export type SpeelminutenRegel = SpeelminutenRij & {
  gemiddelde: number | null
  minutenAandeel: number | null
}

export interface SpeelminutenVerdeling {
  regels: SpeelminutenRegel[]
  noemer: number
}

// Speelminuten per speler. `noemer` = de grootste noemer uit de rijen; is die
// 0, dan zijn er geen regels (lege staat AC-K.9). Een speler zonder rij
// (`wedstrijden` 0) krijgt overal null — "geen gegevens", nooit een verzonnen
// 0 (AC-K.4); een ingevoerde 0 blijft 0. `gemiddelde` = hele minuten per
// wedstrijd met minuten (AC-A10). `minutenAandeel` = minuten t.o.v. het
// hoogste totaal, alleen voor de meterbreedte; null als iedereen 0 heeft.
// Volgorde (AC-A9, O4): spelers met minuten-wedstrijden eerst, dan minuten
// aflopend, wedstrijden aflopend, naam, id. Geen rangnummers (W4).
export function verdeelSpeelminuten(rows: SpeelminutenRij[]): SpeelminutenVerdeling {
  let noemer = 0
  for (const rij of rows) {
    if (rij) noemer = Math.max(noemer, telwaarde(rij.noemer))
  }
  if (noemer === 0) return { regels: [], noemer: 0 }

  const schoon: SpeelminutenRij[] = []
  for (const rij of rows) {
    if (!rij) continue
    const wedstrijden = telwaarde(rij.wedstrijden)
    schoon.push({
      player_id: rij.player_id,
      naam: rij.naam,
      gast: rij.gast === true,
      wedstrijden,
      minuten: wedstrijden > 0 ? telwaarde(rij.minuten) : null,
      wissels: wedstrijden > 0 ? telwaarde(rij.wissels) : null,
      noemer,
    })
  }

  const maxMinuten = schoon.reduce((max, r) => Math.max(max, r.minuten ?? 0), 0)
  const regels: SpeelminutenRegel[] = schoon.map((r) => ({
    ...r,
    gemiddelde: r.minuten !== null && r.wedstrijden > 0 ? Math.round(r.minuten / r.wedstrijden) : null,
    minutenAandeel: r.minuten !== null ? aandeel(r.minuten, maxMinuten) : null,
  }))

  regels.sort((a, b) => {
    const metMinuten = Number(b.wedstrijden > 0) - Number(a.wedstrijden > 0)
    if (metMinuten !== 0) return metMinuten
    const min = (b.minuten ?? 0) - (a.minuten ?? 0)
    if (min !== 0) return min
    const wed = b.wedstrijden - a.wedstrijden
    if (wed !== 0) return wed
    return opNaamDanId(a, b)
  })
  return { regels, noemer }
}

// ── Inzichten-metrics fase 3a: training en kwaliteit (supabase/inzichten-metrics-fase3a.sql) ──
// De twee RPC's filteren en joinen alleen per team en leveren RUWE rijen (één
// per koppeling of per event). Alle regels draaien hier, met de bestaande
// functies in plaats van een nabouw:
// - duur: effectieveDuurMin, parallel = langste (blokDuur via berekenTijdlijn),
//   groep met < 2 leden = los blok (blokkenVanKoppelingen);
// - stap: actueleMetingen + berekenStap + computeCurrentSteps;
// - discipline: analyseBestaat, matchResult en hasTrainingPlanDone.
// Puur: de invoer wordt nooit gemuteerd, nooit NaN.

// Bovengrens op het aantal rijen per fase-3a-RPC. De SQL vraagt `limit 901`
// (= MAX_FASE3_RIJEN + 1) en geeft per rij `totaal` = count(*) over () vóór de
// limit mee; de structuurtest bindt die twee getallen aan elkaar.
export const MAX_FASE3_RIJEN = 900 // SQL: limit 901

// inzichten_training_koppelingen — één rij per koppeling; een training zonder
// koppeling geeft één rij met koppeling_id null. oefening_leesbaar = false als
// de (left) join op oefeningen niets opleverde (geen leesrecht): dan zijn
// oefening_duur_min en categorie null.
export interface TrainingKoppelingRij {
  event_id: string
  datum: string
  trainingstype: string
  koppeling_id: string | null
  volgorde: number | null
  aangemaakt: string | null
  parallel_groep_id: string | null
  koppeling_duur_min: number | null
  oefening_duur_min: number | null
  categorie: string | null
  stap_override: number | null
  oefening_leesbaar: boolean
  totaal: number
}

// inzichten_invul_discipline — één rij per gespeelde wedstrijd of training met
// ruwe tellingen. `handmatig` = er staat een task_override van het
// bijbehorende type ('analysis' bij een wedstrijd, 'training_plan' bij een
// training). `doelstelling` alleen bij trainingen.
export interface InvulDisciplineRij {
  event_id: string
  soort: string
  datum: string
  goals_for: number | null
  goals_against: number | null
  doelstelling: string | null
  aantal_ratings: number
  aantal_momenten: number
  aantal_oefeningen: number
  handmatig: boolean
  totaal: number
}

// Is de RPC-uitkomst afgekapt? Meer dan MAX_FASE3_RIJEN rijen (de SQL-limit
// van 901 is geraakt), óf `totaal` is groter dan wat er binnenkwam (een lagere
// PostgREST max-rows heeft afgekapt). In beide gevallen toont de kaart een
// melding in plaats van gedeeltelijke cijfers (AC-A12).
export function isAfgekapt(rijen: { totaal: number }[]): boolean {
  if (!Array.isArray(rijen)) return false
  return rijen.length > MAX_FASE3_RIJEN || rijen.some((r) => telwaarde(r?.totaal) > rijen.length)
}

const DAG_MS = 86_400_000
const CATEGORIE_SLEUTELS = new Set<string>(PERIODIZATION_CATEGORIES.map((c) => c.key))
const MEETBAAR = new Set<string>(MEETBARE_CATEGORIES)

function isCategorie(waarde: unknown): waarde is OefeningCategorie {
  return typeof waarde === 'string' && CATEGORIE_SLEUTELS.has(waarde)
}

function legeCategorieTelling(): Record<OefeningCategorie, number> {
  const telling = {} as Record<OefeningCategorie, number>
  for (const c of PERIODIZATION_CATEGORIES) telling[c.key] = 0
  return telling
}

function eindigOfNull(waarde: unknown): number | null {
  return typeof waarde === 'number' && Number.isFinite(waarde) ? waarde : null
}

// Bruikbare koppelingsrij: een event-id en een echte kalenderdatum.
function isBruikbareRij(rij: TrainingKoppelingRij | null | undefined): rij is TrainingKoppelingRij {
  return !!rij && typeof rij.event_id === 'string' && isDateString(rij.datum)
}

function isGeldigVenster(venster: Seizoensvenster | null | undefined): venster is Seizoensvenster {
  return !!venster && isGeldigSeizoensvenster(venster.start, venster.end)
}

// Deterministische volgorde van koppelingen binnen één training: dezelfde als
// sorteerKoppelingen in lib/parallel-groep.ts (volgorde → aangemaakt → id).
function opKoppelingsvolgorde(a: TrainingKoppelingRij, b: TrainingKoppelingRij): number {
  return (
    (eindigOfNull(a.volgorde) ?? 0) - (eindigOfNull(b.volgorde) ?? 0) ||
    String(a.aangemaakt ?? '').localeCompare(String(b.aangemaakt ?? '')) ||
    (String(a.koppeling_id) < String(b.koppeling_id) ? -1 : String(a.koppeling_id) > String(b.koppeling_id) ? 1 : 0)
  )
}

// ── Belasting in minuten per categorie per week ───────────────────────

export interface BelastingWeek {
  // Maandag van de ISO-week ('YYYY-MM-DD'); weken lopen maandag–zondag.
  maandag: string
  isoJaar: number
  isoWeek: number
  // De week begint vóór resp. eindigt ná het venster: een deelweek.
  deelweekBegin: boolean
  deelweekEind: boolean
  trainingen: number
  trainingenZonderOefeningen: number
  // Minuten per categorie; elke oefening telt met haar EIGEN duur, ook binnen
  // een parallelle groep (Q2). null = geen enkele training in deze week ("geen
  // gegevens"); een week met trainingen geeft per categorie 0 of meer (B.6).
  perCategorie: Record<OefeningCategorie, number> | null
  // Som van berekenTijdlijn(...).totaalMin per training: het planner-totaal
  // (parallel = langste, genest additief). null = geen trainingen.
  trainingstotaalMin: number | null
  // Blokken zonder duur (ontbreken dus in trainingstotaalMin).
  blokkenZonderDuur: number
  // Koppelingen met een bekende categorie maar zonder duur (B.4).
  oefeningenZonderDuur: number
  // Koppelingen zonder leesbare categorie: hun minuten tellen wél in het
  // trainingstotaal (net als de planner), niet in een categorie.
  oefeningenOnbekend: number
  // trainingstotaalMin t.o.v. het hoogste weektotaal, alleen voor de
  // staafhoogte. null bij geen trainingen of als elk totaal 0 is.
  totaalAandeel: number | null
}

export interface BelastingOverzicht {
  weken: BelastingWeek[]
  afgekapt: boolean
  // Er is minstens één training in het venster (ook zonder oefeningen).
  heeftTrainingen: boolean
  // Er is minstens één koppeling met een duur (AC-A5: alleen ingeplande
  // trainingen zonder invoer gelden niet als data).
  heeftMinuten: boolean
  totaalPerCategorie: Record<OefeningCategorie, number>
}

// Lid in de vorm die blokkenVanKoppelingen én effectieveDuurMin verwachten.
// volgorde null → 0 en aangemaakt null → '' is precies wat sorteerKoppelingen
// zelf al doet (`?? 0` resp. `String(x ?? '')`). Een niet-leesbare oefening
// krijgt `oefeningen: null`: dan telt alleen de eigen duur van de koppeling.
function belastingLid(rij: TrainingKoppelingRij) {
  return {
    id: String(rij.koppeling_id),
    volgorde: eindigOfNull(rij.volgorde) ?? 0,
    created_at: typeof rij.aangemaakt === 'string' ? rij.aangemaakt : '',
    parallel_groep_id: typeof rij.parallel_groep_id === 'string' ? rij.parallel_groep_id : null,
    // Ruw doorgeven (alleen undefined → null): effectieveDuurMin beslist zelf,
    // zodat ook een onbruikbare waarde precies zo uitvalt als in de planner
    // (geen eigen duur ≠ ongeldige eigen duur: alleen NULL valt terug).
    duur_min: rij.koppeling_duur_min ?? null,
    oefeningen: rij.oefening_leesbaar === true ? { duur_min: rij.oefening_duur_min ?? null } : null,
  }
}

interface TrainingGroep {
  eventId: string
  datum: string
  koppelingen: TrainingKoppelingRij[]
}

// Groepeert bruikbare rijen per training (event_id), in invoervolgorde.
function groepeerPerTraining(rijen: TrainingKoppelingRij[], filter: (r: TrainingKoppelingRij) => boolean): TrainingGroep[] {
  const perEvent = new Map<string, TrainingGroep>()
  for (const rij of Array.isArray(rijen) ? rijen : []) {
    if (!isBruikbareRij(rij) || !filter(rij)) continue
    let groep = perEvent.get(rij.event_id)
    if (!groep) {
      groep = { eventId: rij.event_id, datum: rij.datum, koppelingen: [] }
      perEvent.set(rij.event_id, groep)
    }
    if (typeof rij.koppeling_id === 'string') groep.koppelingen.push(rij)
  }
  return [...perEvent.values()]
}

// Trainingsminuten per categorie per ISO-week over `venster` (Q2/Q5/Q6). Weken
// chronologisch (O1), elke week van het venster aanwezig, ook zonder training.
export function belastingPerWeek(rijen: TrainingKoppelingRij[], venster: Seizoensvenster): BelastingOverzicht {
  const afgekapt = isAfgekapt(rijen)
  const totaalPerCategorie = legeCategorieTelling()
  if (!isGeldigVenster(venster)) {
    return { weken: [], afgekapt, heeftTrainingen: false, heeftMinuten: false, totaalPerCategorie }
  }

  const trainingen = groepeerPerTraining(rijen, (r) => r.datum >= venster.start && r.datum <= venster.end)
  const heeftTrainingen = trainingen.length > 0
  const heeftMinuten = trainingen.some((t) => t.koppelingen.some((k) => effectieveDuurMin(belastingLid(k)) !== null))
  // Afgekapt: geen gedeeltelijke cijfers (de nieuwste week kan ontbreken).
  if (afgekapt) return { weken: [], afgekapt, heeftTrainingen, heeftMinuten, totaalPerCategorie }

  const weken: BelastingWeek[] = wekenInVenster(venster.start, venster.end).map((maandag) => {
    const iso = isoWeek(maandag)!
    const zondag = fromUtcMs(toUtcMs(maandag)! + 6 * DAG_MS)
    return {
      maandag,
      isoJaar: iso.jaar,
      isoWeek: iso.week,
      deelweekBegin: maandag < venster.start,
      deelweekEind: zondag > venster.end,
      trainingen: 0,
      trainingenZonderOefeningen: 0,
      perCategorie: null,
      trainingstotaalMin: null,
      blokkenZonderDuur: 0,
      oefeningenZonderDuur: 0,
      oefeningenOnbekend: 0,
      totaalAandeel: null,
    }
  })
  const perMaandag = new Map(weken.map((w) => [w.maandag, w]))

  for (const training of trainingen) {
    const week = perMaandag.get(maandagVanWeek(training.datum) ?? '')
    if (!week) continue
    week.trainingen++
    week.perCategorie ??= legeCategorieTelling()
    week.trainingstotaalMin ??= 0
    if (training.koppelingen.length === 0) {
      week.trainingenZonderOefeningen++
      continue
    }
    const leden = training.koppelingen.map(belastingLid)
    // Het planner-totaal: exact dezelfde aanroep als TrainingPlanEditor.
    const tijdlijn = berekenTijdlijn(blokkenVanKoppelingen(leden), null)
    week.trainingstotaalMin += tijdlijn.totaalMin
    week.blokkenZonderDuur += tijdlijn.blokkenZonderDuur

    training.koppelingen.forEach((rij, i) => {
      const categorie = rij.oefening_leesbaar === true ? rij.categorie : null
      if (!isCategorie(categorie)) {
        week.oefeningenOnbekend++
        return
      }
      const duur = effectieveDuurMin(leden[i])
      if (duur === null) {
        week.oefeningenZonderDuur++
        return
      }
      week.perCategorie![categorie] += duur
      totaalPerCategorie[categorie] += duur
    })
  }

  const maxWeektotaal = weken.reduce((max, w) => Math.max(max, w.trainingstotaalMin ?? 0), 0)
  for (const week of weken) {
    week.totaalAandeel = week.trainingstotaalMin === null ? null : aandeel(week.trainingstotaalMin, maxWeektotaal)
  }
  return { weken, afgekapt, heeftTrainingen, heeftMinuten, totaalPerCategorie }
}

// ── Periodisering: voortgang per meetbaar onderdeel ───────────────────

export interface StapPunt {
  datum: string
  stap: number
  bron: 'meting' | 'training'
  // Training met een handmatige stap_override.
  handmatig: boolean
  // Het event bij een trainingspunt, null bij een meetpunt.
  eventId: string | null
}

export interface OnderdeelVoortgang {
  key: OefeningCategorie
  maxStap: number
  gemeten: boolean
  // Eerste meting OOIT van dit onderdeel (Q3).
  nulmeting: { datum: string; stap: number } | null
  // Stand t/m gisteren (O3): computeCurrentSteps met de meting die vandaag
  // geldt (exclusief) en de VCT-trainingen t/m gisteren. Niet geclampt.
  huidig: { stap: number } | null
  // huidig − nulmeting, in stappen (geen %); kan negatief zijn.
  verschil: number | null
  // Precies één meting en nog geen enkel trainingspunt (P.4).
  geenVoortgang: boolean
  // Punten binnen `weergave`, op datum; op dezelfde datum eerst de training
  // (die gebruikte nog de vorige meting), dan de meting.
  punten: StapPunt[]
  // Aantal trainingspunten in `punten`.
  trainingen: number
}

export interface PeriodiseringVoortgang {
  onderdelen: OnderdeelVoortgang[]
  afgekapt: boolean
  // Koppelingen in VCT-trainingen zonder leesbare oefening: tellen niet mee
  // in de stap-telling, en dat wordt zichtbaar gemeld (nooit stil weg).
  onbekend: number
  // B1: de weergave is leeg omdat het seizoen nog niet begonnen is (gisteren
  // ligt vóór de seizoensstart). Gemeten onderdelen hebben dan wél nulmeting,
  // huidig en verschil, maar geen punten. periodiseringVoortgang vult dit veld
  // altijd; optioneel getypeerd zodat bestaande letterlijke fixtures geldig
  // blijven.
  seizoenNogNietBegonnen?: boolean
}

interface VctTraining {
  eventId: string
  datum: string
  // Per meetbaar onderdeel: de override van deze training (eerste niet-null in
  // koppelingsvolgorde), of null.
  perCategorie: Map<string, number | null>
}

function ongemetenOnderdeel(key: OefeningCategorie, maxStap: number): OnderdeelVoortgang {
  return {
    key,
    maxStap,
    gemeten: false,
    nulmeting: null,
    huidig: null,
    verschil: null,
    geenVoortgang: false,
    punten: [],
    trainingen: 0,
  }
}

// Reconstructie van de periodiseringsstap door de tijd (P.1–P.8, Q3).
// `rijen` = inzichten_training_koppelingen vanaf de vroegste meting t/m het
// einde van `weergave`; `metingen` = categorie_metingen van het team;
// `weergave` = verledenSeizoensVenster (hele seizoen t/m gisteren); `vandaag`
// = todayLocal(). Alleen VCT-trainingen (P.7). Per training T op datum d en
// onderdeel c: m = actueleMetingen(metingen, d)[c] (exclusief, zoals de
// planner), k = aantal eerdere VCT-trainingen met c, datum > m.datum en < d
// (dezelfde dag telt niet), stap = override ?? berekenStap(m.stap, k).
export function periodiseringVoortgang(
  rijen: TrainingKoppelingRij[],
  metingen: CategorieMeting[],
  weergave: Seizoensvenster,
  vandaag: string,
): PeriodiseringVoortgang {
  const meetbaar = PERIODIZATION_CATEGORIES.filter((c) => c.hasMeting)
  if (isAfgekapt(rijen)) return { onderdelen: [], afgekapt: true, onbekend: 0, seizoenNogNietBegonnen: false }
  // B1: twee echte datums met end < start = verledenSeizoensVenster van een
  // seizoen dat nog moet beginnen. Dan wel de stand per gemeten onderdeel,
  // maar geen enkel punt (er is nog geen seizoen om te tonen).
  const nogNietBegonnen =
    !!weergave && isDateString(weergave.start) && isDateString(weergave.end) && weergave.end < weergave.start
  if (!isDateString(vandaag) || (!nogNietBegonnen && !isGeldigVenster(weergave))) {
    return {
      onderdelen: meetbaar.map((c) => ongemetenOnderdeel(c.key, c.maxStap)),
      afgekapt: false,
      onbekend: 0,
      seizoenNogNietBegonnen: false,
    }
  }
  // Bij nogNietBegonnen is dit voor elke datum onwaar: punten blijven leeg.
  const inWeergave = (datum: string) => datum >= weergave.start && datum <= weergave.end
  // Nooit iets van vandaag of later, en niets na het einde van de weergave.
  const telt = (datum: string) => datum < vandaag && datum <= weergave.end

  const schoneMetingen = (Array.isArray(metingen) ? metingen : []).filter(
    (m): m is CategorieMeting =>
      !!m && MEETBAAR.has(m.categorie) && isDateString(m.datum) && telt(m.datum) && eindigOfNull(m.stap) !== null,
  )

  let onbekend = 0
  const trainingen: VctTraining[] = []
  for (const groep of groepeerPerTraining(rijen, (r) => r.trainingstype === 'vct' && telt(r.datum))) {
    const perCategorie = new Map<string, number | null>()
    for (const rij of [...groep.koppelingen].sort(opKoppelingsvolgorde)) {
      if (rij.oefening_leesbaar !== true) {
        onbekend++
        continue
      }
      if (typeof rij.categorie !== 'string' || !MEETBAAR.has(rij.categorie)) continue
      const override = eindigOfNull(rij.stap_override)
      if (!perCategorie.has(rij.categorie) || (perCategorie.get(rij.categorie) === null && override !== null)) {
        perCategorie.set(rij.categorie, override)
      }
    }
    trainingen.push({ eventId: groep.eventId, datum: groep.datum, perCategorie })
  }
  trainingen.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))

  // Huidige stand t/m gisteren (O3): de meting die vandaag (exclusief) geldt,
  // plus de VCT-trainingen strikt ná die meting en vóór vandaag.
  const actueelNu = actueleMetingen(schoneMetingen, vandaag)
  const occurrencesNu: Record<string, number> = {}
  for (const c of meetbaar) {
    const m = actueelNu[c.key]
    if (!m) continue
    occurrencesNu[c.key] = trainingen.filter((t) => t.perCategorie.has(c.key) && t.datum > m.datum).length
  }
  const huidigeStappen = computeCurrentSteps(actueelNu, occurrencesNu)

  const onderdelen = meetbaar.map((c): OnderdeelVoortgang => {
    const eigenMetingen = schoneMetingen
      .filter((m) => m.categorie === c.key)
      .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (eigenMetingen.length === 0) return ongemetenOnderdeel(c.key, c.maxStap)

    const metC = trainingen.filter((t) => t.perCategorie.has(c.key))
    const trainingPunten: StapPunt[] = []
    let trainingPuntenTotaal = 0
    for (const t of metC) {
      const m = actueleMetingen(eigenMetingen, t.datum)[c.key]
      // Vóór de eerste meting: geen verzonnen stap (P.6).
      if (!m) continue
      const k = metC.filter((eerder) => eerder.datum > m.datum && eerder.datum < t.datum).length
      const override = t.perCategorie.get(c.key) ?? null
      trainingPuntenTotaal++
      if (!inWeergave(t.datum)) continue
      trainingPunten.push({
        datum: t.datum,
        stap: override ?? berekenStap(m.stap, k),
        bron: 'training',
        handmatig: override !== null,
        eventId: t.eventId,
      })
    }
    const meetPunten: StapPunt[] = eigenMetingen
      .filter((m) => inWeergave(m.datum))
      .map((m) => ({ datum: m.datum, stap: m.stap, bron: 'meting', handmatig: false, eventId: null }))
    // Stabiele sortering op datum; per datum eerst de trainingen (al op event_id
    // gesorteerd), dan de meting.
    const punten = [...trainingPunten, ...meetPunten].sort((a, b) =>
      a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.bron === 'training' ? 0 : 1) - (b.bron === 'training' ? 0 : 1),
    )

    const eerste = eigenMetingen[0]
    const huidigeStap = huidigeStappen[c.key]
    const huidig = typeof huidigeStap === 'number' ? { stap: huidigeStap } : null
    return {
      key: c.key,
      maxStap: c.maxStap,
      gemeten: true,
      nulmeting: { datum: eerste.datum, stap: eerste.stap },
      huidig,
      verschil: huidig ? huidig.stap - eerste.stap : null,
      geenVoortgang: eigenMetingen.length === 1 && trainingPuntenTotaal === 0,
      punten,
      trainingen: trainingPunten.length,
    }
  })

  return { onderdelen, afgekapt: false, onbekend, seizoenNogNietBegonnen: nogNietBegonnen }
}

// B2: ondergrens (p_start) voor de periodiserings-RPC. Per gemeten onderdeel
// de meting die op de eerste seizoensdag gold — de laatste met datum STRIKT
// vóór de seizoensstart, precies wat actueleMetingen(metingen, seizoenStart)
// voor een training op die dag gebruikt — of, zonder zo'n meting, de eerste
// meting van dat onderdeel. De ondergrens is het minimum daarvan; dat is per
// constructie ≥ de vroegste meting. Elke k-telling voor een training in het
// seizoen (en voor `huidig`) telt alleen trainingen ná zo'n meting, dus de
// reconstructie is identiek aan die vanaf de vroegste meting, terwijl de bron
// niet meegroeit over seizoenen.
// Waarom strikt vóór en niet ≤: bij een meting precies op de seizoensstart
// gebruikt een training op die dag nog de vorige meting, en die k telt
// trainingen vanaf díe datum. null = geen bruikbare meting of ongeldige start
// (dan geen RPC-aanroep).
export function periodiseringOndergrens(metingen: CategorieMeting[], seizoenStart: string): string | null {
  if (!isDateString(seizoenStart)) return null
  const perCategorie = new Map<string, { eerste: string; laatsteVoorStart: string | null }>()
  for (const m of Array.isArray(metingen) ? metingen : []) {
    if (!m || !MEETBAAR.has(m.categorie) || !isDateString(m.datum) || eindigOfNull(m.stap) === null) continue
    const huidig = perCategorie.get(m.categorie) ?? { eerste: m.datum, laatsteVoorStart: null }
    if (m.datum < huidig.eerste) huidig.eerste = m.datum
    if (m.datum < seizoenStart && (huidig.laatsteVoorStart === null || m.datum > huidig.laatsteVoorStart)) {
      huidig.laatsteVoorStart = m.datum
    }
    perCategorie.set(m.categorie, huidig)
  }
  let ondergrens: string | null = null
  for (const { eerste, laatsteVoorStart } of perCategorie.values()) {
    const anker = laatsteVoorStart ?? eerste
    if (ondergrens === null || anker < ondergrens) ondergrens = anker
  }
  return ondergrens
}

// ── Invul-discipline ──────────────────────────────────────────────────

export interface InvulDiscipline {
  wedstrijden: number
  // analyseBestaat (de to-do-regel van het dashboard, Q4).
  metAnalyse: number
  // matchResult !== 'unknown': beide doelpuntvelden ingevuld.
  metUitslag: number
  // Handmatig afgevinkt ZONDER automatisch ingevuld (O4); telt nooit als
  // ingevuld.
  analyseHandmatig: number
  trainingen: number
  // hasTrainingPlanDone (doelstelling of ≥1 oefening).
  metPlan: number
  planHandmatig: number
  afgekapt: boolean
}

// Hoe volledig wedstrijden en trainingen zijn ingevuld (D.1–D.7). De regels
// zijn die van het dashboard (app/page.tsx), niet nagebouwd. Een ander `soort`
// dan 'match'/'training' wordt genegeerd. Bij afgekapt blijven de tellingen
// gevuld met wat er binnenkwam; de kaart toont dan alleen de melding.
export function telInvulDiscipline(rijen: InvulDisciplineRij[]): InvulDiscipline {
  const uitkomst: InvulDiscipline = {
    wedstrijden: 0,
    metAnalyse: 0,
    metUitslag: 0,
    analyseHandmatig: 0,
    trainingen: 0,
    metPlan: 0,
    planHandmatig: 0,
    afgekapt: isAfgekapt(rijen),
  }
  for (const rij of Array.isArray(rijen) ? rijen : []) {
    if (!rij) continue
    if (rij.soort === 'match') {
      uitkomst.wedstrijden++
      const auto = analyseBestaat({
        goals_for: rij.goals_for,
        goals_against: rij.goals_against,
        ratingCount: telwaarde(rij.aantal_ratings),
        eventCount: telwaarde(rij.aantal_momenten),
      })
      if (auto) uitkomst.metAnalyse++
      if (matchResult({ goals_for: rij.goals_for, goals_against: rij.goals_against }) !== 'unknown') uitkomst.metUitslag++
      if (rij.handmatig === true && !auto) uitkomst.analyseHandmatig++
    } else if (rij.soort === 'training') {
      uitkomst.trainingen++
      const auto = hasTrainingPlanDone(rij.doelstelling, telwaarde(rij.aantal_oefeningen))
      if (auto) uitkomst.metPlan++
      if (rij.handmatig === true && !auto) uitkomst.planHandmatig++
    }
  }
  return uitkomst
}

// ── Fase 3b: RPE, sRPE en doelstelling-oordeel ────────────────────────
// Bron: inzichten_training_evaluaties (supabase/inzichten-metrics-fase3b.sql),
// venster `verleden` (t/m gisteren, zoals belasting en discipline). De duur
// per training komt uit de BESTAANDE 3a-bron inzichten_training_koppelingen,
// met precies de aanroep van belastingPerWeek (planner-totaal, parallel =
// langste): geen extra RPC en geen SQL-duplicaat van de duurregel (R9).
// belastingPerWeek, telInvulDiscipline en InvulDiscipline hierboven blijven
// bewust ongewijzigd (A15, D.4).

// inzichten_training_evaluaties — één rij per training in het venster (left
// join): rpe en oordeel zijn null zolang ze niet zijn ingevuld.
export interface TrainingEvaluatieRij {
  event_id: string
  datum: string
  doelstelling: string | null
  rpe: number | null
  oordeel: string | null
  totaal: number
}

// Geplande duur van één training: het planner-totaal uit berekenTijdlijn.
// heeftKoppelingen = false → de training heeft geen trainingsplan-blokken.
export interface TrainingDuur {
  totaalMin: number
  blokkenZonderDuur: number
  heeftKoppelingen: boolean
}

// Duur per training (event_id), op basis van dezelfde groepering, leden en
// tijdlijnaanroep als belastingPerWeek: de som per week hiervan is dus altijd
// gelijk aan BelastingWeek.trainingstotaalMin (pariteitstest). Geen
// vensterfilter: de aanroeper beslist welke trainingen meetellen.
export function trainingDuurPerEvent(rijen: TrainingKoppelingRij[]): Map<string, TrainingDuur> {
  const duur = new Map<string, TrainingDuur>()
  for (const training of groepeerPerTraining(rijen, () => true)) {
    if (training.koppelingen.length === 0) {
      duur.set(training.eventId, { totaalMin: 0, blokkenZonderDuur: 0, heeftKoppelingen: false })
      continue
    }
    const tijdlijn = berekenTijdlijn(blokkenVanKoppelingen(training.koppelingen.map(belastingLid)), null)
    duur.set(training.eventId, {
      totaalMin: tijdlijn.totaalMin,
      blokkenZonderDuur: tijdlijn.blokkenZonderDuur,
      heeftKoppelingen: true,
    })
  }
  return duur
}

export interface EvaluatieWeek {
  // Maandag van de ISO-week ('YYYY-MM-DD'); weken lopen maandag–zondag.
  maandag: string
  isoJaar: number
  isoWeek: number
  deelweekBegin: boolean
  deelweekEind: boolean
  trainingen: number
  // Trainingen met een geldige RPE (isValidRpe).
  metRpe: number
  // Trainingen MET RPE maar zonder berekenbare duur: tellen niet mee in srpe,
  // ook niet als 0 (K.3).
  zonderDuur: number
  // Meegetelde trainingen waarvan de duur blokken zonder duur mist (voetnoot *).
  onvolledigeDuur: number
  // Σ RPE × geplande duur in AU. null = geen enkele berekenbare training in
  // deze week ("geen gegevens", K.4), of de duurbron is afgekapt.
  srpe: number | null
  // srpe t.o.v. de hoogste week, alleen voor de staafhoogte.
  srpeAandeel: number | null
  // Geldige oordelen, ongeacht de huidige doelstelling (R5.1, besluit O1).
  ja: number
  deels: number
  nee: number
  // Trainingen met een niet-lege doelstelling (heeftDoelstelling).
  metDoelstelling: number
  // Daarvan zonder geldig oordeel; telt nooit als nee (K.7).
  metDoelstellingZonderOordeel: number
}

export interface EvaluatieOverzicht {
  weken: EvaluatieWeek[]
  afgekaptEvaluaties: boolean
  afgekaptDuur: boolean
  // Er is minstens één training in het venster.
  heeftTrainingen: boolean
  // Minstens één geldige RPE of geldig oordeel in het venster (AC-A5).
  heeftInvoer: boolean
  totaal: Omit<
    EvaluatieWeek,
    'maandag' | 'isoJaar' | 'isoWeek' | 'deelweekBegin' | 'deelweekEind' | 'srpeAandeel' | 'srpe'
  >
}

type EvaluatieTotaal = EvaluatieOverzicht['totaal']

function legeEvaluatieTotaal(): EvaluatieTotaal {
  return {
    trainingen: 0,
    metRpe: 0,
    zonderDuur: 0,
    onvolledigeDuur: 0,
    ja: 0,
    deels: 0,
    nee: 0,
    metDoelstelling: 0,
    metDoelstellingZonderOordeel: 0,
  }
}

// Bruikbare evaluatierij: een niet-leeg event-id en een echte kalenderdatum.
function isBruikbareEvaluatie(rij: TrainingEvaluatieRij | null | undefined): rij is TrainingEvaluatieRij {
  return !!rij && typeof rij.event_id === 'string' && rij.event_id !== '' && isDateString(rij.datum)
}

// sRPE per ISO-week en oordeel-aantallen per week en periode (K.1–K.7). Weken
// chronologisch, elke week van het venster aanwezig, ook zonder training.
// Puur: de invoer wordt nooit gemuteerd, nooit NaN.
export function evaluatiesPerWeek(
  evaluaties: TrainingEvaluatieRij[],
  koppelingen: TrainingKoppelingRij[],
  venster: Seizoensvenster,
): EvaluatieOverzicht {
  const afgekaptEvaluaties = isAfgekapt(evaluaties)
  const afgekaptDuur = isAfgekapt(koppelingen)
  const totaal = legeEvaluatieTotaal()
  if (!isGeldigVenster(venster)) {
    return { weken: [], afgekaptEvaluaties, afgekaptDuur, heeftTrainingen: false, heeftInvoer: false, totaal }
  }

  const rijen = (Array.isArray(evaluaties) ? evaluaties : []).filter(
    (r) => isBruikbareEvaluatie(r) && r.datum >= venster.start && r.datum <= venster.end,
  )
  const heeftTrainingen = rijen.length > 0
  const heeftInvoer = rijen.some((r) => isValidRpe(r.rpe) || isTrainingOordeel(r.oordeel))
  // Afgekapt: geen gedeeltelijke cijfers (de nieuwste week kan ontbreken).
  if (afgekaptEvaluaties) return { weken: [], afgekaptEvaluaties, afgekaptDuur, heeftTrainingen, heeftInvoer, totaal }

  // Bij een afgekapte duurbron blijven de oordeel-aantallen kloppen, maar is
  // geen enkele sRPE te vertrouwen: alle srpe-velden blijven null.
  const duur = afgekaptDuur ? null : trainingDuurPerEvent(koppelingen)

  const weken: EvaluatieWeek[] = wekenInVenster(venster.start, venster.end).map((maandag) => {
    const iso = isoWeek(maandag)!
    const zondag = fromUtcMs(toUtcMs(maandag)! + 6 * DAG_MS)
    return {
      maandag,
      isoJaar: iso.jaar,
      isoWeek: iso.week,
      deelweekBegin: maandag < venster.start,
      deelweekEind: zondag > venster.end,
      trainingen: 0,
      metRpe: 0,
      zonderDuur: 0,
      onvolledigeDuur: 0,
      srpe: null,
      srpeAandeel: null,
      ja: 0,
      deels: 0,
      nee: 0,
      metDoelstelling: 0,
      metDoelstellingZonderOordeel: 0,
    }
  })
  const perMaandag = new Map(weken.map((w) => [w.maandag, w]))

  for (const rij of rijen) {
    const week = perMaandag.get(maandagVanWeek(rij.datum) ?? '')
    if (!week) continue
    week.trainingen++

    if (isValidRpe(rij.rpe)) {
      week.metRpe++
      if (duur) {
        const d = duur.get(rij.event_id)
        if (!d || !(d.totaalMin > 0)) {
          week.zonderDuur++
        } else {
          week.srpe = (week.srpe ?? 0) + rij.rpe * d.totaalMin
          if (d.blokkenZonderDuur > 0) week.onvolledigeDuur++
        }
      }
    }

    const oordeel = isTrainingOordeel(rij.oordeel) ? rij.oordeel : null
    if (oordeel) week[oordeel]++
    if (heeftDoelstelling(rij.doelstelling)) {
      week.metDoelstelling++
      if (!oordeel) week.metDoelstellingZonderOordeel++
    }
  }

  const maxWeekSrpe = weken.reduce((max, w) => Math.max(max, w.srpe ?? 0), 0)
  for (const week of weken) {
    week.srpeAandeel = week.srpe === null ? null : aandeel(week.srpe, maxWeekSrpe)
    for (const sleutel of Object.keys(totaal) as (keyof EvaluatieTotaal)[]) totaal[sleutel] += week[sleutel]
  }
  return { weken, afgekaptEvaluaties, afgekaptDuur, heeftTrainingen, heeftInvoer, totaal }
}

// Uitbreiding van de invul-discipline (D.1/D.2). Een eigen functie naast
// telInvulDiscipline, zodat de 3a-maten en hun type byte-gelijk blijven (D.4).
// Noemer D.1 = trainingen; noemer D.2 = trainingen met een niet-lege
// doelstelling (R5.3).
export interface EvaluatieDiscipline {
  trainingen: number
  metRpe: number
  metDoelstelling: number
  metOordeelBijDoelstelling: number
  afgekapt: boolean
}

// Bij afgekapt blijven de tellingen gevuld met wat er binnenkwam; de kaart
// toont dan alleen de melding (zelfde regel als telInvulDiscipline).
export function telEvaluatieDiscipline(rijen: TrainingEvaluatieRij[]): EvaluatieDiscipline {
  const uitkomst: EvaluatieDiscipline = {
    trainingen: 0,
    metRpe: 0,
    metDoelstelling: 0,
    metOordeelBijDoelstelling: 0,
    afgekapt: isAfgekapt(rijen),
  }
  for (const rij of Array.isArray(rijen) ? rijen : []) {
    if (!rij) continue
    uitkomst.trainingen++
    if (isValidRpe(rij.rpe)) uitkomst.metRpe++
    if (heeftDoelstelling(rij.doelstelling)) {
      uitkomst.metDoelstelling++
      if (isTrainingOordeel(rij.oordeel)) uitkomst.metOordeelBijDoelstelling++
    }
  }
  return uitkomst
}
