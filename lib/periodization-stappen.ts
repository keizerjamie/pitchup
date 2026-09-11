import { PERIODIZATION_CATEGORIES, type OefeningCategorie } from '@/lib/types'
import { clampDuurMin } from '@/lib/sessie-tijdlijn'

// Statische, universele domeinkennis: de trainingsparameters per
// periodiseringsstap. Bewust een module-constante in de code (net als
// PERIODIZATION_CATEGORIES / FORMATIONS_BY_TEAM_SIZE in lib/types.ts) en géén
// databasetabel — de data is niet team-specifiek en verandert niet.
//
// Bewust géén 'use server': pure regels die zowel de server action
// (app/actions/training-plan.ts) als de client hergebruiken, zelfde patroon
// als lib/spelerindeling.ts.

// Eén rij uit een periodiseringstabel. Alle waarden zijn LETTERLIJKE strings
// uit de brontabel — inclusief eenheid en decimaalkomma ("4,5 min"). Nooit
// afronden, nooit herformatteren, nooit lokaliseren.
// Een ontbrekend veld betekent: die kolom bestaat niet voor deze categorie.
export interface StapRij {
  arbeid: string
  herhalingen: string
  rustHH: string
  series?: string
  rustSeries?: string
}

// Categorieën met een beschrijvende stap-tekst i.p.v. kolommen (steigerungs)
// staan NIET in deze tabel: hun tekst is vertaalbaar en leeft in messages/*.
export const PERIODIZATION_STEP_TABLES: Partial<Record<OefeningCategorie, StapRij[]>> = {
  sprints_weinig_rust: [
    { arbeid: '15m', herhalingen: '6',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '7',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '7',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '20m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '20m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
  ],
  // Geen series-kolom in de brontabel.
  sprints_veel_rust: [
    { arbeid: '5/15/25m', herhalingen: '6/4/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/4/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/5/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/5/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/5/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/6/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/6/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/6/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/7/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/7/5',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/7/5', rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/8/5', rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/8/6', rustHH: '30/45/60 sec', rustSeries: '4 min' },
  ],
  // Geen series/rustSeries-kolommen in de brontabel.
  partijen_groot: [
    { arbeid: '10 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '11 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '11 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '6', rustHH: '2 min' },
  ],
  // Geen series/rustSeries-kolommen; let op de decimaalkomma's in arbeid.
  partijen_midden: [
    { arbeid: '4 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '4,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '5 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '5,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '6 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '6,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '5', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '5', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '6', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '6', rustHH: '2 min' },
  ],
  // Alle vijf kolommen; let op de decimaalkomma's in rustHH (stap 2 en 4).
  partijen_klein: [
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '3 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '2,5 min', series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '2 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '1,5 min', series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1,5 min', herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '2 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '2,5 min', herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '7',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '8',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '9',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '10', rustHH: '1 min',   series: '2', rustSeries: '4 min' },
  ],
}

// Numerieke tegenhanger van PERIODIZATION_STEP_TABLES, UITSLUITEND voor de drie
// partijen-categorieën: die zijn de enige waar een oefeningduur uit de stap te
// berekenen valt. De strings hierboven blijven de bron voor WEERGAVE en worden
// nooit geparsed (zie de kop van dit bestand); deze tabel is de bron voor
// REKENEN. Twee tabellen, één waarheid — bewaakt door de consistentietest in
// lib/periodization-stappen.test.ts, die elke numerieke rij terugformatteert
// naar de weergavestring en met de rij hierboven vergelijkt. Wijkt er ooit één
// waarde af, dan faalt die test; er is geen pad waarlangs ze stil uit elkaar
// kunnen lopen.
//
// Minuten, niet seconden: alle vijf de velden van deze drie categorieën staan
// in de brontabel in minuten. Decimale waarden (4,5) zijn geldig en komen voor.
export interface StapRekenRij {
  arbeidMin: number
  herhalingen: number
  rustHHMin: number
  // Afwezig waar de brontabel de kolom niet heeft (partijen_groot/-midden).
  series?: number
  rustSeriesMin?: number
}

// Rij i hoort exact bij rij i van PERIODIZATION_STEP_TABLES[cat]; de lengtes zijn
// per categorie gelijk (21 / 15 / 13).
export const PERIODIZATION_STEP_MINUTEN: Partial<Record<OefeningCategorie, StapRekenRij[]>> = {
  partijen_groot: [
    { arbeidMin: 10, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 11, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 12, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 13, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 14, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 15, herhalingen: 2, rustHHMin: 2 },
    { arbeidMin: 11, herhalingen: 3, rustHHMin: 2 },
    { arbeidMin: 12, herhalingen: 3, rustHHMin: 2 },
    { arbeidMin: 13, herhalingen: 3, rustHHMin: 2 },
    { arbeidMin: 14, herhalingen: 3, rustHHMin: 2 },
    { arbeidMin: 15, herhalingen: 3, rustHHMin: 2 },
    { arbeidMin: 12, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 13, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 14, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 15, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 13, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 14, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 15, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 13, herhalingen: 6, rustHHMin: 2 },
    { arbeidMin: 14, herhalingen: 6, rustHHMin: 2 },
    { arbeidMin: 15, herhalingen: 6, rustHHMin: 2 },
  ],
  partijen_midden: [
    { arbeidMin: 4, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 4.5, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 5, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 5.5, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 6, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 6.5, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 7, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 7.5, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 8, herhalingen: 4, rustHHMin: 2 },
    { arbeidMin: 7, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 7.5, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 8, herhalingen: 5, rustHHMin: 2 },
    { arbeidMin: 7, herhalingen: 6, rustHHMin: 2 },
    { arbeidMin: 7.5, herhalingen: 6, rustHHMin: 2 },
    { arbeidMin: 8, herhalingen: 6, rustHHMin: 2 },
  ],
  partijen_klein: [
    { arbeidMin: 1, herhalingen: 6, rustHHMin: 3, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 1, herhalingen: 6, rustHHMin: 2.5, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 1, herhalingen: 6, rustHHMin: 2, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 1, herhalingen: 6, rustHHMin: 1.5, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 1, herhalingen: 6, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 1.5, herhalingen: 6, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 2, herhalingen: 6, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 2.5, herhalingen: 6, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 3, herhalingen: 6, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 3, herhalingen: 7, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 3, herhalingen: 8, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 3, herhalingen: 9, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
    { arbeidMin: 3, herhalingen: 10, rustHHMin: 1, series: 2, rustSeriesMin: 4 },
  ],
}

// Berekende oefeningduur in hele minuten voor één periodiseringsstap.
// null zodra er niets te rekenen valt: geen stap, of een categorie zonder
// numerieke tabel (sprints, steigerungs, warming_up, …). Dat null is het
// signaal "niet automatisch berekenen" — de aanroeper laat de bestaande duur
// dan met rust.
//
// Formule: (arbeid × herhalingen + rustHH × (herhalingen − 1)) × series +
// rustSeries × (series − 1). Ontbrekende series/rustSeries tellen als
// series = 1 en rustSeries = 0; daarmee reduceert de formule zich vanzelf tot
// arbeid × herhalingen + rustHH × (herhalingen − 1) voor partijen_groot en
// partijen_midden — één formule, geen tweede tak die kan gaan afwijken.
//
// Stap-index wordt geclampt naar [1, tabellengte], exact zoals stapInhoud
// hieronder: een berekende stap boven het maximum rekent met de zwaarste
// beschikbare rij, en badge/inhoud/duur blijven dan onderling consistent.
//
// Math.round staat er omdat duur_min een SMALLINT is. Met de huidige rijen
// levert de formule uitsluitend gehele getallen op; een test pint dat vast,
// zodat een toekomstige rij die wél afrondt zichtbaar wordt in plaats van stil.
export function berekenDuurUitStap(categorie: string, stap: number | null | undefined): number | null {
  if (stap === null || stap === undefined || !Number.isFinite(stap)) return null
  const tabel = PERIODIZATION_STEP_MINUTEN[categorie as OefeningCategorie]
  if (!tabel || tabel.length === 0) return null
  const rij = tabel[Math.min(Math.max(1, Math.floor(stap)), tabel.length) - 1]
  if (!rij) return null
  const series = rij.series ?? 1
  const rustSeries = rij.rustSeriesMin ?? 0
  const blok = rij.arbeidMin * rij.herhalingen + rij.rustHHMin * (rij.herhalingen - 1)
  return clampDuurMin(Math.round(blok * series + rustSeries * (series - 1)))
}

// Bovengrens van het stapnummer voor een categorie. Onbekende categorie of een
// categorie zonder eigen maximum → 99 (dezelfde ruime grens die de categorieën
// zonder meting in PERIODIZATION_CATEGORIES al hebben).
export function maxStapVoor(categorie: string): number {
  return PERIODIZATION_CATEGORIES.find((c) => c.key === categorie)?.maxStap ?? 99
}

// Ondergrens altijd 1, bovengrens maxStap. Niet-eindig getal → 1 (zelfde
// gedrag als het bestaande `parseInt(raw, 10) || 1` in de editor).
export function clampStapOverride(value: number | null, categorie: string): number | null {
  if (value === null) return null
  const n = Math.floor(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(maxStapVoor(categorie), n))
}

// null bij: geen tabel voor categorie, geen stap, of stap buiten bereik.
// Clamt naar de laatste rij zodat een berekende stap boven het maximum de
// zwaarste beschikbare rij toont.
export function stapInhoud(categorie: string, stap: number | null | undefined): StapRij | null {
  if (stap === null || stap === undefined) return null
  const tabel = PERIODIZATION_STEP_TABLES[categorie as OefeningCategorie]
  if (!tabel) return null
  const clamped = Math.min(Math.max(1, stap), tabel.length)
  return tabel[clamped - 1] ?? null
}

// Heeft deze categorie überhaupt stap-inhoud om te tonen? `steigerungs` heeft
// geen kolommentabel maar wél een beschrijvende tekst per stap (in messages/*).
export function heeftStapInhoud(categorie: string): boolean {
  return categorie === 'steigerungs' || !!PERIODIZATION_STEP_TABLES[categorie as OefeningCategorie]
}
