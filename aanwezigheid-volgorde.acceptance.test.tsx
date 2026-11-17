// Acceptatietests — Aanwezigheidslijst: eerst reguliere spelers, dan gastspelers,
// elk blok in vaste positievolgorde (story 02-story.md, AC1–AC14).
//
// Testmethode: de ECHTE server component EventDetailPage wordt aangeroepen en
// gerenderd (mockpatroon gastspelers.acceptance.test.tsx). De Supabase-mock
// past de echte `.order('position')` toe en levert de spelers dus in een
// ALFABETISCHE (= voor de story verkeerde) positievolgorde aan; de goede
// volgorde moet dus uit de client-sortering komen.
//
// Volgorde wordt gemeten via DOM-documentvolgorde van de spelersnamen en de
// blokkoppen (role=heading), niet via klassen of interne structuur.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { Dict } from '@/messages/nl'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })),
  // components/dashboard/JoinedBanner.tsx (validatiebevinding 3) — deze
  // story gaat niet over de invite-bevestiging.
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// Nooit daadwerkelijk aangeroepen in deze tests (geen enkele test klikt een
// knop) — puur nodig zodat de imports in de gerenderde clientcomponenten
// resolven.
vi.mock('@/app/actions/attendance', () => ({
  updateAttendance: vi.fn().mockResolvedValue(undefined),
  markAllPresent: vi.fn().mockResolvedValue(undefined),
  // Nooit daadwerkelijk aangeroepen (geen enkele test klikt "Opslaan") — puur
  // nodig zodat de import in LineupBuilder (AC4-tests) resolvet. Zelfde
  // precedent als opstelling-vorm.acceptance.test.tsx.
  saveLineup: vi.fn().mockResolvedValue({ legePosities: 0, selectieAutomatischGevuld: false, selectieFout: false }),
}))
vi.mock('@/app/actions/players', () => ({
  markInjured: vi.fn().mockResolvedValue(undefined),
  markRecovered: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/events', () => ({
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
}))


import { createClient } from '@/lib/supabase/server'
import EventDetailPage from '@/app/events/[id]/page'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'
import PlayersPage from '@/app/players/page'
import * as attendanceActies from '@/app/actions/attendance'

// ── team_members: de teamcontext van élke page en server action ──
// lib/team-context.ts (requireTeamContext) leest team_members vóór alles;
// zonder lidmaatschapsrij komt geen enkele pagina of action voorbij zijn
// eerste regel ('Geen team'). Deze ene tabel wordt daarom apart bediend, los
// van de mock hieronder. In fase 1 is elke gebruiker owner van precies één
// team en geldt teams.id === user.id — vanaf fase 2 kan team_id daarvan
// afwijken en is dit de plek om dat na te bootsen.
function teamMembersChain(userId: string | undefined) {
  const rows = userId ? [{ team_id: userId, user_id: userId, rol: 'owner' }] : []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) {
    chain[op] = () => chain
  }
  chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows, error: null, count: rows.length })
  return chain
}



const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

afterEach(() => cleanup())

beforeEach(() => {
  vi.mocked(attendanceActies.updateAttendance).mockClear()
  vi.mocked(attendanceActies.markAllPresent).mockClear()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
})

type Row = Record<string, unknown>

// ── Generieke Supabase-tabel-engine met ECHTE filtering (kopie, zelfde
// precedent als de andere *.acceptance.test.tsx-bestanden in deze repo —
// elk bestand houdt zijn eigen kopie, er is geen gedeelde test-utils-module).
function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    function resolveRows(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
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
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain },
      gt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) > (val as string | number)); return chain },
      gte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) >= (val as string | number)); return chain },
      lte: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) <= (val as string | number)); return chain },
      lt: (col: string, val: unknown) => { filters.push((r) => (r[col] as string | number) < (val as string | number)); return chain },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      // Upsert met de echte UNIQUE-semantiek van de conflictkolommen: zonder
      // ignoreDuplicates is een botsing een 23505-fout (zoals een insert in
      // Postgres), mét ignoreDuplicates wordt de botsende rij overgeslagen en
      // blijft de bestaande staan. De rijen worden echt toegevoegd, zodat een
      // tweede, gelijktijdige backfill dezelfde botsing tegenkomt.
      upsert: (payload: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        const nieuw = Array.isArray(payload) ? payload : [payload]
        const sleutels = (options.onConflict ?? 'id').split(',').map((k) => k.trim())
        const botst = (a: Row, b: Row) => sleutels.every((k) => a[k] === b[k])
        for (const rij of nieuw) {
          if (rows.some((bestaand) => botst(bestaand, rij))) {
            if (options.ignoreDuplicates) continue
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
          }
          rows.push({ ...rij })
        }
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: resolveRows(), error: null }),
    }
    return chain
  }
}


