// Acceptatietests — Afmeldperiodes (user story: als coach wil ik dat een
// afmelding voor een periode automatisch wordt toegepast op elke training en
// wedstrijd binnen die periode — ook op events die pas ná de afmelding worden
// aangemaakt — en wil ik een eerder geregistreerde periode ook weer kunnen
// intrekken (inclusief het terugdraaien van de daardoor veroorzaakte
// afwezigheden), zodat mijn wedstrijdselectie en trainingsopkomst altijd het
// werkelijke aantal beschikbare spelers tonen).
//
// ── Testmethode ──
// Dit bestand roept de ECHTE server actions aan (markAbsentForPeriod,
// revokeAbsencePeriod, createEvent, generateSeasonTrainings, markRecovered)
// tegen één gedeelde, FILTERENDE in-memory Supabase-mock (zelfde precedent
// als de tableFactory in wedstrijdselectie.acceptance.test.tsx en
// dashboard-vorm.acceptance.test.tsx) — geen call-recording mocks die alleen
// "is aangeroepen met X" checken. Voor Story-AC3 wordt daarnaast de ECHTE
// route /events/[id]/squad/page.tsx gerenderd, zelfde precedent als
// renderSquadPage() in wedstrijdselectie.acceptance.test.tsx.
//
// De mock-DB is uitgebreid t.o.v. dat precedent met .gte/.lte/.is (nodig voor
// de periode-queries en markRecovered) en ECHTE .insert()/.upsert()/
// .update()/.delete() die de in-memory rijenset muteren — noodzakelijk omdat
// deze story juist over de interactie tussen meerdere server actions op
// DEZELFDE data gaat (registreer periode → maak event aan → trek periode in),
// niet over één geïsoleerde call. .upsert() volgt het ECHTE Postgres
// ON CONFLICT ... DO UPDATE SET-gedrag: kolommen die niet in de payload staan
// blijven ongewijzigd (Object.assign met een object zonder die key raakt hem
// niet aan) — dat is precies het gedrag dat updateAttendance/markInjured
// gebruiken om absence_period_id nooit onbedoeld te wissen.
//
// ── Nummering ──
// De AC-nummers hieronder (AC1..AC23) volgen exact de genummerde
// acceptatiecriteria uit de goedgekeurde user story.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('__notFound__')
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { markAbsentForPeriod, revokeAbsencePeriod, updateAttendance } from '@/app/actions/attendance'
import { createEvent } from '@/app/actions/events'
import { generateSeasonTrainings } from '@/app/actions/settings'
import { markInjured, markRecovered } from '@/app/actions/players'
import { saveNulmeting } from '@/app/actions/training-plan'
import MatchSquadPage from '@/app/events/[id]/squad/page'

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
// ── In-memory, filterende Supabase-mock (gedeelde DB per test) ──
// ═══════════════════════════════════════════════════════════════════════
type Row = Record<string, unknown>

function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }))
  // Monotoon oplopende created_at: garandeert dat `.order('created_at')` de
  // ECHTE aanroepvolgorde weerspiegelt, nodig om Story-AC16 (herkomst bij
  // overlappende periodes) deterministisch te kunnen bewijzen.
  let seq = 0
  const nextCreatedAt = () => new Date(Date.UTC(2020, 0, 1) + seq++).toISOString()

  function table(name: string): Row[] {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  function from(name: string) {
    const rows = table(name)
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let onConflictCols: string[] | null = null

    function matches(r: Row) {
      return filters.every((f) => f(r))
    }
    function applyOrder(list: Row[]): Row[] {
      if (orders.length === 0) return list
      return [...list].sort((a, b) => {
        for (const o of orders) {
          const av = a[o.col] as string | number | null | undefined
          const bv = b[o.col] as string | number | null | undefined
          const aNull = av === null || av === undefined
          const bNull = bv === null || bv === undefined
          if (aNull && bNull) continue
          if (aNull) return o.nullsFirst ? -1 : 1
          if (bNull) return o.nullsFirst ? 1 : -1
          if (av! < bv!) return o.ascending ? -1 : 1
          if (av! > bv!) return o.ascending ? 1 : -1
        }
        return 0
      })
    }
    function execSelect(): Row[] {
      let out = rows.filter(matches)
      out = applyOrder(out)
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }
    function execInsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const inserted: Row[] = []
      for (const item of items) {
        const row: Row = { id: randomUUID(), created_at: nextCreatedAt(), ...item }
        rows.push(row)
        inserted.push(row)
      }
      return { data: inserted, error: null }
    }
    function execUpsert() {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
      const result: Row[] = []
      for (const item of items) {
        let existing: Row | undefined
        if (onConflictCols) existing = rows.find((r) => onConflictCols!.every((c) => r[c] === item[c]))
        if (existing) {
          // ECHTE Postgres ON CONFLICT DO UPDATE SET-semantiek: alleen de
          // kolommen die in `item` staan worden overschreven.
          Object.assign(existing, item)
          result.push(existing)
        } else {
          const row: Row = { id: randomUUID(), created_at: nextCreatedAt(), ...item }
          rows.push(row)
          result.push(row)
        }
      }
      return { data: result, error: null }
    }
    function execUpdate() {
      const targets = rows.filter(matches)
      for (const t of targets) Object.assign(t, payload)
      return { data: targets, error: null }
    }
    function execDelete() {
      const targets = rows.filter(matches)
      for (const t of targets) {
        const idx = rows.indexOf(t)
        if (idx >= 0) rows.splice(idx, 1)
      }
      if (name === 'absence_periods') {
        // ON DELETE SET NULL (schema): vangnet, revokeAbsencePeriod herstelt
        // zelf al expliciet vóór het verwijderen.
        for (const t of targets) {
          for (const a of table('attendance')) {
            if (a.absence_period_id === t.id) a.absence_period_id = null
          }
        }
      }
      return { data: targets, error: null }
    }
    function resolve() {
      if (mode === 'insert') return execInsert()
      if (mode === 'upsert') return execUpsert()
      if (mode === 'update') return execUpdate()
      if (mode === 'delete') return execDelete()
      return { data: execSelect(), error: null }
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
        return chain
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) < (val as string | number))
        return chain
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) <= (val as string | number))
        return chain
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) >= (val as string | number))
        return chain
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      insert: (p: Row | Row[]) => {
        mode = 'insert'
        payload = p
        return chain
      },
      upsert: (p: Row | Row[], opts: { onConflict?: string } = {}) => {
        mode = 'upsert'
        payload = p
        onConflictCols = opts.onConflict ? opts.onConflict.split(',') : null
        return chain
      },
      update: (p: Row) => {
        mode = 'update'
        payload = p
        return chain
      },
      delete: () => {
        mode = 'delete'
        return chain
      },
      single: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      maybeSingle: async () => {
        const { data, error } = resolve()
        const arr = Array.isArray(data) ? data : [data]
        return { data: arr[0] ?? null, error }
      },
      then: (onres: (v: { data: unknown; error: unknown }) => unknown, onrej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onres, onrej),
    }
    return chain
  }

  return { tables, from }
}

