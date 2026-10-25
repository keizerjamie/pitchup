import { describe, it, expect } from 'vitest'
import { bouwDoelPad, isTijdzone, parsePdfParams, STANDAARD_TIJDZONE } from '@/lib/pdf/doelen'

const EVENT = '22222222-2222-4222-8222-222222222222'

function parse(query: string) {
  return parsePdfParams(new URLSearchParams(query))
}

describe('bouwDoelPad', () => {
  it('trainingsplan', () => {
    expect(bouwDoelPad({ doel: 'trainingsplan', eventId: EVENT })).toBe(`/events/${EVENT}/training-plan`)
  })

  it('selectie', () => {
    expect(bouwDoelPad({ doel: 'selectie', eventId: EVENT })).toBe(`/events/${EVENT}/squad`)
  })

  it('aanwezigheid', () => {
    expect(bouwDoelPad({ doel: 'aanwezigheid', periode: '4w' })).toBe('/players?weergave=aanwezigheid&periode=4w')
  })

  it('inzichten', () => {
    expect(bouwDoelPad({ doel: 'inzichten', periode: '8w' })).toBe('/inzichten?periode=8w')
  })
})

describe('parsePdfParams', () => {
  it('trainingsplan en selectie met geldige uuid', () => {
    expect(parse(`doel=trainingsplan&id=${EVENT}`)).toEqual({
      doel: { doel: 'trainingsplan', eventId: EVENT },
      tz: STANDAARD_TIJDZONE,
    })
    expect(parse(`doel=selectie&id=${EVENT}&tz=Europe%2FLondon`)).toEqual({
      doel: { doel: 'selectie', eventId: EVENT },
      tz: 'Europe/London',
    })
  })

  it('ontbrekende periode valt terug op seizoen', () => {
    expect(parse('doel=aanwezigheid')?.doel).toEqual({ doel: 'aanwezigheid', periode: 'seizoen' })
    expect(parse('doel=inzichten')?.doel).toEqual({ doel: 'inzichten', periode: 'seizoen' })
  })

  it('geldige periode blijft behouden', () => {
    expect(parse('doel=inzichten&periode=4w')?.doel).toEqual({ doel: 'inzichten', periode: '4w' })
  })

  it('negeert onbekende extra parameters', () => {
    expect(parse('doel=inzichten&utm=x')).not.toBeNull()
  })

  it.each([
    '',
    'doel=onbekend',
    'doel=trainingsplan',
    'doel=trainingsplan&id=niet-een-uuid',
    `doel=trainingsplan&id=${EVENT}x`,
    `doel=selectie&id=${EVENT}&periode=seizoen`,
    `doel=aanwezigheid&id=${EVENT}`,
    'doel=inzichten&periode=',
    'doel=inzichten&periode=jaar',
    'doel=inzichten&tz=',
    'doel=inzichten&tz=Niet%2FBestaand',
    // Geen pad-injectie via id: uuid-vormcheck houdt dit tegen.
    'doel=trainingsplan&id=..%2F..%2Fsettings',
  ])('ongeldig: %s', (query) => {
    expect(parse(query)).toBeNull()
  })
})

describe('isTijdzone', () => {
  it.each(['Europe/Amsterdam', 'America/New_York', 'UTC', 'Asia/Kolkata'])('geldig: %s', (zone) => {
    expect(isTijdzone(zone)).toBe(true)
  })

  it.each(['', 'Mars/Olympus', 'x'.repeat(65), 42, null])('ongeldig: %s', (zone) => {
    expect(isTijdzone(zone)).toBe(false)
  })
})
