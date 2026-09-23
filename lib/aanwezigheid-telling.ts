// Pure beslisregel rond het TONEN en TELLEN van aanwezigheid. Bewust géén
// 'use server' en géén Supabase-afhankelijkheid, zodat zowel de server
// components (het dashboard, het trainingsplan, de opstelling) als de
// clientcomponent TrainingAttendance dezelfde regel gebruiken en die regel los
// te testen is. Zelfde soort bestand als lib/attendance-rows.ts.
//
// De regel zelf (teltMee): een vaste speler telt en toont ALTIJD mee; een
// gastspeler alleen als hij aanwezig is. Een afwezige of onbekende gast bestaat
// dus niet voor een afwezigen-/onbekendlijst en niet voor enige noemer. Het
// opkomstpercentage gaat daarbovenop UITSLUITEND over de vaste selectie: een
// aanwezig gezette gast is wel zichtbaar bij de aanwezigen, maar verhoogt het
// percentage niet.
//
// LET OP — dit is de WEERGAVE-regel. De OPSLAG-regel staat in
// lib/attendance-rows.ts (resolveAttendanceStatus): daar staat een gast nog
// steeds standaard `absent` in de database. Die twee regels zijn bewust
// gescheiden; verander er nooit één "omdat de andere het anders doet".

import { berekenAanwezigheidPercentage } from '@/lib/inzichten'
import type { AttendanceStatus, PlayerType } from '@/lib/types'

// Minimale vorm waar beide functies genoeg aan hebben: zowel Player als de
// lichtere spelerrijen van het dashboard passen hierop.
export interface TelbareSpeler {
  id: string
  type: PlayerType
}

// DE REGEL, op één plek. Telt/toont deze speler mee voor dit event?
// Een vaste speler altijd; een gast alleen als hij aanwezig is.
export function teltMee(type: PlayerType, aanwezig: boolean): boolean {
  return type !== 'guest' || aanwezig
}

export interface AanwezigheidsTelling {
  aanwezig: number                  // vast aanwezig + gast aanwezig
  afwezig: number                   // UITSLUITEND vaste spelers met 'absent'
  onbekend: number                  // UITSLUITEND vaste spelers met 'unknown'
  meetellend: number                // aanwezig + afwezig + onbekend
  gastenAanwezig: number            // voor de subregel op de stat-card
  vastAanwezig: number              // teller van het opkomstpercentage
  vastAfwezig: number               // rest van de noemer
  opkomstPercentage: number | null  // null bij noemer 0
}

// De vier getallen van de stat-cards in één doorloop. `statusVan` haalt de
// status op waar de aanroeper hem ook vandaan haalt (lokale state, een map uit
// de database), zodat deze functie niets van attendance-rijen hoeft te weten.
export function telAanwezigheid<T extends TelbareSpeler>(
  spelers: T[],
  statusVan: (speler: T) => AttendanceStatus,
): AanwezigheidsTelling {
  let aanwezig = 0
  let afwezig = 0
  let onbekend = 0
  let gastenAanwezig = 0
  let vastAanwezig = 0
  let vastAfwezig = 0

  for (const speler of spelers) {
    const status = statusVan(speler)
    const isAanwezig = status === 'present'
    // De enige plek waar de gast-uitsluiting valt: een niet-aanwezige gast
    // komt hierna in geen enkele teller meer voor.
    if (!teltMee(speler.type, isAanwezig)) continue
    const isGast = speler.type === 'guest'

    if (isAanwezig) {
      aanwezig++
      if (isGast) gastenAanwezig++
      else vastAanwezig++
    } else if (status === 'absent') {
      // Onbereikbaar voor een gast: die is hierboven al weggefilterd.
      afwezig++
      vastAfwezig++
    } else {
      onbekend++
    }
  }

  return {
    aanwezig,
    afwezig,
    onbekend,
    meetellend: aanwezig + afwezig + onbekend,
    gastenAanwezig,
    vastAanwezig,
    vastAfwezig,
    // Bewust gedelegeerd aan berekenAanwezigheidPercentage: één afronding voor
    // dit scherm, het dashboard en /inzichten, en één plek die null teruggeeft
    // bij noemer 0 (nooit 0%, dat zou "iedereen afwezig" suggereren).
    opkomstPercentage: berekenAanwezigheidPercentage(vastAanwezig, vastAfwezig),
  }
}

// Dezelfde regel voor de twee lijstpagina's (trainingsplan en opstelling).
// `afwezig` is hier bewust "niet aanwezig", dus INCLUSIEF status 'unknown' —
// dat is het bestaande gedrag van beide pagina's en verandert niet; deze
// functie haalt er alleen de gasten uit. Behoudt de invoervolgorde en muteert
// de invoer niet.
export function splitsAanwezigheid<T extends TelbareSpeler>(
  spelers: T[],
  isAanwezig: (speler: T) => boolean,
): { aanwezig: T[]; afwezig: T[] } {
  const aanwezig: T[] = []
  const afwezig: T[] = []
  for (const speler of spelers) {
    const present = isAanwezig(speler)
    if (!teltMee(speler.type, present)) continue
    if (present) aanwezig.push(speler)
    else afwezig.push(speler)
  }
  return { aanwezig, afwezig }
}
