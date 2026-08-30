// Acceptatietests — Uitgebreide formatiecatalogus + inslag-animatie in de
// opstellingsbouwer.
//
// Twee wijzigingen:
//
//   1. De gecureerde 11-tal-catalogus ging van 5 naar 15 formaties, inclusief
//      drie 4-3-3-varianten. Vijftien chips naast elkaar is een muur, dus de
//      kiezer is uitklapbaar: dicht toont hij alleen de actieve formatie, open
//      het volledige raster. De vorm van de catalogus zelf (11 posities, één
//      keeper, rugnummers 1-11, bekende positielabels) wordt bewaakt in
//      lib/formations.test.ts; dit bestand toetst wat de coach ervan ziet.
//   2. Een speler die in zijn positie wordt gezet, slaat in: het poppetje
//      schiet door en veert terug, er slaan twee schokgolf-ringen naar buiten
//      en het naamplaatje schuift eronder omhoog. Alleen bij het NEERZETTEN,
//      nooit bij verwijderen, en nooit bij prefers-reduced-motion.
//
// ── Testmethode ──
// Rendert de ECHTE server-pagina app/events/[id]/lineup/page.tsx met alleen
// @/lib/supabase/server, next/navigation en next/headers gestubd — zelfde
// precedent als opstelling-vorm.acceptance.test.tsx.
//
// De animatie zelf (de keyframes in app/globals.css) is in jsdom niet te
// meten: er is geen layout-engine en geen animatieklok. Wat hier bewijsbaar is
// — en wat ook precies de logica is die kán breken — is WANNEER de app de
// animatie aanzet: welk slot, bij welke actie, en of de reduced-motion-check
// hem tegenhoudt. De keyframes zelf zijn declaratieve CSS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { FORMATIONS } from '@/lib/types'

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
const EVENT_ID = 'e1'

type Row = Record<string, unknown>

function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      lt: () => chain,
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }),
    }
    return chain
  }
}

function speler(id: string, naam: string, positie: string, nummer: number): Row {
  return {
    id, team_id: TEAM, name: naam, position: positie, secondary_positions: [],
    jersey_number: nummer, active: true, injured: false, type: 'regular', rating: 7,
    created_at: '2024-01-01T00:00:00Z',
  }
}

// Elf spelers, allemaal aanwezig. Anna en Bram hebben een eigen naam omdat de
// tests hierboven op /Anna/ en /Bram/ zoeken; de rest vult alleen het veld.
const SPELERS: Row[] = [
  speler('p1', 'Anna Keeper', 'Keeper', 1),
  speler('p2', 'Bram Midden', 'Centrale middenvelder', 6),
  ...Array.from({ length: 9 }, (_, i) =>
    speler(`p${i + 3}`, `Veldspeler${i + 3}`, 'Centrale middenvelder', i + 10)),
]

function makeSupabaseMock(opts: { lineups?: Row[] } = {}) {
  const factories: Record<string, () => unknown> = {
    events: tableFactory([{
      id: EVENT_ID, team_id: TEAM, type: 'match', date: '2026-08-10', time: null, location: null,
      match_type: 'league', opponent: 'Tegenstander', home_away: 'home', notes: null,
      doelstelling: null, goals_for: null, goals_against: null, created_at: '2026-08-01T10:00:00Z',
    }]),
    players: tableFactory(SPELERS),
    attendance: tableFactory(SPELERS.map((p) => ({
      event_id: EVENT_ID, team_id: TEAM, player_id: p.id, status: 'present',
    }))),
    lineups: tableFactory(opts.lineups ?? []),
    match_squad: tableFactory([]),
    settings: tableFactory([]),
    match_ratings: tableFactory([]),
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: TEAM } } }) },
    from: (table: string) => {
      const factory = factories[table]
      if (!factory) throw new Error(`Onverwachte tabel in test: ${table}`)
      return factory()
    },
  }
}

