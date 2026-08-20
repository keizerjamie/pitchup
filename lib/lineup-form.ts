import { isDateString } from '@/lib/season-dates'

// Vormgewogen spelerskwaliteit voor het opstellen (app/events/[id]/lineup).
//
// Pure module: GEEN Supabase-import, geen klok, geen I/O. De pagina haalt de
// rijen op (twee gewone queries, geen RPC) en geeft ze hier door; alles wat
// hieronder gebeurt is rekenwerk op die rijen. Zo is het volledig testbaar en
// blijft de tenant-afscherming waar hij hoort: bij de queries.
//
// De types horen bewust hier en niet in lib/types.ts — precedent:
// `MatchFormItem` in lib/match-form.ts:7-21 en `Seizoensvenster` in
// lib/inzichten.ts. Ook de rij-interfaces zijn bewust smal (alleen de kolommen
// die de berekening nodig heeft) in plaats van `Player`/`FootballEvent`/
// `MatchRating`, zoals `MatchFormRow` in lib/match-form.ts:23-30.

// Maximaal aantal meetellende wedstrijden (X) in het vormvenster.
export const VORM_VENSTER = 5

// Vormgewicht bij een vol venster (X = VORM_VENSTER). Bij minder wedstrijden
// schuift het gewicht evenredig terug richting het anker.
export const VORM_MAX_GEWICHT = 0.7

// Anker als `players.rating` ontbreekt of ongeldig is: het midden van de
// schaal 1..10, zodat een speler zonder handmatige beoordeling niet
// stelselmatig boven- of onderaan belandt.
export const ANKER_FALLBACK = 5

// Drempel voor de trendpijl, INCLUSIEF ('flat' bij |verschil| <= 0,5).
// Ratings zijn hele getallen: bij X = 3 is het kleinst mogelijke verschil
// ongelijk aan nul exact 0,5. Zonder deze drempel zou de pijl al op één
// afwijkend cijfer heen en weer flikkeren.
export const TREND_DREMPEL = 0.5

// Hoeveel eerdere wedstrijden de pagina ophaalt om het venster te kunnen
// vullen. Ruimer dan VORM_VENSTER omdat niet elke wedstrijd beoordeeld is:
// onbeoordeelde wedstrijden schuiven het venster naar achteren.
export const FORM_MATCH_HORIZON = 25

// 'none' = te weinig beoordeelde wedstrijden (X < 3) om een richting te tonen.
export type FormTrend = 'up' | 'flat' | 'down' | 'none'

export interface PlayerForm {
  // 1..10, ONAFGEROND. Enige bron voor ranking én auto-opstellen: afronden
  // gebeurt pas in de weergave, zodat afronding nooit een rangorde omdraait.
  quality: number
  // X: aantal meetellende beoordeelde wedstrijden, 0..VORM_VENSTER.
  count: number
  trend: FormTrend
}

export interface FormPlayerRow {
  id: string
  rating: number | null
}

export interface FormMatchRow {
  id: string
  // Kale kalenderdatum 'YYYY-MM-DD' uit events.date.
  date: string
  // timestamptz (UTC) uit events.created_at — uitsluitend tie-break, wordt
  // nooit getoond.
  created_at: string | null
}

export interface FormRatingRow {
  event_id: string
  player_id: string
  rating: number | null
}

// Geldig = een echt getal binnen de schaal 1..10 (dezelfde CHECK als
// match_ratings.rating / players.rating in supabase/schema.sql). Alles anders
// — null, NaN, 0, 11, een string — telt als "niet beoordeeld" en levert
// NOOIT een 0 op.
//
// Bewust GEËXPORTEERD, hoewel het van origine een intern predicaat is: de
// weergavelaag (components/LineupBuilder.tsx) moet "heeft deze speler een
// handmatig coachcijfer?" met exact dezelfde regel beantwoorden als de
// berekening hier. Met een eigen check aan die kant (bijv. `rating != null`)
// zou een rating buiten 1..10 daar als coachcijfer gelden terwijl de
// berekening op ANKER_FALLBACK terugvalt — dan toont de UI de rekenfallback 5
// als "5,0". Eén definitie, twee gebruikers. Veilig te importeren in een
// client component: deze module blijft puur (geen Supabase, geen klok, geen
// I/O). Gedrag is onveranderd; alleen de zichtbaarheid is verruimd.
export function isGeldigeRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10
}

