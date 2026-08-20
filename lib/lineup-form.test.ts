import { describe, it, expect } from 'vitest'
import {
  blendPlayerForm,
  buildPlayerForms,
  emptyPlayerForm,
  isGeldigeRating,
  ANKER_FALLBACK,
  TREND_DREMPEL,
  VORM_MAX_GEWICHT,
  VORM_VENSTER,
} from '@/lib/lineup-form'
import type { FormMatchRow, FormPlayerRow, FormRatingRow } from '@/lib/lineup-form'

// Fixtures als kleine factory's met sane defaults + Partial<>-overrides —
// patroon van lib/match-form.test.ts en lib/season-dates.test.ts.
const speler = (over: Partial<FormPlayerRow> = {}): FormPlayerRow => ({
  id: 'p1',
  rating: 7,
  ...over,
})

const wedstrijd = (over: Partial<FormMatchRow> = {}): FormMatchRow => ({
  id: 'e1',
  date: '2026-08-01',
  created_at: '2026-07-20T10:00:00+00:00',
  ...over,
})

const beoordeling = (over: Partial<FormRatingRow> = {}): FormRatingRow => ({
  event_id: 'e1',
  player_id: 'p1',
  rating: 7,
  ...over,
})

// Bouwt N wedstrijden vóór de peildatum, recent-eerst: index 0 = meest recent.
// Datums lopen af vanaf 2026-07-31, zodat de sortering in buildPlayerForms
// dezelfde volgorde oplevert als de invoervolgorde hier.
const reeks = (ratings: (number | null)[], playerId = 'p1') => {
  const matches: FormMatchRow[] = []
  const rows: FormRatingRow[] = []
  ratings.forEach((rating, i) => {
    const dag = 31 - i
    const id = `e${i + 1}`
    matches.push(wedstrijd({ id, date: `2026-07-${String(dag).padStart(2, '0')}` }))
    if (rating !== null) rows.push(beoordeling({ event_id: id, player_id: playerId, rating }))
  })
  return { matches, ratings: rows }
}

const gewogen = (ratings: number[]) => {
  let som = 0
  let gewicht = 0
  ratings.forEach((r, i) => {
    const w = VORM_VENSTER - i
    som += w * r
    gewicht += w
  })
  return som / gewicht
}

// isGeldigeRating is publiek contract sinds de weergavelaag hem deelt met de
// berekening (lib/lineup-form.ts). Daarom hier DIRECT vastgelegd en niet meer
// alleen indirect via blendPlayerForm/buildPlayerForms.
describe('isGeldigeRating — publiek contract', () => {
  it('accepteert elk getal binnen de schaal 1..10, inclusief de randen', () => {
    expect(isGeldigeRating(1)).toBe(true)
    expect(isGeldigeRating(10)).toBe(true)
    expect(isGeldigeRating(5)).toBe(true)
    expect(isGeldigeRating(7.4)).toBe(true)
  })

  it('wijst null, NaN, 0, 11 en een niet-numerieke waarde af', () => {
    expect(isGeldigeRating(null)).toBe(false)
    expect(isGeldigeRating(NaN)).toBe(false)
    expect(isGeldigeRating(0)).toBe(false)
    expect(isGeldigeRating(11)).toBe(false)
    expect(isGeldigeRating('7')).toBe(false)
  })

  it('wijst ook undefined en niet-eindige getallen af', () => {
    expect(isGeldigeRating(undefined)).toBe(false)
    expect(isGeldigeRating(Infinity)).toBe(false)
    expect(isGeldigeRating(-Infinity)).toBe(false)
  })

  it('hanteert dezelfde regel als het anker in blendPlayerForm', () => {
    // Wat het predicaat afwijst, valt in de berekening terug op ANKER_FALLBACK;
    // wat het accepteert, wordt als anker gebruikt. Dat is precies de regel die
    // de weergavelaag mag hergebruiken.
    const gevallen = [null, NaN, 0, 11, '7' as unknown as number, 1, 5, 10]
    for (const waarde of gevallen) {
      const quality = blendPlayerForm(waarde as number | null, []).quality
      expect(quality).toBe(isGeldigeRating(waarde) ? waarde : ANKER_FALLBACK)
    }
  })

  it('versmalt het type naar number', () => {
    const waarde: number | null = 8
    if (isGeldigeRating(waarde)) {
      // Type-niveau: `waarde` is hier number, dus toFixed() compileert.
      expect(waarde.toFixed(1)).toBe('8.0')
    } else {
      throw new Error('8 hoort geldig te zijn')
    }
  })
})

