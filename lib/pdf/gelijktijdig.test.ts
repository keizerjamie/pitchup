import { describe, it, expect } from 'vitest'
import { maakSlotTeller, MAX_GELIJKTIJDIGE_RENDERS, renderSlots } from '@/lib/pdf/gelijktijdig'

describe('maakSlotTeller', () => {
  it('geeft precies `max` plekken uit en weigert daarna', () => {
    const teller = maakSlotTeller(2)
    const a = teller.probeer()
    const b = teller.probeer()

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(teller.probeer()).toBeNull()
    expect(teller.actief()).toBe(2)
  })

  it('vrijgeven maakt een plek vrij', () => {
    const teller = maakSlotTeller(1)
    const vrij = teller.probeer()!

    vrij()

    expect(teller.actief()).toBe(0)
    expect(teller.probeer()).not.toBeNull()
  })

  it('dubbel vrijgeven telt maar één keer (teller nooit onder nul)', () => {
    const teller = maakSlotTeller(2)
    const vrij = teller.probeer()!
    teller.probeer()

    vrij()
    vrij()

    expect(teller.actief()).toBe(1)
  })
})

describe('renderSlots', () => {
  it('is begrensd op 2 (besluit 2026-10-25)', () => {
    expect(MAX_GELIJKTIJDIGE_RENDERS).toBe(2)
    const vrij = [renderSlots.probeer(), renderSlots.probeer()]
    expect(renderSlots.probeer()).toBeNull()
    vrij.forEach((v) => v?.())
    expect(renderSlots.actief()).toBe(0)
  })
})
