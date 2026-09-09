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
  parseCyclusCorrectie,
  serializeCyclusCorrectie,
  actieveCorrectie,
  effectieveCyclusWeek,
  CYCLUS_CORRECTIE_KEY,
  type ActueleMeting,
  type CyclusCorrectie,
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

// ────────────────────────────────────────────────
// Handmatige cyclusweek-correctie
// ────────────────────────────────────────────────

// Alle datums hieronder zijn kale kalenderdatums; de correctiedatum heet
// consequent D.
const D = '2026-09-08'

function correctie(week: number, datum = D, ankerBijCorrectie: string | null = '2026-08-01'): CyclusCorrectie {
  return { week, datum, ankerBijCorrectie }
}

describe('CYCLUS_CORRECTIE_KEY', () => {
  it('is de settings-key die de action schrijft en de pagina leest', () => {
    // Vastgepind: verandert deze string, dan verliezen bestaande teams stil hun
    // correctie zonder dat er ergens iets rood wordt.
    expect(CYCLUS_CORRECTIE_KEY).toBe('cyclus_week_correctie')
  })
})

describe('parseCyclusCorrectie / serializeCyclusCorrectie', () => {
  it('doet een roundtrip mét ankersnapshot', () => {
    const c = correctie(6)
    const waarde = serializeCyclusCorrectie(c)
    expect(waarde).toBe('6|2026-09-08|2026-08-01')
    expect(parseCyclusCorrectie(waarde)).toEqual(c)
  })

  it('doet een roundtrip zonder ankersnapshot (leeg derde segment ⇒ null)', () => {
    const c = correctie(3, D, null)
    const waarde = serializeCyclusCorrectie(c)
    expect(waarde).toBe('3|2026-09-08|')
    expect(parseCyclusCorrectie(waarde)).toEqual({ week: 3, datum: D, ankerBijCorrectie: null })
  })

  it('accepteert de randweken 1 en 6', () => {
    expect(parseCyclusCorrectie('1|2026-09-08|')?.week).toBe(1)
    expect(parseCyclusCorrectie('6|2026-09-08|')?.week).toBe(6)
  })

  it('geeft null bij afwezige, lege of onvolledige waarden', () => {
    expect(parseCyclusCorrectie(null)).toBeNull()
    expect(parseCyclusCorrectie(undefined)).toBeNull()
    expect(parseCyclusCorrectie('')).toBeNull()
    expect(parseCyclusCorrectie('6|2026-09-08')).toBeNull() // derde segment ontbreekt
    expect(parseCyclusCorrectie('6|2026-09-08||')).toBeNull() // segment te veel
  })

  it('geeft null bij een week buiten 1..6 of een niet-geheel getal', () => {
    for (const waarde of ['0|2026-09-08|', '7|2026-09-08|', '3.5|2026-09-08|', 'abc|2026-09-08|', '-1|2026-09-08|', ' 6|2026-09-08|']) {
      expect(parseCyclusCorrectie(waarde)).toBeNull()
    }
  })

  it('geeft null bij een ongeldige correctiedatum of ankersnapshot', () => {
    expect(parseCyclusCorrectie('6|2026-02-30|')).toBeNull()
    expect(parseCyclusCorrectie('6|gisteren|')).toBeNull()
    expect(parseCyclusCorrectie('6|2026-09-08|nonsens')).toBeNull()
    expect(parseCyclusCorrectie('6|2026-09-08|2026-02-30')).toBeNull()
  })
})

describe('actieveCorrectie', () => {
  it('houdt de correctie zolang het afgeleide anker gelijk is aan de snapshot', () => {
    const c = correctie(6)
    expect(actieveCorrectie(c, '2026-08-01')).toEqual(c)
  })

  it('houdt de correctie als er toen én nu geen enkele meting is (AC 5, regel 13)', () => {
    const c = correctie(6, D, null)
    expect(actieveCorrectie(c, null)).toEqual(c)
  })

  it('laat de correctie vervallen zodra het afgeleide anker verschuift (regel 12)', () => {
    expect(actieveCorrectie(correctie(6), '2026-07-20')).toBeNull()
  })

  it('laat de correctie vervallen als er nu wél een anker is en toen niet', () => {
    expect(actieveCorrectie(correctie(6, D, null), '2026-08-01')).toBeNull()
  })

  it('laat de correctie vervallen als het anker helemaal verdween', () => {
    expect(actieveCorrectie(correctie(6), null)).toBeNull()
  })

  it('geeft null zonder correctie', () => {
    expect(actieveCorrectie(null, '2026-08-01')).toBeNull()
    expect(actieveCorrectie(null, null)).toBeNull()
  })

  it('herleeft als het anker terugkeert naar de snapshot (read-time-model)', () => {
    const c = correctie(6)
    expect(actieveCorrectie(c, '2026-07-20')).toBeNull()
    expect(actieveCorrectie(c, '2026-08-01')).toEqual(c)
  })
})

