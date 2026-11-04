// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  begroetingScript,
  begroetingVoorUur,
  lokaalUur,
  GRENS_AVOND,
  GRENS_MIDDAG,
} from '@/lib/begroeting'

const LABELS = { morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond' }

describe('begroetingVoorUur', () => {
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('uur %i → %s', (uur, verwacht) => {
    expect(begroetingVoorUur(uur)).toBe(verwacht)
  })

  it('grenzen zijn 12 en 18', () => {
    expect(GRENS_MIDDAG).toBe(12)
    expect(GRENS_AVOND).toBe(18)
  })
})

describe('lokaalUur', () => {
  it('23:30 UTC is 00:30 in Amsterdam (wintertijd) → uur 0 → Goedemorgen', () => {
    const uur = lokaalUur(new Date('2026-11-04T23:30:00Z'), 'Europe/Amsterdam')
    expect(uur).toBe(0)
    expect(LABELS[begroetingVoorUur(uur)]).toBe('Goedemorgen')
  })

  it('zomertijd: 16:30 UTC is 18:30 in Amsterdam → avond', () => {
    expect(lokaalUur(new Date('2026-07-01T16:30:00Z'), 'Europe/Amsterdam')).toBe(18)
  })

  it('UTC middernacht → 0, niet 24', () => {
    expect(lokaalUur(new Date('2026-11-04T00:00:00Z'), 'UTC')).toBe(0)
  })

  it('zonder tijdzone → getHours() van de omgeving', () => {
    const d = new Date('2026-11-04T10:15:00Z')
    expect(lokaalUur(d)).toBe(d.getHours())
  })

  it('onbekende tijdzone gooit niet maar valt terug op getHours()', () => {
    const d = new Date('2026-11-04T10:15:00Z')
    expect(lokaalUur(d, 'Niet/Bestaand')).toBe(d.getHours())
  })
})

describe('begroetingScript', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  function voerUit(id: string, labels = LABELS) {
    new Function(begroetingScript(id, labels))()
  }

  it.each([
    [new Date(2026, 10, 4, 0, 30), 'Goedemorgen'],
    [new Date(2026, 10, 4, 11, 59), 'Goedemorgen'],
    [new Date(2026, 10, 4, 12, 0), 'Goedemiddag'],
    [new Date(2026, 10, 4, 17, 59), 'Goedemiddag'],
    [new Date(2026, 10, 4, 18, 0), 'Goedenavond'],
  ])('zet de tekst op de begroeting van het apparaatuur (%s)', (nu, verwacht) => {
    vi.useFakeTimers()
    vi.setSystemTime(nu)
    document.body.innerHTML = '<span id="b1">Goedenavond</span>'
    voerUit('b1')
    expect(document.getElementById('b1')!.textContent).toBe(verwacht)
    expect(verwacht).toBe(LABELS[begroetingVoorUur(new Date().getHours())])
  })

  it('doet niets (en gooit niet) als het element ontbreekt', () => {
    expect(() => voerUit('bestaat-niet')).not.toThrow()
  })

  it('escapet id en labels: geen </script> in de broncode, tekst blijft letterlijk', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0))
    const kwaad = { morning: '</script><b>"x"</b>', afternoon: 'a', evening: 'e' }
    const bron = begroetingScript('id"1', kwaad)
    expect(bron).not.toContain('</script>')
    document.body.innerHTML = '<span></span>'
    document.querySelector('span')!.id = 'id"1'
    new Function(bron)()
    expect(document.getElementById('id"1')!.textContent).toBe('</script><b>"x"</b>')
  })

  it('React useId-achtige ids met dubbele punten werken', () => {
    document.body.innerHTML = '<span id=":r1:">x</span>'
    voerUit(':r1:')
    expect(LABELS).toHaveProperty([begroetingVoorUur(new Date().getHours())], document.getElementById(':r1:')!.textContent)
  })
})