function makeSupabase(user: { id: string } | null, tables: Record<string, Row[]>) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) =>
      t === 'team_members' ? teamMembersChain(user?.id) : tableFactory(tables[t] ?? [])(),
    rpc: () => Promise.resolve({ data: [], error: null }),
  }
}

function makePlayer(overrides: Row = {}): Row {
  return {
    id: 'p1', team_id: TEAM, name: 'Speler', position: 'Spits', secondary_positions: [],
    jersey_number: 9, active: true, injured: false, type: 'regular', rating: 5,
    created_at: '2024-01-01T00:00:00Z', ...overrides,
  }
}

function baseEventRow(overrides: Row = {}): Row {
  return {
    id: 'e1', team_id: TEAM, type: 'training', date: '2026-08-20', time: null, location: null,
    match_type: null, opponent: null, home_away: null, gather_time: null, notes: null,
    doelstelling: null, goals_for: null, goals_against: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function tabellen(opts: { event?: Row; players: Row[]; attendance?: Row[] }): Record<string, Row[]> {
  return {
    events: [opts.event ?? baseEventRow()],
    players: opts.players,
    attendance: opts.attendance ?? [],
    lineups: [], metingen: [], training_oefeningen: [], match_ratings: [], match_events: [],
    match_squad: [], absence_periods: [], settings: [], oefeningen: [],
  }
}

async function renderEvent(opts: { event?: Row; players: Row[]; attendance?: Row[]; dict?: Dict }) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabase({ id: TEAM }, tabellen(opts)) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await EventDetailPage({ params: Promise.resolve({ id: 'e1' }) })
  return render(<DictProvider dict={opts.dict ?? nl}>{el}</DictProvider>)
}

// ── DOM-hulpen ──
function kop(naam: string): HTMLElement | null {
  return screen.queryByRole('heading', { level: 3, name: naam })
}
// Namen (unieke tekst) gesorteerd op documentvolgorde.
function volgorde(namen: string[]): string[] {
  const els = namen.map((n) => ({ n, el: screen.getByText(n) }))
  els.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return els.map((x) => x.n)
}
function volgNaKop(el: HTMLElement, k: HTMLElement): boolean {
  return !!(k.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
}
function rijVan(el: HTMLElement): HTMLElement {
  const row = el.parentElement?.parentElement
  if (!row || within(row).queryAllByRole('button').length !== 3) {
    throw new Error('Aanwezigheidsrij niet gevonden')
  }
  return row
}
function statusVanRij(row: HTMLElement): 'present' | 'absent' | 'injured' | 'unknown' {
  const pressed = within(row).queryByRole('button', { pressed: true })
  if (!pressed) return 'unknown'
  const txt = pressed.textContent ?? ''
  if (txt.includes(nl.event.absentStat)) return 'absent'
  if (txt.includes(nl.event.injuredStat)) return 'injured'
  return 'present'
}
async function klik(el: HTMLElement) {
  await act(async () => { fireEvent.click(el) })
}

const POS = [
  'Keeper', 'Rechtsachter', 'Centrale verdediger', 'Linksachter',
  'Defensieve middenvelder', 'Centrale middenvelder', 'Aanvallende middenvelder',
  'Rechtsmiddenvelder', 'Linksmiddenvelder', 'Rechtsbuiten', 'Spits', 'Linksbuiten',
] as const
// Deterministisch door elkaar (niet in story-volgorde).
const GEHUSSELD = [...POS].sort((a, b) => ((a.length * 7) % 5) - ((b.length * 7) % 5) || b.localeCompare(a))
function perPositie(prefix: string, type: 'regular' | 'guest'): Row[] {
  return GEHUSSELD.map((pos, i) =>
    makePlayer({ id: `${prefix}${i}`, name: `${prefix} ${pos}`, position: pos, type, jersey_number: 20 - i }))
}

describe('AC1 — blok "Spelers" boven blok "Gastspelers"', () => {
  it('AC1: een gast die in de DB-volgorde vóór de reguliere speler komt, staat toch onder de kop "Gastspelers", onder alle reguliere spelers', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: 'g1', name: 'Gast Keeper', position: 'Keeper', type: 'guest' }),
        makePlayer({ id: 'r1', name: 'Vast Spits', position: 'Spits', type: 'regular' }),
      ],
    })
    const spelersKop = kop(nl.players.title)!
    const gastKop = kop(nl.event.attendanceGuestsHeading)!
    expect(spelersKop).toBeInTheDocument()
    expect(gastKop).toBeInTheDocument()
    expect(volgorde(['Gast Keeper', 'Vast Spits'])).toEqual(['Vast Spits', 'Gast Keeper'])
    expect(spelersKop.compareDocumentPosition(gastKop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(volgNaKop(screen.getByText('Vast Spits'), spelersKop)).toBe(true)
    expect(volgNaKop(screen.getByText('Vast Spits'), gastKop)).toBe(false)
    expect(volgNaKop(screen.getByText('Gast Keeper'), gastKop)).toBe(true)
  })

  it('AC1: geldt ook voor een wedstrijd (stap "Beschikbaar")', async () => {
    await renderEvent({
      event: baseEventRow({ type: 'match', opponent: 'Tegenstander', match_type: 'competition', home_away: 'home' }),
      players: [
        makePlayer({ id: 'g1', name: 'Gast Keeper', position: 'Keeper', type: 'guest' }),
        makePlayer({ id: 'r1', name: 'Vast Spits', position: 'Spits', type: 'regular' }),
      ],
    })
    const gastKop = kop(nl.event.attendanceGuestsHeading)!
    expect(volgNaKop(screen.getByText('Gast Keeper'), gastKop)).toBe(true)
    expect(volgNaKop(screen.getByText('Vast Spits'), gastKop)).toBe(false)
  })
})

