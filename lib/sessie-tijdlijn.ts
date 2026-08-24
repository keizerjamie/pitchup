import type { ParallelBlok } from '@/lib/parallel-groep'

// Rekent een trainingsplan om naar een tijdlijn: hoe lang duurt de sessie, en
// hoe laat begint elk blok.
//
// Waarom dit bestaat: `oefeningen.duur_min` en `events.time` stonden er al,
// maar de planner deed er niets mee. Een trainer denkt in minuten ("19:00
// warming-up, kwartier, dan de passvorm") en zag alleen een lijst zonder
// optelsom — je merkte pas op het veld dat je sessie 20 minuten te lang was.
//
// Pure functies, geen React en geen databasetoegang: dezelfde scheiding als
// lib/parallel-groep.ts, zodat scherm én printweergave dezelfde cijfers tonen
// en dit los testbaar blijft.

// Referentieduur van een training. BEWUST EEN CONSTANTE en geen instelling:
// een instelbare waarde vraagt een instellingenscherm, en dat is hier niet
// gevraagd. Onderzoek naar jeugdtrainingen komt uit op 60–90 minuten; 90 is de
// bovengrens en daarmee een bruikbaar plafond om tegen af te zetten.
//
// Het is een REFERENTIE, geen limiet: langer plannen mag, het wordt alleen
// zichtbaar gemarkeerd.
export const STANDAARD_SESSIEDUUR_MIN = 90

export interface TijdlijnBlok {
  key: string
  // Duur van het blok. Bij een parallelle groep is dat de LANGSTE duur van de
  // leden, niet de som: die oefeningen draaien tegelijk. Null = geen enkel lid
  // heeft een duur ingevuld.
  duurMin: number | null
  // Minuten vanaf het begin van de sessie. Null zodra een eerder blok geen
  // duur heeft — vanaf dat punt is er geen eerlijke klok meer te berekenen.
  startMin: number | null
  // Kloktijden, alleen als de training een starttijd heeft én de klok tot hier
  // ononderbroken is. 'HH:MM'.
  startTijd: string | null
  eindTijd: string | null
}

export interface Tijdlijn {
  blokken: TijdlijnBlok[]
  // Som van de bekende blokduren. Parallelle groepen tellen één keer mee.
  totaalMin: number
  // Aantal blokken zonder ingevulde duur — die ontbreken dus in `totaalMin`.
  // Expliciet, zodat de UI "78 min (2 zonder duur)" kan tonen in plaats van
  // een te laag totaal als hard getal te presenteren.
  blokkenZonderDuur: number
  // Eindtijd van de sessie, of null zonder starttijd/bij een gat in de klok.
  eindTijd: string | null
}

// Duur van één blok: de langste van zijn leden. Leden zonder duur tellen niet
// mee (een oefening zonder ingevulde duur maakt het blok niet nul minuten).
export function blokDuur(blok: ParallelBlok): number | null {
  const duren = blok.leden
    .map((lid) => lid.oefeningen?.duur_min ?? null)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0)
  if (duren.length === 0) return null
  return Math.max(...duren)
}

// 'HH:MM(:SS)' → minuten sinds middernacht. Null bij een onbruikbare waarde;
// nooit een gegokte waarde, want daar zou een verkeerde kloktijd uit rollen.
export function tijdNaarMinuten(tijd: string | null): number | null {
  if (!tijd) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(tijd)
  if (!match) return null
  const uren = Number(match[1])
  const minuten = Number(match[2])
  if (uren < 0 || uren > 23 || minuten < 0 || minuten > 59) return null
  return uren * 60 + minuten
}

// Minuten sinds middernacht → 'HH:MM'. Loopt bewust NIET over middernacht heen:
// een training die na 23:59 zou eindigen levert null op in plaats van een tijd
// die de volgende dag suggereert zonder dat te zeggen.
export function minutenNaarTijd(minuten: number): string | null {
  if (!Number.isFinite(minuten) || minuten < 0 || minuten >= 24 * 60) return null
  const uren = Math.floor(minuten / 60)
  const rest = Math.round(minuten % 60)
  return `${String(uren).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

// Bouwt de tijdlijn. `startTijd` is de starttijd van het event ('HH:MM' of
// null); zonder starttijd blijven alle kloktijden null maar worden de duren
// wél opgeteld — het totaal is ook zonder klok bruikbaar.
export function berekenTijdlijn(blokken: ParallelBlok[], startTijd: string | null): Tijdlijn {
  const startMinuten = tijdNaarMinuten(startTijd)

  let cursor: number | null = 0
  let totaalMin = 0
  let blokkenZonderDuur = 0

  const resultaat: TijdlijnBlok[] = blokken.map((blok) => {
    const duur = blokDuur(blok)
    const startMin = cursor

    if (duur === null) {
      blokkenZonderDuur++
      // Vanaf hier is de klok niet meer betrouwbaar: we weten niet wanneer dit
      // blok afloopt, dus ook niet wanneer het volgende begint.
      cursor = null
    } else {
      totaalMin += duur
      cursor = startMin === null ? null : startMin + duur
    }

    const klokStart = startMinuten !== null && startMin !== null ? minutenNaarTijd(startMinuten + startMin) : null
    const klokEind =
      startMinuten !== null && startMin !== null && duur !== null
        ? minutenNaarTijd(startMinuten + startMin + duur)
        : null

    return { key: blok.key, duurMin: duur, startMin, startTijd: klokStart, eindTijd: klokEind }
  })

  // Eindtijd van de hele sessie: alleen als de klok nergens onderbroken is.
  const eindTijd = startMinuten !== null && cursor !== null ? minutenNaarTijd(startMinuten + cursor) : null

  return { blokken: resultaat, totaalMin, blokkenZonderDuur, eindTijd }
}
