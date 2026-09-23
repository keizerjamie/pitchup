import { describe, it, expect } from 'vitest'
import { teltMee, telAanwezigheid, splitsAanwezigheid } from '@/lib/aanwezigheid-telling'
import type { TelbareSpeler } from '@/lib/aanwezigheid-telling'
import type { AttendanceStatus, PlayerType } from '@/lib/types'

// Pure weergave-regel: geen mocks, geen Supabase, geen datums. De volledige
// matrix van spelertype × status staat hieronder — één assert per cel — plus
// het rekenvoorbeeld van de eigenaar en de noemer-0-randen waar het percentage
// null hoort te zijn en nooit 0.

interface Speler extends TelbareSpeler {
  status: AttendanceStatus
}

function speler(id: string, type: PlayerType, status: AttendanceStatus): Speler {
  return { id, type, status }
}

const statusVan = (p: Speler) => p.status
const isAanwezig = (p: Speler) => p.status === 'present'

// Handige lege telling om per cel alleen de afwijkingen te hoeven benoemen.
const NUL = {
  aanwezig: 0,
  afwezig: 0,
  onbekend: 0,
  meetellend: 0,
  gastenAanwezig: 0,
  vastAanwezig: 0,
  vastAfwezig: 0,
  opkomstPercentage: null,
}

describe('teltMee — de regel zelf', () => {
  it('een vaste speler telt altijd mee, aanwezig of niet', () => {
    expect(teltMee('regular', true)).toBe(true)
    expect(teltMee('regular', false)).toBe(true)
  })

  it('een gast telt alleen mee als hij aanwezig is', () => {
    expect(teltMee('guest', true)).toBe(true)
    expect(teltMee('guest', false)).toBe(false)
  })
})

describe('telAanwezigheid — matrix spelertype × status', () => {
  it('(a) regular + present → aanwezig, teller én noemer van de opkomst', () => {
    expect(telAanwezigheid([speler('p1', 'regular', 'present')], statusVan)).toEqual({
      ...NUL,
      aanwezig: 1,
      meetellend: 1,
      vastAanwezig: 1,
      opkomstPercentage: 100,
    })
  })

  it('(b) regular + absent → afwezig, alleen de noemer van de opkomst', () => {
    expect(telAanwezigheid([speler('p1', 'regular', 'absent')], statusVan)).toEqual({
      ...NUL,
      afwezig: 1,
      meetellend: 1,
      vastAfwezig: 1,
      opkomstPercentage: 0,
    })
  })

  it('(c) regular + unknown → onbekend, en buiten de opkomst-noemer (null)', () => {
    expect(telAanwezigheid([speler('p1', 'regular', 'unknown')], statusVan)).toEqual({
      ...NUL,
      onbekend: 1,
      meetellend: 1,
      opkomstPercentage: null,
    })
  })

  it('(d) guest + present → wél aanwezig, maar NIET in de opkomst-noemer', () => {
    expect(telAanwezigheid([speler('g1', 'guest', 'present')], statusVan)).toEqual({
      ...NUL,
      aanwezig: 1,
      meetellend: 1,
      gastenAanwezig: 1,
      opkomstPercentage: null,
    })
  })

  it('(e) guest + absent → nergens: niet afwezig, niet onbekend, geen noemer', () => {
    expect(telAanwezigheid([speler('g1', 'guest', 'absent')], statusVan)).toEqual(NUL)
  })

  it('(f) guest + unknown → nergens: niet afwezig, niet onbekend, geen noemer', () => {
    expect(telAanwezigheid([speler('g1', 'guest', 'unknown')], statusVan)).toEqual(NUL)
  })
})

