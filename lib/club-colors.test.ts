import { describe, it, expect } from 'vitest'
import {
  CLUB_COLOR_FALLBACK,
  CLUB_COLOR_KEYS,
  isClubColorSlot,
  normalizeHexColor,
  resolveClubColors,
} from '@/lib/club-colors'

describe('CLUB_COLOR_KEYS / CLUB_COLOR_FALLBACK', () => {
  it('gebruikt de twee afgesproken settings-keys', () => {
    expect(CLUB_COLOR_KEYS).toEqual({
      primary: 'team_color_primary',
      secondary: 'team_color_secondary',
    })
  })

  it('valt terug op de kleuren die de printweergave vandaag al gebruikt', () => {
    expect(CLUB_COLOR_FALLBACK).toEqual({ primary: '#004f3b', secondary: '#009966' })
  })

  it('levert fallbacks die zelf door de eigen normalisatie komen', () => {
    expect(normalizeHexColor(CLUB_COLOR_FALLBACK.primary)).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(normalizeHexColor(CLUB_COLOR_FALLBACK.secondary)).toBe(CLUB_COLOR_FALLBACK.secondary)
  })
})

describe('normalizeHexColor — geldige invoer', () => {
  it('accepteert een 6-cijferige hex met #', () => {
    expect(normalizeHexColor('#1a4f8b')).toBe('#1a4f8b')
  })

  it('accepteert een 6-cijferige hex zonder #', () => {
    expect(normalizeHexColor('1a4f8b')).toBe('#1a4f8b')
  })

  it('maakt hoofdletters lowercase', () => {
    expect(normalizeHexColor('#A1B2C3')).toBe('#a1b2c3')
    expect(normalizeHexColor('A1B2C3')).toBe('#a1b2c3')
  })

  it('negeert omringende spaties', () => {
    expect(normalizeHexColor('  #a1b2c3  ')).toBe('#a1b2c3')
    expect(normalizeHexColor(' A1B2C3 ')).toBe('#a1b2c3')
  })

  it('expandeert een 3-cijferige hex naar 6 cijfers', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('abc')).toBe('#aabbcc')
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc')
    expect(normalizeHexColor('#000')).toBe('#000000')
    expect(normalizeHexColor('#fff')).toBe('#ffffff')
  })

  it('levert altijd de canonieke vorm: 7 tekens, beginnend met #', () => {
    for (const invoer of ['#abc', 'ABC', '#1a4f8b', ' 059669 ']) {
      const uit = normalizeHexColor(invoer)!
      expect(uit).toHaveLength(7)
      expect(uit.startsWith('#')).toBe(true)
      expect(uit).toBe(uit.toLowerCase())
    }
  })

  it('is idempotent: nog een keer normaliseren verandert niets', () => {
    const eenmaal = normalizeHexColor(' #ABC ')!
    expect(normalizeHexColor(eenmaal)).toBe(eenmaal)
  })
})

describe('normalizeHexColor — ongeldige invoer', () => {
  it('weigert een lege string', () => {
    expect(normalizeHexColor('')).toBeNull()
    expect(normalizeHexColor('   ')).toBeNull()
  })

  it('weigert alleen een #', () => {
    expect(normalizeHexColor('#')).toBeNull()
  })

  it('weigert een kleurnaam', () => {
    expect(normalizeHexColor('rood')).toBeNull()
    expect(normalizeHexColor('green')).toBeNull()
  })

  it('weigert een andere kleurnotatie', () => {
    expect(normalizeHexColor('rgb(0,0,0)')).toBeNull()
    expect(normalizeHexColor('hsl(120, 50%, 50%)')).toBeNull()
  })

  it('weigert een verkeerd aantal cijfers', () => {
    expect(normalizeHexColor('#12')).toBeNull()
    expect(normalizeHexColor('#1234')).toBeNull()
    expect(normalizeHexColor('#12345')).toBeNull()
    expect(normalizeHexColor('#1234567')).toBeNull()
  })

  it('weigert een niet-hex teken', () => {
    expect(normalizeHexColor('#12345g')).toBeNull()
    expect(normalizeHexColor('#xyzxyz')).toBeNull()
  })

  it('weigert een dubbele #', () => {
    expect(normalizeHexColor('##abc')).toBeNull()
  })

  it('weigert alles wat geen string is', () => {
    expect(normalizeHexColor(null)).toBeNull()
    expect(normalizeHexColor(undefined)).toBeNull()
    expect(normalizeHexColor(123456)).toBeNull()
    expect(normalizeHexColor({})).toBeNull()
    expect(normalizeHexColor(['#abc'])).toBeNull()
  })
})