describe('blendPlayerForm — succes', () => {
  it('rekent het voorbeeld uit de brief exact na (anker 7, [8,7,8,7,7])', () => {
    // Σ(w·r) = 40+28+24+14+7 = 113, Σw = 15 → vorm = 7,5333…
    // quality = 0,3·7 + 0,7·7,5333… = 7,3733…
    const vorm = blendPlayerForm(7, [8, 7, 8, 7, 7])
    expect(vorm.quality).toBeCloseTo(7.3733, 4)
    expect(vorm.count).toBe(5)
  })

  it('rekent het X=3-voorbeeld uit de brief na (anker 6, [8,6,5] → 6,245)', () => {
    const vorm = blendPlayerForm(6, [8, 6, 5])
    expect(vorm.quality).toBeCloseTo(6.245, 6)
    expect(vorm.count).toBe(3)
  })

  it('geeft bij X=0 exact het anker terug, count 0 en trend none', () => {
    expect(blendPlayerForm(8, [])).toEqual({ quality: 8, count: 0, trend: 'none' })
  })

  it('weegt bij X=5 het anker voor 0,3 en de vorm voor 0,7', () => {
    const ratings = [9, 8, 6, 7, 5]
    const vorm = gewogen(ratings)
    // Los uitgerekend: (45+32+18+14+5)/15 = 114/15 = 7,6
    expect(vorm).toBeCloseTo(7.6, 10)
    expect(blendPlayerForm(4, ratings).quality).toBeCloseTo(0.3 * 4 + 0.7 * 7.6, 10)
  })

  it('schuift quality monotoon van het anker naar de vorm als X van 0 naar 5 loopt', () => {
    const anker = 4
    const alle = [9, 9, 9, 9, 9]
    const reeksKwaliteit = [0, 1, 2, 3, 4, 5].map(
      (x) => blendPlayerForm(anker, alle.slice(0, x)).quality
    )
    expect(reeksKwaliteit[0]).toBe(anker)
    for (let i = 1; i < reeksKwaliteit.length; i++) {
      expect(reeksKwaliteit[i]).toBeGreaterThan(reeksKwaliteit[i - 1])
    }
    // Eindpunt: 0,3·4 + 0,7·9 = 7,5
    expect(reeksKwaliteit[5]).toBeCloseTo(7.5, 10)
    // En het vormgewicht bij X=5 is echt VORM_MAX_GEWICHT.
    expect((VORM_VENSTER / VORM_VENSTER) * VORM_MAX_GEWICHT).toBe(VORM_MAX_GEWICHT)
  })

  it('laat de volgorde van dezelfde cijfers meetellen (recentheidsweging)', () => {
    const oplopend = blendPlayerForm(7, [5, 6, 7, 8, 9]).quality
    const aflopend = blendPlayerForm(7, [9, 8, 7, 6, 5]).quality
    expect(oplopend).not.toBeCloseTo(aflopend, 6)
    expect(blendPlayerForm(7, [10, 1, 1, 1, 1]).quality).toBeGreaterThan(
      blendPlayerForm(7, [1, 1, 1, 1, 10]).quality
    )
  })

  it('negeert alles voorbij VORM_VENSTER', () => {
    const eersteVijf = blendPlayerForm(7, [8, 7, 8, 7, 7])
    const metStaart = blendPlayerForm(7, [8, 7, 8, 7, 7, 1, 1, 10])
    expect(metStaart).toEqual(eersteVijf)
  })
})

