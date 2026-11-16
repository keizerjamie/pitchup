import { describe, it, expect } from 'vitest'
import { bepaalVandaag, taakHref, WEEKREGEL_DAGEN, type KaartEvent, type VandaagTaak } from '@/lib/vandaag-scherm'
import type { OpstellingTelling } from '@/lib/lineup-compleet'

const TODAY = '2026-11-16'
const dag = (n: number) => {
  const d = new Date(Date.UTC(2026, 10, 16 + n))
  return d.toISOString().slice(0, 10)
}

const training = (id: string, date: string): KaartEvent =>
  ({ id, type: 'training', date, time: '19:30', opponent: null, home_away: null })
const wedstrijd = (id: string, date: string, opponent: string | null = 'Diemen', home_away: 'home' | 'away' | null = 'away'): KaartEvent =>
  ({ id, type: 'match', date, time: '14:30', opponent, home_away })
const taak = (eventId: string, taskType: VandaagTaak['taskType'], deadline: string, effective = false, eventDate = deadline): VandaagTaak =>
  ({ eventId, taskType, deadline, eventDate, effective })

function invoer(over: Partial<Parameters<typeof bepaalVandaag>[0]> & { lijst?: KaartEvent[] } = {}) {
  const { lijst = [], ...rest } = over
  return {
    vandaag: TODAY,
    taken: [],
    events: new Map(lijst.map((e) => [e.id, e])),
    volgendEvent: null,
    opstellingPerEvent: new Map<string, OpstellingTelling>(),
    selectieKlaarIds: new Set<string>(),
    opstellingKlaarIds: new Set<string>(),
    ...rest,
  }
}

describe('taakHref', () => {
  it('zelfde hrefs als de To-do-lijst', () => {
    expect(taakHref('e1', 'squad')).toBe('/events/e1/squad')
    expect(taakHref('e1', 'lineup')).toBe('/events/e1/lineup')
    expect(taakHref('e1', 'analysis')).toBe('/events/e1/analysis')
    expect(taakHref('e1', 'training_plan')).toBe('/events/e1/training-plan')
    expect(taakHref('e1', 'self_review')).toBe('/events/e1#mijn-zelfreview')
  })
})

