import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  saveCategorieMeting,
  deleteCategorieMeting,
  saveCyclusWeekCorrectie,
  deleteCyclusWeekCorrectie,
} from '@/app/actions/periodisering'

type TableResult = { data?: unknown; error?: unknown }

// Harnas overgenomen van app/actions/training-plan.test.ts, met één toevoeging:
// `upsert` naast `insert`, inclusief de onConflict-sleutel. Die sleutel IS het
// idempotentiecontract van deze feature (AC 26) en moet dus meetbaar zijn.
function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  // Per tabel meerdere opeenvolgende antwoorden, in volgorde van afhandeling.
  // Nodig voor het bewerk-pad, dat categorie_metingen vier keer aanspreekt
  // (de rij zelf, de nieuwste rij, de bezette-datum-check en de update).
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    // `eqs` wijst naar de eq-filters van ÉÉN statement (één from()-keten), zodat
    // een test kan bewijzen dat juist die select/update tenant-gescoped is.
    select: [] as { table: string; cols: unknown; eqs: Eq[] }[],
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    upsert: [] as { table: string; payload: Record<string, unknown>; onConflict?: string }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }

  // Het resultaat wordt pas bij het awaiten gekozen, zodat een wachtrij per
  // aanroep opschuift. Bij een lege wachtrij blijft het laatste antwoord staan.
  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? { data: [], error: null }
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    for (const m of ['gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.select = (cols: unknown) => { calls.select.push({ table, cols, eqs }); return c }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); eqs.push({ col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.upsert = (payload: Record<string, unknown>, opties?: { onConflict?: string }) => {
      calls.upsert.push({ table, payload, onConflict: opties?.onConflict })
      return c
    }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, eqs }); return c }
    c.delete = () => { calls.delete.push({ table, eqs }); return c }
    c.single = () => Promise.resolve(nextResult(table))
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(nextResult(table))
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// Bestaande meting van dit team, als nieuwste van haar onderdeel: de vier
// antwoorden die het bewerk-pad achter elkaar opvraagt.
function bestaandeMeting(opts: {
  rij?: TableResult
  nieuwste?: TableResult
  bezet?: TableResult
  schrijf?: TableResult
} = {}) {
  return makeSupabase({
    queues: {
      categorie_metingen: [
        opts.rij ?? { data: { id: 'm1', categorie: 'partijen_klein', datum: '2026-08-01' } },
        opts.nieuwste ?? { data: { id: 'm1' } },
        opts.bezet ?? { data: null },
        opts.schrijf ?? { error: null },
      ],
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────
// Nieuwe meting
// ────────────────────────────────────────────────

describe('saveCategorieMeting — nieuwe meting', () => {
  const nieuw = {
    categorie: 'partijen_groot',
    datum: '2026-08-01',
    stap: 5,
    notes: null,
  }

  it('schrijft één rij met team_id van de ingelogde user en de idempotentie-sleutel', async () => {
    const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
    use(m)
    await saveCategorieMeting(nieuw)

    expect(m.calls.upsert).toHaveLength(1)
    expect(m.calls.upsert[0].table).toBe('categorie_metingen')
    expect(m.calls.upsert[0].payload).toEqual({
      team_id: 'team-1',
      categorie: 'partijen_groot',
      datum: '2026-08-01',
      stap: 5,
      notes: null,
    })
    // AC 26: de UNIQUE-sleutel doet de deduplicatie, niet de app.
    expect(m.calls.upsert[0].onConflict).toBe('team_id,categorie,datum')
    // Geen enkele andere tabel aangeraakt (een meting is geen agenda-item meer).
    expect(m.calls.insert).toHaveLength(0)
  })

  it('negeert een team_id uit de payload en gebruikt altijd de ingelogde user', async () => {
    const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
    use(m)
    await saveCategorieMeting({ ...nieuw, team_id: 'ander-team' } as never)
    expect(m.calls.upsert[0].payload.team_id).toBe('team-1')
  })

  it('vernieuwt zowel /periodisering als het dashboard', async () => {
    use(makeSupabase({ tables: { categorie_metingen: { error: null } } }))
    await saveCategorieMeting(nieuw)
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('slaat een lege of witruimte-notitie op als null (AC 22)', async () => {
    for (const notes of [null, '', '   ']) {
      const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
      use(m)
      await saveCategorieMeting({ ...nieuw, notes })
      expect(m.calls.upsert[0].payload.notes).toBeNull()
    }
  })

  it('kapt een lange notitie af op 1000 tekens', async () => {
    const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
    use(m)
    await saveCategorieMeting({ ...nieuw, notes: 'a'.repeat(1500) })
    expect(String(m.calls.upsert[0].payload.notes)).toHaveLength(1000)
  })

  it('clamt een stap buiten het bereik op de grens van díé categorie (AC 19)', async () => {
    const gevallen: [string, number, number][] = [
      // categorie, ingevoerd, verwacht
      ['partijen_groot', 0, 1],
      ['partijen_groot', 26, 21],
      ['partijen_klein', 18, 13],
      ['sprints_weinig_rust', 19, 14],
      ['sprints_veel_rust', 18, 13],
      ['partijen_midden', 20, 15],
    ]
    for (const [categorie, ingevoerd, verwacht] of gevallen) {
      const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
      use(m)
      await saveCategorieMeting({ ...nieuw, categorie, stap: ingevoerd })
      expect(m.calls.upsert[0].payload.stap).toBe(verwacht)
    }
  })

  it('laat de grenswaarden 1 en het categorie-maximum ongemoeid (edge 9)', async () => {
    for (const [categorie, stap] of [['partijen_groot', 1], ['partijen_groot', 21], ['partijen_klein', 13]] as [string, number][]) {
      const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
      use(m)
      await saveCategorieMeting({ ...nieuw, categorie, stap })
      expect(m.calls.upsert[0].payload.stap).toBe(stap)
    }
  })

  it('slaat een meting op die volgens het cyclusschema nog niet aan de beurt is, en een datum in de toekomst (AC 23)', async () => {
    const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
    use(m)
    await saveCategorieMeting({ ...nieuw, categorie: 'sprints_veel_rust', datum: '2099-12-31' })
    expect(m.calls.upsert).toHaveLength(1)
    expect(m.calls.upsert[0].payload.datum).toBe('2099-12-31')
  })

  it('gebruikt bij twee snel opeenvolgende verzoeken twee keer dezelfde conflict-sleutel, nooit een blinde insert (AC 26)', async () => {
    const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
    use(m)
    await saveCategorieMeting(nieuw)
    await saveCategorieMeting(nieuw)
    expect(m.calls.insert).toHaveLength(0)
    expect(m.calls.upsert.map((u) => u.onConflict)).toEqual([
      'team_id,categorie,datum',
      'team_id,categorie,datum',
    ])
  })

  it('weigert een categorie buiten de vijf meetbare onderdelen, zonder write', async () => {
    for (const categorie of ['positiespel', 'warming_up', 'steigerungs', 'overig', 'onzin', '']) {
      const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
      use(m)
      await expect(saveCategorieMeting({ ...nieuw, categorie })).rejects.toThrow('Ongeldig onderdeel')
      expect(m.calls.upsert).toHaveLength(0)
    }
  })

  it('weigert een ongeldige datum en schrijft niets weg (AC 20)', async () => {
    for (const datum of ['2026-13-01', '2026-02-30', '', 'gisteren', '01-08-2026']) {
      const m = makeSupabase({ tables: { categorie_metingen: { error: null } } })
      use(m)
      await expect(saveCategorieMeting({ ...nieuw, datum })).rejects.toThrow('Ongeldige datum')
      expect(m.calls.upsert).toHaveLength(0)
    }
  })

  it('gooit "Niet ingelogd" zonder user, zonder write (AC 24)', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveCategorieMeting(nieuw)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.upsert).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })

  it('geeft bij een DB-fout de generieke melding, nooit de rauwe tekst', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = makeSupabase({
      tables: {
        categorie_metingen: { data: null, error: { code: '23514', message: 'violates check constraint "categorie_metingen_stap_check"' } },
      },
    })
    use(m)
    let fout: Error | null = null
    try {
      await saveCategorieMeting(nieuw)
    } catch (e) {
      fout = e as Error
    }
    expect(fout?.message).toBe(GENERIC_ERROR_MESSAGE)
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('categorie_metingen_stap_check')
    consoleError.mockRestore()
  })
})

// ────────────────────────────────────────────────
// Bestaande meting bewerken
// ────────────────────────────────────────────────

describe('saveCategorieMeting — bewerken', () => {
  const bewerk = {
    id: 'm1',
    categorie: 'partijen_klein',
    datum: '2026-08-05',
    stap: 4,
    notes: null,
  }

  it('werkt alleen de opgegeven rij van dit team bij, zonder categorie of team_id in de payload', async () => {
    const m = bestaandeMeting()
    use(m)
    await saveCategorieMeting(bewerk)

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('categorie_metingen')
    expect(m.calls.update[0].payload).toEqual({ datum: '2026-08-05', stap: 4, notes: null })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'm1' },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('leest de rij tenant-gescoped op id + team_id', async () => {
    const m = bestaandeMeting()
    use(m)
    await saveCategorieMeting(bewerk)

    const guard = m.calls.select.find((s) => s.table === 'categorie_metingen')!
    expect(guard.eqs).toEqual([
      { col: 'id', val: 'm1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('clamt op de categorie van de OPGEHAALDE rij, niet op die van de client', async () => {
    // De rij is partijen_klein (max 13); de client beweert partijen_groot
    // (max 21) en stuurt stap 20 mee. Zou de categorie uit de payload komen,
    // dan werd 20 weggeschreven.
    const m = bestaandeMeting()
    use(m)
    await saveCategorieMeting({ ...bewerk, categorie: 'partijen_groot', stap: 20 })
    expect(m.calls.update[0].payload.stap).toBe(13)
  })

  it('gooit "Meting niet gevonden" bij een meting van een ander team of een onbekend id (AC 25, 27)', async () => {
    const m = bestaandeMeting({ rij: { data: null } })
    use(m)
    await expect(saveCategorieMeting({ ...bewerk, id: 'vreemd' })).rejects.toThrow('Meting niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Alleen de nieuwste meting is te bewerken" bij een oudere meting (AC 28)', async () => {
    const m = bestaandeMeting({ nieuwste: { data: { id: 'm2' } } })
    use(m)
    await expect(saveCategorieMeting(bewerk)).rejects.toThrow('Alleen de nieuwste meting is te bewerken')
    expect(m.calls.update).toHaveLength(0)
  })

  it('zoekt de nieuwste meting per onderdeel binnen het eigen team', async () => {
    const m = bestaandeMeting()
    use(m)
    await saveCategorieMeting(bewerk)

    const nieuwste = m.calls.select.filter((s) => s.table === 'categorie_metingen')[1]
    expect(nieuwste.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'categorie', val: 'partijen_klein' },
    ])
  })

  it('weigert een datum waarop dit onderdeel al een meting heeft', async () => {
    const m = bestaandeMeting({ bezet: { data: { id: 'm9' } } })
    use(m)
    await expect(saveCategorieMeting(bewerk))
      .rejects.toThrow('Er staat al een meting voor dit onderdeel op deze datum')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een ongeldige datum vóór er iets wordt opgehaald of geschreven', async () => {
    const m = bestaandeMeting()
    use(m)
    await expect(saveCategorieMeting({ ...bewerk, datum: '2026-02-30' })).rejects.toThrow('Ongeldige datum')
    expect(m.calls.select).toHaveLength(0)
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user, zonder write', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveCategorieMeting(bewerk)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('geeft bij een DB-fout op de update de generieke melding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = bestaandeMeting({ schrijf: { error: { code: '23505', message: 'duplicate key value' } } })
    use(m)
    await expect(saveCategorieMeting(bewerk)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })
})

// ────────────────────────────────────────────────
// Meting verwijderen
// ────────────────────────────────────────────────

describe('deleteCategorieMeting', () => {
  function teVerwijderen(opts: { rij?: TableResult; nieuwste?: TableResult; schrijf?: TableResult } = {}) {
    return makeSupabase({
      queues: {
        categorie_metingen: [
          opts.rij ?? { data: { id: 'm1', categorie: 'partijen_klein', datum: '2026-08-01' } },
          opts.nieuwste ?? { data: { id: 'm1' } },
          opts.schrijf ?? { error: null },
        ],
      },
    })
  }

  it('verwijdert alleen de opgegeven rij van dit team en vernieuwt beide paden', async () => {
    const m = teVerwijderen()
    use(m)
    await deleteCategorieMeting('m1')

    expect(m.calls.delete).toHaveLength(1)
    expect(m.calls.delete[0].table).toBe('categorie_metingen')
    expect(m.calls.delete[0].eqs).toEqual([
      { col: 'id', val: 'm1' },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('gooit "Meting niet gevonden" bij een meting van een ander team of een onbekend id (AC 25, 27)', async () => {
    const m = teVerwijderen({ rij: { data: null } })
    use(m)
    await expect(deleteCategorieMeting('vreemd')).rejects.toThrow('Meting niet gevonden')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('gooit bij een oudere meting en verwijdert niets (AC 28)', async () => {
    const m = teVerwijderen({ nieuwste: { data: { id: 'm2' } } })
    use(m)
    await expect(deleteCategorieMeting('m1')).rejects.toThrow('Alleen de nieuwste meting is te bewerken')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user, zonder delete (AC 24)', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(deleteCategorieMeting('m1')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('geeft bij een DB-fout de generieke melding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = teVerwijderen({ schrijf: { error: { code: '42501', message: 'permission denied' } } })
    use(m)
    await expect(deleteCategorieMeting('m1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })
})

// ────────────────────────────────────────────────
// Handmatige cyclusweek-correctie
// ────────────────────────────────────────────────
// De correctie leeft in de settings-tabel. Het harnas hierboven kent die tabel
// al (onbekende tabellen krijgen een lege factory), dus alleen de klok moet
// vast: de action schrijft todayLocal() als correctiedatum mee.

const VANDAAG = '2026-09-08'

// Lokale middernacht + 12 uur, zodat todayLocal() in elke tijdzone 2026-09-08
// oplevert.
function zetKlokVast() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0))
}

// Twee metingen van dit team; de vroegste (2026-08-01) is het afgeleide anker.
function metMetingen(rijen: unknown[] = [
  { id: 'm1', categorie: 'partijen_groot', datum: '2026-08-01', stap: 5, notes: null },
  { id: 'm2', categorie: 'partijen_klein', datum: '2026-08-20', stap: 3, notes: null },
], settings: TableResult = { error: null }) {
  return makeSupabase({
    tables: { categorie_metingen: { data: rijen }, settings },
  })
}

describe('saveCyclusWeekCorrectie', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('schrijft één settings-rij met de idempotentie-sleutel en de ankersnapshot', async () => {
    zetKlokVast()
    const m = metMetingen()
    use(m)
    await saveCyclusWeekCorrectie(6)

    expect(m.calls.upsert).toHaveLength(1)
    expect(m.calls.upsert[0].table).toBe('settings')
    expect(m.calls.upsert[0].payload).toEqual({
      team_id: 'team-1',
      key: 'cyclus_week_correctie',
      value: `6|${VANDAAG}|2026-08-01`,
    })
    expect(m.calls.upsert[0].onConflict).toBe('team_id,key')
  })

  it('schrijft een leeg derde segment als er nog geen enkele meting is (AC 5)', async () => {
    zetKlokVast()
    const m = metMetingen([])
    use(m)
    await saveCyclusWeekCorrectie(6)
    expect(m.calls.upsert[0].payload.value).toBe(`6|${VANDAAG}|`)
  })

  it('negeert voor de ankersnapshot een meting van na vandaag', async () => {
    // Peildatum EXCLUSIEF = morgen: een meting van 2099 hoort nog niet bij het
    // anker, een meting van vandaag wél.
    zetKlokVast()
    const m = metMetingen([
      { id: 'm1', categorie: 'partijen_groot', datum: '2099-01-01', stap: 5, notes: null },
      { id: 'm2', categorie: 'partijen_klein', datum: VANDAAG, stap: 3, notes: null },
    ])
    use(m)
    await saveCyclusWeekCorrectie(4)
    expect(m.calls.upsert[0].payload.value).toBe(`4|${VANDAAG}|${VANDAAG}`)
  })

  it('leest de ankersnapshot team-gescoped', async () => {
    zetKlokVast()
    const m = metMetingen()
    use(m)
    await saveCyclusWeekCorrectie(6)
    expect(m.calls.eq).toContainEqual({ table: 'categorie_metingen', col: 'team_id', val: 'team-1' })
  })

  it('negeert een gemanipuleerde payload: team_id komt altijd uit de sessie', async () => {
    zetKlokVast()
    const m = metMetingen()
    use(m)
    await saveCyclusWeekCorrectie(6)
    expect(m.calls.upsert[0].payload.team_id).toBe('team-1')
    expect(m.calls.upsert[0].payload.key).toBe('cyclus_week_correctie')
  })

  it('vernieuwt /periodisering en de trainingsplanner, niet het dashboard', async () => {
    zetKlokVast()
    use(metMetingen())
    await saveCyclusWeekCorrectie(6)
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/events/[id]/training-plan', 'page')
    expect(revalidatePath).not.toHaveBeenCalledWith('/')
  })

  it('accepteert de randweken 1 en 6', async () => {
    for (const week of [1, 6]) {
      zetKlokVast()
      const m = metMetingen()
      use(m)
      await saveCyclusWeekCorrectie(week)
      expect(m.calls.upsert[0].payload.value).toBe(`${week}|${VANDAAG}|2026-08-01`)
      vi.useRealTimers()
    }
  })

  it('weigert een week buiten 1..6 of een niet-geheel getal, zonder te schrijven (AC 6/7)', async () => {
    for (const week of [0, 7, 3.5, NaN, Infinity, -1]) {
      const m = metMetingen()
      use(m)
      await expect(saveCyclusWeekCorrectie(week)).rejects.toThrow('Ongeldige cyclusweek')
      expect(m.calls.upsert).toHaveLength(0)
    }
  })

  it('weigert niet-numerieke invoer zonder te schrijven (AC 7)', async () => {
    for (const week of ['3.5', '', 'abc', null, undefined]) {
      const m = metMetingen()
      use(m)
      await expect(saveCyclusWeekCorrectie(week as never)).rejects.toThrow('Ongeldige cyclusweek')
      expect(m.calls.upsert).toHaveLength(0)
    }
  })

  it('gooit "Niet ingelogd" zonder user, zonder te schrijven (AC 8)', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveCyclusWeekCorrectie(6)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('geeft bij een DB-fout de generieke melding, nooit de ruwe fout', async () => {
    zetKlokVast()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = metMetingen(undefined, { error: { code: '42501', message: 'permission denied for table settings' } })
    use(m)
    await expect(saveCyclusWeekCorrectie(6)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })

  it('levert bij twee correcties op dezelfde dag twee upserts met dezelfde sleutel op (edge)', async () => {
    zetKlokVast()
    const m = metMetingen()
    use(m)
    await saveCyclusWeekCorrectie(6)
    await saveCyclusWeekCorrectie(2)
    expect(m.calls.upsert).toHaveLength(2)
    expect(m.calls.upsert.map((u) => u.onConflict)).toEqual(['team_id,key', 'team_id,key'])
    expect(m.calls.upsert[1].payload.value).toBe(`2|${VANDAAG}|2026-08-01`)
  })
})

describe('deleteCyclusWeekCorrectie', () => {
  it('verwijdert de rij met zowel team_id als key als filter', async () => {
    const m = makeSupabase({ tables: { settings: { error: null } } })
    use(m)
    await deleteCyclusWeekCorrectie()

    expect(m.calls.delete).toHaveLength(1)
    expect(m.calls.delete[0].table).toBe('settings')
    // Zonder de key-filter zou dit álle settings van het team wissen.
    expect(m.calls.delete[0].eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'key', val: 'cyclus_week_correctie' },
    ])
  })

  it('vernieuwt /periodisering en de trainingsplanner, niet het dashboard', async () => {
    use(makeSupabase({ tables: { settings: { error: null } } }))
    await deleteCyclusWeekCorrectie()
    expect(revalidatePath).toHaveBeenCalledWith('/periodisering')
    expect(revalidatePath).toHaveBeenCalledWith('/events/[id]/training-plan', 'page')
    expect(revalidatePath).not.toHaveBeenCalledWith('/')
  })

  it('gooit "Niet ingelogd" zonder user, zonder delete', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(deleteCyclusWeekCorrectie()).rejects.toThrow('Niet ingelogd')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('geeft bij een DB-fout de generieke melding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = makeSupabase({ tables: { settings: { error: { code: '42501', message: 'permission denied' } } } })
    use(m)
    await expect(deleteCyclusWeekCorrectie()).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })
})
