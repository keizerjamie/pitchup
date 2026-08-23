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