describe('AC2 — binnen elk blok op positie (keeper t/m linksbuiten)', () => {
  it('AC2: reguliere spelers staan in de vaste positievolgorde, ondanks alfabetische DB-volgorde', async () => {
    await renderEvent({ players: perPositie('Vast', 'regular') })
    expect(volgorde(POS.map((p) => `Vast ${p}`))).toEqual(POS.map((p) => `Vast ${p}`))
  })
})

describe('AC3 — zelfde positie: alfabetisch op naam, rugnummer telt niet', () => {
  it('AC3: namen binnen één positie alfabetisch, ook als het rugnummer een andere volgorde geeft', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: 'a', name: 'Anna', position: 'Spits', jersey_number: 9 }),
        makePlayer({ id: 'b', name: 'Bram', position: 'Spits', jersey_number: 1 }),
        makePlayer({ id: 'c', name: 'Cees', position: 'Spits', jersey_number: null }),
      ],
    })
    expect(volgorde(['Cees', 'Bram', 'Anna'])).toEqual(['Anna', 'Bram', 'Cees'])
  })

  it('AC3 (edge): hoofdletters en accenten volgens nl-NL: eva < Dirk < Odegaard < Ödegaard < Zidane', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: '1', name: 'Zidane', position: 'Spits' }),
        makePlayer({ id: '2', name: 'Ödegaard', position: 'Spits' }),
        makePlayer({ id: '3', name: 'Odegaard', position: 'Spits' }),
        makePlayer({ id: '4', name: 'eva', position: 'Spits' }),
        makePlayer({ id: '5', name: 'Dirk', position: 'Spits' }),
      ],
    })
    expect(volgorde(['Zidane', 'Ödegaard', 'Odegaard', 'eva', 'Dirk']))
      .toEqual(['Dirk', 'eva', 'Odegaard', 'Ödegaard', 'Zidane'])
  })

  it('AC3 (edge): gelijke positie én naam → vaste tiebreak op id, onafhankelijk van aanlevervolgorde', async () => {
    const rijen = (volgorde: string[]) => volgorde.map((id) =>
      makePlayer({ id, name: 'Dubbel', position: 'Spits' }))
    for (const aanlever of [['b-id', 'a-id'], ['a-id', 'b-id']]) {
      cleanup()
      await renderEvent({
        players: rijen(aanlever),
        attendance: [
          { event_id: 'e1', team_id: TEAM, player_id: 'a-id', status: 'present' },
          { event_id: 'e1', team_id: TEAM, player_id: 'b-id', status: 'absent' },
        ],
      })
      const rijenEls = screen.getAllByText('Dubbel').map(rijVan)
      expect(rijenEls.map(statusVanRij)).toEqual(['present', 'absent']) // a-id eerst
    }
  })
})

