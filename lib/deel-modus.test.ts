import { describe, it, expect } from 'vitest'
import { bepaalDeelModus } from '@/lib/deel-modus'

describe('bepaalDeelModus', () => {
  const rijen: [boolean, boolean, boolean, string][] = [
    // [beginscherm-app, touch, kanBestandDelen, verwacht]
    [false, false, false, 'afdrukken'],
    [false, false, true, 'afdrukken'], // computer met share: toch gewoon printen
    [false, true, false, 'afdrukken'], // touch zonder bestand-delen
    [false, true, true, 'delen'],
    [true, false, false, 'link'], // iOS-beginscherm-app zonder canShare: noodroute
    [true, false, true, 'delen'],
    [true, true, false, 'link'],
    [true, true, true, 'delen'],
  ]
  it.each(rijen)('beginscherm=%s touch=%s canShare=%s -> %s', (app, touch, kan, verwacht) => {
    expect(bepaalDeelModus({ isBeginschermApp: app, isTouchToestel: touch, kanBestandDelen: kan })).toBe(verwacht)
  })
})
