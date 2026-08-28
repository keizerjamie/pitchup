// Acceptatietests — Clubkleuren op de poppetjes + een afgebakende bank in de
// opstellingsbouwer.
//
// Twee samenhangende wijzigingen aan app/events/[id]/lineup/page.tsx en
// components/LineupBuilder.tsx:
//
//   1. De poppetjes op het veld waren altijd wit. Zodra er clubkleuren gekozen
//      zijn dragen ze het clubtenue: linkerhelft primair, rechterhelft
//      secundair. Zonder gekozen kleur blijven ze wit — bewust NIET het
//      donkergroene CLUB_COLOR_FALLBACK-tenue.
//   2. De bank toonde élke actieve speler. Hij toont nu de wedstrijdselectie
//      (match_squad) zodra die bepaald is, en zolang dat niet zo is alleen de
//      aanwezige spelers. Datzelfde filter geldt voor de spelerspopup per
//      positie en voor "Auto-opstelling" — die drie lezen één en dezelfde pool
//      (eligibleIds in LineupBuilder), zodat de popup nooit iemand kan
//      aanbieden die niet op de bank staat.
//
// ── Testmethode ──
// Dit bestand rendert de ECHTE server-pagina app/events/[id]/lineup/page.tsx
// met uitsluitend @/lib/supabase/server, next/navigation en next/headers
// gestubd — zelfde precedent als opstelling-vorm.acceptance.test.tsx. De
// Supabase-mock is een tabel-engine die de echte method-chain (.eq/.in/.order)
// op een in-memory rijenset toepast, geen call-recorder: zou de productiequery
// een team_id-filter missen, dan faalt het tenant-isolatieblok onderaan net zo
// hard als tegen een echte database.
//
// getDict() is gewrapt in React's cache(); de cookies-mock geeft nooit een
// locale-cookie terug, dus de locale is binnen dit bestand altijd 'nl'.
//
// ── Scoping van asserties ──
// Spelersnamen komen op deze pagina op DRIE plekken voor: het overzicht rechts
// (spans), de poppetjes op het veld (buttons) en de bank (spans). Losse
// getByText zou dus vals-positief kunnen zijn. Daarom:
//   • bank      → altijd binnen benchSection(), gescoped op het kopje.
//   • popup     → getByRole('button', { name: … }); alleen de popup-rijen zijn
//                 buttons met een spelersnaam (een onbezet slot toont zijn
//                 positielabel, niet een naam).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { CLUB_COLOR_FALLBACK, CLUB_COLOR_KEYS, KIT_INK_LIGHT, READABLE_INK_DARK } from '@/lib/club-colors'

vi.mock('@/app/actions/attendance', () => ({
  saveLineup: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('__notFound__')
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import LineupPage from '@/app/events/[id]/lineup/page'

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
const EVENT_ID = 'e1'
const EVENT_DATE = '2026-08-10'

type Row = Record<string, unknown>

// ── Tabel-engine (zie kopcomment) ──
function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    let limitN: number | null = null

    function resolveRows(): Row[] {
      const out = rows.filter((r) => filters.every((f) => f(r)))
      return limitN === null ? out : out.slice(0, limitN)
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) < (val as string))
        return chain
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      order: () => chain,
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: resolveRows(), error: null }),
    }
    return chain
  }
}

function eventRow(overrides: Row = {}): Row {
  return {
    id: EVENT_ID,
    team_id: TEAM,
    type: 'match',
    date: EVENT_DATE,
    time: null,
    location: null,
    match_type: 'league',
    opponent: 'Tegenstander',
    home_away: 'home',
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  }
}