describe('AC4 — gasten alleen in gastblok, zelfde positievolgorde', () => {
  it('AC4: gasten staan in het gastblok in de vaste positievolgorde; reguliere spelers staan er niet in', async () => {
    await renderEvent({ players: [...perPositie('Gast', 'guest'), makePlayer({ id: 'v', name: 'Vast Keeper', position: 'Keeper' })] })
    const gastKop = kop(nl.event.attendanceGuestsHeading)!
    expect(volgorde(POS.map((p) => `Gast ${p}`))).toEqual(POS.map((p) => `Gast ${p}`))
    for (const p of POS) expect(volgNaKop(screen.getByText(`Gast ${p}`), gastKop)).toBe(true)
    expect(volgNaKop(screen.getByText('Vast Keeper'), gastKop)).toBe(false)
  })
})

describe('AC5 — statuswijziging verandert de volgorde nooit', () => {
  const spelers = () => [
    makePlayer({ id: 'g1', name: 'Gast Linksbuiten', position: 'Linksbuiten', type: 'guest' }),
    makePlayer({ id: 'g2', name: 'Gast Keeper', position: 'Keeper', type: 'guest' }),
    makePlayer({ id: 'r1', name: 'Vast Spits', position: 'Spits' }),
    makePlayer({ id: 'r2', name: 'Vast Keeper', position: 'Keeper' }),
    makePlayer({ id: 'r3', name: 'Vast Rechtsachter', position: 'Rechtsachter' }),
  ]
  const verwacht = ['Vast Keeper', 'Vast Rechtsachter', 'Vast Spits', 'Gast Keeper', 'Gast Linksbuiten']

  it('AC5: status zetten (aanwezig, afwezig, geblesseerd, terug naar onbekend) laat de volgorde gelijk', async () => {
    await renderEvent({ players: spelers() })
    expect(volgorde(verwacht)).toEqual(verwacht)
    const rij = () => rijVan(screen.getByText('Vast Spits'))
    for (const label of [nl.event.presentStat, nl.event.absentStat, nl.event.injuredStat, nl.event.injuredStat]) {
      await klik(within(rij()).getByRole('button', { name: label }))
      expect(volgorde(verwacht)).toEqual(verwacht)
    }
    await klik(within(rijVan(screen.getByText('Gast Linksbuiten'))).getByRole('button', { name: nl.event.presentStat }))
    expect(volgorde(verwacht)).toEqual(verwacht)
  })

  it('AC5: "Markeer allen aanwezig" laat de volgorde gelijk', async () => {
    await renderEvent({ players: spelers() })
    await klik(screen.getByRole('button', { name: nl.event.markAllPresent }))
    expect(attendanceActies.markAllPresent).toHaveBeenCalledTimes(1)
    for (const n of verwacht) expect(statusVanRij(rijVan(screen.getByText(n)))).toBe('present')
    expect(volgorde(verwacht)).toEqual(verwacht)
  })
})

describe('AC6 — afwezige actieve gasten worden getoond', () => {
  it('AC6: een gast met status "afwezig" staat in de lijst, in het gastblok', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: 'g1', name: 'Afwezige Gast', type: 'guest' }),
        makePlayer({ id: 'r1', name: 'Vast', type: 'regular' }),
      ],
      attendance: [{ event_id: 'e1', team_id: TEAM, player_id: 'g1', status: 'absent' }],
    })
    const gast = screen.getByText('Afwezige Gast')
    expect(statusVanRij(rijVan(gast))).toBe('absent')
    expect(volgNaKop(gast, kop(nl.event.attendanceGuestsHeading)!)).toBe(true)
  })
})