function makeClient(db: ReturnType<typeof makeDb>, user: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => db.from(t),
  }
}

function useDb(db: ReturnType<typeof makeDb>, user: { id: string } | null = { id: TEAM }) {
  vi.mocked(createClient).mockResolvedValue(
    makeClient(db, user) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
}

// ── Testdata-fabrieken ──
const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

function playerRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    team_id: TEAM,
    name: 'Speler X',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function eventRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    team_id: TEAM,
    type: 'training',
    date: '2026-08-10',
    time: '19:00',
    location: null,
    match_type: null,
    opponent: null,
    home_away: null,
    gather_time: null,
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function attendanceRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    team_id: TEAM,
    event_id: 'e1',
    player_id: 'p1',
    status: 'unknown',
    injury_set: false,
    absence_period_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function periodRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    team_id: TEAM,
    player_id: 'p1',
    from_date: '2026-08-01',
    to_date: '2026-08-31',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function settingsRow(key: string, value: string, teamId = TEAM): Row {
  return { id: randomUUID(), team_id: teamId, key, value }
}

function eventForm(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function trainingForm(overrides: Record<string, string> = {}) {
  return { type: 'training', date: '2026-08-15', time: '19:00', ...overrides }
}
function matchForm(overrides: Record<string, string> = {}) {
  return {
    type: 'match',
    date: '2026-08-15',
    time: '14:00',
    match_type: 'league',
    home_away: 'home',
    opponent: 'FC Rivalen',
    ...overrides,
  }
}

// createEvent gooit ALTIJD een redirect bij succes (app/actions/events.ts:105)
// — dat is dus de "succesvolle" uitkomst, geen fout. Geeft het gegenereerde
// event-id terug zodat de test de attendance-rij kan opzoeken.
async function callCreateEvent(fields: Record<string, string>): Promise<string> {
  try {
    await createEvent(eventForm(fields))
    throw new Error('verwacht een redirect-worp, kreeg er geen')
  } catch (e) {
    const msg = (e as Error).message
    const m = msg.match(/^__redirect__:\/events\/(.+)$/)
    if (!m) throw e
    return m[1]
  }
}

function attendanceFor(db: ReturnType<typeof makeDb>, eventId: string, playerId: string): Row | undefined {
  return db.tables.attendance?.find((a) => a.event_id === eventId && a.player_id === playerId)
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — periode geregistreerd → nieuwe TRAINING binnen de range → automatisch
// absent, ongeacht team-default
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — nieuwe training binnen een geregistreerde periode → speler automatisch absent, ongeacht team-default', () => {
  it('team-default is "present", speler X krijgt toch automatisch absent op een nieuwe training binnen de periode', async () => {
    const x = playerRow({ id: 'px', name: 'Speler X' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const { periodId, affected } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    expect(affected).toBe(0) // nog geen bestaande events

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBe(periodId)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — zelfde, maar voor een nieuwe WEDSTRIJD
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — nieuwe wedstrijd binnen een geregistreerde periode → speler automatisch absent', () => {
  it('speler X krijgt automatisch absent op een nieuwe wedstrijd binnen de periode', async () => {
    const x = playerRow({ id: 'px', name: 'Speler X' })
    const db = makeDb({ players: [x] })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(matchForm({ date: '2026-08-20' }))
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBe(periodId)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — speler X (auto-absent) staat NIET in de selecteerbare lijst op
// /events/[id]/squad
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — automatisch afgemelde speler staat niet in de selecteerbare lijst op de squad-pagina', () => {
  it('speler X (auto-absent door periode) ontbreekt op /events/[id]/squad; speler Y (aanwezig) staat er wél', async () => {
    const x = playerRow({ id: 'px', name: 'Speler X' })
    const y = playerRow({ id: 'py', name: 'Speler Y' })
    const db = makeDb({ players: [x, y] })
    useDb(db)

    await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(matchForm({ date: '2026-08-20' }))
    // Y heeft geen periode, dus team-default (present) — expliciet ook nog
    // eens bevestigd door de coach, zodat Y in de selecteerbare lijst staat.
    await updateAttendance(eventId, 'py', 'present')

    vi.mocked(createClient).mockResolvedValue(
      makeClient(db, { id: TEAM }) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    const el = await MatchSquadPage({ params: Promise.resolve({ id: eventId }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.queryByRole('button', { name: `${nl.matchSquad.toggleLabel}: Speler X` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Speler Y` })).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — geen actieve periode op event-datum → bestaand gedrag ongewijzigd
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — geen actieve periode op de event-datum → bestaand gedrag (team-default), geen regressie', () => {
  it('zonder periode krijgt een nieuwe training gewoon de team-default status ("unknown")', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'unknown')],
    })
    useDb(db)

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('unknown')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — periode intrekken → periode bestaat niet meer, telt niet meer mee
// bij nieuwe events ná het intrekken
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — periode intrekken: verdwijnt en telt niet meer mee bij events die daarna worden aangemaakt', () => {
  it('na revokeAbsencePeriod bestaat de periode niet meer én een nieuwe training in dezelfde range krijgt weer de team-default', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    await revokeAbsencePeriod(periodId)

    expect(db.tables.absence_periods.find((p) => p.id === periodId)).toBeUndefined()

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('present')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6 — bestaand event door DEZE periode op absent gezet → bij intrekken
// terug naar team-default
// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — intrekken zet een bestaand, door de periode geraakt event terug naar team-default', () => {
  it('een event dat al bestond bij registratie krijgt bij intrekken weer de team-default status', async () => {
    const x = playerRow({ id: 'px' })
    const existing = eventRow({ id: 'e-existing', type: 'training', date: '2026-08-10' })
    const db = makeDb({
      players: [x],
      events: [existing],
      attendance: [attendanceRow({ event_id: 'e-existing', player_id: 'px', status: 'unknown', absence_period_id: null })],
      settings: [settingsRow('default_attendance', 'unknown')],
    })
    useDb(db)

    const { periodId, affected } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    expect(affected).toBe(1)
    expect(attendanceFor(db, 'e-existing', 'px')?.status).toBe('absent')
    expect(attendanceFor(db, 'e-existing', 'px')?.absence_period_id).toBe(periodId)

    const { restored } = await revokeAbsencePeriod(periodId)
    expect(restored).toBe(1)
    const row = attendanceFor(db, 'e-existing', 'px')
    expect(row?.status).toBe('unknown')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 — nieuw event dat sinds registratie door DEZE periode automatisch op
// absent is gezet → bij intrekken ook terug naar team-default
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — intrekken zet ook een NA registratie automatisch afgemeld event terug naar team-default', () => {
  it('een event aangemaakt ná de periode-registratie wordt bij intrekken ook teruggezet', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-18' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')

    await revokeAbsencePeriod(periodId)
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('present')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — startdatum na einddatum → geweigerd, foutmelding
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — startdatum na einddatum wordt geweigerd', () => {
  it('markAbsentForPeriod gooit een foutmelding en legt geen periode vast', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({ players: [x] })
    useDb(db)

    await expect(markAbsentForPeriod('px', '2026-08-31', '2026-08-01')).rejects.toThrow(
      'Startdatum moet voor einddatum liggen',
    )
    expect(db.tables.absence_periods ?? []).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — periode registreren voor speler van ander team → geweigerd
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — periode registreren voor een speler van een ander team wordt geweigerd', () => {
  it('markAbsentForPeriod gooit "Speler niet gevonden" en legt geen periode vast', async () => {
    const otherPlayer = playerRow({ id: 'p-other', team_id: OTHER_TEAM })
    const db = makeDb({ players: [otherPlayer] })
    useDb(db, { id: TEAM })

    await expect(markAbsentForPeriod('p-other', '2026-08-01', '2026-08-31')).rejects.toThrow('Speler niet gevonden')
    expect(db.tables.absence_periods ?? []).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — periode intrekken die niet bestaat / al ingetrokken is / niet van
// eigen team is → geweigerd, zonder andere periodes/attendance te raken
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — intrekken van een niet-bestaande, al ingetrokken, of andermans periode wordt geweigerd', () => {
  it('een niet-bestaand periode-id geeft "Periode niet gevonden"', async () => {
    const db = makeDb({})
    useDb(db)
    await expect(revokeAbsencePeriod(randomUUID())).rejects.toThrow('Periode niet gevonden')
  })

  it('een al ingetrokken periode geeft bij een tweede keer weer "Periode niet gevonden"', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({ players: [x] })
    useDb(db)
    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    await revokeAbsencePeriod(periodId)
    await expect(revokeAbsencePeriod(periodId)).rejects.toThrow('Periode niet gevonden')
  })

  it('een periode van een ander team wordt geweigerd, en laat de eigen periodes/attendance van dat andere team ongemoeid', async () => {
    const otherPlayer = playerRow({ id: 'p-other', team_id: OTHER_TEAM })
    const otherPeriod = periodRow({ id: randomUUID(), team_id: OTHER_TEAM, player_id: 'p-other' })
    const otherEvent = eventRow({ id: 'e-other', team_id: OTHER_TEAM, date: '2026-08-15' })
    const otherAttendance = attendanceRow({
      event_id: 'e-other',
      player_id: 'p-other',
      team_id: OTHER_TEAM,
      status: 'absent',
      absence_period_id: otherPeriod.id as string,
    })
    const db = makeDb({
      players: [otherPlayer],
      events: [otherEvent],
      attendance: [otherAttendance],
      absence_periods: [otherPeriod],
    })
    useDb(db, { id: TEAM }) // ingelogd als TEAM, periode is van OTHER_TEAM

    await expect(revokeAbsencePeriod(otherPeriod.id as string)).rejects.toThrow('Periode niet gevonden')

    // Andermans periode en attendance blijven volledig ongemoeid.
    expect(db.tables.absence_periods.find((p) => p.id === otherPeriod.id)).toBeDefined()
    const row = attendanceFor(db, 'e-other', 'p-other')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBe(otherPeriod.id)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — geen actieve periode bij een nieuw event → attendance-toewijzing
// verandert niet (meerdere spelers, geen enkele flipt naar absent)
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — zonder actieve periode verandert de attendance-toewijzing van een nieuw event niet', () => {
  it('drie spelers zonder periode krijgen alle drie gewoon de team-default status op een nieuw event', async () => {
    const players = [playerRow({ id: 'p1' }), playerRow({ id: 'p2' }), playerRow({ id: 'p3' })]
    const db = makeDb({
      players,
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    for (const p of players) {
      const row = attendanceFor(db, eventId, p.id as string)
      expect(row?.status).toBe('present')
      expect(row?.absence_period_id).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC12 — geldt voor TRAINING én WEDSTRIJD (bestaande events, één
// periode-registratie raakt beide types tegelijk)
// ═══════════════════════════════════════════════════════════════════════
describe('AC12 — geldt zowel voor training als wedstrijd', () => {
  it('één markAbsentForPeriod-aanroep zet zowel een bestaande training als een bestaande wedstrijd op absent', async () => {
    const x = playerRow({ id: 'px' })
    const training = eventRow({ id: 'e-training', type: 'training', date: '2026-08-05' })
    const match = eventRow({ id: 'e-match', type: 'match', date: '2026-08-12', opponent: 'FC Rivalen', match_type: 'league', home_away: 'home' })
    const db = makeDb({
      players: [x],
      events: [training, match],
      attendance: [
        attendanceRow({ event_id: 'e-training', player_id: 'px', status: 'present' }),
        attendanceRow({ event_id: 'e-match', player_id: 'px', status: 'present' }),
      ],
    })
    useDb(db)

    const { affected } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    expect(affected).toBe(2)
    expect(attendanceFor(db, 'e-training', 'px')?.status).toBe('absent')
    expect(attendanceFor(db, 'e-match', 'px')?.status).toBe('absent')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13 — periodegrenzen inclusief (fromDate/toDate zelf vallen binnen de
// periode; net erbuiten niet)
// ═══════════════════════════════════════════════════════════════════════
describe('AC13 — periodegrenzen zijn inclusief', () => {
  it('een event op exact fromDate of toDate valt binnen de periode; één dag ervoor/erna niet', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markAbsentForPeriod('px', '2026-08-05', '2026-08-10')

    const onFrom = await callCreateEvent(trainingForm({ date: '2026-08-05' }))
    const onTo = await callCreateEvent(trainingForm({ date: '2026-08-10' }))
    const beforeFrom = await callCreateEvent(trainingForm({ date: '2026-08-04' }))
    const afterTo = await callCreateEvent(trainingForm({ date: '2026-08-11' }))

    expect(attendanceFor(db, onFrom, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, onTo, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, beforeFrom, 'px')?.status).toBe('present')
    expect(attendanceFor(db, afterTo, 'px')?.status).toBe('present')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — automatische afwezigheid heeft voorrang op team-default (zowel bij
// default "present" als bij default "unknown")
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — automatische afwezigheid wint altijd van de team-default', () => {
  it.each(['present', 'unknown'])('team-default "%s" wordt genegeerd: speler binnen de periode wordt absent', async (defaultValue) => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', defaultValue)],
    })
    useDb(db)

    await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — periode-afmelding wint altijd, ook over een reeds handmatig op
// present gezette attendance-rij (bestaande én nieuwe events)
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — periode wint altijd, ook over een handmatig op present gezette rij', () => {
  it('bestaand event: een handmatig op present gezette rij wordt bij registratie alsnog absent', async () => {
    const x = playerRow({ id: 'px' })
    const existing = eventRow({ id: 'e-existing', date: '2026-08-10' })
    const db = makeDb({
      players: [x],
      events: [existing],
      attendance: [attendanceRow({ event_id: 'e-existing', player_id: 'px', status: 'present', absence_period_id: null })],
    })
    useDb(db)

    await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    expect(attendanceFor(db, 'e-existing', 'px')?.status).toBe('absent')
  })

  it('nieuw event na registratie: team-default "present" wordt genegeerd, speler wordt direct absent (geen tussentijdse "present"-rij)', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-20' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC16 — overlappende periodes: elke periode werkt onafhankelijk, intrekken
// van P1 laat P2 ongemoeid en draagt de herkomst over als P2 dezelfde datum
// dekt
// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — overlappende periodes werken onafhankelijk; intrekken van P1 draagt herkomst over aan P2', () => {
  it('P1 (1-31 aug) en P2 (15 aug - 15 sep) overlappen: een nieuw event op 20 aug krijgt P1 als herkomst (eerst geregistreerd); na intrekken van P1 draagt de rij over naar P2, blijft absent, en P2 zelf blijft ongewijzigd bestaan', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({ players: [x] })
    useDb(db)

    const { periodId: p1 } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const { periodId: p2 } = await markAbsentForPeriod('px', '2026-08-15', '2026-09-15')
    expect(p1).not.toBe(p2)

    // Nieuw event, gedekt door BEIDE periodes: periodIdByPlayerForDate kiest de
    // eerst-geregistreerde dekkende periode (P1) als herkomst.
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-20' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, eventId, 'px')?.absence_period_id).toBe(p1)

    const { restored } = await revokeAbsencePeriod(p1)
    // De rij wordt niet naar team-default hersteld: P2 dekt dezelfde datum nog
    // steeds, dus telt niet mee als "restored".
    expect(restored).toBe(0)

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBe(p2)

    // P1 is weg, P2 bestaat onaangetast nog steeds.
    expect(db.tables.absence_periods.find((p) => p.id === p1)).toBeUndefined()
    expect(db.tables.absence_periods.find((p) => p.id === p2)).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 — periode blijft gelden ongeacht actief/inactief-status van de speler
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — de periode geldt ongeacht actief/inactief-status van de speler', () => {
  it('markAbsentForPeriod zet ook een INACTIEVE speler op absent voor een bestaand event', async () => {
    const inactive = playerRow({ id: 'p-inactive', active: false })
    const existing = eventRow({ id: 'e-existing', date: '2026-08-10' })
    // Geen attendance-rij: createEvent maakt namelijk alleen rijen aan voor
    // actieve spelers (app/actions/events.ts:65), dus een inactieve speler
    // heeft normaliter nog geen rij. markAbsentForPeriod is niet aan die
    // active-filter gebonden en moet de periode alsnog toepassen.
    const db = makeDb({ players: [inactive], events: [existing] })
    useDb(db)

    const { periodId, affected } = await markAbsentForPeriod('p-inactive', '2026-08-01', '2026-08-31')
    expect(affected).toBe(1)
    const row = attendanceFor(db, 'e-existing', 'p-inactive')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBe(periodId)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 — intrekken werkt met terugwerkende kracht (ook al verstreken events)
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — intrekken werkt met terugwerkende kracht, ook op al verstreken events', () => {
  it('een event in het verleden dat door de periode absent werd, wordt bij intrekken ook hersteld', async () => {
    const x = playerRow({ id: 'px' })
    const pastEvent = eventRow({ id: 'e-past', date: '2020-01-15' })
    const db = makeDb({
      players: [x],
      events: [pastEvent],
      attendance: [attendanceRow({ event_id: 'e-past', player_id: 'px', status: 'unknown', absence_period_id: null })],
      settings: [settingsRow('default_attendance', 'unknown')],
    })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2020-01-01', '2020-01-31')
    expect(attendanceFor(db, 'e-past', 'px')?.status).toBe('absent')

    const { restored } = await revokeAbsencePeriod(periodId)
    expect(restored).toBe(1)
    expect(attendanceFor(db, 'e-past', 'px')?.status).toBe('unknown')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC19 — meting-events blijven buiten deze story (geen attendance, geen
// periodecheck)
// ═══════════════════════════════════════════════════════════════════════
describe('AC19 — meting-events blijven buiten de periodecheck', () => {
  it('een meting-event binnen de periode-range wordt door markAbsentForPeriod genegeerd (niet meegeteld, geen attendance-rij)', async () => {
    const x = playerRow({ id: 'px' })
    const meting = eventRow({ id: 'e-meting', type: 'meting', date: '2026-08-15', match_type: null })
    const db = makeDb({ players: [x], events: [meting] })
    useDb(db)

    const { affected } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    expect(affected).toBe(0)
    expect(attendanceFor(db, 'e-meting', 'px')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC20 — tenant-isolatie: een periode van een ANDER team met dezelfde
// speler-id/datum mag nooit meetellen
// ═══════════════════════════════════════════════════════════════════════
describe('AC20 — tenant-isolatie: een periode van een ander team telt nooit mee, ook niet bij een gelijk speler-id/datum', () => {
  it('OTHER_TEAM heeft een periode met hetzelfde player_id-literal, gedekt door dezelfde datum: TEAM krijgt gewoon team-default, geen absent', async () => {
    const sharedId = 'shared-player-id'
    const ownPlayer = playerRow({ id: sharedId, team_id: TEAM })
    const otherTeamPeriod = periodRow({
      id: randomUUID(),
      team_id: OTHER_TEAM,
      player_id: sharedId,
      from_date: '2026-08-01',
      to_date: '2026-08-31',
    })
    const db = makeDb({
      players: [ownPlayer],
      absence_periods: [otherTeamPeriod],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db, { id: TEAM })

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    const row = attendanceFor(db, eventId, sharedId)
    expect(row?.status).toBe('present')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC21 (BELANGRIJK, edge case) — een event valt binnen een periode, maar de
// coach heeft de attendance-rij zelf handmatig op absent gezet, ONAFHANKELIJK
// van de periode (absence_period_id = null). Bij intrekken mag deze
// handmatige absent NIET worden teruggezet naar default.
// ═══════════════════════════════════════════════════════════════════════
// LET OP — waarom deze rij hier rechtstreeks in de DB wordt gezaaid i.p.v. via
// de acties opgebouwd: in de huidige implementatie stempelt
// markAbsentForPeriod ALTIJD absence_period_id op ieder event binnen de
// range op het moment van registratie (attendance.ts:98-104), en
// periodIdByPlayerForDate doet hetzelfde bij het aanmaken van een nieuw event
// (events.ts:85-97). Er is dus geen publieke actie-volgorde die een rij kan
// opleveren die tegelijk (a) absent is, (b) absence_period_id=null heeft, én
// (c) waarvan de event-datum toch binnen een op dat moment actieve periode
// valt. Dat is precies de garantie die revokeAbsencePeriod moet waarmaken:
// de SELECT filtert strikt op `absence_period_id = periodId`
// (attendance.ts:159-163), nooit op datumbereik. Deze test zaait die
// combinatie rechtstreeks om exact díe invariant te bewijzen, in lijn met de
// impliciete instructie van de story dat dit géén ongelukje mag zijn.
describe('AC21 — een handmatig (absence_period_id=null) afgemelde rij binnen het periodebereik blijft ongemoeid bij intrekken', () => {
  it('de handmatige absent-rij (absence_period_id=null) verandert niet, ook al valt de event-datum binnen de ingetrokken periode', async () => {
    const x = playerRow({ id: 'px' })
    const covered = eventRow({ id: 'e-covered', date: '2026-08-15' })
    const period = periodRow({ id: randomUUID(), team_id: TEAM, player_id: 'px', from_date: '2026-08-01', to_date: '2026-08-31' })
    const db = makeDb({
      players: [x],
      events: [covered],
      absence_periods: [period],
      attendance: [
        attendanceRow({
          event_id: 'e-covered',
          player_id: 'px',
          status: 'absent',
          absence_period_id: null, // handmatig, onafhankelijk van de periode
        }),
      ],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await revokeAbsencePeriod(period.id as string)

    const row = attendanceFor(db, 'e-covered', 'px')
    expect(row?.status).toBe('absent')
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC22 — generateSeasonTrainings past periodes ook toe (bulk-trainingen)
// ═══════════════════════════════════════════════════════════════════════
describe('AC22 — generateSeasonTrainings past afmeldperiodes toe op elk gegenereerd event', () => {
  it('een speler met een lopende periode krijgt op de gegenereerde trainingen binnen die periode automatisch absent, en daarbuiten team-default', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [
        settingsRow('season_start', '2026-08-01'),
        settingsRow('season_end', '2026-08-31'),
        // Elke maandag (1) en donderdag (4) van augustus 2026.
        settingsRow('training_days', '1,4'),
        settingsRow('default_attendance', 'present'),
      ],
    })
    useDb(db)

    // Periode dekt alleen de eerste helft van de maand.
    await markAbsentForPeriod('px', '2026-08-01', '2026-08-15')

    const { created } = await generateSeasonTrainings()
    expect(created).toBeGreaterThan(0)

    const generated = db.tables.events.filter((e) => e.type === 'training')
    const withinPeriod = generated.filter((e) => (e.date as string) >= '2026-08-01' && (e.date as string) <= '2026-08-15')
    const outsidePeriod = generated.filter((e) => (e.date as string) > '2026-08-15')
    expect(withinPeriod.length).toBeGreaterThan(0)
    expect(outsidePeriod.length).toBeGreaterThan(0)

    for (const e of withinPeriod) {
      const row = attendanceFor(db, e.id as string, 'px')
      expect(row?.status).toBe('absent')
      expect(row?.absence_period_id).not.toBeNull()
    }
    for (const e of outsidePeriod) {
      const row = attendanceFor(db, e.id as string, 'px')
      expect(row?.status).toBe('present')
      expect(row?.absence_period_id).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC23 — markRecovered respecteert een lopende afmeldperiode: een rij met
// absence_period_id blijft absent (alleen injury_set wordt opgeschoond); een
// rij zonder absence_period_id gaat terug naar default (bestaand gedrag)
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// HER-VERIFICATIE (fix-ronde) — AC21-uitbreiding: een door de periode
// veroorzaakte absent-rij die de coach ACHTERAF handmatig wijzigt naar
// 'present' of 'unknown' (via updateAttendance, vóórdat de periode wordt
// ingetrokken) blijft bij intrekken op die handmatig gezette status staan —
// alleen de herkomst (absence_period_id) wordt gewist. Dit is de nieuwe
// uitzondering in revokeAbsencePeriod (attendance.ts:232):
// `row.injury_set || row.status !== 'absent'`. Anders dan AC21 hierboven
// (waar de rij van meet af aan buiten de periode-actie om is gezaaid) wordt
// deze rij hier ECHT door de periode-actie zelf op absent gezet, en pas
// daarna door de coach overruled — dat maakt dit een écht van-buitenaf
// bewezen scenario, zonder rechtstreeks in de mock-DB te zaaien.
// ═══════════════════════════════════════════════════════════════════════
describe('AC21-uitbreiding — periode-veroorzaakte absent-rij die de coach achteraf handmatig wijzigt, blijft ongemoeid bij intrekken', () => {
  it('coach wijzigt de door-de-periode-veroorzaakte rij handmatig naar "present" → intrekken laat de rij op "present" staan (alleen herkomst wist)', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'unknown')],
    })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, eventId, 'px')?.absence_period_id).toBe(periodId)

    // De coach ziet de speler toch aanwezig en zet de rij handmatig op
    // 'present'. updateAttendance upsert zonder absence_period_id in de
    // payload, dus de herkomst blijft (bewust) staan.
    await updateAttendance(eventId, 'px', 'present')
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('present')
    expect(attendanceFor(db, eventId, 'px')?.absence_period_id).toBe(periodId)

    const { restored } = await revokeAbsencePeriod(periodId)
    expect(restored).toBe(0) // niets "hersteld": de rij was al niet meer 'absent'

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('present') // blijft zoals de coach hem zette
    expect(row?.absence_period_id).toBeNull() // alleen de herkomst is gewist
  })

  it('coach wijzigt de door-de-periode-veroorzaakte rij handmatig naar "unknown" → intrekken laat de rij op "unknown" staan (alleen herkomst wist)', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-20' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, eventId, 'px')?.absence_period_id).toBe(periodId)

    await updateAttendance(eventId, 'px', 'unknown')
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('unknown')
    expect(attendanceFor(db, eventId, 'px')?.absence_period_id).toBe(periodId)

    const { restored } = await revokeAbsencePeriod(periodId)
    expect(restored).toBe(0)

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('unknown') // blijft zoals de coach hem zette
    expect(row?.absence_period_id).toBeNull() // alleen de herkomst is gewist
  })
})

// ═══════════════════════════════════════════════════════════════════════
// HER-VERIFICATIE (fix-ronde) — datumvalidatie is verscherpt: markAbsentForPeriod
// gebruikt nu isDateString (lib/season-dates.ts) i.p.v. een eigen regex, en
// weigert daarmee ook kalendarisch niet-bestaande datums (die een pure
// vormcheck zou doorlaten). Van-buitenaf bewezen via de echte server action,
// niet via de al bestaande unit-test van isDateString zelf
// (lib/season-dates.test.ts).
// ═══════════════════════════════════════════════════════════════════════
describe('AC8-verscherping — een kalendarisch ongeldige datum (bv. 30 februari) wordt geweigerd', () => {
  it('markAbsentForPeriod weigert "2026-02-30" als fromDate met "Ongeldige datum" en legt geen periode vast', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({ players: [x] })
    useDb(db)

    await expect(markAbsentForPeriod('px', '2026-02-30', '2026-03-15')).rejects.toThrow('Ongeldige datum')
    expect(db.tables.absence_periods ?? []).toHaveLength(0)
  })

  it('markAbsentForPeriod weigert "2026-02-30" als toDate met "Ongeldige datum" en legt geen periode vast', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({ players: [x] })
    useDb(db)

    await expect(markAbsentForPeriod('px', '2026-02-01', '2026-02-30')).rejects.toThrow('Ongeldige datum')
    expect(db.tables.absence_periods ?? []).toHaveLength(0)
  })
})

describe('AC23 — markRecovered respecteert een lopende afmeldperiode', () => {
  it('een toekomstige rij MET absence_period_id blijft absent; alleen injury_set wordt opgeschoond', async () => {
    const x = playerRow({ id: 'px', injured: true })
    const period = periodRow({ id: randomUUID(), team_id: TEAM, player_id: 'px', from_date: '2099-01-01', to_date: '2099-12-31' })
    const future = eventRow({ id: 'e-future', date: '2099-06-01' })
    const db = makeDb({
      players: [x],
      absence_periods: [period],
      events: [future],
      attendance: [
        attendanceRow({
          event_id: 'e-future',
          player_id: 'px',
          status: 'absent',
          injury_set: true,
          absence_period_id: period.id as string,
        }),
      ],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markRecovered('px')

    const row = attendanceFor(db, 'e-future', 'px')
    expect(row?.status).toBe('absent') // blijft absent: de periode is leidend
    expect(row?.injury_set).toBe(false) // wél opgeschoond
    expect(row?.absence_period_id).toBe(period.id) // herkomst blijft staan
  })

  it('een toekomstige rij ZONDER absence_period_id (pure blessure) gaat terug naar team-default (bestaand gedrag)', async () => {
    const y = playerRow({ id: 'py', injured: true })
    const future = eventRow({ id: 'e-future2', date: '2099-06-01' })
    const db = makeDb({
      players: [y],
      events: [future],
      attendance: [
        attendanceRow({
          event_id: 'e-future2',
          player_id: 'py',
          status: 'absent',
          injury_set: true,
          absence_period_id: null,
        }),
      ],
      settings: [settingsRow('default_attendance', 'unknown')],
    })
    useDb(db)

    await markRecovered('py')

    const row = attendanceFor(db, 'e-future2', 'py')
    expect(row?.status).toBe('unknown')
    expect(row?.injury_set).toBe(false)
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC24 — BLESSURES bij NIEUWE events (zelfde bugklasse als de afmeldperiodes
// hierboven: markInjured raakte alleen BESTAANDE events, waardoor een event dat
// daarna werd aangemaakt de geblesseerde speler weer op de team-default zette).
//
// Dit blok staat bewust in dít bestand en niet in een nieuw: blessures lopen
// door exact dezelfde server actions (createEvent, generateSeasonTrainings) en
// dezelfde in-memory mock/fixtures als de afmeldperiodes, inclusief de
// samenloop van beide markeringen op één rij. Een apart bestand zou die mock,
// de fabrieken en de callCreateEvent-helper moeten dupliceren.
// ═══════════════════════════════════════════════════════════════════════
describe('AC24 — nieuw event na een blessuremelding → speler automatisch absent met injury_set', () => {
  it('(a) team-default is "present", maar de geblesseerde speler krijgt op een nieuwe training absent + injury_set; een fitte teamgenoot niet', async () => {
    const x = playerRow({ id: 'px', name: 'Speler X' })
    const y = playerRow({ id: 'py', name: 'Speler Y' })
    const db = makeDb({
      players: [x, y],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markInjured('px')
    expect(db.tables.players.find((p) => p.id === 'px')?.injured).toBe(true)

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))

    const geblesseerd = attendanceFor(db, eventId, 'px')
    expect(geblesseerd?.status).toBe('absent')
    expect(geblesseerd?.injury_set).toBe(true)
    expect(geblesseerd?.absence_period_id).toBeNull()

    // Geen kruisbesmetting: de fitte teamgenoot houdt de team-default.
    const fit = attendanceFor(db, eventId, 'py')
    expect(fit?.status).toBe('present')
    expect(fit?.injury_set).toBe(false)
  })

  it('(a2) geldt ook voor een nieuwe wedstrijd', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markInjured('px')
    const eventId = await callCreateEvent(matchForm({ date: '2026-08-15' }))

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.injury_set).toBe(true)
  })

  it('(b) geldt ook voor de seizoensgeneratie: élke gegenereerde training krijgt absent + injury_set, ook buiten elke periode', async () => {
    const x = playerRow({ id: 'px' })
    const y = playerRow({ id: 'py' })
    const db = makeDb({
      players: [x, y],
      settings: [
        settingsRow('season_start', '2026-08-01'),
        settingsRow('season_end', '2026-08-31'),
        settingsRow('training_days', '1,4'),
        settingsRow('default_attendance', 'present'),
      ],
    })
    useDb(db)

    await markInjured('px')

    const { created } = await generateSeasonTrainings()
    expect(created).toBeGreaterThan(0)

    const generated = db.tables.events.filter((e) => e.type === 'training')
    expect(generated.length).toBe(created)
    for (const e of generated) {
      const row = attendanceFor(db, e.id as string, 'px')
      expect(row?.status, `training ${e.date as string}`).toBe('absent')
      expect(row?.injury_set).toBe(true)
      expect(row?.absence_period_id).toBeNull()

      expect(attendanceFor(db, e.id as string, 'py')?.status).toBe('present')
    }
  })

  it('(c) samenloop met een lopende periode: beide markeringen; ná het intrekken van de periode blijft de rij absent (alleen de herkomst wist)', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markInjured('px')
    const { periodId } = await markAbsentForPeriod('px', '2026-08-01', '2026-08-31')

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-15' }))
    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.injury_set).toBe(true)
    expect(row?.absence_period_id).toBe(periodId)

    // Regressie op bestaand gedrag (app/actions/attendance.ts:232): een rij met
    // injury_set blijft bij intrekken absent, alleen de herkomst verdwijnt.
    const { restored } = await revokeAbsencePeriod(periodId)
    expect(restored).toBe(0)

    const na = attendanceFor(db, eventId, 'px')
    expect(na?.status).toBe('absent')
    expect(na?.injury_set).toBe(true)
    expect(na?.absence_period_id).toBeNull()
  })

  it('(d) markRecovered zet een zo ontstane rij op een TOEKOMSTIG event terug naar de team-default', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markInjured('px')
    // Ver in de toekomst: markRecovered raakt bewust alleen events vanaf
    // vandaag, dus deze datum maakt de test datum-onafhankelijk.
    const eventId = await callCreateEvent(trainingForm({ date: '2099-06-01' }))
    expect(attendanceFor(db, eventId, 'px')?.status).toBe('absent')
    expect(attendanceFor(db, eventId, 'px')?.injury_set).toBe(true)

    await markRecovered('px')

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('present')
    expect(row?.injury_set).toBe(false)
    expect(row?.absence_period_id).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AANVULLENDE VERIFICATIE — Story "blessure automatisch afwezig bij nieuwe
// events", criteria 8, 9, 10 en 13. AC24 hierboven (bouwer) bewijst al de
// criteria 1, 2, 3, 4, 7, 14 en 15; de backfill-criteria 5 en 6 staan al in
// wedstrijdselectie.acceptance.test.tsx ("Blessures" na Story-AC (bevinding
// 2)). Deze vier resterende criteria hadden nog geen expliciete, van-buitenaf
// bewezen test — dit blok sluit dat gat, met dezelfde gedeelde filterende
// mock-DB en dezelfde echte server actions als de rest van dit bestand.
// ═══════════════════════════════════════════════════════════════════════
describe('Criterium 8 — alleen actieve spelers krijgen een rij, ook als het om een blessure gaat', () => {
  it('een inactieve geblesseerde speler krijgt GEEN attendance-rij; een actieve geblesseerde speler wel (absent + injury_set)', async () => {
    const inactive = playerRow({ id: 'p-inactive', active: false, injured: true })
    const active = playerRow({ id: 'p-active', active: true, injured: true })
    const db = makeDb({
      players: [inactive, active],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-20' }))

    expect(attendanceFor(db, eventId, 'p-inactive')).toBeUndefined()
    const row = attendanceFor(db, eventId, 'p-active')
    expect(row?.status).toBe('absent')
    expect(row?.injury_set).toBe(true)
  })
})

describe('Criterium 9 — meting-events krijgen nooit attendance-rijen, ook niet voor geblesseerde spelers', () => {
  it('saveNulmeting (de enige plek die meting-events aanmaakt) schrijft geen enkele attendance-rij weg, ook niet voor een geblesseerde speler', async () => {
    const x = playerRow({ id: 'px', injured: true })
    const db = makeDb({ players: [x] })
    useDb(db)

    await saveNulmeting({
      date: '2026-08-20',
      steps: {
        partijen_groot_stap: 5,
        partijen_midden_stap: 5,
        partijen_klein_stap: 5,
        sprints_weinig_rust_stap: 5,
        sprints_veel_rust_stap: 5,
      },
      notes: null,
    })

    const metingEvent = db.tables.events.find((e) => e.type === 'meting')
    expect(metingEvent).toBeDefined()
    expect(db.tables.attendance ?? []).toHaveLength(0)
  })
})

describe('Criterium 10 — geen datumvergelijking: ook een event met een datum in het verleden krijgt de blessure mee', () => {
  it('een training met een datum ver in het verleden krijgt de geblesseerde speler toch automatisch absent + injury_set', async () => {
    const x = playerRow({ id: 'px' })
    const db = makeDb({
      players: [x],
      settings: [settingsRow('default_attendance', 'present')],
    })
    useDb(db)

    await markInjured('px')
    // Duidelijk in het verleden (ruim vóór elke realistische "vandaag"):
    // alleen de huidige players.injured-waarde mag tellen, niet de eventdatum.
    const eventId = await callCreateEvent(trainingForm({ date: '2020-01-15' }))

    const row = attendanceFor(db, eventId, 'px')
    expect(row?.status).toBe('absent')
    expect(row?.injury_set).toBe(true)
  })
})

describe('Criterium 13 — team zonder actieve spelers → geen attendance-rijen, geen fout', () => {
  it('createEvent op een team zonder (actieve) spelers slaagt gewoon (redirect) en schrijft geen enkele attendance-rij weg', async () => {
    const inactiveOnly = playerRow({ id: 'p-inactive', active: false, injured: true })
    const db = makeDb({ players: [inactiveOnly] })
    useDb(db)

    // callCreateEvent verwacht zelf al de succes-redirect; een onverwachte
    // throw (bijv. een crash op de lege spelerslijst) laat deze test falen.
    const eventId = await callCreateEvent(trainingForm({ date: '2026-08-20' }))
    expect(db.tables.attendance ?? []).toHaveLength(0)
    expect(eventId).toBeTruthy()
  })

  it('generateSeasonTrainings op een team zonder actieve spelers slaagt gewoon, maakt events aan, maar schrijft geen enkele attendance-rij weg', async () => {
    const inactiveOnly = playerRow({ id: 'p-inactive', active: false, injured: true })
    const db = makeDb({
      players: [inactiveOnly],
      settings: [
        settingsRow('season_start', '2026-08-01'),
        settingsRow('season_end', '2026-08-31'),
        settingsRow('training_days', '1,4'),
        settingsRow('default_attendance', 'present'),
      ],
    })
    useDb(db)

    const { created } = await generateSeasonTrainings()
    expect(created).toBeGreaterThan(0)
    expect(db.tables.attendance ?? []).toHaveLength(0)
  })
})