function ankerVan(anchor: number | null): number {
  return isGeldigeRating(anchor) ? anchor : ANKER_FALLBACK
}

// Recentheidsgewicht van de i-de wedstrijd (i = 1..VORM_VENSTER): 5, 4, 3, 2, 1.
function gewichtVan(index: number): number {
  return VORM_VENSTER + 1 - index
}

function trendVan(ratings: number[]): FormTrend {
  if (ratings.length < 3) return 'none'
  // Bewust ONgewogen: de recentheidsweging zit al in `quality`. De pijl
  // beantwoordt een andere vraag — hoe verhoudt het recente blok zich tot het
  // oudere blok — en vergelijkt die twee blokken dus gelijkwaardig.
  const recent = (ratings[0] + ratings[1]) / 2
  const ouderen = ratings.slice(2)
  const ouder = ouderen.reduce((som, r) => som + r, 0) / ouderen.length
  const verschil = recent - ouder
  if (Math.abs(verschil) <= TREND_DREMPEL) return 'flat'
  return verschil > 0 ? 'up' : 'down'
}

// Blendt het handmatige anker (`players.rating`) met het recentheidsgewogen
// gemiddelde van de laatste maximaal VORM_VENSTER beoordeelde wedstrijden.
//
//   w_i          = VORM_VENSTER + 1 - i        (i = 1..X  →  5, 4, 3, 2, 1)
//   vorm         = Σ(w_i · r_i) / Σ(w_i)
//   vormGewicht  = (X / VORM_VENSTER) · VORM_MAX_GEWICHT
//   quality      = anker · (1 - vormGewicht) + vorm · vormGewicht
//
// `ratingsRecentFirst` staat recent-eerst. Ongeldige waarden worden hier
// nogmaals weggefilterd (defensief; buildPlayerForms levert al alleen geldige
// aan) en alles voorbij VORM_VENSTER wordt genegeerd. De invoer wordt niet
// gemuteerd.
export function blendPlayerForm(anchor: number | null, ratingsRecentFirst: number[]): PlayerForm {
  const anker = ankerVan(anchor)
  const ratings = ratingsRecentFirst.filter(isGeldigeRating).slice(0, VORM_VENSTER)
  const count = ratings.length

  if (count === 0) return { quality: anker, count: 0, trend: 'none' }

  let gewogenSom = 0
  let gewichtSom = 0
  ratings.forEach((rating, i) => {
    const gewicht = gewichtVan(i + 1)
    gewogenSom += gewicht * rating
    gewichtSom += gewicht
  })
  const vorm = gewogenSom / gewichtSom
  const vormGewicht = (count / VORM_VENSTER) * VORM_MAX_GEWICHT

  return {
    // Bewust NIET afgerond.
    quality: anker * (1 - vormGewicht) + vorm * vormGewicht,
    count,
    trend: trendVan(ratings),
  }
}

// Vorm van een speler zonder enige beoordeelde wedstrijd: puur het anker.
// Identiek aan blendPlayerForm(anchor, []) — ook bruikbaar als defensieve
// fallback aan de consumerende kant.
export function emptyPlayerForm(anchor: number | null): PlayerForm {
  return blendPlayerForm(anchor, [])
}

// Sorteert wedstrijden recent-eerst: date desc → created_at desc (null
// achteraan) → id desc. Exact hetzelfde tie-break-precedent als de vorm-query
// op het dashboard (app/page.tsx:60-68), zodat lijst en berekening dezelfde
// volgorde aanhouden.
function vergelijkWedstrijden(a: FormMatchRow, b: FormMatchRow): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const ca = a.created_at
  const cb = b.created_at
  if (ca !== cb) {
    // `== null` vangt ook een ontbrekende waarde af, niet alleen expliciet null.
    if (ca == null) return 1
    if (cb == null) return -1
    return ca < cb ? 1 : -1
  }
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