describe('telAanwezigheid — het voorbeeld van de eigenaar', () => {
  // 20 vaste spelers (15 aanwezig, 5 afwezig) + 6 gasten allemaal op present:
  // het percentage toont 75% (15/20), niet 81% (21/26).
  const spelers: Speler[] = [
    ...Array.from({ length: 15 }, (_, i) => speler(`v-aanwezig-${i}`, 'regular', 'present')),
    ...Array.from({ length: 5 }, (_, i) => speler(`v-afwezig-${i}`, 'regular', 'absent')),
    ...Array.from({ length: 6 }, (_, i) => speler(`g-${i}`, 'guest', 'present')),
  ]

  it('telt 21 aanwezig, 5 afwezig, 0 onbekend en 75% opkomst', () => {
    expect(telAanwezigheid(spelers, statusVan)).toEqual({
      aanwezig: 21,
      afwezig: 5,
      onbekend: 0,
      meetellend: 26,
      gastenAanwezig: 6,
      vastAanwezig: 15,
      vastAfwezig: 5,
      opkomstPercentage: 75,
    })
  })

  it('met dezelfde 6 gasten op absent verdwijnen zij volledig uit de telling', () => {
    const metAfwezigeGasten = spelers.map((p) =>
      p.type === 'guest' ? { ...p, status: 'absent' as AttendanceStatus } : p,
    )
    expect(telAanwezigheid(metAfwezigeGasten, statusVan)).toEqual({
      aanwezig: 15,
      afwezig: 5,
      onbekend: 0,
      meetellend: 20,
      gastenAanwezig: 0,
      vastAanwezig: 15,
      vastAfwezig: 5,
      opkomstPercentage: 75,
    })
  })
})

describe('telAanwezigheid — randgevallen met noemer 0', () => {
  it('uitsluitend gasten → opkomstPercentage null, nooit 0', () => {
    const telling = telAanwezigheid(
      [
        speler('g1', 'guest', 'present'),
        speler('g2', 'guest', 'absent'),
        speler('g3', 'guest', 'unknown'),
      ],
      statusVan,
    )
    expect(telling.opkomstPercentage).toBeNull()
    expect(telling.aanwezig).toBe(1)
    expect(telling.gastenAanwezig).toBe(1)
    expect(telling.afwezig).toBe(0)
    expect(telling.onbekend).toBe(0)
    expect(telling.meetellend).toBe(1)
  })

  it('lege spelerslijst → alle nullen en opkomstPercentage null', () => {
    expect(telAanwezigheid([], statusVan)).toEqual(NUL)
  })

  it('alleen vaste spelers met unknown → opkomstPercentage null, nooit 0', () => {
    const telling = telAanwezigheid(
      [speler('p1', 'regular', 'unknown'), speler('p2', 'regular', 'unknown')],
      statusVan,
    )
    expect(telling.opkomstPercentage).toBeNull()
    expect(telling.onbekend).toBe(2)
    expect(telling.meetellend).toBe(2)
  })
})

describe('splitsAanwezigheid', () => {
  it('zet een aanwezige gast bij de aanwezigen en laat een afwezige gast weg', () => {
    const spelers = [
      speler('v1', 'regular', 'present'),
      speler('v2', 'regular', 'absent'),
      speler('g1', 'guest', 'present'),
      speler('g2', 'guest', 'absent'),
    ]
    const { aanwezig, afwezig } = splitsAanwezigheid(spelers, isAanwezig)
    expect(aanwezig.map((p) => p.id)).toEqual(['v1', 'g1'])
    expect(afwezig.map((p) => p.id)).toEqual(['v2'])
  })

  it('rekent een vaste speler met unknown bij de afwezigen, een gast met unknown nergens', () => {
    const spelers = [speler('v1', 'regular', 'unknown'), speler('g1', 'guest', 'unknown')]
    const { aanwezig, afwezig } = splitsAanwezigheid(spelers, isAanwezig)
    expect(aanwezig).toEqual([])
    expect(afwezig.map((p) => p.id)).toEqual(['v1'])
  })

  it('behoudt de invoervolgorde en muteert de invoer niet', () => {
    const spelers = [
      speler('v3', 'regular', 'absent'),
      speler('v1', 'regular', 'present'),
      speler('g1', 'guest', 'absent'),
      speler('v2', 'regular', 'present'),
      speler('v4', 'regular', 'unknown'),
    ]
    const kopie = spelers.map((p) => ({ ...p }))
    const { aanwezig, afwezig } = splitsAanwezigheid(spelers, isAanwezig)
    expect(aanwezig.map((p) => p.id)).toEqual(['v1', 'v2'])
    expect(afwezig.map((p) => p.id)).toEqual(['v3', 'v4'])
    expect(spelers).toEqual(kopie)
    expect(spelers).toHaveLength(5)
  })

  it('lege invoer → twee lege lijsten', () => {
    expect(splitsAanwezigheid([], isAanwezig)).toEqual({ aanwezig: [], afwezig: [] })
  })
})