describe('blendPlayerForm — trend', () => {
  it('geeft none zolang X < 3', () => {
    expect(blendPlayerForm(7, []).trend).toBe('none')
    expect(blendPlayerForm(7, [9]).trend).toBe('none')
    expect(blendPlayerForm(7, [9, 9]).trend).toBe('none')
    expect(blendPlayerForm(7, [9]).count).toBe(1)
    expect(blendPlayerForm(7, [9, 9]).count).toBe(2)
  })

  it('geeft up als het recente blok meer dan de drempel hoger ligt', () => {
    expect(blendPlayerForm(7, [9, 9, 6, 6, 6]).trend).toBe('up')
  })

  it('geeft down als het recente blok meer dan de drempel lager ligt', () => {
    expect(blendPlayerForm(7, [6, 6, 9, 9, 9]).trend).toBe('down')
  })

  it('houdt een verschil van exact ±TREND_DREMPEL flat', () => {
    expect(TREND_DREMPEL).toBe(0.5)
    // recent (8+7)/2 = 7,5 vs ouder 7 → +0,5
    expect(blendPlayerForm(7, [8, 7, 7]).trend).toBe('flat')
    // recent (7+6)/2 = 6,5 vs ouder 7 → -0,5
    expect(blendPlayerForm(7, [7, 6, 7]).trend).toBe('flat')
  })

  it('slaat bij ±0,6 wél om', () => {
    // recent 8 vs ouder 7,4 → +0,6
    expect(blendPlayerForm(7, [8, 8, 7.4]).trend).toBe('up')
    // recent 7,4 vs ouder 8 → -0,6
    expect(blendPlayerForm(7, [7.4, 7.4, 8]).trend).toBe('down')
  })

  it('vergelijkt het oudere blok ONgewogen (gemiddelde van r3..rX)', () => {
    // recent 8, ouder (6+6+10)/3 = 7,3333 → +0,6667 → up.
    expect(blendPlayerForm(7, [8, 8, 6, 6, 10]).trend).toBe('up')
    // Zelfde cijfers, maar de 10 vooraan in het oudere blok verandert niets aan
    // de trend — het blok telt gelijkwaardig.
    expect(blendPlayerForm(7, [8, 8, 10, 6, 6]).trend).toBe('up')
  })
})

describe('blendPlayerForm — falen', () => {
  it('valt terug op ANKER_FALLBACK als rating null is (X=0)', () => {
    expect(ANKER_FALLBACK).toBe(5)
    expect(blendPlayerForm(null, [])).toEqual({ quality: 5, count: 0, trend: 'none' })
    expect(emptyPlayerForm(null)).toEqual(blendPlayerForm(null, []))
  })

  it('valt terug op ANKER_FALLBACK als rating null is (X=5)', () => {
    const ratings = [8, 7, 8, 7, 7]
    expect(blendPlayerForm(null, ratings).quality).toBeCloseTo(
      0.3 * ANKER_FALLBACK + 0.7 * gewogen(ratings),
      10
    )
  })

  it('behandelt een anker buiten 1..10 of niet-numeriek als ontbrekend', () => {
    expect(blendPlayerForm(0, []).quality).toBe(ANKER_FALLBACK)
    expect(blendPlayerForm(11, []).quality).toBe(ANKER_FALLBACK)
    expect(blendPlayerForm(NaN, []).quality).toBe(ANKER_FALLBACK)
    expect(blendPlayerForm('7' as unknown as number, []).quality).toBe(ANKER_FALLBACK)
  })

  it('gooit ongeldige ratings weg in plaats van ze als 0 te tellen', () => {
    const vies = [null, NaN, 0, 11, '8', undefined] as unknown as number[]
    const vorm = blendPlayerForm(7, [8, ...vies, 7])
    expect(vorm.count).toBe(2)
    expect(vorm.quality).toBeCloseTo(blendPlayerForm(7, [8, 7]).quality, 10)
    expect(Number.isFinite(vorm.quality)).toBe(true)
  })
})

describe('emptyPlayerForm', () => {
  it('is identiek aan blendPlayerForm(anchor, [])', () => {
    expect(emptyPlayerForm(9)).toEqual(blendPlayerForm(9, []))
    expect(emptyPlayerForm(9)).toEqual({ quality: 9, count: 0, trend: 'none' })
  })
})

