import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  addOefeningToTraining,
  createAndAddOefening,
  removeOefeningFromTraining,
  updateKoppeling,
  reorderKoppelingen,
  saveSpelerindeling,
  vormParallelGroep,
  voegToeAanParallelGroep,
  haalUitParallelGroep,
  saveParallelIndeling,
  verplaatsParallelSpeler,
} from '@/app/actions/training-plan'

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  // Per tabel meerdere opeenvolgende antwoorden, in volgorde van afhandeling.
  // Nodig voor de parallelle-groep-acties, die training_oefeningen meerdere
  // keren aanspreken (de koppeling zelf, de andere groepsleden, de updates en
  // de blok-normalisatie) met verschillende vormen. Zelfde patroon als
  // app/actions/attendance.test.ts.
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    // `eqs` wijst naar de eq-filters van ÉÉN statement (één from()-keten), zodat
    // een test kan bewijzen dat juist die select/update tenant-gescoped is —
    // de vlakke `eq`-lijst mengt alle statements door elkaar.
    select: [] as { table: string; cols: unknown; eqs: Eq[] }[],
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string }[],
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
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, eqs }); return c }
    c.delete = () => { calls.delete.push({ table }); return c }
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

// Welke volgorde is er per koppeling weggeschreven? De id komt uit de
// eq-filters van diezelfde update, zodat de assertie niet van de volgorde van
// de update-aanroepen afhangt.
function volgordePerId(m: ReturnType<typeof makeSupabase>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const u of m.calls.update) {
    const id = u.eqs.find((e) => e.col === 'id')?.val as string
    out[id] = u.payload.volgorde
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addOefeningToTraining', () => {
  it('gebruikt volgorde = max + 1', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: 4 }, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'o1')
    const insert = m.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.volgorde).toBe(5)
    expect(insert.payload.team_id).toBe('team-1')
    expect(insert.payload.event_id).toBe('e1')
    expect(insert.payload.oefening_id).toBe('o1')
  })

  it('gooit "Oefening niet gevonden" bij een oefening van een ander team', async () => {
    use(makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: null },
      },
    }))
    await expect(addOefeningToTraining('e1', 'vreemd')).rejects.toThrow('Oefening niet gevonden')
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: null },
        oefeningen: { data: { id: 'o1' } },
      },
    })
    use(m)
    await expect(addOefeningToTraining('vreemd', 'o1')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
  })

  it('voegt dezelfde oefening een tweede keer toe als een NIEUWE rij onderaan', async () => {
    // Eerste keer: nog niets in de training → volgorde 0.
    const eerste = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(eerste)
    await addOefeningToTraining('e1', 'o1')
    expect(eerste.calls.insert.filter((i) => i.table === 'training_oefeningen')).toHaveLength(1)
    expect(eerste.calls.insert[0].payload.volgorde).toBe(0)

    // Tweede keer dezelfde oefening: geen no-op, maar een insert met max + 1.
    const tweede = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: 0 }, error: null },
      },
    })
    use(tweede)
    await addOefeningToTraining('e1', 'o1')
    const insert = tweede.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.volgorde).toBe(1)
    expect(insert.payload.oefening_id).toBe('o1')
    expect(insert.payload.team_id).toBe('team-1')
  })

  it('leest de hoogste volgorde tenant-gescoped op event_id + team_id', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: { volgorde: 2 }, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'o1')
    const volgordeSelect = m.calls.select.find((sel) => sel.table === 'training_oefeningen')!
    expect(volgordeSelect.eqs).toContainEqual({ col: 'event_id', val: 'e1' })
    expect(volgordeSelect.eqs).toContainEqual({ col: 'team_id', val: 'team-1' })
  })

  it('gooit de generieke fout bij een insert-fout (geen stille no-op meer)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o1' } },
        training_oefeningen: { data: null, error: { code: '23505', message: 'duplicate' } },
      },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'o1')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(addOefeningToTraining('e1', 'o1')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.insert).toHaveLength(0)
  })
})