describe('isClubColorSlot', () => {
  it('accepteert alleen de twee bekende slots', () => {
    expect(isClubColorSlot('primary')).toBe(true)
    expect(isClubColorSlot('secondary')).toBe(true)
  })

  // Dragend voor de tenant-/sleutelafscherming: zonder deze whitelist zou een
  // client via `slot` een andere settings-key kunnen raken.
  it('weigert andere settings-keys en onzin', () => {
    expect(isClubColorSlot('tertiary')).toBe(false)
    expect(isClubColorSlot('team_logo_url')).toBe(false)
    expect(isClubColorSlot('team_color_primary')).toBe(false)
    expect(isClubColorSlot('season_start')).toBe(false)
    expect(isClubColorSlot('')).toBe(false)
    expect(isClubColorSlot('PRIMARY')).toBe(false)
  })

  it('weigert prototype-sleutels en niet-strings', () => {
    expect(isClubColorSlot('__proto__')).toBe(false)
    expect(isClubColorSlot('constructor')).toBe(false)
    expect(isClubColorSlot('toString')).toBe(false)
    expect(isClubColorSlot(null)).toBe(false)
    expect(isClubColorSlot(undefined)).toBe(false)
    expect(isClubColorSlot(0)).toBe(false)
    expect(isClubColorSlot({ primary: 'primary' })).toBe(false)
  })
})

describe('resolveClubColors', () => {
  it('geeft beide fallbacks als er niets is ingesteld', () => {
    expect(resolveClubColors({})).toEqual({ primary: '#004f3b', secondary: '#009966' })
  })

  it('geeft de fallback voor de kleur die ontbreekt — primair ingesteld', () => {
    expect(resolveClubColors({ team_color_primary: '#1a4f8b' })).toEqual({
      primary: '#1a4f8b',
      secondary: '#009966',
    })
  })

  it('geeft de fallback voor de kleur die ontbreekt — secundair ingesteld', () => {
    expect(resolveClubColors({ team_color_secondary: '#ffcc00' })).toEqual({
      primary: '#004f3b',
      secondary: '#ffcc00',
    })
  })

  it('geeft beide ingestelde kleuren terug', () => {
    expect(resolveClubColors({ team_color_primary: '#1a4f8b', team_color_secondary: '#ffcc00' }))
      .toEqual({ primary: '#1a4f8b', secondary: '#ffcc00' })
  })

  it('normaliseert wat er in de database staat', () => {
    expect(resolveClubColors({ team_color_primary: ' #ABC ', team_color_secondary: 'FFCC00' }))
      .toEqual({ primary: '#aabbcc', secondary: '#ffcc00' })
  })

  it('valt terug op de fallback bij een rommelige waarde in de database', () => {
    expect(resolveClubColors({ team_color_primary: 'green', team_color_secondary: '' })).toEqual({
      primary: '#004f3b',
      secondary: '#009966',
    })
  })

  it('negeert andere settings-keys', () => {
    expect(resolveClubColors({ team_name: 'FC Test', team_logo_url: 'https://x/y.png' })).toEqual({
      primary: '#004f3b',
      secondary: '#009966',
    })
  })

  it('levert nooit een lege of undefined kleur', () => {
    const gevallen: Record<string, string>[] = [
      {},
      { team_color_primary: 'kapot' },
      { team_color_secondary: '#12345' },
    ]
    for (const settings of gevallen) {
      const kleuren = resolveClubColors(settings)
      expect(kleuren.primary).toMatch(/^#[0-9a-f]{6}$/)
      expect(kleuren.secondary).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
