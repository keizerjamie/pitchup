import { describe, it, expect, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  countCategoryOccurrences,
  getTrainingLog,
  actueleMetingen,
  ankerDatum,
  metingenPerCategorie,
  onderdeelStatus,
  hermetingStand,
  computeCurrentSteps,
  cycleWeekFor,
  type ActueleMeting,
} from '@/lib/periodization'
import { berekenStap, type CategorieMeting } from '@/lib/types'

// Minimale, chainbare supabase-mock: elke query-methode geeft de builder terug
// en de builder is awaitable; `from(table)` bepaalt welke dataset terugkomt.
function makeSupabase(byTable: Record<string, { data: unknown }>): SupabaseClient {
  function chain(table: string) {
    const result = byTable[table] ?? { data: [] }
    const c: Record<string, unknown> = {}
    const methods = [
      'select', 'eq', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'neq', 'limit',
    ]
    for (const m of methods) c[m] = () => c
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result)
    return c
  }
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient
}

// Eén opgeslagen meting van één onderdeel (tabel categorie_metingen).
function meetRij(
  categorie: string,
  datum: string,
  stap: number,
  extra: Partial<CategorieMeting> = {},
): CategorieMeting {
  return {
    id: `${categorie}@${datum}`,
    team_id: 'team-1',
    categorie,
    datum,
    stap,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

// De uitkomst van actueleMetingen, direct opgeschreven: [categorie, datum, stap].
function actueelUit(paren: [string, string, number?][]): Record<string, ActueleMeting> {
  const actueel: Record<string, ActueleMeting> = {}
  for (const [categorie, datum, stap] of paren) {
    actueel[categorie] = { id: `${categorie}@${datum}`, categorie, datum, stap: stap ?? 1, notes: null }
  }
  return actueel
}

describe('countCategoryOccurrences', () => {
  it('telt de koppeling: 1x per categorie per training', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1' }, { id: 't2' }] },
      training_oefeningen: {
        data: [
          // t1 heeft twee partijen_groot-koppelingen -> telt als 1
          { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } },
          // t2 heeft er één -> +1
          { event_id: 't2', oefeningen: { categorie: 'partijen_groot' } },
        ],
      },
    })

    const occ = await countCategoryOccurrences(supabase, 'team-1', '2026-01-01', '2026-02-01')
    expect(occ.partijen_groot).toBe(2)
  })
})

describe('berekenStap (regressie)', () => {
  it('verzwaren-en-herhalen: N + floor(k/2)', () => {
    expect(berekenStap(3, 0)).toBe(3)
    expect(berekenStap(3, 1)).toBe(3)
    expect(berekenStap(3, 2)).toBe(4)
    expect(berekenStap(3, 5)).toBe(5)
  })
})

// ════════════════════════════════════════════════
// Nulmeting per onderdeel
// ════════════════════════════════════════════════

describe('actueleMetingen', () => {
  it('kiest per onderdeel de meting met de HOOGSTE datum, niet de laatst ingevoerde', () => {
    // Bewust door elkaar aangeleverd, met de hoogste datum in het midden.
    const actueel = actueleMetingen(
      [
        meetRij('partijen_groot', '2026-01-05', 2),
        meetRij('partijen_groot', '2026-03-01', 7),
        meetRij('partijen_groot', '2026-02-01', 4),
      ],
      '2026-12-31',
    )
    expect(actueel.partijen_groot.datum).toBe('2026-03-01')
    expect(actueel.partijen_groot.stap).toBe(7)
  })

  it('laat een achteraf ingevoerde, oudere meting de actuele niet verdringen (edge 13)', () => {
    const actueel = actueleMetingen(
      [meetRij('partijen_klein', '2026-03-01', 5), meetRij('partijen_klein', '2026-01-15', 9)],
      '2026-12-31',
    )
    expect(actueel.partijen_klein.datum).toBe('2026-03-01')
    expect(actueel.partijen_klein.stap).toBe(5)
  })

  it('houdt de peildatum exclusief: een meting óp de peildatum telt niet mee', () => {
    const rijen = [meetRij('partijen_groot', '2026-03-01', 3)]
    expect(actueleMetingen(rijen, '2026-03-01')).toEqual({})
    expect(actueleMetingen(rijen, '2026-03-02').partijen_groot.stap).toBe(3)
  })

  it('houdt onderdelen volledig los van elkaar', () => {
    const actueel = actueleMetingen(
      [
        meetRij('partijen_groot', '2026-01-01', 3),
        meetRij('sprints_veel_rust', '2026-04-01', 6),
      ],
      '2026-12-31',
    )
    expect(Object.keys(actueel).sort()).toEqual(['partijen_groot', 'sprints_veel_rust'])
    expect(actueel.sprints_veel_rust.datum).toBe('2026-04-01')
  })

  it('geeft een leeg resultaat zonder metingen', () => {
    expect(actueleMetingen([], '2026-12-31')).toEqual({})
  })
})