describe('updateKoppeling', () => {
  // Koppeling met een gejoinde bibliotheek-oefening in de gegeven categorie.
  function metCategorie(categorie: string) {
    return makeSupabase({
      tables: {
        training_oefeningen: { data: { id: 'k1', oefeningen: { categorie } }, error: null },
      },
    })
  }

  it('raakt alleen de opgegeven koppeling van dit team', async () => {
    const m = metCategorie('partijen_groot')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: 5 })
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload.stap_override).toBe(5)
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('clamt stap_override op het maximum van de categorie van de koppeling', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: 40 })
    expect(m.calls.update[0].payload.stap_override).toBe(13)
  })

  it('clamt steigerungs op 5', async () => {
    const m = metCategorie('steigerungs')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: 9 })
    expect(m.calls.update[0].payload.stap_override).toBe(5)
  })

  it('clamt een categorie zonder brondata op 99', async () => {
    const m = metCategorie('overig')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: 150 })
    expect(m.calls.update[0].payload.stap_override).toBe(99)
  })

  it('haalt de categorie server-side op, gescoped op id + event_id + team_id', async () => {
    // Koppeling van een ander team/andere training → select vindt niets.
    // Precies daarom staan de assertions op DIT pad: de eq-filters die de mock
    // registreert komen dan uitsluitend van de categorie-select.
    const m = makeSupabase({ tables: { training_oefeningen: { data: null } } })
    use(m)
    await expect(updateKoppeling('vreemd', 'e1', { stap_override: 5 }))
      .rejects.toThrow('Koppeling niet gevonden')

    const select = m.calls.select.find((s) => s.table === 'training_oefeningen')!
    expect(select.eqs).toEqual([
      { col: 'id', val: 'vreemd' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
    // Niets weggeschreven zonder gevonden koppeling.
    expect(m.calls.update).toHaveLength(0)
  })

  it('wist de override zonder extra select (er valt niets te clampen)', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: null })
    expect(m.calls.select.filter((s) => s.table === 'training_oefeningen')).toHaveLength(0)
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload.stap_override).toBeNull()
  })

  it('scoped de eind-update op id + event_id + team_id', async () => {
    // Patch zonder categorie-select, zodat alle eq-filters van de update komen.
    const m = metCategorie('partijen_klein')
    use(m)
    await updateKoppeling('k1', 'e1', { stap_override: null })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('laat het volgorde-pad ongemoeid (geen categorie-select, eigen clamp)', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    await updateKoppeling('k1', 'e1', { volgorde: 99_999 })
    expect(m.calls.select.filter((s) => s.table === 'training_oefeningen')).toHaveLength(0)
    expect(m.calls.update[0].payload.volgorde).toBe(32767)
  })

  it('weigert nesting in zichzelf', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    await expect(updateKoppeling('k1', 'e1', { genest_in: 'k1' }))
      .rejects.toThrow('Kan niet in zichzelf nesten')
    expect(m.calls.update).toHaveLength(0)
  })

  it('weigert een ouder buiten deze training/dit team', async () => {
    const m = makeSupabase({ tables: { training_oefeningen: { data: null } } })
    use(m)
    await expect(updateKoppeling('k1', 'e1', { genest_in: 'vreemd' }))
      .rejects.toThrow('Ongeldige nesting')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(updateKoppeling('k1', 'e1', { stap_override: 5 })).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('removeOefeningFromTraining', () => {
  it('verwijdert alleen de koppeling, niet het bibliotheekitem', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, training_oefeningen: { error: null } },
    })
    use(m)
    await removeOefeningFromTraining('k1', 'e1')
    expect(m.calls.delete).toContainEqual({ table: 'training_oefeningen' })
    expect(m.calls.delete.some((d) => d.table === 'oefeningen')).toBe(false)
    // Zowel het lezen van de groep als de delete zelf is op event + team gescoped.
    const select = m.calls.select.find((s) => s.table === 'training_oefeningen')!
    expect(select.eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'event_id', val: 'e1' })
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(removeOefeningFromTraining('k1', 'vreemd')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.delete).toHaveLength(0)
  })

  it('laat de parallelle groep vervallen als er nog één lid overblijft', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },  // groep vóór het verwijderen
          { error: null },                                   // de delete zelf
          { data: [{ id: 'k2' }] },                          // resterende leden
          { error: null },                                   // opruim-update
          { data: [{ id: 'k2', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' }] },
        ],
      },
    })
    use(m)
    await removeOefeningFromTraining('k1', 'e1')

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload).toEqual({ parallel_groep_id: null, parallel_spelers: [] })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k2' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('laat een groep met twee overgebleven leden intact', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { error: null },
          { data: [{ id: 'k2' }, { id: 'k3' }] },
          { data: [
            { id: 'k2', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)
    await removeOefeningFromTraining('k1', 'e1')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('reorderKoppelingen', () => {
  it('werkt volgorde per koppeling bij, tenant-gescoped', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 2, parallel_groep_id: null, created_at: '2024-01-03T00:00:00Z' },
          ] },
          { error: null },
        ],
      },
    })
    use(m)
    await reorderKoppelingen('e1', ['k3', 'k1', 'k2'])

    // Eén update per koppeling, met de nieuwe blok-index als volgorde.
    expect(m.calls.update).toHaveLength(3)
    expect(m.calls.update.every((u) => u.table === 'training_oefeningen')).toBe(true)
    expect(volgordePerId(m)).toEqual({ k3: 0, k1: 1, k2: 2 })

    // Elke update is gescoped op id + event_id + team_id.
    for (const id of ['k3', 'k1', 'k2']) {
      expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: id })
    }
    for (const u of m.calls.update) {
      expect(u.eqs).toContainEqual({ col: 'event_id', val: 'e1' })
      expect(u.eqs).toContainEqual({ col: 'team_id', val: 'team-1' })
    }
  })

  it('geeft alle leden van één parallelle groep dezelfde volgorde', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 2, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
            { id: 'k4', volgorde: 3, parallel_groep_id: null, created_at: '2024-01-04T00:00:00Z' },
          ] },
          { error: null },
        ],
      },
    })
    use(m)
    await reorderKoppelingen('e1', ['k2', 'k3', 'k1', 'k4'])

    // De groep vormt één blok (volgorde 0), de losse koppelingen krijgen
    // oplopende, aaneengesloten blok-nummers.
    expect(volgordePerId(m)).toEqual({ k2: 0, k3: 0, k1: 1, k4: 2 })
  })

  it('schrijft niets als de blok-volgorde al klopt', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
          { error: null },
        ],
      },
    })
    use(m)
    await reorderKoppelingen('e1', ['k1', 'k2', 'k3'])
    expect(m.calls.update).toHaveLength(0)
  })

  it('respecteert assertOwnEvent (event van ander team → niet gevonden)', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(reorderKoppelingen('vreemd', ['k1'])).rejects.toThrow('Event niet gevonden')
    // Geen enkele koppeling aangeraakt.
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('saveSpelerindeling', () => {
  const twoTeams = { teams: [{ grootte: 6, formaties: [] }, { grootte: 6, formaties: [] }] }

  it('schrijft de genormaliseerde indeling alleen naar training_oefeningen, tenant-gescoped', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
      },
    })
    use(m)
    await saveSpelerindeling('k1', 'e1', [['p1'], ['p2']])

    // Precies één update, uitsluitend op training_oefeningen (nooit oefeningen).
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload.spelerindeling).toEqual([['p1'], ['p2']])
    expect(m.calls.update.some((u) => u.table === 'oefeningen')).toBe(false)

    // Update is gescoped op id + team_id.
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'id', val: 'k1' })
    expect(m.calls.eq).toContainEqual({ table: 'training_oefeningen', col: 'team_id', val: 'team-1' })
  })

  it('scoped de players-validatiequery (voor toegestane player_id\'s) op team_id van de ingelogde user', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
      },
    })
    use(m)
    await saveSpelerindeling('k1', 'e1', [['p1'], ['p2']])

    // Valt deze scoping ooit weg, dan accepteert validateSpelerindeling
    // player_id's van een ander team — alleen RLS zou dat dan nog afvangen.
    expect(m.calls.eq).toContainEqual({ table: 'players', col: 'team_id', val: 'team-1' })
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    use(makeSupabase({ user: null }))
    await expect(saveSpelerindeling('k1', 'e1', [])).rejects.toThrow('Niet ingelogd')
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(saveSpelerindeling('k1', 'vreemd', [])).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" bij een koppeling van een ander team', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: null },
      },
    })
    use(m)
    await expect(saveSpelerindeling('vreemd', 'e1', [])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Speler niet gevonden" bij een player_id buiten de tenant', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: twoTeams }, error: null },
        players: { data: [{ id: 'p1' }] },
      },
    })
    use(m)
    await expect(saveSpelerindeling('k1', 'e1', [['p1', 'vreemd']])).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Team bestaat niet in deze oefening" bij een teamIndex buiten de teams-lengte', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: { teams: [{ grootte: 6, formaties: [] }] } }, error: null },
        players: { data: [{ id: 'p1' }, { id: 'p2' }] },
      },
    })
    use(m)
    await expect(saveSpelerindeling('k1', 'e1', [['p1'], ['p2']]))
      .rejects.toThrow('Team bestaat niet in deze oefening')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('createAndAddOefening', () => {
  const input = {
    naam: 'Rondo',
    categorie: 'partijen_klein' as const,
    teams: [],
    aantal_neutralen: 0,
  }

  it('schrijft de teams canoniek weg: key + keeperInGrootte', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o-new' }, error: null },
        training_oefeningen: { data: { id: 'k1' }, error: null },
      },
    })
    use(m)
    await createAndAddOefening('e1', {
      ...input,
      teams: [
        { grootte: 6, formaties: ['3-2'] },                            // label → key
        { grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false },  // zonder keeper
      ],
    })
    const oefening = m.calls.insert.find((i) => i.table === 'oefeningen')!
    expect(oefening.payload.teams).toEqual([
      { grootte: 6, formaties: ['3-0-2'], keeperInGrootte: true },
      { grootte: 6, formaties: ['3-2-1'], keeperInGrootte: false },
    ])
    expect(oefening.payload.team_id).toBe('team-1')
  })

  it('weigert meer dan één formatie per team', async () => {
    use(makeSupabase({ tables: { events: { data: { id: 'e1' } } } }))
    await expect(
      createAndAddOefening('e1', { ...input, teams: [{ grootte: 6, formaties: ['3-0-2', '2-2-1'] }] }),
    ).rejects.toThrow('Maximaal één formatie per team')
  })

  it('propageert een fout bij het koppelen (geen halve staat)', async () => {
    // Oefening-insert slaagt (geeft id terug), maar de koppel-insert faalt.
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'o-new' }, error: null },
        training_oefeningen: { data: null, error: { code: 'XXXXX', message: 'link kapot' } },
      },
    })
    use(m)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // De fout propageert, maar met een generieke melding: de ruwe
    // database-melding mag de client niet bereiken (zie lib/errors.ts).
    let err: Error | null = null
    try {
      await createAndAddOefening('e1', input)
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toBe(GENERIC_ERROR_MESSAGE)
    expect(err?.message).not.toContain('link kapot')
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('link kapot')
    consoleError.mockRestore()
    // De bibliotheek-oefening is wel aangemaakt; de koppeling-insert is geprobeerd.
    expect(m.calls.insert.some((i) => i.table === 'oefeningen')).toBe(true)
    expect(m.calls.insert.some((i) => i.table === 'training_oefeningen')).toBe(true)
  })
})

