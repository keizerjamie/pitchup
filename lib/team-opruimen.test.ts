// Tests voor lib/team-opruimen.ts — de gedeelde opruiming van één team.
//
// Twee aanroepers delen deze code: deleteAccount (per eigen team) en deleteTeam
// (één los team). BR 49 eist dat ze hetzelfde doen; dat kan alleen zolang er
// één implementatie is. Deze tests leggen die ene implementatie vast.
//
// Mock-smaak: een stub die de filters VASTLEGT (en niet toepast). Dat volstaat
// hier, want de functie leest niets — hij verwijdert alleen, en de vraag is
// precies welke delete met welk filter in welke volgorde gebeurt. Dat de
// deletes onder RLS ook echt werken staat in blok 22 van
// supabase/team-rls-verificatie.sql; vitest bewijst niets over RLS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'
import { TEAM_TABELLEN, actiefTeamNaVerlies, ruimTeamOp } from '@/lib/team-opruimen'
import type { SupabaseClient } from '@supabase/supabase-js'

const TEAM = '11111111-1111-4111-8111-111111111111'

type Eq = { col: string; val: unknown }

function makeSupabase(opts: {
  tableError?: { table: string; error: { code?: string; message: string } }
  storageError?: { code?: string; message: string }
} = {}) {
  const volgorde: string[] = []
  const deletes: { table: string; eqs: Eq[] }[] = []
  const storage: { bucket: string; paths: string[] }[] = []

  function chain(table: string) {
    const eqs: Eq[] = []
    const result = opts.tableError?.table === table
      ? { data: null, error: opts.tableError.error }
      : { data: null, error: null }
    const c: Record<string, unknown> = {}
    c.delete = () => { deletes.push({ table, eqs }); volgorde.push(table); return c }
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  const supabase = {
    from: (t: string) => chain(t),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          storage.push({ bucket, paths })
          volgorde.push('storage')
          return { data: opts.storageError ? null : [], error: opts.storageError ?? null }
        },
      }),
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, deletes, storage, volgorde }
}

let consoleError: ReturnType<typeof vi.spyOn>
function logged(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleError.mockRestore()
})

describe('TEAM_TABELLEN', () => {
  it('bevat de dertien teamtabellen in FK-veilige volgorde', () => {
    expect([...TEAM_TABELLEN]).toEqual([
      'training_oefeningen', 'task_overrides', 'match_squad', 'match_events',
      'match_ratings', 'lineups', 'attendance', 'absence_periods',
      'categorie_metingen', 'metingen', 'events', 'players', 'settings',
    ])
  })

  // Het gat uit de researcher-briefing: categorie_metingen heeft geen FK naar
  // events of players en cascadet dus nergens vanaf (AC 14).
  it('bevat categorie_metingen', () => {
    expect(TEAM_TABELLEN).toContain('categorie_metingen')
  })

  // Oefeningen zijn persoonlijk bezit (BR 54) en overleven een verwijderd team.
  it('bevat oefeningen NIET — alleen de koppelingen (training_oefeningen) gaan mee', () => {
    expect(TEAM_TABELLEN).not.toContain('oefeningen')
    expect(TEAM_TABELLEN).toContain('training_oefeningen')
  })

  // Kinderen vóór ouders: attendance/lineups/match_* en training_oefeningen
  // hangen aan events, events en players komen daarna, settings als laatste.
  it('wist de tabellen die aan events en players hangen vóór events en players zelf', () => {
    const pos = (t: string) => TEAM_TABELLEN.indexOf(t as (typeof TEAM_TABELLEN)[number])
    for (const kind of ['training_oefeningen', 'match_squad', 'match_events', 'match_ratings', 'lineups', 'attendance', 'absence_periods']) {
      expect(pos(kind), kind).toBeLessThan(pos('events'))
      expect(pos(kind), kind).toBeLessThan(pos('players'))
    }
  })
})