function playerRow(overrides: Row = {}): Row {
  return {
    id: 'p1',
    team_id: TEAM,
    name: 'Speler Een',
    position: 'Centrale middenvelder',
    secondary_positions: [],
    jersey_number: null,
    active: true,
    injured: false,
    type: 'regular',
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// Vier spelers met goed te onderscheiden voornamen (de UI toont
// name.split(' ')[0]).
const SPELERS: Row[] = [
  playerRow({ id: 'p1', name: 'Anna Keeper', position: 'Keeper', jersey_number: 1 }),
  playerRow({ id: 'p2', name: 'Bram Bank', position: 'Centrale middenvelder', jersey_number: 6 }),
  playerRow({ id: 'p3', name: 'Chris Afwezig', position: 'Spits', jersey_number: 9 }),
  playerRow({ id: 'p4', name: 'Daan Onbekend', position: 'Linksachter', jersey_number: 3 }),
]

// jsdom normaliseert de losse `color`-property naar 'rgb(r, g, b)' maar laat
// hex binnen de `background`-shorthand staan. Deze helper houdt de asserties
// gekoppeld aan de echte constanten uit lib/club-colors.ts in plaats van aan
// overgeschreven rgb-strings.
function rgbVan(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

function attendanceRow(playerId: string, status: string, teamId = TEAM): Row {
  return { event_id: EVENT_ID, team_id: teamId, player_id: playerId, status }
}

function squadRow(playerId: string, teamId = TEAM): Row {
  return { event_id: EVENT_ID, team_id: teamId, player_id: playerId }
}

function settingRow(key: string, value: string, teamId = TEAM): Row {
  return { team_id: teamId, key, value }
}

// Opgeslagen opstelling met Anna (p1) in het keepersslot. Nodig omdat de
// bank-sectie pas verschijnt zodra er minstens één speler is opgesteld — en
// het bezette poppetje is precies wat het tenue moet dragen.
function lineupRow(playerId: string | null = 'p1'): Row {
  return {
    id: 'l1',
    event_id: EVENT_ID,
    team_id: TEAM,
    formation: '4-3-3',
    positions: [
      { player_id: playerId, x: 50, y: 90, position_label: 'KP', position_number: 1 },
      { player_id: null, x: 15, y: 70, position_label: 'LV', position_number: 3 },
      { player_id: null, x: 38, y: 70, position_label: 'MV', position_number: 5 },
      { player_id: null, x: 62, y: 70, position_label: 'MV', position_number: 4 },
      { player_id: null, x: 85, y: 70, position_label: 'RV', position_number: 2 },
      { player_id: null, x: 25, y: 48, position_label: 'LM', position_number: 6 },
      { player_id: null, x: 50, y: 48, position_label: 'CM', position_number: 8 },
      { player_id: null, x: 75, y: 48, position_label: 'RM', position_number: 10 },
      { player_id: null, x: 20, y: 22, position_label: 'LA', position_number: 11 },
      { player_id: null, x: 50, y: 18, position_label: 'SP', position_number: 9 },
      { player_id: null, x: 80, y: 22, position_label: 'RA', position_number: 7 },
    ],
    notes: null,
    created_at: '2026-08-05T10:00:00Z',
  }
}

function makeSupabaseMock(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  attendance?: Row[]
  lineups?: Row[]
  matchSquad?: Row[]
  settings?: Row[]
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const factories: Record<string, () => unknown> = {
    events: tableFactory(opts.events ?? [eventRow()]),
    players: tableFactory(opts.players ?? SPELERS),
    attendance: tableFactory(opts.attendance ?? []),
    lineups: tableFactory(opts.lineups ?? []),
    match_squad: tableFactory(opts.matchSquad ?? []),
    settings: tableFactory(opts.settings ?? []),
    match_ratings: tableFactory([]),
  }
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const factory = factories[table]
      if (!factory) throw new Error(`Onverwachte tabel in test: ${table}`)
      return factory()
    },
  }
}

async function renderLineupPage(opts: Parameters<typeof makeSupabaseMock>[0] = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await LineupPage({ params: Promise.resolve({ id: EVENT_ID }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// De bank-sectie, gescoped op zijn eigen kopje ("Bank / reserve (n)") — zonder
// deze scoping zou een naam uit het spelersoverzicht rechts de assertie
// kunnen redden.
function benchSection(): HTMLElement {
  const heading = screen.getByText(new RegExp(`^${nl.lineup.bench} \\(\\d+\\)$`))
  const section = heading.parentElement
  if (!section) throw new Error('Bank-sectie zonder container')
  return section
}

// Het bezette keepersslot. `data-testid` onderscheidt het witte poppetje van
// het tenue-poppetje; beide varianten hebben er precies één per bezet slot.
function poppetjeTenue(): HTMLElement | null {
  return screen.queryByTestId('speler-poppetje-tenue')
}
function poppetjeWit(): HTMLElement | null {
  return screen.queryByTestId('speler-poppetje-wit')
}

// Opent het (onbezette) CM-slot in het standaard 4-3-3 — zelfde ingang als
// opstelling-vorm.acceptance.test.tsx.
function openCmSlot() {
  fireEvent.click(screen.getByText('CM'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────────────────────────────────
// 1. De bank zonder wedstrijdselectie
// ────────────────────────────────────────────────────────────────────────────

describe('Bank zonder wedstrijdselectie — alleen de aanwezige spelers', () => {
  it('toont alleen wie op aanwezig staat; afgemelde en onbekende spelers vallen weg', async () => {
    await renderLineupPage({
      attendance: [
        attendanceRow('p1', 'present'),
        attendanceRow('p2', 'present'),
        attendanceRow('p3', 'absent'),
        // p4 heeft helemaal geen aanwezigheidsrij — ook die hoort weg te vallen.
      ],
      lineups: [lineupRow('p1')],
    })

    const bank = benchSection()
    // Anna staat al opgesteld, dus blijft Bram als enige inzetbare reserve over.
    expect(within(bank).getByText('Bram')).toBeInTheDocument()
    expect(within(bank).queryByText('Chris')).toBeNull()
    expect(within(bank).queryByText('Daan')).toBeNull()
    expect(screen.getByText(`${nl.lineup.bench} (1)`)).toBeInTheDocument()
  })

  it('past hetzelfde filter toe op de spelerspopup per positie', async () => {
    await renderLineupPage({
      attendance: [
        attendanceRow('p1', 'present'),
        attendanceRow('p2', 'present'),
        attendanceRow('p3', 'absent'),
      ],
      lineups: [lineupRow('p1')],
    })

    openCmSlot()

    // Alleen popup-rijen zijn buttons met een spelersnaam erin.
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Chris/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Daan/ })).toBeNull()
  })

  it('gebruikt dezelfde pool voor Auto-opstelling', async () => {
    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present'), attendanceRow('p2', 'present')],
      lineups: [lineupRow(null)],
    })

    fireEvent.click(screen.getByText(nl.lineup.autoLineup))

    // Anna (keeper) en Bram (middenvelder) belanden op het veld; de niet
    // aanwezige Chris en Daan nergens.
    expect(screen.getByRole('button', { name: /Anna/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Chris/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Daan/ })).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. De bank mét wedstrijdselectie
// ────────────────────────────────────────────────────────────────────────────

describe('Bank mét wedstrijdselectie — alleen de geselecteerde spelers', () => {
  it('vervangt de aanwezigheidslijst door de selectie', async () => {
    await renderLineupPage({
      // Bram is wél aanwezig maar NIET geselecteerd; Chris is niet aanwezig maar
      // wel geselecteerd. De selectie is leidend zodra hij bestaat.
      attendance: [
        attendanceRow('p1', 'present'),
        attendanceRow('p2', 'present'),
        attendanceRow('p3', 'absent'),
      ],
      matchSquad: [squadRow('p1'), squadRow('p3')],
      lineups: [lineupRow('p1')],
    })

    const bank = benchSection()
    expect(within(bank).getByText('Chris')).toBeInTheDocument()
    expect(within(bank).queryByText('Bram')).toBeNull()
    expect(within(bank).queryByText('Daan')).toBeNull()
    expect(screen.getByText(`${nl.lineup.bench} (1)`)).toBeInTheDocument()
  })

  it('past de selectie ook toe op de spelerspopup', async () => {
    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present'), attendanceRow('p2', 'present')],
      matchSquad: [squadRow('p1'), squadRow('p3')],
      lineups: [lineupRow('p1')],
    })

    openCmSlot()

    expect(screen.getByRole('button', { name: /Chris/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bram/ })).toBeNull()
  })

  it('laat een al opgestelde speler buiten de selectie op het veld staan (geen stille leegloop)', async () => {
    // Daan stond al opgesteld toen de selectie werd bepaald en zit er niet in.
    // Hij mag niet naamloos worden; hij hoort alleen niet meer op de bank.
    const opstelling = lineupRow('p1') as Row & { positions: Row[] }
    opstelling.positions = opstelling.positions.map((pos) =>
      pos.position_label === 'LV' ? { ...pos, player_id: 'p4' } : pos,
    )

    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present')],
      matchSquad: [squadRow('p1'), squadRow('p2')],
      lineups: [opstelling],
    })

    expect(screen.getByRole('button', { name: /Daan/ })).toBeInTheDocument()
    expect(within(benchSection()).queryByText('Daan')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3. Clubkleuren op de poppetjes
// ────────────────────────────────────────────────────────────────────────────

describe('Poppetjes — clubkleuren', () => {
  const basis = {
    attendance: [attendanceRow('p1', 'present')],
    lineups: [lineupRow('p1')],
  }

  it('blijft wit zolang er geen clubkleur is gekozen', async () => {
    await renderLineupPage(basis)

    expect(poppetjeTenue()).toBeNull()
    const wit = poppetjeWit()
    expect(wit).not.toBeNull()
    expect(wit!.className).toContain('bg-white')
    // Regressie: nooit stilzwijgend het donkergroene fallbacktenue.
    expect(wit!.getAttribute('style') ?? '').not.toContain(CLUB_COLOR_FALLBACK.primary)
  })

  it('deelt het poppetje in tweeën zodra beide clubkleuren gekozen zijn', async () => {
    await renderLineupPage({
      ...basis,
      settings: [
        settingRow(CLUB_COLOR_KEYS.primary, '#ff0000'),
        settingRow(CLUB_COLOR_KEYS.secondary, '#0000ff'),
      ],
    })

    expect(poppetjeWit()).toBeNull()
    const tenue = poppetjeTenue()
    expect(tenue).not.toBeNull()
    // Harde stops op 50%: links primair, rechts secundair — geen verloop.
    expect(tenue!.style.background).toBe('linear-gradient(90deg, #ff0000 0 50%, #0000ff 50% 100%)')
    // Het rugnummer krijgt de contrastkleur, niet de oude vaste donkergroene.
    expect(tenue!.style.color).toBe(rgbVan(KIT_INK_LIGHT))
    expect(tenue!.className).not.toContain('bg-white')
  })

  it('maakt een effen shirt wanneer alleen de primaire kleur gekozen is', async () => {
    await renderLineupPage({
      ...basis,
      settings: [settingRow(CLUB_COLOR_KEYS.primary, '#ff0000')],
    })

    const tenue = poppetjeTenue()
    expect(tenue).not.toBeNull()
    expect(tenue!.style.background).toBe('linear-gradient(90deg, #ff0000 0 50%, #ff0000 50% 100%)')
    // Nooit de secundaire fallbackkleur erbij verzinnen.
    expect(tenue!.style.background).not.toContain(CLUB_COLOR_FALLBACK.secondary)
  })

  it('kiest een leesbaar rugnummer op een licht tenue', async () => {
    await renderLineupPage({
      ...basis,
      settings: [settingRow(CLUB_COLOR_KEYS.primary, '#ffe600')],
    })

    const tenue = poppetjeTenue()
    expect(tenue).not.toBeNull()
    // Geel shirt → donkere ink, niet wit.
    expect(tenue!.style.color).toBe(rgbVan(READABLE_INK_DARK))
    expect(tenue!.style.color).not.toBe(rgbVan(KIT_INK_LIGHT))
  })

  it('laat een leeg slot ongemoeid: geen tenue op een onbezette positie', async () => {
    await renderLineupPage({
      ...basis,
      settings: [
        settingRow(CLUB_COLOR_KEYS.primary, '#ff0000'),
        settingRow(CLUB_COLOR_KEYS.secondary, '#0000ff'),
      ],
    })

    // Precies één bezet slot (de keeper) → precies één tenue-poppetje.
    expect(screen.getAllByTestId('speler-poppetje-tenue')).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4. Tenant-isolatie op de twee nieuwe queries
// ────────────────────────────────────────────────────────────────────────────

describe('Tenant-isolatie — match_squad en settings van een ander team tellen nooit mee', () => {
  it('negeert de wedstrijdselectie van een ander team (bank valt terug op aanwezigheid)', async () => {
    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present'), attendanceRow('p2', 'present')],
      // Zou dit filter ontbreken, dan zou Chris (de "selectie" van team-2) op de
      // bank verschijnen en Bram eruit vallen.
      matchSquad: [squadRow('p3', OTHER_TEAM)],
      lineups: [lineupRow('p1')],
    })

    const bank = benchSection()
    expect(within(bank).getByText('Bram')).toBeInTheDocument()
    expect(within(bank).queryByText('Chris')).toBeNull()
  })

  it('negeert de clubkleuren van een ander team (poppetjes blijven wit)', async () => {
    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present')],
      settings: [
        settingRow(CLUB_COLOR_KEYS.primary, '#ff0000', OTHER_TEAM),
        settingRow(CLUB_COLOR_KEYS.secondary, '#0000ff', OTHER_TEAM),
      ],
      lineups: [lineupRow('p1')],
    })

    expect(poppetjeTenue()).toBeNull()
    expect(poppetjeWit()).not.toBeNull()
  })

  it('haalt uitsluitend de twee kleursleutels op, geen andere settings-rijen', async () => {
    // Zonder .in('key', [...]) zou een willekeurige settings-waarde als kleur
    // door resolveKitColors kunnen glippen. team_logo_url is hier bewust een
    // geldige hexstring: alleen het key-filter kan hem buitenhouden.
    await renderLineupPage({
      attendance: [attendanceRow('p1', 'present')],
      settings: [settingRow('team_logo_url', '#ff0000')],
      lineups: [lineupRow('p1')],
    })

    expect(poppetjeTenue()).toBeNull()
    expect(poppetjeWit()).not.toBeNull()
  })
})
