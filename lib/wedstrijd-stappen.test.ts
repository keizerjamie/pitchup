import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WEDSTRIJD_STAPPEN,
  bouwStapperData,
  stapHref,
  telBeschikbaarheid,
  volgendeStap,
  wedstrijdDatumBereikt,
  type StapperInvoer,
} from '@/lib/wedstrijd-stappen'
import { FORMATIONS, type AttendanceStatus, type PlayerType } from '@/lib/types'
import { todayLocal } from '@/lib/utils'

// Pure regels, geen Supabase. De opstelling wordt opgebouwd uit de echte
// formatie in FORMATIONS, zodat de test meebeweegt als een formatie verandert.

const FORMATIE = '4-3-3'
const SLOTS = FORMATIONS[FORMATIE].positions

function volleOpstelling() {
  return SLOTS.map((s, i) => ({ ...s, player_id: `p${i}` }))
}

function invoer(over: Partial<StapperInvoer> = {}): StapperInvoer {
  return {
    eventId: 'e1',
    huidig: 'beschikbaar',
    aanwezigheid: { aanwezig: 0, geenReactie: 0 },
    selectieRijen: 0,
    lineup: null,
    uitslag: { goals_for: null, goals_against: null },
    ratingCount: 0,
    eventCount: 0,
    eventDate: '2026-11-16',
    vandaag: '2026-11-16',
    ...over,
  }
}

describe('stapHref en volgendeStap', () => {
  it('levert de vier bestaande paden in de vaste volgorde', () => {
    expect(WEDSTRIJD_STAPPEN).toEqual(['beschikbaar', 'selectie', 'opstelling', 'analyse'])
    expect(WEDSTRIJD_STAPPEN.map((s) => stapHref('abc', s))).toEqual([
      '/events/abc',
      '/events/abc/squad',
      '/events/abc/lineup',
      '/events/abc/analysis',
    ])
  })

  it('volgende stap loopt 1→2→3→4 en stopt bij analyse', () => {
    expect(volgendeStap('beschikbaar')).toBe('selectie')
    expect(volgendeStap('selectie')).toBe('opstelling')
    expect(volgendeStap('opstelling')).toBe('analyse')
    expect(volgendeStap('analyse')).toBeNull()
  })
})

describe('wedstrijdDatumBereikt', () => {
  it('vandaag en eerder = bereikt, morgen = niet', () => {
    expect(wedstrijdDatumBereikt('2026-11-16', '2026-11-16')).toBe(true)
    expect(wedstrijdDatumBereikt('2026-11-15', '2026-11-16')).toBe(true)
    expect(wedstrijdDatumBereikt('2026-11-17', '2026-11-16')).toBe(false)
  })

  it('een niet-string datum geldt als niet bereikt (fail-safe)', () => {
    expect(wedstrijdDatumBereikt(null, '2026-11-16')).toBe(false)
    expect(wedstrijdDatumBereikt(undefined, '2026-11-16')).toBe(false)
    expect(wedstrijdDatumBereikt(20261116, '2026-11-16')).toBe(false)
  })
})

describe('telBeschikbaarheid', () => {
  type S = { id: string; type: PlayerType }
  const spelers: S[] = [
    { id: 'a', type: 'regular' },
    { id: 'b', type: 'regular' },
    { id: 'c', type: 'regular' },
    { id: 'd', type: 'regular' },
    { id: 'g1', type: 'guest' },
    { id: 'g2', type: 'guest' },
  ]
  const status: Record<string, AttendanceStatus> = {
    a: 'present', b: 'unknown', c: 'absent', g1: 'present', g2: 'unknown',
  }

  it('aanwezige gasten tellen niet mee in "aanwezig"; een ontbrekende rij telt als geen reactie', () => {
    // d heeft geen rij → 'unknown'; g2 (gast, unknown) bestaat niet voor de telling.
    expect(telBeschikbaarheid(spelers, (s) => status[s.id] ?? 'unknown'))
      .toEqual({ aanwezig: 1, geenReactie: 2 })
  })

  it('lege lijst geeft nullen', () => {
    expect(telBeschikbaarheid([] as S[], () => 'present')).toEqual({ aanwezig: 0, geenReactie: 0 })
  })
})

describe('bouwStapperData — selectie', () => {
  it('null = onbekend, >0 = klaar, 0 = open', () => {
    expect(bouwStapperData(invoer({ selectieRijen: null })).selectie).toBe('onbekend')
    expect(bouwStapperData(invoer({ selectieRijen: 1 })).selectie).toBe('klaar')
    expect(bouwStapperData(invoer({ selectieRijen: 0 })).selectie).toBe('open')
  })
})