describe('buildPlayerForms — venster en volgorde', () => {
  it('rekent de vorm per speler uit met de recentste wedstrijd als r1', () => {
    const { matches, ratings } = reeks([8, 7, 8, 7, 7])
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(5)
    expect(forms.p1.quality).toBeCloseTo(7.3733, 4)
  })

  it('telt alleen de VORM_VENSTER recentste beoordeelde wedstrijden', () => {
    const { matches, ratings } = reeks([8, 7, 8, 7, 7, 1, 1, 10])
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(VORM_VENSTER)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [8, 7, 8, 7, 7]).quality, 10)
  })

  it('sluit een wedstrijd op exact de peildatum uit en telt de dag ervoor wél mee', () => {
    const matches = [
      wedstrijd({ id: 'zelfde-dag', date: '2026-08-01' }),
      wedstrijd({ id: 'dag-ervoor', date: '2026-07-31' }),
    ]
    const ratings = [
      beoordeling({ event_id: 'zelfde-dag', rating: 10 }),
      beoordeling({ event_id: 'dag-ervoor', rating: 9 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(1)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
  })

  it('breekt gelijke datums op created_at desc, met null achteraan', () => {
    const matches = [
      wedstrijd({ id: 'oud', date: '2026-07-31', created_at: '2026-07-31T08:00:00+00:00' }),
      wedstrijd({ id: 'nieuw', date: '2026-07-31', created_at: '2026-07-31T20:00:00+00:00' }),
      wedstrijd({ id: 'zonder', date: '2026-07-31', created_at: null }),
    ]
    const ratings = [
      beoordeling({ event_id: 'oud', rating: 5 }),
      beoordeling({ event_id: 'nieuw', rating: 9 }),
      beoordeling({ event_id: 'zonder', rating: 1 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    // Verwachte volgorde: nieuw (9) → oud (5) → zonder created_at (1).
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [9, 5, 1]).quality, 10)
  })

  it('breekt gelijke datum én created_at op id desc', () => {
    const created = '2026-07-31T08:00:00+00:00'
    const matches = [
      wedstrijd({ id: 'e-a', date: '2026-07-31', created_at: created }),
      wedstrijd({ id: 'e-b', date: '2026-07-31', created_at: created }),
    ]
    const ratings = [
      beoordeling({ event_id: 'e-a', rating: 4 }),
      beoordeling({ event_id: 'e-b', rating: 10 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    // id desc → e-b eerst.
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [10, 4]).quality, 10)
  })
})

describe('buildPlayerForms — falen', () => {
  it('laat een onbeoordeelde wedstrijd het venster doorschuiven in plaats van 0 te tellen', () => {
    // Wedstrijd 2 en 4 zijn niet beoordeeld; het venster pakt door tot en met 7.
    const { matches, ratings } = reeks([8, null, 7, null, 6, 9, 9])
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(5)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [8, 7, 6, 9, 9]).quality, 10)
    // Een 0 zou de kwaliteit ver onder het anker trekken; dat mag nooit.
    expect(forms.p1.quality).toBeGreaterThan(7)
  })

  it('behandelt null, NaN, 0, 11 en een string als niet beoordeeld', () => {
    const matches = [
      wedstrijd({ id: 'a', date: '2026-07-31' }),
      wedstrijd({ id: 'b', date: '2026-07-30' }),
      wedstrijd({ id: 'c', date: '2026-07-29' }),
      wedstrijd({ id: 'd', date: '2026-07-28' }),
      wedstrijd({ id: 'e', date: '2026-07-27' }),
      wedstrijd({ id: 'f', date: '2026-07-26' }),
    ]
    const ratings = [
      beoordeling({ event_id: 'a', rating: null }),
      beoordeling({ event_id: 'b', rating: NaN }),
      beoordeling({ event_id: 'c', rating: 0 }),
      beoordeling({ event_id: 'd', rating: 11 }),
      beoordeling({ event_id: 'e', rating: '8' as unknown as number }),
      beoordeling({ event_id: 'f', rating: 9 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(1)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
  })

  it('slaat wedstrijden met een ongeldige datum over zonder te crashen', () => {
    const matches = [
      wedstrijd({ id: 'bestaat-niet', date: '2026-02-30' }),
      wedstrijd({ id: 'leeg', date: '' }),
      wedstrijd({ id: 'undef', date: undefined as unknown as string }),
      wedstrijd({ id: 'goed', date: '2026-07-31' }),
    ]
    const ratings = [
      beoordeling({ event_id: 'bestaat-niet', rating: 1 }),
      beoordeling({ event_id: 'leeg', rating: 1 }),
      beoordeling({ event_id: 'undef', rating: 1 }),
      beoordeling({ event_id: 'goed', rating: 9 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(1)
    expect(Number.isNaN(forms.p1.quality)).toBe(false)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
  })

  it('geeft bij een ongeldige peildatum iedereen de lege vorm', () => {
    const { matches, ratings } = reeks([9, 9, 9])
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '' })
    expect(forms.p1).toEqual(emptyPlayerForm(7))
  })

  it('geeft bij lege matches/ratings elke speler emptyPlayerForm(anker)', () => {
    const forms = buildPlayerForms({
      players: [speler({ id: 'p1', rating: 8 }), speler({ id: 'p2', rating: null })],
      matches: [],
      ratings: [],
      before: '2026-08-01',
    })
    expect(forms.p1).toEqual(emptyPlayerForm(8))
    expect(forms.p2).toEqual(emptyPlayerForm(null))
  })
})

// De sleutel (event, speler) in ratingSleutel wordt gescheiden door U+0000.
// Die scheider is geen detail: hij is de reden dat twee verschillende paren
// nooit dezelfde sleutel kunnen krijgen. De ids hieronder zijn bewust GEEN
// UUID's maar bevatten spaties — precies de vorm waarop een naïeve
// scheider
// stukloopt. Zo faalt een "opschoning" naar spatie/'-'/':' zichtbaar in plaats
// van stil de beoordeling van de ene speler aan de andere te geven.
describe('ratingSleutel — scheider tussen event en speler', () => {
  it('houdt het paar (e1 p, 1) uit elkaar van het paar (e1, p 1)', () => {
    // Met een spatie als scheider geven beide paren 'e1 p 1'. Speler 'p 1'
    // zou dan bij event 'e1' de 9 van speler '1' bij event 'e1 p' oppikken.
    const forms = buildPlayerForms({
      players: [speler({ id: '1', rating: 7 }), speler({ id: 'p 1', rating: 7 })],
      matches: [
        wedstrijd({ id: 'e1 p', date: '2026-07-31' }),
        wedstrijd({ id: 'e1', date: '2026-07-30' }),
      ],
      ratings: [beoordeling({ event_id: 'e1 p', player_id: '1', rating: 9 })],
      before: '2026-08-01',
    })
    expect(forms['1'].count).toBe(1)
    expect(forms['1'].quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
    // De kern: speler 'p 1' heeft geen enkele beoordeling en hoort er ook geen
    // te erven. Bij een botsende scheider is dit count 1.
    expect(forms['p 1'].count).toBe(0)
    expect(forms['p 1']).toEqual(emptyPlayerForm(7))
  })

  it('houdt twee botsende paren met elk een eigen cijfer uit elkaar', () => {
    // Met een spatie als scheider zouden beide rijen op sleutel 'e1 p 1'
    // landen: de tweede wordt dan als "dubbele rij" weggegooid en speler
    // 'p 1' krijgt de 9 van de ander in plaats van zijn eigen 2.
    const forms = buildPlayerForms({
      players: [speler({ id: '1', rating: 7 }), speler({ id: 'p 1', rating: 7 })],
      matches: [
        wedstrijd({ id: 'e1 p', date: '2026-07-31' }),
        wedstrijd({ id: 'e1', date: '2026-07-30' }),
      ],
      ratings: [
        beoordeling({ event_id: 'e1 p', player_id: '1', rating: 9 }),
        beoordeling({ event_id: 'e1', player_id: 'p 1', rating: 2 }),
      ],
      before: '2026-08-01',
    })
    expect(forms['1'].quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
    expect(forms['p 1'].quality).toBeCloseTo(blendPlayerForm(7, [2]).quality, 10)
    // Expliciet: 'p 1' heeft NIET de 9 van de ander geerfd.
    expect(forms['p 1'].quality).not.toBeCloseTo(blendPlayerForm(7, [9]).quality, 6)
  })

  it('gebruikt het echte teken U+0000, niet de zes tekens \\u0000', () => {
    // Zou de escape per ongeluk dubbel ontsnapt raken, dan is de scheider de
    // TEKST '\u0000'. Deze twee paren botsen dan wel ('a' + '\u0000' +
    // '\u0000b' is dezelfde string als 'a\u0000' + '\u0000' + 'b'), met het
    // echte stuurteken niet.
    const forms = buildPlayerForms({
      players: [speler({ id: 'b', rating: 7 }), speler({ id: '\\u0000b', rating: 7 })],
      matches: [
        wedstrijd({ id: 'a\\u0000', date: '2026-07-31' }),
        wedstrijd({ id: 'a', date: '2026-07-30' }),
      ],
      ratings: [beoordeling({ event_id: 'a\\u0000', player_id: 'b', rating: 9 })],
      before: '2026-08-01',
    })
    expect(forms['b'].count).toBe(1)
    expect(forms['\\u0000b'].count).toBe(0)
  })
})

// Bronbestand-bewaking. De scheider hierboven MOET als escape in de bron staan
// en niet als kale 0x00-byte: met een echte NUL erin ziet `file` het bestand
// als 'data' en slaat een gewone `grep` het zonder waarschuwing over, waardoor
// de module onvindbaar wordt bij elke repo-brede zoekopdracht. Dit is precies
// zo misgegaan; deze test houdt het tegen.
describe('lib/lineup-form.ts — bronrepresentatie', () => {
  it('bevat geen letterlijke NUL-byte', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    // Pad vanaf de projectroot: onder jsdom is import.meta.url geen file-URL.
    const bron = readFileSync(resolve(process.cwd(), 'lib/lineup-form.ts'))
    expect(bron.includes(0x00)).toBe(false)
    // En de escape staat er wel echt in.
    expect(bron.toString('utf8')).toContain('${eventId}\\u0000${playerId}')
  })
})

describe('buildPlayerForms — edge', () => {
  it('negeert een rating-rij met een onbekende player_id', () => {
    const { matches } = reeks([9])
    const ratings = [beoordeling({ event_id: 'e1', player_id: 'vreemde-speler', rating: 1 })]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(Object.keys(forms)).toEqual(['p1'])
    expect(forms.p1).toEqual(emptyPlayerForm(7))
  })

  it('negeert een rating-rij met een onbekende event_id (tenant-defensie)', () => {
    const { matches } = reeks([9])
    const ratings = [beoordeling({ event_id: 'event-van-ander-team', rating: 1 })]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1).toEqual(emptyPlayerForm(7))
    expect(forms.p1.count).toBe(0)
  })

  it('geeft een speler zonder beoordelingen count 0 en trend none', () => {
    const { matches, ratings } = reeks([8, 7, 9])
    const forms = buildPlayerForms({
      players: [speler(), speler({ id: 'p2', rating: 6 })],
      matches,
      ratings,
      before: '2026-08-01',
    })
    expect(forms.p2).toEqual({ quality: 6, count: 0, trend: 'none' })
    expect(forms.p1.count).toBe(3)
  })

  it('telt een dubbele rij voor hetzelfde (event, speler) maar één keer — eerste wint', () => {
    const { matches } = reeks([9])
    const ratings = [
      beoordeling({ event_id: 'e1', rating: 9 }),
      beoordeling({ event_id: 'e1', rating: 1 }),
    ]
    const forms = buildPlayerForms({ players: [speler()], matches, ratings, before: '2026-08-01' })
    expect(forms.p1.count).toBe(1)
    expect(forms.p1.quality).toBeCloseTo(blendPlayerForm(7, [9]).quality, 10)
  })

  it('muteert zijn invoer niet', () => {
    const players = [speler(), speler({ id: 'p2', rating: null })]
    const { matches, ratings } = reeks([8, 7, 9, 6, 5, 4])
    const playersKopie = structuredClone(players)
    const matchesKopie = structuredClone(matches)
    const ratingsKopie = structuredClone(ratings)

    buildPlayerForms({ players, matches, ratings, before: '2026-08-01' })

    expect(players).toEqual(playersKopie)
    expect(matches).toEqual(matchesKopie)
    expect(ratings).toEqual(ratingsKopie)
  })
})