describe('AC7 — geen gasten: kop "Gastspelers" niet zichtbaar', () => {
  it('AC7: alleen reguliere spelers → wel kop "Spelers", geen kop "Gastspelers"', async () => {
    await renderEvent({ players: [makePlayer({ id: 'r1', name: 'Vast' })] })
    expect(kop(nl.players.title)).toBeInTheDocument()
    expect(kop(nl.event.attendanceGuestsHeading)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.event.attendanceGuestsHeading)).not.toBeInTheDocument()
  })
})

describe('AC8 — alleen gasten: alleen blok "Gastspelers", nooit een kop van een leeg blok', () => {
  it('AC8: alleen gasten → kop "Gastspelers" wel, kop "Spelers" niet', async () => {
    await renderEvent({ players: [makePlayer({ id: 'g1', name: 'Gast', type: 'guest' })] })
    expect(kop(nl.event.attendanceGuestsHeading)).toBeInTheDocument()
    expect(kop(nl.players.title)).not.toBeInTheDocument()
    expect(screen.getByText('Gast')).toBeInTheDocument()
  })
})

describe('AC9 — onbekende positie breekt niets, speler achteraan in zijn blok', () => {
  it('AC9: speler met onbekende positie staat achteraan in zijn eigen blok (regulier én gast), pagina rendert', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: 'r1', name: 'Vast Onbekend', position: 'Libero' }),
        makePlayer({ id: 'r2', name: 'Vast Linksbuiten', position: 'Linksbuiten' }),
        makePlayer({ id: 'r3', name: 'Vast Keeper', position: 'Keeper' }),
        makePlayer({ id: 'g1', name: 'Gast Onbekend', position: 'Libero', type: 'guest' }),
        makePlayer({ id: 'g2', name: 'Gast Spits', position: 'Spits', type: 'guest' }),
      ],
    })
    expect(volgorde(['Vast Onbekend', 'Vast Linksbuiten', 'Vast Keeper', 'Gast Onbekend', 'Gast Spits']))
      .toEqual(['Vast Keeper', 'Vast Linksbuiten', 'Vast Onbekend', 'Gast Spits', 'Gast Onbekend'])
  })
})

describe('AC10 — alleen `position` telt, `secondary_positions` niet', () => {
  it('AC10: een bijpositie "Keeper" brengt een Spits niet naar voren', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: 'a', name: 'Aad Spits', position: 'Spits', secondary_positions: ['Keeper'] }),
        makePlayer({ id: 'b', name: 'Bob Rechtsachter', position: 'Rechtsachter', secondary_positions: ['Linksbuiten'] }),
      ],
    })
    expect(volgorde(['Aad Spits', 'Bob Rechtsachter'])).toEqual(['Bob Rechtsachter', 'Aad Spits'])
  })
})

describe('AC11 — inactieven blijven weg, teamfilter blijft', () => {
  it('AC11: inactieve speler/gast en spelers van een ander team staan niet in de lijst', async () => {
    await renderEvent({
      players: [
        makePlayer({ id: '1', name: 'Actief Vast' }),
        makePlayer({ id: '2', name: 'Inactief Vast', active: false }),
        makePlayer({ id: '3', name: 'Actief Gast', type: 'guest' }),
        makePlayer({ id: '4', name: 'Inactief Gast', type: 'guest', active: false }),
        makePlayer({ id: '5', name: 'Ander Team Vast', team_id: OTHER_TEAM }),
        makePlayer({ id: '6', name: 'Ander Team Gast', team_id: OTHER_TEAM, type: 'guest' }),
      ],
    })
    expect(screen.getByText('Actief Vast')).toBeInTheDocument()
    expect(screen.getByText('Actief Gast')).toBeInTheDocument()
    for (const n of ['Inactief Vast', 'Inactief Gast', 'Ander Team Vast', 'Ander Team Gast']) {
      expect(screen.queryByText(n)).not.toBeInTheDocument()
    }
  })
})