// ────────────────────────────────────────────────
// Parallelle oefeningen
// ────────────────────────────────────────────────
// player_id's zijn UUID's; saveParallelIndeling keurt elke andere vorm af.
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const VREEMDE_SPELER = '99999999-9999-4999-8999-999999999999'

describe('vormParallelGroep', () => {
  // Rijen zoals de blok-normalisatie ze ná de groepsupdate terugleest: beide
  // leden zitten dan in dezelfde groep en delen al volgorde 0.
  const naGroepering = {
    data: [
      { id: 'k1', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-01T00:00:00Z' },
      { id: 'k2', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-02T00:00:00Z' },
    ],
  }

  it('schrijft dezelfde groepId naar alle leden en geeft die terug', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: null }, { id: 'k2', parallel_groep_id: null }] },
          { error: null },
          { error: null },
          naGroepering,
        ],
      },
    })
    use(m)
    const { groepId } = await vormParallelGroep('e1', ['k1', 'k2'])

    expect(typeof groepId).toBe('string')
    expect(m.calls.update).toHaveLength(2)
    for (const u of m.calls.update) {
      expect(u.table).toBe('training_oefeningen')
      expect(u.payload).toEqual({ parallel_groep_id: groepId })
    }
    // Elke update gescoped op id + event_id + team_id.
    expect(m.calls.update.map((u) => u.eqs)).toEqual([
      [{ col: 'id', val: 'k1' }, { col: 'event_id', val: 'e1' }, { col: 'team_id', val: 'team-1' }],
      [{ col: 'id', val: 'k2' }, { col: 'event_id', val: 'e1' }, { col: 'team_id', val: 'team-1' }],
    ])
  })

  it('leest de leden gescoped op event_id + team_id', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: null }, { id: 'k2', parallel_groep_id: null }] },
          { error: null },
          { error: null },
          naGroepering,
        ],
      },
    })
    use(m)
    await vormParallelGroep('e1', ['k1', 'k2'])

    const select = m.calls.select.find((s) => s.table === 'training_oefeningen')!
    expect(select.eqs).toEqual([
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('gooit bij minder dan twee unieke koppelingen', async () => {
    const m = makeSupabase({ tables: { events: { data: { id: 'e1' } } } })
    use(m)
    await expect(vormParallelGroep('e1', ['k1']))
      .rejects.toThrow('Minimaal twee oefeningen voor een parallelle groep')
    // Dubbel aangeleverd id telt maar één keer.
    await expect(vormParallelGroep('e1', ['k1', 'k1']))
      .rejects.toThrow('Minimaal twee oefeningen voor een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" als een id niet in deze training van dit team zit', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: [{ id: 'k1', parallel_groep_id: null }] },
      },
    })
    use(m)
    await expect(vormParallelGroep('e1', ['k1', 'vreemd'])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit als een lid al in een parallelle groep zit', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: [
          { id: 'k1', parallel_groep_id: null },
          { id: 'k2', parallel_groep_id: 'g-bestaand' },
        ] },
      },
    })
    use(m)
    await expect(vormParallelGroep('e1', ['k1', 'k2']))
      .rejects.toThrow('Koppeling zit al in een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(vormParallelGroep('e1', ['k1', 'k2'])).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(vormParallelGroep('vreemd', ['k1', 'k2'])).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('voegToeAanParallelGroep', () => {
  // Na het toevoegen delen alle drie de leden groep g1 en volgorde 0.
  const naToevoegen = {
    data: [
      { id: 'k1', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z' },
      { id: 'k2', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
      { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
    ],
  }

  it('zet de nieuwkomer in de groep met een lege indeling en raakt geen andere rij aan', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k3', parallel_groep_id: null } },  // de koppeling zelf
          { data: { id: 'k1' } },                            // bestaand lid van g1
          { error: null },                                   // de update
          naToevoegen,                                       // blok-normalisatie
        ],
      },
    })
    use(m)
    await voegToeAanParallelGroep('e1', 'k3', 'g1')

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload).toEqual({ parallel_groep_id: 'g1', parallel_spelers: [] })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k3' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('gooit "Ongeldige parallelle groep" als de groep niet in deze training bestaat', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k3', parallel_groep_id: null } },
          { data: null },  // geen enkel lid met dit groep-id binnen event + team
        ],
      },
    })
    use(m)
    await expect(voegToeAanParallelGroep('e1', 'k3', 'groep-van-ander-team'))
      .rejects.toThrow('Ongeldige parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" bij een koppeling van een ander team of event', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, training_oefeningen: { data: null } },
    })
    use(m)
    await expect(voegToeAanParallelGroep('e1', 'vreemd', 'g1'))
      .rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit als de koppeling al in een groep zit', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k3', parallel_groep_id: 'g9' } },
      },
    })
    use(m)
    await expect(voegToeAanParallelGroep('e1', 'k3', 'g1'))
      .rejects.toThrow('Koppeling zit al in een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(voegToeAanParallelGroep('e1', 'k3', 'g1')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(voegToeAanParallelGroep('vreemd', 'k3', 'g1')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('haalUitParallelGroep', () => {
  it('wist parallel_groep_id én parallel_spelers van de koppeling', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { error: null },                          // de update
          { data: [{ id: 'k2' }, { id: 'k3' }] },   // groep houdt twee leden
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 1, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)
    await haalUitParallelGroep('e1', 'k1')

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload).toEqual({ parallel_groep_id: null, parallel_spelers: [] })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('laat de groep vervallen als er nog één lid overblijft', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { error: null },              // update k1
          { data: [{ id: 'k2' }] },     // enig overgebleven lid
          { error: null },              // update k2
          { data: [
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)
    await haalUitParallelGroep('e1', 'k1')

    expect(m.calls.update).toHaveLength(2)
    expect(m.calls.update[1].payload).toEqual({ parallel_groep_id: null, parallel_spelers: [] })
    expect(m.calls.update[1].eqs).toEqual([
      { col: 'id', val: 'k2' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('is idempotent voor een koppeling zonder groep (geen fout, geen opruiming)', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', parallel_groep_id: null }, error: null },
      },
    })
    use(m)
    await expect(haalUitParallelGroep('e1', 'k1')).resolves.toBeUndefined()
    expect(m.calls.update).toHaveLength(1)
  })

  it('gooit "Koppeling niet gevonden" bij een koppeling van een ander team', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, training_oefeningen: { data: null } },
    })
    use(m)
    await expect(haalUitParallelGroep('e1', 'vreemd')).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(haalUitParallelGroep('e1', 'k1')).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(haalUitParallelGroep('vreemd', 'k1')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('saveParallelIndeling', () => {
  // Koppeling in groep g1, met één ander groepslid waarop P3 al staat.
  function inGroep(andereSpelers: string[] = [P3]) {
    return {
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }, { id: P2 }, { id: P3 }] },
      },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } },
          { data: [{ id: 'k2', parallel_spelers: andereSpelers }] },
          { error: null },
        ],
      },
    }
  }

  it('schrijft de indeling alleen naar training_oefeningen, tenant-gescoped', async () => {
    const m = makeSupabase(inGroep())
    use(m)
    await saveParallelIndeling('k1', 'e1', [P1, P2])

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('training_oefeningen')
    expect(m.calls.update[0].payload).toEqual({ parallel_spelers: [P1, P2] })
    expect(m.calls.update.some((u) => u.table === 'oefeningen')).toBe(false)
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
    // De validatieset met toegestane player_id's is op het eigen team gescoped.
    expect(m.calls.eq).toContainEqual({ table: 'players', col: 'team_id', val: 'team-1' })
  })

  it('gooit "Speler in meerdere oefeningen" bij overlap met een ander groepslid', async () => {
    const m = makeSupabase(inGroep([P2]))
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P1, P2]))
      .rejects.toThrow('Speler in meerdere oefeningen')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Speler niet gevonden" bij een player_id buiten de tenant', async () => {
    const m = makeSupabase(inGroep())
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P1, VREEMDE_SPELER]))
      .rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Ongeldige indeling" bij een id dat geen UUID is', async () => {
    const m = makeSupabase(inGroep())
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', ['p1'])).rejects.toThrow('Ongeldige indeling')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit als de koppeling niet in een parallelle groep zit', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', parallel_groep_id: null } },
      },
    })
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P1]))
      .rejects.toThrow('Koppeling zit niet in een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" bij een koppeling van een ander team of event', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } }, training_oefeningen: { data: null } },
    })
    use(m)
    await expect(saveParallelIndeling('vreemd', 'e1', [P1])).rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(saveParallelIndeling('k1', 'e1', [P1])).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(saveParallelIndeling('k1', 'vreemd', [P1])).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