describe('ankerDatum', () => {
  it('is de vroegste datum onder de actuele metingen (AC 14)', () => {
    const anker = ankerDatum(actueelUit([
      ['partijen_groot', '2026-03-01'],
      ['partijen_klein', '2026-01-15'],
      ['sprints_veel_rust', '2026-02-20'],
    ]))
    expect(anker).toBe('2026-01-15')
  })

  it('is null zonder metingen', () => {
    expect(ankerDatum({})).toBeNull()
  })

  it('verandert niet als een ánder onderdeel later wordt hermeten (AC 15)', () => {
    const voor = actueelUit([['partijen_groot', '2026-01-15'], ['partijen_klein', '2026-02-01']])
    const na = actueelUit([['partijen_groot', '2026-01-15'], ['partijen_klein', '2026-06-01']])
    expect(ankerDatum(voor)).toBe('2026-01-15')
    expect(ankerDatum(na)).toBe('2026-01-15')
  })

  it('wordt opnieuw afgeleid als de datum van de ankermeting wijzigt (AC 16)', () => {
    const na = actueelUit([['partijen_groot', '2026-03-10'], ['partijen_klein', '2026-02-01']])
    expect(ankerDatum(na)).toBe('2026-02-01')
  })

  it('neemt bij een gedeelde vroegste datum die datum (edge 8)', () => {
    const anker = ankerDatum(actueelUit([
      ['partijen_groot', '2026-01-15'],
      ['partijen_klein', '2026-01-15'],
      ['sprints_veel_rust', '2026-05-01'],
    ]))
    expect(anker).toBe('2026-01-15')
  })
})

describe('metingenPerCategorie', () => {
  it('groepeert per onderdeel met de nieuwste bovenaan (AC 5)', () => {
    const per = metingenPerCategorie([
      meetRij('partijen_groot', '2026-01-05', 2),
      meetRij('partijen_groot', '2026-03-01', 7),
      meetRij('partijen_groot', '2026-02-01', 4),
    ])
    expect(per.partijen_groot.map((m) => m.datum)).toEqual(['2026-03-01', '2026-02-01', '2026-01-05'])
  })

  it('houdt de geschiedenis van onderdelen gescheiden', () => {
    const per = metingenPerCategorie([
      meetRij('partijen_groot', '2026-01-05', 2),
      meetRij('sprints_weinig_rust', '2026-02-05', 3),
      meetRij('sprints_weinig_rust', '2026-04-05', 5),
    ])
    expect(per.partijen_groot).toHaveLength(1)
    expect(per.sprints_weinig_rust.map((m) => m.stap)).toEqual([5, 3])
  })
})