describe('bouwStapperData — opstelling', () => {
  it('undefined (queryfout) = onbekend, geen rij = open', () => {
    expect(bouwStapperData(invoer({ lineup: undefined })).opstelling).toBe('onbekend')
    expect(bouwStapperData(invoer({ lineup: null })).opstelling).toBe('open')
  })

  it('volledige opstelling = klaar, één leeg slot = open', () => {
    expect(bouwStapperData(invoer({ lineup: { formation: FORMATIE, positions: volleOpstelling() } })).opstelling).toBe('klaar')
    const half = volleOpstelling()
    half[3] = { ...half[3], player_id: null as unknown as string }
    expect(bouwStapperData(invoer({ lineup: { formation: FORMATIE, positions: half } })).opstelling).toBe('open')
  })

  it('onbekende formatie of kapotte positions = open, en gooit niet', () => {
    expect(bouwStapperData(invoer({ lineup: { formation: 'bestaat-niet', positions: volleOpstelling() } })).opstelling).toBe('open')
    expect(bouwStapperData(invoer({ lineup: { formation: FORMATIE, positions: 'kapot' } })).opstelling).toBe('open')
    expect(bouwStapperData(invoer({ lineup: { formation: FORMATIE, positions: [null, 3, 'x'] } })).opstelling).toBe('open')
  })
})

describe('bouwStapperData — analyse en vergrendeling', () => {
  it('uitslag, beoordeling of moment = klaar', () => {
    expect(bouwStapperData(invoer({ uitslag: { goals_for: 2, goals_against: 0 } })).analyse).toBe('klaar')
    expect(bouwStapperData(invoer({ ratingCount: 1 })).analyse).toBe('klaar')
    expect(bouwStapperData(invoer({ eventCount: 3 })).analyse).toBe('klaar')
  })

  it('half ingevulde uitslag telt niet; niets = open', () => {
    expect(bouwStapperData(invoer({ uitslag: { goals_for: 2, goals_against: null } })).analyse).toBe('open')
    expect(bouwStapperData(invoer()).analyse).toBe('open')
  })

  it('een null-telling zonder bestaande analyse = onbekend', () => {
    expect(bouwStapperData(invoer({ ratingCount: null })).analyse).toBe('onbekend')
    expect(bouwStapperData(invoer({ eventCount: null })).analyse).toBe('onbekend')
  })

  it('een null-telling maar wél een uitslag = klaar (bestaan wint)', () => {
    expect(bouwStapperData(invoer({ ratingCount: null, uitslag: { goals_for: 0, goals_against: 0 } })).analyse).toBe('klaar')
    expect(bouwStapperData(invoer({ ratingCount: null, eventCount: 2 })).analyse).toBe('klaar')
  })

  it('morgen zonder analyse = vergrendeld', () => {
    expect(bouwStapperData(invoer({ eventDate: '2026-11-17', vandaag: '2026-11-16' })).analyseVergrendeld).toBe(true)
  })

  it('vandaag = niet vergrendeld', () => {
    expect(bouwStapperData(invoer({ eventDate: '2026-11-16', vandaag: '2026-11-16' })).analyseVergrendeld).toBe(false)
  })

  it('toekomst mét analyse = klaar en niet vergrendeld', () => {
    const d = bouwStapperData(invoer({ eventDate: '2026-11-20', vandaag: '2026-11-16', ratingCount: 1 }))
    expect(d.analyse).toBe('klaar')
    expect(d.analyseVergrendeld).toBe(false)
  })

  it('ontbrekende datum zonder analyse = vergrendeld (fail-safe)', () => {
    expect(bouwStapperData(invoer({ eventDate: null })).analyseVergrendeld).toBe(true)
  })
})

describe('bouwStapperData — middernacht via de vandaag-parameter', () => {
  afterEach(() => { vi.useRealTimers() })

  it('23:59 de avond ervoor vergrendeld, 00:00 op de wedstrijddag open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 16, 23, 59, 59))
    expect(bouwStapperData(invoer({ eventDate: '2026-11-17', vandaag: todayLocal() })).analyseVergrendeld).toBe(true)
    vi.setSystemTime(new Date(2026, 10, 17, 0, 0, 0))
    expect(bouwStapperData(invoer({ eventDate: '2026-11-17', vandaag: todayLocal() })).analyseVergrendeld).toBe(false)
  })
})

describe('bouwStapperData — doorgegeven velden', () => {
  it('neemt eventId, huidig en aanwezigheid ongewijzigd over', () => {
    const d = bouwStapperData(invoer({ eventId: 'x9', huidig: 'opstelling', aanwezigheid: { aanwezig: 7, geenReactie: 2 } }))
    expect(d.eventId).toBe('x9')
    expect(d.huidig).toBe('opstelling')
    expect(d.aanwezigheid).toEqual({ aanwezig: 7, geenReactie: 2 })
  })

  it('gooit niet bij een lege uitslag-vorm', () => {
    expect(() => bouwStapperData(invoer({ uitslag: {} as StapperInvoer['uitslag'] }))).not.toThrow()
  })
})