describe('verplaatsParallelSpeler', () => {
  // k1 en k2 zitten in groep g1; P1 staat bij k1, P2 bij k2. De queue-volgorde
  // volgt de aanroepen: beide leden lezen, overige groepsleden lezen, bron-
  // update, doel-update.
  function inGroep(opts: { naarUpdate?: TableResult } = {}) {
    return {
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }, { id: P2 }, { id: P3 }] },
      },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P1] },
            { id: 'k2', parallel_groep_id: 'g1', parallel_spelers: [P2] },
          ] },
          { data: [] },
          { error: null },
          opts.naarUpdate ?? { error: null },
          { error: null },
        ],
      },
    }
  }

  it('haalt de speler bij de bron weg en zet hem bij het doel, event- en tenant-gescoped', async () => {
    const m = makeSupabase(inGroep())
    use(m)
    await verplaatsParallelSpeler('e1', 'k1', 'k2', P1)

    expect(m.calls.update).toHaveLength(2)
    expect(m.calls.update[0].payload).toEqual({ parallel_spelers: [] })
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.update[1].payload).toEqual({ parallel_spelers: [P2, P1] })
    expect(m.calls.update[1].eqs).toEqual([
      { col: 'id', val: 'k2' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('draait de bron-update terug als de doel-update faalt', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = makeSupabase(inGroep({ naarUpdate: { error: { code: '42501', message: 'nope' } } }))
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()

    // Derde update = compensatie: de bron staat weer op zijn oude indeling.
    expect(m.calls.update).toHaveLength(3)
    expect(m.calls.update[2].payload).toEqual({ parallel_spelers: [P1] })
    expect(m.calls.update[2].eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })

  it('gooit "Speler in meerdere oefeningen" bij overlap met een ander groepslid', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        players: { data: [{ id: P1 }, { id: P2 }, { id: P3 }] },
      },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P1] },
            { id: 'k2', parallel_groep_id: 'g1', parallel_spelers: [] },
          ] },
          { data: [{ id: 'k3', parallel_spelers: [P1] }] },
        ],
      },
    })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1))
      .rejects.toThrow('Speler in meerdere oefeningen')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Speler niet gevonden" als de speler niet bij de bron staat', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P2] },
            { id: 'k2', parallel_groep_id: 'g1', parallel_spelers: [] },
          ] },
        ],
      },
    })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1)).rejects.toThrow('Speler niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit als de leden niet in dezelfde parallelle groep zitten', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P1] },
            { id: 'k2', parallel_groep_id: 'g2', parallel_spelers: [] },
          ] },
        ],
      },
    })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1))
      .rejects.toThrow('Koppelingen zitten niet in dezelfde parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit als een van de leden geen parallelle groep heeft', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [
            { id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P1] },
            { id: 'k2', parallel_groep_id: null, parallel_spelers: [] },
          ] },
        ],
      },
    })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1))
      .rejects.toThrow('Koppeling zit niet in een parallelle groep')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Koppeling niet gevonden" als een van de leden buiten deze training valt', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: 'g1', parallel_spelers: [P1] }] },
        ],
      },
    })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'vreemd', P1))
      .rejects.toThrow('Koppeling niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit bij een verplaatsing naar hetzelfde lid', async () => {
    const m = makeSupabase({ tables: { events: { data: { id: 'e1' } } } })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k1', P1))
      .rejects.toThrow('Bron en doel zijn dezelfde oefening')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Niet ingelogd" zonder user', async () => {
    const m = makeSupabase({ user: null })
    use(m)
    await expect(verplaatsParallelSpeler('e1', 'k1', 'k2', P1)).rejects.toThrow('Niet ingelogd')
    expect(m.calls.update).toHaveLength(0)
  })

  it('gooit "Event niet gevonden" bij een event van een ander team', async () => {
    const m = makeSupabase({ tables: { events: { data: null } } })
    use(m)
    await expect(verplaatsParallelSpeler('vreemd', 'k1', 'k2', P1)).rejects.toThrow('Event niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})