describe('onderdeelStatus', () => {
  it('toont zonder metingen alle vijf als "nog te meten", met hun vaste cyclusweek (AC 10, 11)', () => {
    const status = onderdeelStatus({}, {})
    expect(status.map((s) => s.key)).toEqual([
      'partijen_groot', 'partijen_midden', 'partijen_klein',
      'sprints_weinig_rust', 'sprints_veel_rust',
    ])
    expect(status.map((s) => (s.gemeten ? null : s.week))).toEqual([1, 3, 5, 3, 5])
  })

  it('toont een gemeten onderdeel met zijn actuele stap en maximum (AC 12)', () => {
    const status = onderdeelStatus(
      actueelUit([['partijen_klein', '2026-01-15', 4]]),
      { partijen_klein: 6 },
    )
    const klein = status.find((s) => s.key === 'partijen_klein')!
    expect(klein).toEqual({ key: 'partijen_klein', gemeten: true, stap: 6, maxStap: 13, datum: '2026-01-15' })
    // De overige vier blijven "nog te meten" (edge 3).
    expect(status.filter((s) => !s.gemeten)).toHaveLength(4)
  })

  it('laat Steigerungs en de niet-meetbare categorieën volledig weg (AC 9, edge 16)', () => {
    const keys = onderdeelStatus({}, {}).map((s) => s.key)
    for (const key of ['steigerungs', 'warming_up', 'positiespel', 'pass_trap', 'overig']) {
      expect(keys).not.toContain(key)
    }
  })
})

describe('computeCurrentSteps — nieuwe vorm', () => {
  it('is de stap van de actuele meting + floor(k/2) (AC 17)', () => {
    const stappen = computeCurrentSteps(
      actueelUit([['partijen_groot', '2026-01-01', 3], ['partijen_klein', '2026-01-01', 5]]),
      { partijen_groot: 4, partijen_klein: 1 },
    )
    expect(stappen.partijen_groot).toBe(5)
    expect(stappen.partijen_klein).toBe(5)
  })

  it('is exact de ingevulde stap zolang er nog geen training is geweest (AC 13)', () => {
    const stappen = computeCurrentSteps(actueelUit([['sprints_veel_rust', '2026-01-01', 7]]), {})
    expect(stappen.sprints_veel_rust).toBe(7)
  })

  it('geeft null voor onderdelen zonder meting en voor onderdelen zonder nulmeting', () => {
    const stappen = computeCurrentSteps(actueelUit([['partijen_groot', '2026-01-01', 3]]), {})
    expect(stappen.partijen_klein).toBeNull()
    expect(stappen.steigerungs).toBeNull()
    expect(stappen.warming_up).toBeNull()
  })

  it('clamt niet: een berekende stap mag boven het categorie-maximum uitkomen (edge 10)', () => {
    const stappen = computeCurrentSteps(
      actueelUit([['partijen_klein', '2026-01-01', 13]]), // maxStap 13
      { partijen_klein: 6 },
    )
    expect(stappen.partijen_klein).toBe(16)
  })
})