describe('ruimTeamOp', () => {
  it('verwijdert eerst het logo, dan de dertien tabellen en als laatste de teams-rij', async () => {
    const m = makeSupabase()
    await ruimTeamOp(m.supabase, TEAM, 'test.label')

    expect(m.volgorde).toEqual(['storage', ...TEAM_TABELLEN, 'teams'])
  })

  it('scoopt elke tabel-delete op team_id = dit team, en de teams-rij op zijn id', async () => {
    const m = makeSupabase()
    await ruimTeamOp(m.supabase, TEAM, 'test.label')

    for (const del of m.deletes) {
      expect(del.eqs, del.table).toEqual([{ col: del.table === 'teams' ? 'id' : 'team_id', val: TEAM }])
    }
  })

  it('haalt het logo uit de gedeelde bucket op het gedeelde pad (lib/logo-upload.ts)', async () => {
    const m = makeSupabase()
    await ruimTeamOp(m.supabase, TEAM, 'test.label')

    expect(m.storage).toEqual([{ bucket: TEAM_LOGO_BUCKET, paths: [teamLogoPath(TEAM)] }])
  })

  it('raakt oefeningen en team_members nooit rechtstreeks aan — dat laatste doet de cascade op teams', async () => {
    const m = makeSupabase()
    await ruimTeamOp(m.supabase, TEAM, 'test.label')

    const tabellen = m.deletes.map((d) => d.table)
    expect(tabellen).not.toContain('oefeningen')
    expect(tabellen).not.toContain('team_members')
    expect(tabellen).not.toContain('team_invites')
  })

  it('laat een storage-fout de opruiming niet blokkeren, maar logt hem met het label en zonder ruwe tekst', async () => {
    const m = makeSupabase({ storageError: { code: '404', message: `Object not found: ${TEAM}/logo` } })
    await ruimTeamOp(m.supabase, TEAM, 'test.label')

    expect(m.volgorde).toEqual(['storage', ...TEAM_TABELLEN, 'teams'])
    expect(logged()).toContain('test.label.storage')
    expect(logged()).not.toContain('Object not found')
    expect(logged()).not.toContain(TEAM)
  })

  it('stopt bij een tabelfout met een generieke melding; de teams-rij blijft dan staan', async () => {
    const m = makeSupabase({
      tableError: { table: 'events', error: { code: '42501', message: 'permission denied for table events' } },
    })

    await expect(ruimTeamOp(m.supabase, TEAM, 'test.label')).rejects.toThrow(GENERIC_ERROR_MESSAGE)

    const tabellen = m.deletes.map((d) => d.table)
    expect(tabellen).toEqual(TEAM_TABELLEN.slice(0, TEAM_TABELLEN.indexOf('events') + 1))
    expect(tabellen).not.toContain('teams')
    // Het label per stap maakt de mislukking terug te vinden — zonder
    // team-id (een tenant-sleutel) en zonder de ruwe databasefout.
    expect(logged()).toContain('test.label.events')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('permission denied')
    expect(logged()).not.toContain(TEAM)
  })

  it('gooit ook als de teams-rij zelf niet weg kan', async () => {
    const m = makeSupabase({ tableError: { table: 'teams', error: { code: '42501', message: 'nope' } } })

    await expect(ruimTeamOp(m.supabase, TEAM, 'test.label')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(logged()).toContain('test.label.teams')
  })
})

describe('actiefTeamNaVerlies', () => {
  // Alfabetisch gesorteerd zoals getTeamContext ze aanlevert.
  const teams = [{ teamId: 'a' }, { teamId: 'b' }, { teamId: 'c' }]

  it('houdt het actieve team als een ANDER team wegvalt', () => {
    expect(actiefTeamNaVerlies(teams, 'c', 'b')).toBe('b')
  })

  it('schakelt naar het eerstvolgende team in de lijst als het actieve wegvalt (AC 17/53)', () => {
    expect(actiefTeamNaVerlies(teams, 'a', 'a')).toBe('b')
    expect(actiefTeamNaVerlies(teams, 'b', 'b')).toBe('a')
  })

  it('geeft null als er geen team overblijft (lege staat, AC 16)', () => {
    expect(actiefTeamNaVerlies([{ teamId: 'a' }], 'a', 'a')).toBeNull()
  })

  it('valt terug op het eerste overgebleven team als het "actieve" id niet (meer) in de lijst staat', () => {
    expect(actiefTeamNaVerlies(teams, 'a', 'bestaat-niet')).toBe('b')
  })
})