describe('bepaalVandaag — hoofdkaart', () => {
  it('AC1: open trainingsplan van vandaag → trainingskaart naar de planner', () => {
    const t1 = training('t1', TODAY)
    const m = bepaalVandaag(invoer({ lijst: [t1], taken: [taak('t1', 'training_plan', TODAY)] }))
    expect(m.hoofdkaart).toEqual({
      soort: 'training_plan', event: t1, open: true, href: '/events/t1/training-plan', doelTaak: 'training_plan', legePosities: null,
    })
  })

  it('AC2: wedstrijd zonder selectie → selectiekaart; na selectie → opstellingskaart', () => {
    const m1 = wedstrijd('m1', dag(2))
    const zonder = bepaalVandaag(invoer({ lijst: [m1], taken: [taak('m1', 'squad', dag(2)), taak('m1', 'lineup', dag(2))] }))
    expect(zonder.hoofdkaart).toMatchObject({ soort: 'squad', href: '/events/m1/squad', open: true })
    const met = bepaalVandaag(invoer({ lijst: [m1], taken: [taak('m1', 'squad', dag(2), true), taak('m1', 'lineup', dag(2))] }))
    expect(met.hoofdkaart).toMatchObject({ soort: 'lineup', href: '/events/m1/lineup', open: true })
  })

  it('AC3/AC4: open analyse en open zelfreview kunnen hoofdkaart zijn', () => {
    const m0 = wedstrijd('m0', dag(-1))
    const t0 = training('t0', dag(-2))
    const analyse = bepaalVandaag(invoer({ lijst: [m0], taken: [taak('m0', 'analysis', TODAY, false, dag(-1))] }))
    expect(analyse.hoofdkaart).toMatchObject({ soort: 'analysis', href: '/events/m0/analysis' })
    const review = bepaalVandaag(invoer({ lijst: [t0], taken: [taak('t0', 'self_review', dag(-2))] }))
    expect(review.hoofdkaart).toMatchObject({ soort: 'self_review', href: '/events/t0#mijn-zelfreview' })
  })

  it('AC5/AC6: eerste open taak in compareTasks-volgorde, klaar telt niet', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(1))
    const t2 = training('t2', dag(3))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m1, t2],
      taken: [
        taak('t2', 'training_plan', dag(3)),
        taak('t1', 'training_plan', TODAY, true),
        taak('m1', 'squad', dag(1)),
      ],
    }))
    expect(m.hoofdkaart?.event.id).toBe('m1')
    expect(m.hoofdkaart?.soort).toBe('squad')
  })

  it('zelfde deadline: stabiel, de eerst aangeleverde taak wint (selectie vóór opstelling)', () => {
    const m1 = wedstrijd('m1', dag(1))
    const t1 = training('t1', dag(1))
    const m = bepaalVandaag(invoer({
      lijst: [m1, t1],
      taken: [taak('m1', 'squad', dag(1)), taak('m1', 'lineup', dag(1)), taak('t1', 'training_plan', dag(1))],
    }))
    expect(m.hoofdkaart).toMatchObject({ soort: 'squad', event: { id: 'm1' } })
    expect(m.regels.map((r) => r.event.id)).toEqual(['t1'])
  })

  it('AC9: open opstelling met onvolledige lineups-rij → probleemkaart met aantal', () => {
    const m1 = wedstrijd('m1', dag(2))
    const basis = { lijst: [m1], taken: [taak('m1', 'squad', dag(2), true), taak('m1', 'lineup', dag(2))] }
    const leeg2 = bepaalVandaag(invoer({ ...basis, opstellingPerEvent: new Map([['m1', { totaal: 11, leeg: 2, compleet: false }]]) }))
    expect(leeg2.hoofdkaart).toMatchObject({ soort: 'lineup_onvolledig', legePosities: 2, href: '/events/m1/lineup', doelTaak: 'lineup' })

    const onbekend = bepaalVandaag(invoer({ ...basis, opstellingPerEvent: new Map([['m1', { totaal: null, leeg: null, compleet: false }]]) }))
    expect(onbekend.hoofdkaart).toMatchObject({ soort: 'lineup_onvolledig', legePosities: null })

    // Alle posities gevuld maar toch niet compleet (bv. dubbele speler / te veel posities).
    const nulLeeg = bepaalVandaag(invoer({ ...basis, opstellingPerEvent: new Map([['m1', { totaal: 11, leeg: 0, compleet: false }]]) }))
    expect(nulLeeg.hoofdkaart).toMatchObject({ soort: 'lineup_onvolledig', legePosities: null })

    const geenRij = bepaalVandaag(invoer(basis))
    expect(geenRij.hoofdkaart).toMatchObject({ soort: 'lineup', legePosities: null })
  })

  it('AC10: probleemkaart is alleen hoofdkaart als hij vooraan staat, anders een regel', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(2))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m1],
      taken: [taak('t1', 'training_plan', TODAY), taak('m1', 'squad', dag(2), true), taak('m1', 'lineup', dag(2))],
      opstellingPerEvent: new Map([['m1', { totaal: 11, leeg: 1, compleet: false }]]),
    }))
    expect(m.hoofdkaart?.soort).toBe('training_plan')
    expect(m.regels).toHaveLength(1)
    expect(m.regels[0]).toMatchObject({ soort: 'lineup_onvolledig', legePosities: 1, open: true })
  })

  it('handmatig afgevinkte opstelling is nooit een probleem', () => {
    const m1 = wedstrijd('m1', dag(2))
    const t1 = training('t1', TODAY)
    const m = bepaalVandaag(invoer({
      lijst: [m1, t1],
      taken: [taak('t1', 'training_plan', TODAY), taak('m1', 'lineup', dag(2), true)],
      opstellingPerEvent: new Map([['m1', { totaal: 11, leeg: 3, compleet: false }]]),
    }))
    expect(m.regels[0]).toMatchObject({ soort: 'lineup', open: false, legePosities: null })
  })

  it('AC14: alle taken klaar → eerstvolgend event als hoofdkaart, open:false', () => {
    const t1 = training('t1', dag(1))
    const m = bepaalVandaag(invoer({ lijst: [t1], taken: [taak('t1', 'training_plan', dag(1), true)], volgendEvent: t1 }))
    expect(m.hoofdkaart).toEqual({
      soort: 'volgend_event', event: t1, open: false, href: '/events/t1/training-plan', doelTaak: 'training_plan', legePosities: null,
    })
    // Het hoofdkaart-event staat niet ook als regel.
    expect(m.regels).toEqual([])
  })

  it('AC14 wedstrijd: opstelling klaar / selectie klaar → opstelling, anders selectie', () => {
    const m9 = wedstrijd('m9', dag(10))
    const geen = bepaalVandaag(invoer({ volgendEvent: m9 }))
    expect(geen.hoofdkaart).toMatchObject({ soort: 'volgend_event', href: '/events/m9/squad', doelTaak: 'squad' })
    const selectie = bepaalVandaag(invoer({ volgendEvent: m9, selectieKlaarIds: new Set(['m9']) }))
    expect(selectie.hoofdkaart).toMatchObject({ href: '/events/m9/lineup', doelTaak: 'lineup' })
    const opstelling = bepaalVandaag(invoer({ volgendEvent: m9, opstellingKlaarIds: new Set(['m9']) }))
    expect(opstelling.hoofdkaart).toMatchObject({ href: '/events/m9/lineup', doelTaak: 'lineup' })
  })

  it('AC13: geen taken en geen eerstvolgend event → hoofdkaart null, geen regels', () => {
    expect(bepaalVandaag(invoer())).toEqual({ hoofdkaart: null, regels: [] })
  })

  it('taak met onbekend event wordt overgeslagen', () => {
    const t1 = training('t1', dag(1))
    const m = bepaalVandaag(invoer({ lijst: [t1], taken: [taak('weg', 'squad', TODAY), taak('t1', 'training_plan', dag(1))] }))
    expect(m.hoofdkaart?.event.id).toBe('t1')
    expect(m.regels).toEqual([])
  })
})