describe('getTrainingLog — nieuwe vorm (per onderdeel)', () => {
  it('telt een training alleen mee vanaf de EIGEN meetdatum van dat onderdeel (AC 18)', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1', date: '2026-01-10' }, { id: 't2', date: '2026-02-10' }] },
      training_oefeningen: {
        data: [
          { event_id: 't1', stap_override: null, oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't1', stap_override: null, oefeningen: { categorie: 'partijen_klein' } },
          { event_id: 't2', stap_override: null, oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't2', stap_override: null, oefeningen: { categorie: 'partijen_klein' } },
        ],
      },
    })

    // partijen_groot is op 1 januari gemeten, partijen_klein pas op 1 februari:
    // training t1 (10 januari) ligt tussen die twee meetdata in.
    const { occurrences, currentSteps, log, lastByCategory } = await getTrainingLog(
      supabase,
      'team-1',
      actueelUit([['partijen_groot', '2026-01-01', 3], ['partijen_klein', '2026-02-01', 2]]),
      '2026-03-01',
    )

    expect(occurrences.partijen_groot).toBe(2)
    expect(occurrences.partijen_klein).toBe(1)
    expect(currentSteps.partijen_groot).toBe(4) // 3 + floor(2/2)
    expect(currentSteps.partijen_klein).toBe(2) // 2 + floor(1/2)

    // Het log staat nieuwste eerst.
    expect(log.map((e) => e.eventId)).toEqual(['t2', 't1'])

    // In t1 heeft partijen_klein nog geen stap: die meting bestond toen niet.
    const t1 = log.find((e) => e.eventId === 't1')!
    expect(t1.items.find((i) => i.key === 'partijen_klein')!.step).toBeNull()
    expect(t1.items.find((i) => i.key === 'partijen_groot')!.step).toBe(3)
    expect(lastByCategory.partijen_klein.date).toBe('2026-02-10')
  })

  it('telt een training op exact de meetdatum niet mee (edge 11)', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1', date: '2026-01-10' }] },
      training_oefeningen: {
        data: [{ event_id: 't1', stap_override: null, oefeningen: { categorie: 'partijen_groot' } }],
      },
    })

    const { occurrences, currentSteps } = await getTrainingLog(
      supabase, 'team-1', actueelUit([['partijen_groot', '2026-01-10', 3]]), '2026-03-01',
    )
    expect(occurrences.partijen_groot).toBeUndefined()
    expect(currentSteps.partijen_groot).toBe(3)
  })

  it('laat een handmatige stap_override winnen en telt 1x per categorie per training', async () => {
    const supabase = makeSupabase({
      events: { data: [{ id: 't1', date: '2026-01-10' }] },
      training_oefeningen: {
        data: [
          // Twee partijen_groot-koppelingen in dezelfde training: samen één
          // logregel, en de handmatige override wint van de berekende stap.
          { event_id: 't1', stap_override: null, oefeningen: { categorie: 'partijen_groot' } },
          { event_id: 't1', stap_override: 9, oefeningen: { categorie: 'partijen_groot' } },
        ],
      },
    })

    const { log, occurrences } = await getTrainingLog(
      supabase, 'team-1', actueelUit([['partijen_groot', '2026-01-01', 3]]), '2026-03-01',
    )
    expect(log[0].items).toHaveLength(1)
    expect(log[0].items[0].key).toBe('partijen_groot')
    expect(log[0].items[0].step).toBe(9)
    expect(log[0].items[0].override).toBe(true)
    expect(occurrences.partijen_groot).toBe(1)
  })

  it('doet zonder enige meting geen enkele query en geeft alle stappen null (AC 10)', async () => {
    const supabase = {
      from: () => {
        throw new Error('zonder meting hoort er geen query te zijn')
      },
    } as unknown as SupabaseClient

    const { log, occurrences, currentSteps } = await getTrainingLog(supabase, 'team-1', {}, '2026-03-01')
    expect(log).toEqual([])
    expect(occurrences).toEqual({})
    expect(currentSteps.partijen_groot).toBeNull()
  })

  it('blijft correct bij een lang seizoen zonder hermeting (edge 12)', async () => {
    const trainingen = Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`,
      // 40 opeenvolgende trainingen, allemaal ná de meetdatum.
      date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    }))
    const supabase = makeSupabase({
      events: { data: trainingen },
      training_oefeningen: {
        data: trainingen.map((t) => ({
          event_id: t.id, stap_override: null, oefeningen: { categorie: 'partijen_groot' },
        })),
      },
    })

    const { occurrences, currentSteps } = await getTrainingLog(
      supabase, 'team-1', actueelUit([['partijen_groot', '2026-01-01', 2]]), '2026-03-01',
    )
    expect(occurrences.partijen_groot).toBe(40)
    expect(currentSteps.partijen_groot).toBe(22) // 2 + floor(40/2)
  })
})

describe('cycleWeekFor', () => {
  const oorspronkelijkeTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = oorspronkelijkeTz
  })

  it('telt weken van zes vanaf het anker (regressie)', () => {
    expect(cycleWeekFor('2026-01-01', '2026-01-01')).toBe(1)
    expect(cycleWeekFor('2026-01-01', '2026-01-07')).toBe(1) // zes dagen later
    expect(cycleWeekFor('2026-01-01', '2026-01-08')).toBe(2) // exact één week
    expect(cycleWeekFor('2026-01-01', '2026-02-05')).toBe(6) // week 6 van de cyclus
    expect(cycleWeekFor('2026-01-01', '2026-02-12')).toBe(1) // en weer rond
  })

  it('geeft week 1 voor een datum vóór het anker', () => {
    expect(cycleWeekFor('2026-03-01', '2026-01-01')).toBe(1)
  })

  it('telt een week over de zomertijdovergang heen als één volle week', () => {
    // In Europe/Amsterdam duurt de week rond 29 maart 167 uur. Met lokale
    // Date-parsing viel deze berekening daardoor terug op week 1.
    process.env.TZ = 'Europe/Amsterdam'
    expect(cycleWeekFor('2026-03-25', '2026-04-01')).toBe(2)
  })

  it('geeft week 1 bij een ongeldige of niet-bestaande datum', () => {
    expect(cycleWeekFor('', '2026-04-01')).toBe(1)
    expect(cycleWeekFor('2026-02-30', '2026-04-01')).toBe(1)
    expect(cycleWeekFor('2026-01-01', 'gisteren')).toBe(1)
  })
})

describe('hermetingStand', () => {
  it('staat uit zonder metingen', () => {
    expect(hermetingStand({})).toEqual({ actief: false, hermeten: 0, gemeten: 0, spreidingDagen: 0 })
  })

  it('staat uit als alle onderdelen op dezelfde datum zijn gemeten (spreiding 0)', () => {
    const stand = hermetingStand(actueelUit([
      ['partijen_groot', '2026-08-01'],
      ['partijen_klein', '2026-08-01'],
    ]))
    expect(stand).toEqual({ actief: false, hermeten: 0, gemeten: 2, spreidingDagen: 0 })
  })

  it('staat uit bij 41 en bij exact 42 dagen spreiding, en aan bij 43 (grenswaarden)', () => {
    const bij = (laatste: string) =>
      hermetingStand(actueelUit([['partijen_groot', '2026-08-01'], ['partijen_klein', laatste]]))

    expect(bij('2026-09-11')).toMatchObject({ spreidingDagen: 41, actief: false })
    expect(bij('2026-09-12')).toMatchObject({ spreidingDagen: 42, actief: false })
    expect(bij('2026-09-13')).toMatchObject({ spreidingDagen: 43, actief: true })
  })

  it('herkent de winterstop: vier onderdelen in augustus, één in januari', () => {
    const stand = hermetingStand(actueelUit([
      ['partijen_groot', '2026-08-01'],
      ['partijen_midden', '2026-08-01'],
      ['partijen_klein', '2026-08-01'],
      ['sprints_weinig_rust', '2026-08-01'],
      ['sprints_veel_rust', '2027-01-05'],
    ]))
    expect(stand.actief).toBe(true)
    expect(stand.hermeten).toBe(1)
    expect(stand.gemeten).toBe(5)
  })

  it('telt élk onderdeel dat later dan het anker valt als hermeten', () => {
    const stand = hermetingStand(actueelUit([
      ['partijen_groot', '2026-08-01'],
      ['partijen_midden', '2027-01-05'],
      ['partijen_klein', '2027-01-06'],
    ]))
    expect(stand.hermeten).toBe(2)
    expect(stand.gemeten).toBe(3)
  })

  it('gebruikt het aantal GEMETEN onderdelen als noemer, niet hard vijf', () => {
    const stand = hermetingStand(actueelUit([
      ['partijen_groot', '2026-08-01'],
      ['partijen_midden', '2026-08-01'],
      ['partijen_klein', '2027-01-05'],
    ]))
    expect(stand.gemeten).toBe(3)
    expect(stand.hermeten).toBe(1)
  })

  it('invariant: staat de hint aan, dan is er altijd minstens één hermeten onderdeel', () => {
    const scenarios: Record<string, ActueleMeting>[] = [
      {},
      actueelUit([['partijen_groot', '2026-08-01']]),
      actueelUit([['partijen_groot', '2026-08-01'], ['partijen_klein', '2026-08-01']]),
      actueelUit([['partijen_groot', '2026-08-01'], ['partijen_klein', '2026-09-12']]),
      actueelUit([['partijen_groot', '2026-08-01'], ['partijen_klein', '2027-01-05']]),
    ]
    for (const actueel of scenarios) {
      const stand = hermetingStand(actueel)
      if (stand.actief) expect(stand.hermeten).toBeGreaterThanOrEqual(1)
    }
    // En minstens één scenario zet hem écht aan (anders bewijst de lus niets).
    expect(scenarios.some((a) => hermetingStand(a).actief)).toBe(true)
  })
})