describe('AC12 — koppen vertaald in nl/en/de/fr/es', () => {
  const talen: Record<string, Dict> = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('AC12: %s heeft een kop voor beide blokken', (_naam, dict) => {
    for (const tekst of [dict.players.title, dict.event.attendanceGuestsHeading]) {
      expect(typeof tekst).toBe('string')
      expect(tekst.trim().length).toBeGreaterThan(2)
    }
    expect(dict.event.attendanceGuestsHeading).not.toBe(dict.players.title)
  })
  it('AC12: de vier vreemde talen zijn echt vertaald (niet de NL-tekst gekopieerd)', () => {
    for (const dict of [en, de, fr, es]) {
      expect(dict.event.attendanceGuestsHeading).not.toBe(nl.event.attendanceGuestsHeading)
    }
  })
  it.each(Object.entries(talen))('AC12: %s toont de eigen koppen op de eventpagina', async (_naam, dict) => {
    await renderEvent({
      dict,
      players: [makePlayer({ id: 'r', name: 'Vast' }), makePlayer({ id: 'g', name: 'Gast', type: 'guest' })],
    })
    expect(kop(dict.players.title)).toBeInTheDocument()
    expect(kop(dict.event.attendanceGuestsHeading)).toBeInTheDocument()
  })
})

describe('AC13 — andere lijsten ongewijzigd', () => {
  it('AC13: /players groepeert gasten nog gewoon per positiegroep, zonder gastblok', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ id: TEAM }, {
        players: [
          makePlayer({ id: 'g1', name: 'Gast Keeper', position: 'Keeper', type: 'guest' }),
          makePlayer({ id: 'r1', name: 'Vast Spits', position: 'Spits' }),
        ],
      }) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    render(<DictProvider dict={nl}>{await PlayersPage()}</DictProvider>)
    expect(kop(nl.event.attendanceGuestsHeading)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.event.attendanceGuestsHeading)).not.toBeInTheDocument()
    // Keeper-gast blijft vóór de Spits (groepvolgorde), niet "gasten achteraan".
    expect(volgorde(['Gast Keeper', 'Vast Spits'])).toEqual(['Gast Keeper', 'Vast Spits'])
  })

  it('AC13: de printlijst op het trainingsplan houdt de eigen (DB-)volgorde, geen gastblok', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ id: TEAM }, tabellen({
        players: [
          makePlayer({ id: 'g1', name: 'Gast Keeper', position: 'Keeper', type: 'guest', jersey_number: 21 }),
          makePlayer({ id: 'r1', name: 'Vast Aanvaller', position: 'Aanvallende middenvelder', jersey_number: 7 }),
        ],
        attendance: [
          { event_id: 'e1', team_id: TEAM, player_id: 'g1', status: 'present' },
          { event_id: 'e1', team_id: TEAM, player_id: 'r1', status: 'present' },
        ],
      })) as unknown as Awaited<ReturnType<typeof createClient>>,
    )
    render(<DictProvider dict={nl}>{await TrainingPlanPage({ params: Promise.resolve({ id: 'e1' }) })}</DictProvider>)
    expect(screen.queryByText(nl.event.attendanceGuestsHeading)).not.toBeInTheDocument()
    const li = (naam: string) => screen.getByText((_c, el) => el?.tagName === 'LI' && (el.textContent ?? '').includes(naam))
    // DB-volgorde (position asc): 'Aanvallende middenvelder' vóór 'Keeper'. De nieuwe
    // aanwezigheidsvolgorde zou Keeper eerst zetten; hier moet dat NIET gebeuren.
    expect(li('Vast Aanvaller').compareDocumentPosition(li('Gast Keeper')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('AC14 — volgorde op DB-waarde, gelijk in elke taal', () => {
  const talen: Record<string, Dict> = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('AC14: %s toont de positievolgorde (op DB-waarde) identiek', async (_naam, dict) => {
    await renderEvent({ dict, players: perPositie('Vast', 'regular') })
    expect(volgorde(POS.map((p) => `Vast ${p}`))).toEqual(POS.map((p) => `Vast ${p}`))
  })
})