describe('bepaalVandaag — weekregels', () => {
  it('AC7: één regel per event, in To-do-volgorde, zonder het hoofdkaart-event', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(2))
    const t2 = training('t2', dag(4))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m1, t2],
      taken: [
        taak('t2', 'training_plan', dag(4)),
        taak('m1', 'lineup', dag(2)),
        taak('m1', 'squad', dag(2), true),
        taak('t1', 'training_plan', TODAY),
      ],
    }))
    expect(m.hoofdkaart?.event.id).toBe('t1')
    expect(m.regels.map((r) => [r.event.id, r.soort, r.open, r.href])).toEqual([
      ['m1', 'lineup', true, '/events/m1/lineup'],
      ['t2', 'training_plan', true, '/events/t2/training-plan'],
    ])
  })

  it('AC8: event met alleen klare taken → regel open:false met de eerste taak', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(2))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m1],
      taken: [taak('t1', 'training_plan', TODAY), taak('m1', 'squad', dag(2), true), taak('m1', 'lineup', dag(2), true)],
    }))
    expect(m.regels).toEqual([
      { soort: 'squad', event: m1, open: false, href: '/events/m1/squad', doelTaak: 'squad', legePosities: null },
    ])
  })

  it('event met open én klare taken: soort/href van de eerste OPEN taak', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(2))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m1],
      taken: [taak('t1', 'training_plan', TODAY), taak('m1', 'squad', dag(2), true), taak('m1', 'lineup', dag(2))],
    }))
    expect(m.regels[0]).toMatchObject({ soort: 'lineup', open: true, href: '/events/m1/lineup' })
  })

  it('AC7: gespeeld event met open analyse blijft een regel (buiten het venster)', () => {
    const t1 = training('t1', TODAY)
    const m0 = wedstrijd('m0', dag(-3))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m0],
      taken: [taak('t1', 'training_plan', TODAY), taak('m0', 'analysis', dag(1), false, dag(-3))],
    }))
    expect(m.regels.map((r) => r.event.id)).toEqual(['m0'])
  })

  it('AC7: afgerond event uit het verleden → geen regel (browsercontrole 12/14 nov)', () => {
    const t1 = training('t1', TODAY)
    const tOud = training('tOud', dag(-4))
    const mOud = wedstrijd('mOud', dag(-2))
    const m = bepaalVandaag(invoer({
      lijst: [t1, tOud, mOud],
      taken: [
        taak('t1', 'training_plan', TODAY),
        taak('tOud', 'training_plan', dag(-4), true),
        taak('tOud', 'self_review', dag(-1), true, dag(-4)),
        taak('mOud', 'analysis', dag(1), true, dag(-2)),
      ],
    }))
    expect(m.hoofdkaart?.event.id).toBe('t1')
    expect(m.regels).toEqual([])
  })

  it('AC7: open zelfreview uit het verleden → wel een regel, met de open taak', () => {
    const t1 = training('t1', TODAY)
    const tOud = training('tOud', dag(-5))
    const m = bepaalVandaag(invoer({
      lijst: [t1, tOud],
      taken: [
        taak('t1', 'training_plan', TODAY),
        taak('tOud', 'training_plan', dag(-5), true),
        taak('tOud', 'self_review', dag(1), false, dag(-5)),
      ],
    }))
    expect(m.regels).toEqual([
      { soort: 'self_review', event: tOud, open: true, href: '/events/tOud#mijn-zelfreview', doelTaak: 'self_review', legePosities: null },
    ])
  })

  it('AC7 grenzen: afgerond vandaag en vandaag+7 → wel regel; gisteren en +8 → niet', () => {
    expect(WEEKREGEL_DAGEN).toBe(7)
    const hoofd = training('hoofd', dag(1))
    const tVandaag = training('tVandaag', TODAY)
    const m7 = wedstrijd('m7', dag(7))
    const tGisteren = training('tGisteren', dag(-1))
    const m8 = wedstrijd('m8', dag(8))
    const m = bepaalVandaag(invoer({
      lijst: [hoofd, tVandaag, m7, tGisteren, m8],
      taken: [
        taak('hoofd', 'training_plan', dag(1)),
        taak('tVandaag', 'training_plan', TODAY, true),
        taak('m7', 'squad', dag(7), true),
        taak('tGisteren', 'training_plan', dag(-1), true),
        taak('m8', 'squad', dag(8), true),
      ],
    }))
    expect(m.regels.map((r) => [r.event.id, r.open])).toEqual([
      ['tVandaag', false],
      ['m7', false],
    ])
  })

  it('AC7: open taak buiten het venster in de toekomst (+8) → wel regel', () => {
    const t1 = training('t1', TODAY)
    const m8 = wedstrijd('m8', dag(8))
    const m = bepaalVandaag(invoer({
      lijst: [t1, m8],
      taken: [taak('t1', 'training_plan', TODAY), taak('m8', 'squad', dag(6), false, dag(8))],
    }))
    expect(m.regels.map((r) => r.event.id)).toEqual(['m8'])
  })

  it('event met ongeldige datum en alleen klare taken → geen regel (NaN valt buiten venster)', () => {
    const t1 = training('t1', TODAY)
    const kapot = training('kapot', 'geen-datum')
    const m = bepaalVandaag(invoer({
      lijst: [t1, kapot],
      taken: [taak('t1', 'training_plan', TODAY), taak('kapot', 'training_plan', TODAY, true)],
    }))
    expect(m.regels).toEqual([])
  })

  it('hoofdkaart ongewijzigd: venster filtert alleen regels, niet de hoofdkaart', () => {
    const mOud = wedstrijd('mOud', dag(-10))
    const t1 = training('t1', dag(1))
    const m = bepaalVandaag(invoer({
      lijst: [mOud, t1],
      taken: [taak('mOud', 'analysis', dag(-3), false, dag(-10)), taak('t1', 'training_plan', dag(1), true)],
    }))
    expect(m.hoofdkaart).toMatchObject({ soort: 'analysis', event: mOud, open: true })
    expect(m.regels.map((r) => [r.event.id, r.open])).toEqual([['t1', false]])
    const alleKlaar = bepaalVandaag(invoer({
      lijst: [mOud, t1],
      taken: [taak('mOud', 'analysis', dag(-3), true, dag(-10)), taak('t1', 'training_plan', dag(1), true)],
      volgendEvent: t1,
    }))
    expect(alleKlaar.hoofdkaart).toMatchObject({ soort: 'volgend_event', event: t1 })
    expect(alleKlaar.regels).toEqual([])
  })

  it('muteert de invoer niet', () => {
    const t1 = training('t1', TODAY)
    const m1 = wedstrijd('m1', dag(2))
    const taken = [taak('m1', 'squad', dag(2)), taak('t1', 'training_plan', TODAY, true)]
    const kopie = structuredClone(taken)
    const events = new Map([['t1', t1], ['m1', m1]])
    bepaalVandaag(invoer({ taken, events, volgendEvent: t1 }))
    expect(taken).toEqual(kopie)
    expect([...events.keys()]).toEqual(['t1', 'm1'])
  })
})
