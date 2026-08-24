import { describe, it, expect } from 'vitest'
import type { ParallelBlok } from '@/lib/parallel-groep'
import type { TrainingOefeningWithData } from '@/lib/types'
import {
  STANDAARD_SESSIEDUUR_MIN,
  berekenTijdlijn,
  blokDuur,
  minutenNaarTijd,
  tijdNaarMinuten,
} from '@/lib/sessie-tijdlijn'

function lid(duur: number | null, id = 'k1'): TrainingOefeningWithData {
  return { id, oefeningen: { duur_min: duur } } as unknown as TrainingOefeningWithData
}
function blok(key: string, ...duren: (number | null)[]): ParallelBlok {
  return { key, groepId: duren.length > 1 ? 'g1' : null, leden: duren.map((d, i) => lid(d, `${key}-${i}`)) }
}

describe('tijdNaarMinuten', () => {
  it('leest HH:MM en HH:MM:SS', () => {
    expect(tijdNaarMinuten('19:30')).toBe(19 * 60 + 30)
    expect(tijdNaarMinuten('09:05:00')).toBe(9 * 60 + 5)
  })
  it('weigert onbruikbare waarden in plaats van te gokken', () => {
    for (const waarde of [null, '', 'avond', '25:00', '19:75', '1930']) {
      expect(tijdNaarMinuten(waarde)).toBeNull()
    }
  })
})

describe('minutenNaarTijd', () => {
  it('formatteert met leidende nul', () => {
    expect(minutenNaarTijd(9 * 60 + 5)).toBe('09:05')
    expect(minutenNaarTijd(0)).toBe('00:00')
  })
  it('loopt niet over middernacht heen maar geeft null', () => {
    // Een tijd die "de volgende dag" is zou zonder waarschuwing gelezen worden
    // als vanavond.
    expect(minutenNaarTijd(24 * 60)).toBeNull()
    expect(minutenNaarTijd(-1)).toBeNull()
  })
})

describe('blokDuur', () => {
  it('losse oefening: zijn eigen duur', () => {
    expect(blokDuur(blok('a', 15))).toBe(15)
  })

  it('parallelle groep: de LANGSTE duur, niet de som — die oefeningen draaien tegelijk', () => {
    expect(blokDuur(blok('b', 10, 20, 15))).toBe(20)
  })

  it('leden zonder duur tellen niet mee en maken het blok niet nul', () => {
    expect(blokDuur(blok('c', null, 12))).toBe(12)
  })

  it('geen enkel lid met duur → null, geen 0', () => {
    expect(blokDuur(blok('d', null, null))).toBeNull()
    expect(blokDuur(blok('e', 0))).toBeNull()
  })
})

describe('berekenTijdlijn', () => {
  it('telt de blokken op en zet de klok door vanaf de starttijd', () => {
    const tl = berekenTijdlijn([blok('a', 15), blok('b', 25), blok('c', 20)], '19:00')
    expect(tl.totaalMin).toBe(60)
    expect(tl.blokkenZonderDuur).toBe(0)
    expect(tl.blokken.map((b) => [b.startTijd, b.eindTijd])).toEqual([
      ['19:00', '19:15'],
      ['19:15', '19:40'],
      ['19:40', '20:00'],
    ])
    expect(tl.eindTijd).toBe('20:00')
  })

  it('een parallelle groep telt één keer mee in het totaal', () => {
    // 15 + max(20, 10) = 35, niet 15 + 20 + 10 = 45.
    const tl = berekenTijdlijn([blok('a', 15), blok('b', 20, 10)], '19:00')
    expect(tl.totaalMin).toBe(35)
    expect(tl.eindTijd).toBe('19:35')
  })

  it('zonder starttijd blijven kloktijden leeg maar telt het totaal gewoon door', () => {
    const tl = berekenTijdlijn([blok('a', 15), blok('b', 25)], null)
    expect(tl.totaalMin).toBe(40)
    expect(tl.eindTijd).toBeNull()
    expect(tl.blokken.every((b) => b.startTijd === null)).toBe(true)
    // De relatieve positie is er wél — die heeft geen klok nodig.
    expect(tl.blokken.map((b) => b.startMin)).toEqual([0, 15])
  })

  it('een blok zonder duur breekt de klok vanaf dat punt, in plaats van door te tellen alsof het 0 min duurt', () => {
    const tl = berekenTijdlijn([blok('a', 15), blok('b', null), blok('c', 20)], '19:00')
    expect(tl.blokken[0].startTijd).toBe('19:00')
    // Het onbekende blok begint nog wél op een bekend moment...
    expect(tl.blokken[1].startTijd).toBe('19:15')
    expect(tl.blokken[1].eindTijd).toBeNull()
    // ...maar alles daarna heeft geen betrouwbare tijd meer.
    expect(tl.blokken[2].startTijd).toBeNull()
    expect(tl.eindTijd).toBeNull()
    // Het totaal blijft eerlijk: 35 bekend, 1 blok onbekend.
    expect(tl.totaalMin).toBe(35)
    expect(tl.blokkenZonderDuur).toBe(1)
  })

  it('lege training: nul minuten, geen crash, eindtijd is de starttijd', () => {
    const tl = berekenTijdlijn([], '19:00')
    expect(tl).toMatchObject({ totaalMin: 0, blokkenZonderDuur: 0, eindTijd: '19:00' })
    expect(tl.blokken).toEqual([])
  })

  it('een sessie die over middernacht zou lopen levert geen misleidende tijd op', () => {
    const tl = berekenTijdlijn([blok('a', 90)], '23:00')
    expect(tl.blokken[0].startTijd).toBe('23:00')
    expect(tl.blokken[0].eindTijd).toBeNull()
    expect(tl.eindTijd).toBeNull()
  })

  it('de referentieduur is 90 minuten (bovengrens van 60-90 uit het onderzoek)', () => {
    expect(STANDAARD_SESSIEDUUR_MIN).toBe(90)
  })
})