// Samengestelde sleutel (event, speler) voor de rating-map.
//
// De scheider is U+0000, en dat is essentieel: een NUL kan niet voorkomen in
// een UUID, dus twee verschillende paren kunnen NOOIT dezelfde sleutel
// opleveren. Met een gewoon teken (spatie, '-', ':') zouden ('e1 p','1') en
// ('e1','p 1') allebei 'e1 p 1' geven en zou de ene speler de beoordeling van
// de andere krijgen.
//
// Bewust de ESCAPE `\u0000` en NIET de letterlijke NUL-byte: beide leveren
// exact dezelfde string op, maar een echte 0x00 in de bron maakt dit hele
// bestand binair voor `grep` en `file` — dan slaat elke repo-brede
// zoekopdracht het stilzwijgend over, zonder enige waarschuwing. Niet
// "opschonen": niet naar een leesbaarder teken, en niet terug naar de kale
// byte. Vastgelegd door de scheider-tests in lib/lineup-form.test.ts.
function ratingSleutel(eventId: string, playerId: string): string {
  return `${eventId}\u0000${playerId}`
}

// Bouwt per speler de PlayerForm. Elke speler in `players` krijgt een entry,
// ook zonder enige beoordeling (dan `emptyPlayerForm`).
//
// Tijdzone — bewuste keuze: de cutoff is `before` (events.date van het event
// waarvoor wordt opgesteld), NIET een klokwaarde. Er wordt hier geen klok
// gelezen; twee kale DATE-waarden uit dezelfde database worden als
// 'YYYY-MM-DD'-strings vergeleken, wat tijdzone-onafhankelijk is. Het bekende,
// bewust geaccepteerde serverklok-gat van todayLocal() (lib/utils.ts:1-7,
// toegelicht in lib/inzichten.ts:329-331) wordt hier dus NIET uitgebreid.
// `created_at` (timestamptz/UTC) dient uitsluitend als tie-break.
//
// Tenant-isolatie (vierde laag, naast RLS, de expliciete team_id-filters en de
// team-gescopete in()-lijst): elke rating-rij waarvan `player_id` niet in
// `players` of `event_id` niet in `matches` zit wordt genegeerd. Zo kan een
// rij die er om welke reden dan ook toch tussen zou glippen nooit meetellen.
//
// Muteert de invoer niet.
export function buildPlayerForms(input: {
  players: FormPlayerRow[]
  matches: FormMatchRow[]
  ratings: FormRatingRow[]
  before: string
}): Record<string, PlayerForm> {
  const { players, matches, ratings, before } = input

  // Een ongeldige peildatum kan geen venster opspannen: dan valt iedereen
  // terug op X = 0 in plaats van op een willekeurige stringvergelijking.
  const geldigeCutoff = isDateString(before)

  const wedstrijden = geldigeCutoff
    ? matches
        // Ongeldige datums (ontbrekend, '', '2026-02-30') vallen af: die
        // kunnen niet betrouwbaar geordend of vergeleken worden.
        .filter((m) => isDateString(m.date) && m.date < before)
        // Kopie: [].filter() levert al een nieuwe array, sort() raakt de
        // invoer dus niet.
        .sort(vergelijkWedstrijden)
    : []

  const bekendeEvents = new Set(wedstrijden.map((m) => m.id))
  const bekendeSpelers = new Set(players.map((p) => p.id))

  // Eerste geldige rij per (event, speler) wint — deterministisch, geen
  // dubbeltelling. De database garandeert dit al via UNIQUE(event_id,
  // player_id) (supabase/schema.sql:104); hier is het de vangnetregel.
  const perEventSpeler = new Map<string, number>()
  for (const rij of ratings) {
    if (!bekendeEvents.has(rij.event_id)) continue
    if (!bekendeSpelers.has(rij.player_id)) continue
    if (!isGeldigeRating(rij.rating)) continue
    const sleutel = ratingSleutel(rij.event_id, rij.player_id)
    if (perEventSpeler.has(sleutel)) continue
    perEventSpeler.set(sleutel, rij.rating)
  }

  const result: Record<string, PlayerForm> = {}
  for (const speler of players) {
    const recentFirst: number[] = []
    for (const wedstrijd of wedstrijden) {
      if (recentFirst.length >= VORM_VENSTER) break
      const rating = perEventSpeler.get(ratingSleutel(wedstrijd.id, speler.id))
      // Geen (geldige) beoordeling → de wedstrijd valt buiten het venster en
      // telt NOOIT als 0; het venster schuift door naar een oudere wedstrijd.
      if (rating === undefined) continue
      recentFirst.push(rating)
    }
    result[speler.id] = blendPlayerForm(speler.rating, recentFirst)
  }

  return result
}