describe('effectieveCyclusWeek', () => {
  const anker = '2026-08-31' // afgeleid anker: op D (2026-09-08) week 2

  it('toont op de correctiedag zelf de ingestelde week (AC 1)', () => {
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: correctie(6), onDate: D })).toBe(6)
  })

  it('houdt die week de hele week vast en rolt na week 6 door naar week 1 (AC 2)', () => {
    const c = correctie(6)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-14' })).toBe(6) // D+6
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-15' })).toBe(1) // D+7
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-22' })).toBe(2) // D+14
  })

  it('rolt over een hele cyclus heen terug naar dezelfde week (43 dagen, edge)', () => {
    // D+42 = zes volle weken later ⇒ weer week 1; D+43 zit nog in diezelfde week.
    const c = correctie(1)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-10-20' })).toBe(1) // D+42
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-10-21' })).toBe(1) // D+43
  })

  it('blijft maanden later modulo-correct doortellen', () => {
    const c = correctie(3)
    // D + 182 dagen = 26 weken = precies vier-en-een-derde cyclus: 26 % 6 = 2
    // weken verder dan week 3 ⇒ week 5.
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2027-03-09' })).toBe(5)
  })

  it('geeft een lopende week zonder enige nulmeting (AC 5, regel 13)', () => {
    const c = correctie(4, D, null)
    expect(effectieveCyclusWeek({ anker: null, actieveCorrectie: c, onDate: D })).toBe(4)
    expect(effectieveCyclusWeek({ anker: null, actieveCorrectie: c, onDate: '2026-09-15' })).toBe(5)
  })

  it('valt vóór de correctiedatum terug op het afgeleide anker (regel 11)', () => {
    const c = correctie(6)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-07' })).toBe(
      cycleWeekFor(anker, '2026-09-07'),
    )
    expect(effectieveCyclusWeek({ anker: null, actieveCorrectie: c, onDate: '2026-09-07' })).toBeNull()
  })

  it('geldt op de correctiedatum zelf, niet pas de dag erna (edge)', () => {
    const c = correctie(6)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: D })).toBe(6)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-07' })).toBe(2)
  })

  it('verandert de week niet als de correctie gelijk is aan de al berekende week (edge)', () => {
    // Op D geeft het anker week 2; corrigeren naar 2 laat de uitkomst gelijk.
    const c = correctie(2)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: D })).toBe(2)
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: c, onDate: '2026-09-15' })).toBe(
      cycleWeekFor(anker, '2026-09-15'),
    )
  })

  it('is zonder correctie identiek aan cycleWeekFor op het anker (regressie)', () => {
    for (const onDate of ['2026-08-31', '2026-09-08', '2026-10-12', '2027-01-01']) {
      expect(effectieveCyclusWeek({ anker, actieveCorrectie: null, onDate })).toBe(
        cycleWeekFor(anker, onDate),
      )
    }
  })

  it('geeft null zonder anker en zonder correctie', () => {
    expect(effectieveCyclusWeek({ anker: null, actieveCorrectie: null, onDate: D })).toBeNull()
  })

  it('negeert een correctie met een onmogelijke opgeslagen datum en valt terug op het anker', () => {
    // parseCyclusCorrectie houdt zo'n waarde normaal tegen; deze tak is het
    // vangnet als een rij ooit langs een andere weg binnenkomt.
    const kapot = { week: 6, datum: '2026-02-30', ankerBijCorrectie: null } as CyclusCorrectie
    expect(effectieveCyclusWeek({ anker, actieveCorrectie: kapot, onDate: D })).toBe(
      cycleWeekFor(anker, D),
    )
  })

  it('telt een week over de zomertijdovergang heen als één volle week', () => {
    // Spiegel van de cycleWeekFor-regressie: het virtuele anker mag niet via
    // lokale Date-parsing een dag verschuiven.
    const oorspronkelijkeTz = process.env.TZ
    process.env.TZ = 'Europe/Amsterdam'
    try {
      const c = correctie(3, '2026-03-25', null)
      expect(effectieveCyclusWeek({ anker: null, actieveCorrectie: c, onDate: '2026-04-01' })).toBe(4)
    } finally {
      process.env.TZ = oorspronkelijkeTz
    }
  })
})