async function renderLineupPage(opts: { lineups?: Row[] } = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await LineupPage({ params: Promise.resolve({ id: EVENT_ID }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// Opent de kiezer en tikt de chip van `key` aan. De actieve formatie staat
// twee keer in de DOM zodra het paneel open is — als <span> op de uitklapknop
// en als <button> in het raster — dus de chip wordt op tagnaam gekozen in
// plaats van op tekst alleen.
function kiesFormatie(key: string) {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  const chip = screen.getAllByText(key).find((el) => el.tagName === 'BUTTON')
  if (!chip) throw new Error(`Geen formatiechip gevonden voor ${key}`)
  fireEvent.click(chip)
}

function stubMatchMedia(prefersReduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersReduce && query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  stubMatchMedia(false)
})

afterEach(() => {
  vi.useRealTimers()
})

// ────────────────────────────────────────────────────────────────────────────
// 1. De uitklapbare formatiekiezer
// ────────────────────────────────────────────────────────────────────────────

describe('Formatiekiezer — uitklapbaar', () => {
  it('start dicht en toont dan alleen de actieve formatie, niet de hele catalogus', async () => {
    await renderLineupPage()

    const knop = screen.getByRole('button', { expanded: false })
    expect(knop).toHaveTextContent('4-3-3')
    // De andere veertien staan niet in de DOM zolang het paneel dicht is.
    expect(screen.queryByText('4-4-2')).toBeNull()
    expect(screen.queryByText('3-5-2')).toBeNull()
    expect(screen.queryByText('4-3-3 (controleur)')).toBeNull()
  })

  it('opent op een tik en toont dan élke formatie uit de catalogus', async () => {
    await renderLineupPage()

    fireEvent.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    for (const key of Object.keys(FORMATIONS)) {
      // '4-3-3' staat zowel op de uitklapknop als op zijn eigen chip; de rest
      // precies één keer.
      expect(screen.getAllByText(key).length, key).toBeGreaterThan(0)
    }
    expect(Object.keys(FORMATIONS).length).toBeGreaterThanOrEqual(15)
  })

  it('kiest een 4-3-3-variant, wisselt de opstelling en sluit het paneel', async () => {
    await renderLineupPage()

    kiesFormatie('4-3-3 (controleur)')

    // Paneel dicht, knop toont de nieuwe formatie.
    const knop = screen.getByRole('button', { expanded: false })
    expect(knop).toHaveTextContent('4-3-3 (controleur)')
    expect(screen.queryByText('4-4-2')).toBeNull()

    // En de opstelling is écht gewisseld: de controleur-variant heeft een
    // DM-slot waar het klassieke 4-3-3 er geen heeft.
    expect(screen.getByText('DM')).toBeInTheDocument()
  })

  it('elke formatie in de kiezer levert precies elf slots op', async () => {
    await renderLineupPage()

    for (const key of Object.keys(FORMATIONS)) {
      kiesFormatie(key)
      // Elk onbezet slot toont een '+'; met een lege opstelling zijn dat er 11.
      expect(screen.getAllByText('+'), key).toHaveLength(11)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. De inslag bij het plaatsen van een speler
// ────────────────────────────────────────────────────────────────────────────

// Opent de onbezette CM-slot in het standaard 4-3-3 en zet Bram erin.
function zetBramOpCm() {
  fireEvent.click(screen.getByText('CM'))
  fireEvent.click(screen.getByRole('button', { name: /Bram/ }))
}

describe('Inslag — een speler wordt in zijn positie gezet', () => {
  it('laat de schokgolf slaan en zet de inslag-animatie op het poppetje', async () => {
    await renderLineupPage()

    expect(screen.queryByTestId('poppetje-schokgolf')).toBeNull()

    zetBramOpCm()

    expect(screen.getByTestId('poppetje-schokgolf')).toBeInTheDocument()
    const poppetje = screen.getByTestId('speler-poppetje-wit')
    expect(poppetje.style.animation).toContain('poppetje-inslag')
  })

  it('slaat alleen in op het slot waar de speler landt, niet op de andere tien', async () => {
    await renderLineupPage()

    zetBramOpCm()

    // Eén schokgolf-ring met testid (de tweede, gekleurde ring draagt er geen),
    // dus precies één inslaand slot.
    expect(screen.getAllByTestId('poppetje-schokgolf')).toHaveLength(1)
  })

  it('slaat NIET in bij het verwijderen van een speler', async () => {
    await renderLineupPage()

    vi.useFakeTimers()
    zetBramOpCm()
    // De inslag van het neerzetten eerst laten uitlopen.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByTestId('poppetje-schokgolf')).toBeNull()

    // Slot opnieuw openen en Bram eruit halen.
    fireEvent.click(screen.getByRole('button', { name: /Bram/ }))
    fireEvent.click(screen.getByText(nl.lineup.removePlayer))

    expect(screen.queryByTestId('poppetje-schokgolf')).toBeNull()
  })

  it('ruimt de schokgolf weer op zodat hij niet in de DOM blijft hangen', async () => {
    await renderLineupPage()

    vi.useFakeTimers()
    zetBramOpCm()
    expect(screen.getByTestId('poppetje-schokgolf')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.queryByTestId('poppetje-schokgolf')).toBeNull()
    // Het poppetje blijft staan — alleen de animatie is voorbij.
    expect(screen.getByTestId('speler-poppetje-wit')).toBeInTheDocument()
  })

  it('respecteert prefers-reduced-motion: geen schokgolf, wel de speler', async () => {
    stubMatchMedia(true)
    await renderLineupPage()

    zetBramOpCm()

    expect(screen.queryByTestId('poppetje-schokgolf')).toBeNull()
    const poppetje = screen.getByTestId('speler-poppetje-wit')
    expect(poppetje.style.animation).toBe('')
    // De speler staat er gewoon: de animatie is versiering, geen voorwaarde.
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3. Spelers verhuizen mee bij een formatiewissel
// ────────────────────────────────────────────────────────────────────────────

// Opstelling met beide spelers erin: Anna op de keeper, Bram op de CM van het
// standaard 4-3-3. De verhuislogica zelf is uitputtend getest in
// lib/lineup-verhuizing.test.ts; hier gaat het om de koppeling met de UI.
function opstellingMetTwee(): Row {
  return {
    id: 'l1', event_id: EVENT_ID, team_id: TEAM, formation: '4-3-3', notes: null,
    created_at: '2026-08-05T10:00:00Z',
    positions: FORMATIONS['4-3-3'].positions.map((p) => ({
      ...p,
      player_id: p.position_label === 'KP' ? 'p1' : p.position_label === 'CM' ? 'p2' : null,
    })),
  }
}

// Alle elf slots van het standaard 4-3-3 bezet met p1..p11, in bronvolgorde.
function volledigeOpstelling(): Row {
  return {
    id: 'l1', event_id: EVENT_ID, team_id: TEAM, formation: '4-3-3', notes: null,
    created_at: '2026-08-05T10:00:00Z',
    positions: FORMATIONS['4-3-3'].positions.map((p, i) => ({ ...p, player_id: `p${i + 1}` })),
  }
}

describe('Formatiewissel — spelers verhuizen mee', () => {
  it('houdt beide spelers op het veld in plaats van de opstelling leeg te gooien', async () => {
    await renderLineupPage({ lineups: [opstellingMetTwee()] })

    expect(screen.getByRole('button', { name: /Anna/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()

    kiesFormatie('4-3-3 (controleur)')

    // Vóór deze wijziging stonden ze na de wissel allebei op de bank.
    expect(screen.getByRole('button', { name: /Anna/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bram/ })).toBeInTheDocument()
    // En er zijn nog steeds negen lege slots, dus niemand is gedupliceerd.
    expect(screen.getAllByText('+')).toHaveLength(9)
  })

  it('houdt de keeper in het doel, ook bij een wissel naar een 5-backsysteem', async () => {
    await renderLineupPage({ lineups: [opstellingMetTwee()] })

    kiesFormatie('5-4-1')

    // Het KP-slot staat op x=50, y=90; daar hoort Anna te staan.
    const keeperKnop = screen.getByRole('button', { name: /Anna/ })
    expect(keeperKnop.style.left).toBe('50%')
    expect(keeperKnop.style.top).toBe('90%')
  })

  it('meldt het wanneer iemand geen vergelijkbaar slot heeft', async () => {
    // Met een VOLLE opstelling gaan de slots pas echt om elkaar concurreren.
    // 4-3-3 → 3-5-2 laat precies één speler over: de vleugelspitsen hebben in
    // een 3-5-2 geen tegenhanger. Met een half lege opstelling is er altijd wel
    // ergens plek en zou deze test niets bewijzen.
    await renderLineupPage({ lineups: [volledigeOpstelling()] })
    kiesFormatie('3-5-2')

    expect(screen.getByText(nl.lineup.movedToBench.replace('{n}', '1'))).toBeInTheDocument()
  })

  it('meldt niets wanneer iedereen meeverhuist', async () => {
    await renderLineupPage({ lineups: [opstellingMetTwee()] })

    kiesFormatie('4-4-2')

    expect(screen.queryByText(/pasten niet in deze formatie/)).toBeNull()
  })

  it('laat de melding verdwijnen zodra de coach zelf weer iemand plaatst', async () => {
    await renderLineupPage({ lineups: [volledigeOpstelling()] })
    kiesFormatie('3-5-2')
    expect(screen.getByText(nl.lineup.movedToBench.replace('{n}', '1'))).toBeInTheDocument()

    // Het lege slot dat overbleef toont zijn positielabel; de bezette slots
    // tonen een spelersnaam. Er is er precies één vrij.
    const leegSlot = screen.getAllByText('+')
    expect(leegSlot).toHaveLength(1)
    fireEvent.click(leegSlot[0])
    // De speler die op de bank belandde is de enige beschikbare keuze. De
    // popup-rijen dragen een eigen testid: zonder dat zijn ze niet te
    // onderscheiden van de poppetjes op het veld, die ook <button> met een
    // spelersnaam zijn.
    const rijen = screen.getAllByTestId('popup-speler')
    expect(rijen).toHaveLength(1)
    fireEvent.click(rijen[0])

    expect(screen.queryByText(/pasten niet in deze formatie/)).toBeNull()
  })
})
