// Acceptatietests — Wedstrijdselectie (user story: als trainer op
// /events/<id>/squad de wedstrijdselectie samenstellen en als PDF kunnen
// exporteren via de browser-printdialoog, zodat de lijst met opgeroepen
// spelers op papier mee kan naar het veld).
//
// ── LET OP: twee nummeringen in dit bestand ──
// Het onderstaande blok "AC1..AC11" is de FILE-LOKALE nummering van de
// frontend-engineer (component-niveau, MatchSquadEditor/MatchSquadPrintList
// rechtstreeks gerenderd). Die dekt uitsluitend het PRINT-BLOK-gedrag van de
// goedgekeurde user story. De test-verifier heeft dit gecontroleerd tegen de
// ECHTE, genummerde acceptatiecriteria uit de goedgekeurde story (1 t/m 21,
// zie de sectie "Story-AC…" verderop in dit bestand) en vult daar aan waar
// het bestaande, file-lokale blok een criterium niet dekt. Mapping:
//   File-AC1  ≈ Story-AC4 (export toont exact de geselecteerde namen, alfabetisch) + Story-AC5 (keepers eerst)
//   File-AC2  ≈ Story-AC6 (uitsluitend naam) + Story-AC18 (geen blessure-markering)
//   File-AC3  ≈ Story-AC7 (geen opstelling-herleidbare info)
//   File-AC4  ≈ Story-AC5 (geen zichtbare groepering)
//   File-AC5  ≈ Story-AC8 (vs+datum-kop) + Story-AC19 (opponent null)
//   File-AC6  ≈ Story-AC9 (selectie blijft live/bewerkbaar, print volgt direct)
//   File-AC7  → ondersteunend voor Story-AC4 (print:hidden bediening lekt niet naar papier)
//   File-AC8  ≈ Story-AC13 (lege selectie: export uitgeschakeld, nooit lege PDF)
//   File-AC9  ≈ Story-AC16 (alleen/geen keepers: geen lege regel/scheiding)
//   File-AC10 ≈ Story-AC18 (geblesseerde speler) + Story-AC20 (inactieve speler, component-niveau)
//   File-AC11 ≈ Story-AC21 (i18n vsLabel in 5 talen)
// Story-AC1, 2, 3, 10, 11, 12, 14, 15, 17, 20(paginaniveau) ontbraken in de
// oorspronkelijke, door de frontend-engineer aangeleverde versie van dit
// bestand — met name de faalpaden/tenant-isolatie (10-14) waren UITSLUITEND
// unit-getest in app/actions/match-squad.test.ts (de server action zelf,
// gemockte DB), niet van-buitenaf op paginaniveau (directe URL, 404,
// login-redirect, cross-tenant zichtbaarheid). Die aanvullingen staan in het
// blok "── Story-AC… — aanvullende paginaniveau-tests ──" onderaan dit
// bestand en renderen de ECHTE routes (app/events/[id]/squad/page.tsx en
// app/events/[id]/page.tsx), zelfde precedent als renderPage() in
// afdrukken-trainingsplan.acceptance.test.tsx en de generieke
// tabel-engine (met ECHTE .eq()-filtering, geen call-recording) uit
// dashboard-vorm.acceptance.test.tsx.
//
// ── Testmethode voor print-zichtbaarheid (proxy, geen echte @media print) ──
// jsdom rendert geen CSS media queries — zie het precedent in
// afdrukken-trainingsplan.acceptance.test.tsx voor de volledige toelichting.
// hasPrintHiddenAncestor() loopt de parentElement-keten af en checkt de
// EXACTE string 'print:hidden'.
//
// ── Dubbele-tekst-valkuil (zie messages/nl.ts, poolLabel/poolLabelPrint) ──
// Het scherm-blok (spelersnamen als rijen) en het print-blok (spelersnamen
// als <li>) staan tegelijk in de DOM. We scopen daarom met `within()` op het
// print-blok i.p.v. losse `getByText` op document-niveau.
//
// ── Aanvullingen na validator-bevindingen (deze sessie) ──
//   1) Story-AC17-determinisme-test gebruikt nu de ECHTE, geïmporteerde
//      `sortSquadForExport` uit @/lib/match-squad — niet langer een lokale
//      kopie zonder keeper-voorrang.
//   2) Nieuw blok "AC7b" bewijst dat het print-blok GEEN print:hidden- en
//      GEEN surface-card/glass-card-voorouder heeft (was alleen impliciet
//      geverifieerd via AC7, dat de omgekeerde richting toetst).
//   3) Nieuw blok "Story-AC (foutafhandeling)" bewijst dat het print-blok na
//      een mislukte toggle de teruggerolde (daadwerkelijk opgeslagen)
//      selectie toont — de export is het feitelijke deliverable van deze
//      story, dus dit is niet volledig af te dekken door de bestaande
//      component-tests in MatchSquadEditor.test.tsx alleen.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { Player } from '@/lib/types'
import { FORMATIONS, POSITION_ABBREVIATIONS, POSITION_GROUPS } from '@/lib/types'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'
import { sortSquadForExport } from '@/lib/match-squad'

vi.mock('@/app/actions/match-squad', () => ({
  toggleSquadPlayer: vi.fn().mockResolvedValue(undefined),
}))

import { toggleSquadPlayer } from '@/app/actions/match-squad'
const mockToggle = toggleSquadPlayer as unknown as ReturnType<typeof vi.fn>

// ── Page-level mocks (aanvullend, alleen nodig voor de Story-AC-tests
// onderaan dit bestand): om Story-AC1 (event-detailpagina) en
// Story-AC2/3/10/11/12/14/20 (squadpagina, /events/<id>/squad) écht van
// buitenaf te bewijzen renderen we de ECHTE route-bestanden (async server
// components, gewone functies die JSX teruggeven). Zelfde precedent als
// renderPage() in afdrukken-trainingsplan.acceptance.test.tsx.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
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
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import MatchSquadPage from '@/app/events/[id]/squad/page'
import EventDetailPage from '@/app/events/[id]/page'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Print-proxy helper (zie kopcomment) ──
function hasPrintHiddenAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains('print:hidden')) return true
    node = node.parentElement
  }
  return false
}

// Generieke variant, gebruikt om te bewijzen dat het print-blok NIET onder
// een .surface-card/.glass-card hangt (validator-bevinding 2): die klassen
// zetten CSS-specificiteit die de print:-utilities anders zou kunnen
// overrulen. Loopt (net als hasPrintHiddenAncestor) ook het element zelf mee.
function hasAncestorWithClass(el: HTMLElement | null, className: string): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains(className)) return true
    node = node.parentElement
  }
  return false
}

// Vindt de "hidden print:block"-wrapper van MatchSquadPrintList: het enige
// element in de DOM met beide klassen.
function getPrintBlock(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.hidden.print\\:block')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
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

const mixedPlayers: Player[] = [
  makePlayer({ id: 'p1', name: 'Zeger Zeeman', position: 'Spits', jersey_number: 9 }),
  makePlayer({ id: 'p2', name: 'Wout Willems', position: 'Keeper', jersey_number: 1 }),
  makePlayer({ id: 'p3', name: 'Anna Appel', position: 'Keeper', jersey_number: 12 }),
  makePlayer({ id: 'p4', name: 'Bram Bakker', position: 'Centrale verdediger', jersey_number: 4, injured: true }),
]

function renderPrintList(overrides: Partial<Parameters<typeof MatchSquadPrintList>[0]> = {}, dict = nl) {
  return render(
    <DictProvider dict={dict}>
      <MatchSquadPrintList
        players={overrides.players ?? mixedPlayers}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
      />
    </DictProvider>,
  )
}

function renderEditor(overrides: Partial<Parameters<typeof MatchSquadEditor>[0]> = {}) {
  return render(
    <DictProvider dict={nl}>
      <MatchSquadEditor
        eventId="e1"
        players={overrides.players ?? mixedPlayers}
        initialSelectedIds={overrides.initialSelectedIds ?? []}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
      />
    </DictProvider>,
  )
}

// ═══════════════════════════════════════════════════════════════════════
// ── Page-level testinfrastructuur (uitsluitend voor de Story-AC-tests
//    onderaan dit bestand) ──
// ═══════════════════════════════════════════════════════════════════════

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

type Row = Record<string, unknown>

// Generieke Supabase-tabel-engine die de ECHTE .eq()/.order()/.limit()-
// method-chain van de productiecode toepast op een in-memory rijenset —
// zelfde precedent als dashboard-vorm.acceptance.test.tsx. Dit bewijst
// tenant-isolatie/faalpaden ECHT: vergeet de productiecode een
// team_id-filter, dan lekt een rij van een ander team ook hier door en faalt
// de test — in tegenstelling tot een mock die alleen registreert dát .eq()
// ooit is aangeroepen.
function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null
    function resolveRows(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number
            const bv = b[o.col] as string | number
            if (av < bv) return o.ascending ? -1 : 1
            if (av > bv) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      order: (col: string, opts: { ascending?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true })
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      insert: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: resolveRows() }),
    }
    return chain
  }
}

function matchEventRow(overrides: Row = {}): Row {
  return {
    id: 'e1',
    team_id: TEAM,
    type: 'match',
    date: '2026-08-09',
    time: null,
    location: 'Sportpark Zuid',
    match_type: 'league',
    opponent: 'FC Rivalen',
    home_away: 'home',
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function playerRow(overrides: Row = {}): Row {
  return {
    id: 'p1',
    team_id: TEAM,
    name: 'Piet Peters',
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

function makeSupabaseMock(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  squad?: Row[]
  attendance?: Row[]
  lineups?: Row[]
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const factories: Record<string, () => unknown> = {
    events: tableFactory(opts.events ?? []),
    players: tableFactory(opts.players ?? []),
    match_squad: tableFactory(opts.squad ?? []),
    attendance: tableFactory(opts.attendance ?? []),
    lineups: tableFactory(opts.lineups ?? []),
    metingen: tableFactory([]),
    training_oefeningen: tableFactory([]),
    match_ratings: tableFactory([]),
    match_events: tableFactory([]),
  }
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => (factories[t] ?? tableFactory([]))(),
  }
}

// Rendert de ECHTE /events/<id>/squad-route. Geeft ook `fromCalls` terug
// (welke tabellen daadwerkelijk bevraagd zijn) zodat Story-AC2/AC3 kunnen
// bewijzen dat de selectiepagina géén lineups/attendance-tabel raadpleegt.
async function renderSquadPage(opts: Parameters<typeof makeSupabaseMock>[0] & { id?: string } = {}) {
  const supa = makeSupabaseMock(opts)
  const fromCalls: string[] = []
  const wrapped = {
    ...supa,
    from: (t: string) => {
      fromCalls.push(t)
      return supa.from(t)
    },
  }
  vi.mocked(createClient).mockResolvedValue(wrapped as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = await MatchSquadPage({ params: Promise.resolve({ id: opts.id ?? 'e1' }) })
  const result = render(<DictProvider dict={nl}>{el}</DictProvider>)
  return { ...result, fromCalls }
}

// Rendert de ECHTE /events/<id>-route (event-detailpagina).
async function renderEventPage(opts: Parameters<typeof makeSupabaseMock>[0] & { id?: string } = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await EventDetailPage({ params: Promise.resolve({ id: opts.id ?? 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — print-blok toont exact de geselecteerde namen, keepers-eerst-dan-alfabetisch
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — print-blok toont exact de geselecteerde namen, keepers-eerst-dan-alfabetisch', () => {
  it('toont alle 4 spelers, keepers alfabetisch vooraan, dan veldspelers alfabetisch — géén tussenkop', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Anna Appel', 'Wout Willems', 'Bram Bakker', 'Zeger Zeeman'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — geen rugnummer/positie-afkorting/blessure-markering in het print-blok
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — geen rugnummer/positie-afkorting/blessure-markering in het print-blok', () => {
  it('geen van de rugnummers staat in de spelerslijst (de datumregel mag uiteraard wél cijfers bevatten)', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    const ul = block.querySelector('ul') as HTMLElement
    for (const li of within(ul).getAllByRole('listitem')) {
      expect(li.textContent).not.toMatch(/\d/)
    }
  })

  it('geen positie-afkorting (GK/CB/ST) staat in het print-blok', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    expect(within(block).queryByText('GK')).not.toBeInTheDocument()
    expect(within(block).queryByText('CB')).not.toBeInTheDocument()
    expect(within(block).queryByText('ST')).not.toBeInTheDocument()
  })

  it('geen blessure-markering voor de geblesseerde speler (p4, injured: true)', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    expect(within(block).queryByText(nl.players.injuredBadge)).not.toBeInTheDocument()
    // De naam zelf staat er wél, gewoon als platte tekst zonder markering.
    const line = within(block).getByText('Bram Bakker')
    expect(line.textContent).toBe('Bram Bakker')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — geen enkele FORMATIONS-sleutel of POSITION_ABBREVIATIONS-waarde in het print-blok
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — geen enkele FORMATIONS-sleutel of POSITION_ABBREVIATIONS-waarde in het print-blok', () => {
  it('geen enkele FORMATIONS-sleutel (bv. "4-3-3") komt voor in de tekst van het print-blok', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    for (const key of Object.keys(FORMATIONS)) {
      expect(block.textContent).not.toContain(key)
    }
  })

  it('geen enkele POSITION_ABBREVIATIONS-waarde (bv. "GK", "ST") komt voor als losse tekst in het print-blok', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem')
    for (const abbr of Object.values(POSITION_ABBREVIATIONS)) {
      for (const li of items) {
        expect(li.textContent).not.toBe(abbr)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — geen zichtbare groepering: precies één <ul>, geen <hr>, geen groepslabel
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — geen zichtbare groepering: precies één <ul>, geen <hr>, geen groepslabel', () => {
  it('bevat precies één <ul> en geen <hr>', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    expect(block.querySelectorAll('ul').length).toBe(1)
    expect(block.querySelectorAll('hr').length).toBe(0)
  })

  it('bevat geen enkel POSITION_GROUPS/t.players.groups-label (bv. "Keepers", "Aanvallers")', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    for (const group of POSITION_GROUPS) {
      expect(block.textContent).not.toContain(group.label)
      expect(block.textContent).not.toContain(nl.players.groups[group.label] ?? group.label)
    }
  })

  it('geen enkel <li> is leeg en er zit geen extra scheidend element tussen keepers en veldspelers', () => {
    const { container } = renderPrintList()
    const block = getPrintBlock(container)
    const ul = block.querySelector('ul') as HTMLElement
    // Alle directe children van de <ul> zijn <li>'s — geen tussenliggende
    // <div>/<hr>/lege regel die de keeper/veldspeler-grens zou markeren.
    expect(Array.from(ul.children).every((c) => c.tagName === 'LI')).toBe(true)
    for (const li of within(ul).getAllByRole('listitem')) {
      expect(li.textContent?.trim()).not.toBe('')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — wedstrijdkop: "vs <opponent>" + datum; opponent null → geen vs-regel, datum blijft
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — wedstrijdkop: "vs <opponent>" + datum; opponent null → geen vs-regel, datum blijft', () => {
  it('toont "vs FC Rivalen" en de datum', () => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen', dateLabel: 'zondag 9 augustus 2026' })
    const block = getPrintBlock(container)
    expect(within(block).getByText(`${nl.lineup.vsLabel} FC Rivalen`)).toBeInTheDocument()
    expect(within(block).getByText('zondag 9 augustus 2026')).toBeInTheDocument()
  })

  it('opponent: null → geen vs-regel, maar de datum blijft staan (geen "vs null"/"vs undefined")', () => {
    const { container } = renderPrintList({ opponent: null, dateLabel: 'zondag 9 augustus 2026' })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toMatch(/vs\s*(null|undefined)/i)
    expect(within(block).queryByText(new RegExp(`^${nl.lineup.vsLabel}\\b`))).not.toBeInTheDocument()
    expect(within(block).getByText('zondag 9 augustus 2026')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6 — wijziging van de selectie beweegt het print-blok direct mee (vóór revalidatie)
// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — wijziging van de selectie beweegt het print-blok direct mee (vóór revalidatie)', () => {
  it('een klik op de toggle voegt de speler direct toe aan het print-blok, zonder te wachten op de (gemockte) server action', () => {
    const { container } = renderEditor({ initialSelectedIds: [] })
    let block = getPrintBlock(container)
    expect(within(block).queryAllByRole('listitem')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Zeger Zeeman` }))

    block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toBe('Zeger Zeeman')
    // De server action is wel aangeroepen, maar de print-state hangt daar
    // niet vanaf — de mock lost pas asynchroon op ná deze assertie.
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', true)
  })

  it('een klik die een speler uit de selectie haalt, verwijdert die direct uit het print-blok', () => {
    const { container } = renderEditor({ initialSelectedIds: ['p1'] })
    let block = getPrintBlock(container)
    expect(within(block).getAllByRole('listitem')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Zeger Zeeman` }))

    block = getPrintBlock(container)
    expect(within(block).queryAllByRole('listitem')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 — exportknop en headerbalk dragen print:hidden
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — exportknop en headerbalk dragen print:hidden', () => {
  it('de exportknop (PrintButton) is print:hidden', () => {
    renderEditor({ initialSelectedIds: ['p1'] })
    const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(hasPrintHiddenAncestor(printButton)).toBe(true)
  })

  it('het volledige scherm-blok (teller + spelerslijst) is print:hidden', () => {
    renderEditor()
    const counter = screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))
    expect(hasPrintHiddenAncestor(counter)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7b (validator-bevinding 2, klein) — het print-blok zelf hangt NIET onder
// een print:hidden-voorouder en zit niet in een .surface-card/.glass-card.
// De brief eist dit expliciet: CSS-specificiteit van .surface-card/.glass-card
// zou anders de print:-utilities kunnen overrulen. AC7 hierboven bewijst
// alleen de omgekeerde richting (dat het SCHERM-blok wél print:hidden
// draagt) — dit blok bewijst de andere kant. Precedent:
// components/TrainingPlanEditor.test.tsx:284-293.
// ═══════════════════════════════════════════════════════════════════════
describe('AC7b — het print-blok hangt niet onder print:hidden en niet in een surface-card/glass-card', () => {
  it('het print-blok draagt zelf geen print:hidden en heeft ook geen print:hidden-voorouder (in tegenstelling tot het scherm-blok)', () => {
    const { container } = renderEditor({ initialSelectedIds: ['p1'] })
    const block = getPrintBlock(container)
    expect(hasPrintHiddenAncestor(block)).toBe(false)

    // Contrast, zelfde render: het scherm-blok draagt print:hidden wél.
    const counter = screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))
    expect(hasPrintHiddenAncestor(counter)).toBe(true)
  })

  it('het print-blok zit niet in een .surface-card- of .glass-card-voorouder', () => {
    const { container } = renderEditor({ initialSelectedIds: ['p1'] })
    const block = getPrintBlock(container)
    expect(hasAncestorWithClass(block, 'surface-card')).toBe(false)
    expect(hasAncestorWithClass(block, 'glass-card')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — lege selectie: exportknop disabled, print-blok bevat geen <li>
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — lege selectie: exportknop disabled, print-blok bevat geen <li>', () => {
  it('bij 0 geselecteerd is de exportknop disabled en het print-blok bevat geen <li>', () => {
    const { container } = renderEditor({ initialSelectedIds: [] })
    expect(screen.getByRole('button', { name: nl.trainingPlan.print })).toBeDisabled()
    const block = getPrintBlock(container)
    expect(within(block).queryAllByRole('listitem')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — subset-selecties: alleen keepers / geen keepers, geen lege regel of scheiding
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — subset-selecties: alleen keepers / geen keepers, geen lege regel of scheiding', () => {
  it('alleen keepers geselecteerd → print-blok toont uitsluitend de keepers, alfabetisch, geen scheiding', () => {
    const { container } = renderPrintList({
      players: mixedPlayers.filter((p) => p.position === 'Keeper'),
    })
    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Anna Appel', 'Wout Willems'])
    expect(block.querySelectorAll('hr').length).toBe(0)
  })

  it('geen keepers geselecteerd → print-blok toont uitsluitend veldspelers, alfabetisch', () => {
    const { container } = renderPrintList({
      players: mixedPlayers.filter((p) => p.position !== 'Keeper'),
    })
    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Bram Bakker', 'Zeger Zeeman'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — geselecteerde inactieve speler toont inactief-label; blessure print niet mee
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — geselecteerde inactieve speler toont inactief-label; blessure print niet mee', () => {
  it('een geselecteerde, inactieve speler blijft selecteerbaar op het scherm en toont het inactief-label', () => {
    const inactivePlayer = makePlayer({ id: 'p5', name: 'Oude Getrouwe', active: false })
    renderEditor({
      players: [...mixedPlayers, inactivePlayer],
      initialSelectedIds: ['p5'],
    })
    // Scope op de scherm-rij (naam + toggle): "Oude Getrouwe" staat ook los
    // in het print-blok (jsdom past geen @media print toe), dus niet op
    // document-niveau zoeken.
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Oude Getrouwe` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Oude Getrouwe')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
    // Nog steeds gewoon te de-selecteren (niet uitgeschakeld).
    expect(toggle).not.toBeDisabled()
  })

  it('een geblesseerde speler is gewoon selecteerbaar en krijgt geen blessure-markering op de afdruk', () => {
    const injured = mixedPlayers.find((p) => p.injured)!
    const { container } = renderEditor({ initialSelectedIds: [injured.id] })
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: ${injured.name}` })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).not.toBeDisabled()

    const block = getPrintBlock(container)
    expect(within(block).queryByText(nl.players.injuredBadge)).not.toBeInTheDocument()
    expect(within(block).getByText(injured.name).textContent).toBe(injured.name)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — i18n: t.lineup.vsLabel beschikbaar in alle vijf talen binnen het print-blok
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — i18n: t.lineup.vsLabel beschikbaar in alle vijf talen binnen het print-blok', () => {
  it.each([
    ['nl', nl],
    ['en', en],
    ['de', de],
    ['fr', fr],
    ['es', es],
  ])('taal "%s": de wedstrijdkop gebruikt t.lineup.vsLabel binnen het print-blok', (_locale, dict) => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen' }, dict)
    const block = getPrintBlock(container)
    expect(within(block).getByText(`${dict.lineup.vsLabel} FC Rivalen`)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Story-AC8 (aanvullend) — de kop bevat NOOIT thuis/uit, locatie of
// wedstrijdtype (de story eist expliciet "verder geen event-info")
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC8 (aanvullend) — geen thuis/uit-label, locatie of wedstrijdtype in het print-blok', () => {
  it('het print-blok bevat geen enkel thuis/uit-label en geen enkel wedstrijdtype-label', () => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen' })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toContain(nl.calendar.homeLabel)
    expect(block.textContent).not.toContain(nl.calendar.awayLabel)
    for (const label of Object.values(nl.event.matchTypes)) {
      expect(block.textContent).not.toContain(label)
    }
    // Structurele garantie: MatchSquadPrintList accepteert uitsluitend
    // {players, opponent, dateLabel} als props — home_away/location/match_type
    // worden niet eens doorgegeven, dus kunnen ook niet per ongeluk lekken.
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Story-AC9 (aanvullend) — selectie blijft ALTIJD bewerkbaar, ook na een
// (gesimuleerde) export — geen "bevriezen" van de selectie
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC9 (aanvullend) — geen bevriezing van de selectie na exporteren', () => {
  it('na een klik op de exportknop (window.print) blijven alle toggle-knoppen doodgewoon bruikbaar en verandert een nieuwe klik de selectie/print-blok opnieuw', () => {
    const printSpy = vi.fn()
    Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true })

    const { container } = renderEditor({ initialSelectedIds: ['p1'] })
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(printSpy).toHaveBeenCalledTimes(1)

    // Direct na "export": de toggle is nog gewoon te bedienen (geen freeze) —
    // een tweede speler (p2, nog niet geselecteerd) toevoegen werkt gewoon.
    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Wout Willems` })
    expect(toggle).not.toBeDisabled()
    fireEvent.click(toggle)

    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Wout Willems', 'Zeger Zeeman'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Story-AC (foutafhandeling, aanvullend na frontend-fix) — als het opslaan
// van een toggle mislukt, moet het print-blok de daadwerkelijk OPGESLAGEN
// (teruggerolde) selectie tonen — nooit de mislukte optimistische state.
// Dit is precies wat de trainer op papier zou meenemen naar het veld, dus
// dit hoort op acceptatieniveau bewezen te worden, niet uitsluitend op
// component-niveau: MatchSquadEditor.test.tsx (rollback + foutmelding-tests)
// bewijst alleen aria-pressed/teller/foutmelding, niet expliciet dat het
// print-blok zelf de teruggerolde staat toont. Omdat het print-blok wordt
// gevoed door dezelfde `selected`-state loopt dit gedrag in de praktijk mee,
// maar de export IS het feitelijke deliverable van deze story — dus toetsen
// we het hier rechtstreeks i.p.v. het als "impliciet bewezen" te beschouwen.
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC (foutafhandeling) — bij een mislukte toggle toont het print-blok weer de laatst opgeslagen selectie', () => {
  it('een mislukte toggle die een speler toevoegt: het print-blok laat de mislukte speler niet staan en toont weer alleen de laatst bevestigde selectie', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Netwerkfout'))
    const { container } = renderEditor({ initialSelectedIds: ['p1'] }) // p1 = Zeger Zeeman, al bevestigd

    let block = getPrintBlock(container)
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Zeger Zeeman'])

    // Klik op een NIET-geselecteerde speler (Wout Willems) — de server action
    // wordt gemockt om te falen.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Wout Willems` }))
    })

    block = getPrintBlock(container)
    // Wout Willems staat NIET in het print-blok: de rollback is ook in de
    // export doorgevoerd, niet enkel in de scherm-teller/aria-pressed.
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Zeger Zeeman'])
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()
  })

  it('een mislukte toggle die een al-geselecteerde speler probeert te verwijderen: die speler blijft in het print-blok staan', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Netwerkfout'))
    const { container } = renderEditor({ initialSelectedIds: ['p1'] }) // p1 = Zeger Zeeman, al bevestigd

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Zeger Zeeman` }))
    })

    const block = getPrintBlock(container)
    // Zeger Zeeman is NIET verdwenen uit de export: de mislukte verwijdering
    // is teruggerold naar de laatst opgeslagen (nog steeds geselecteerde) staat.
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Zeger Zeeman'])
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Story-AC15 — leeg team (geen actieve spelers): lege staat, exportactie
// niet bruikbaar (geen exportknop aanwezig, niet slechts disabled)
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC15 — leeg team: lege staat, exportactie niet bruikbaar', () => {
  it('toont de "voeg eerst spelers toe"-hint en bevat GEEN exportknop (het hele scherm-/exportblok ontbreekt, niet enkel disabled)', () => {
    renderEditor({ players: [], initialSelectedIds: [] })
    expect(screen.getByText(nl.matchSquad.emptyTeam)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.add })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Story-AC17 — identieke namen: deterministische, stabiele sortering
// ═══════════════════════════════════════════════════════════════════════
// BELANGRIJK — grens van deze acceptatietest: de PDF toont (terecht, zie
// Story-AC6) UITSLUITEND de naam. Bij drie spelers met exact dezelfde naam
// is de onderlinge id-volgorde daardoor van buitenaf (DOM/PDF) niet te
// onderscheiden — een trainer ziet drie identieke regels en kan niet zien of
// dat "p1,p2,p3" of een andere volgorde is. De ECHTE id-tiebreak-garantie is
// daarom alleen op het niveau van de pure functie te bewijzen (dat gebeurt al
// in lib/match-squad.test.ts:79-87, "valt bij identieke namen terug op het
// id"). Wat WEL van buitenaf te bewijzen is — en hier expliciet getest wordt
// — is dat identieke namen niet crashen, niet dedupliceren en niet leiden tot
// een ontbrekende/lege regel.
describe('Story-AC17 — identieke namen: geen crash, geen deduplicatie/lege regel (id-tiebreak zelf: zie lib/match-squad.test.ts)', () => {
  it('drie spelers met exact dezelfde naam leveren drie afzonderlijke, identieke <li>-regels op, geen lege/ontbrekende regel', () => {
    const dup: Player[] = [
      makePlayer({ id: 'p3', name: 'Jan Jansen', position: 'Spits' }),
      makePlayer({ id: 'p1', name: 'Jan Jansen', position: 'Linksbuiten' }),
      makePlayer({ id: 'p2', name: 'Jan Jansen', position: 'Rechtsachter' }),
    ]
    const { container } = renderPrintList({ players: dup })
    const block = getPrintBlock(container)
    const items = within(block).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    for (const li of items) expect(li.textContent).toBe('Jan Jansen')
  })

  it('herhaald renderen met dezelfde spelers geeft een identieke, deterministische uitkomst (geen willekeurige volgorde tussen runs)', () => {
    const dup: Player[] = [
      makePlayer({ id: 'p3', name: 'Jan Jansen', position: 'Spits' }),
      makePlayer({ id: 'p1', name: 'Jan Jansen', position: 'Linksbuiten' }),
      makePlayer({ id: 'p2', name: 'Jan Jansen', position: 'Rechtsachter' }),
    ]
    // ECHTE, productie-sorteerfunctie (dezelfde die MatchSquadPrintList.tsx
    // gebruikt) — geen lokale kopie meer. Zo faalt deze test ook echt als de
    // keeper-voorrang of de id-tiebreak in lib/match-squad.ts ooit breekt.
    const run1 = sortSquadForExport(dup, 'nl').map((p) => p.id)
    const run2 = sortSquadForExport(dup, 'nl').map((p) => p.id)
    expect(run1).toEqual(run2)
    expect(run1).toEqual(['p1', 'p2', 'p3'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ── Story-AC… — aanvullende paginaniveau-tests ──
// Deze tests renderen de ECHTE routes (geen los component met met-de-hand
// samengestelde props) en bewijzen daarmee criteria die het bestaande,
// component-niveau testblok hierboven niet kon dekken: de actiekaart op de
// event-detailpagina, onafhankelijkheid van attendance/lineups, de
// faalpaden (404/redirect) en tenant-isolatie via echte team-gescoped
// database-filtering.
// ═══════════════════════════════════════════════════════════════════════

// ── Story-AC1 ──
describe('Story-AC1 — event-detailpagina toont actiekaart "Wedstrijdselectie" vóór de opstelling-kaart (alleen voor wedstrijd-events)', () => {
  it('toont de actiekaart "Wedstrijdselectie" met link naar /events/e1/squad, vóór de opstelling-kaart, voor een wedstrijd-event', async () => {
    await renderEventPage({
      events: [matchEventRow()],
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'unknown' }],
    })

    const squadTitle = screen.getByText(nl.event.squad)
    const squadLink = squadTitle.closest('a')
    expect(squadLink).not.toBeNull()
    expect(squadLink).toHaveAttribute('href', '/events/e1/squad')

    const lineupTitle = screen.getByText(nl.event.lineup)
    const lineupLink = lineupTitle.closest('a')
    expect(lineupLink).not.toBeNull()
    expect(lineupLink).toHaveAttribute('href', '/events/e1/lineup')

    // "vóór": de squad-kaart komt in de DOM-volgorde eerder dan de lineup-kaart.
    expect(
      squadLink!.compareDocumentPosition(lineupLink!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('geen wedstrijdselectie-actiekaart op de detailpagina van een training-event', async () => {
    await renderEventPage({
      events: [matchEventRow({ type: 'training', opponent: null, match_type: null, home_away: null })],
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'unknown' }],
    })
    expect(screen.queryByText(nl.event.squad)).not.toBeInTheDocument()
  })
})

// ── Story-AC2 ──
describe('Story-AC2 — selectiepagina werkt ook zonder bestaande opstelling', () => {
  it('rendert de selectiepagina succesvol zonder dat er ooit een lineups-rij bevraagd wordt (geen afhankelijkheid van de opstelling)', async () => {
    const { fromCalls } = await renderSquadPage({
      events: [matchEventRow()],
      players: [playerRow()],
    })
    expect(screen.getByRole('heading', { name: nl.matchSquad.title })).toBeInTheDocument()
    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(fromCalls).not.toContain('lineups')
  })
})

// ── Story-AC3 ──
describe('Story-AC3 — selectie los van attendance én van lineups: aantal geselecteerden hoeft niet gelijk te zijn aan aantal aanwezigen', () => {
  it('toont het werkelijke aantal geselecteerden (1 van de 4 spelers), zonder de attendance-tabel te bevragen', async () => {
    const players = [
      playerRow({ id: 'p1', name: 'Piet Peters' }),
      playerRow({ id: 'p2', name: 'Jan Jansen' }),
      playerRow({ id: 'p3', name: 'Kees Klaassen' }),
      playerRow({ id: 'p4', name: 'Bram Bakker' }),
    ]
    const { fromCalls } = await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [{ id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM }],
    })
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))).toBeInTheDocument()
    expect(fromCalls).not.toContain('attendance')
    expect(fromCalls).not.toContain('lineups')
  })
})

// ── Story-AC10 ──
describe('Story-AC10 — event met type ≠ \'match\' → geen toegang bij directe URL (404)', () => {
  it('een training-event via directe URL naar /squad geeft notFound()', async () => {
    await expect(renderSquadPage({ events: [matchEventRow({ type: 'training' })] })).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('een meting-event via directe URL naar /squad geeft notFound()', async () => {
    await expect(renderSquadPage({ events: [matchEventRow({ type: 'meting' })] })).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })
})

// ── Story-AC11 ──
describe('Story-AC11 — event bestaat niet of behoort tot een ander team → "niet gevonden"', () => {
  it('een niet-bestaand event-id geeft notFound()', async () => {
    await expect(renderSquadPage({ events: [] })).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('een event van een ander team geeft notFound() (niet zichtbaar via directe URL)', async () => {
    await expect(
      renderSquadPage({ events: [matchEventRow({ team_id: OTHER_TEAM })] }),
    ).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })
})

// ── Story-AC12 ──
describe('Story-AC12 — niet-ingelogde gebruiker → redirect naar login', () => {
  it('redirect naar /login, vóór enige databasequery van de selectiepagina', async () => {
    await expect(
      renderSquadPage({ user: null, events: [matchEventRow()] }),
    ).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

// ── Story-AC14 ──
describe('Story-AC14 — tenant-isolatie: selectie van team A nooit zichtbaar/exporteerbaar voor team B, ook niet via directe URL-manipulatie', () => {
  it('team B kan de squad-pagina van een event van team A niet openen via directe URL-manipulatie (notFound, geen data-lek)', async () => {
    await expect(
      renderSquadPage({
        user: { id: OTHER_TEAM },
        events: [matchEventRow({ team_id: TEAM })],
        players: [playerRow({ team_id: TEAM })],
      }),
    ).rejects.toThrow('__notFound__')
  })

  it('een match_squad-rij van een ander team (zelfde event_id, corrupte/foutieve data) telt niet mee in de weergegeven selectie', async () => {
    // Als de productiequery `.eq('team_id', user.id)` op match_squad zou
    // vergeten, telt deze "ghost"-rij van OTHER_TEAM wél mee en toont de
    // teller 2 i.p.v. 1 — deze test faalt dan ook echt (real-filtering
    // tabel-engine, geen call-recording).
    await renderSquadPage({
      events: [matchEventRow()],
      players: [playerRow({ id: 'p1', name: 'Piet Peters' })],
      squad: [
        { id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM },
        { id: 's2', event_id: 'e1', player_id: 'ghost-other-team-player', team_id: OTHER_TEAM },
      ],
    })
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.selectedCount.replace('{n}', '2'))).not.toBeInTheDocument()
  })
})

// ── Story-AC20 (paginaniveau) ──
describe('Story-AC20 — spelers die tussentijds inactief worden gemaakt terwijl ze al in de selectie zitten, blijven zichtbaar (page.tsx-unie, geen stille verdwijning)', () => {
  it('een inactieve, al-geselecteerde speler blijft in de lijst staan mét inactief-label; een inactieve, NIET-geselecteerde speler wordt terecht wél weggelaten', async () => {
    const players = [
      playerRow({ id: 'p1', name: 'Oude Getrouwe', active: false }),
      playerRow({ id: 'p2', name: 'Jan Jansen', active: true }),
      playerRow({ id: 'p3', name: 'Weg Ermee', active: false }),
    ]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [{ id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM }],
    })

    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Oude Getrouwe` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Oude Getrouwe')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
    expect(toggle).not.toBeDisabled()

    // Niet-geselecteerde inactieve speler hoort niet in de (unie van actief +
    // al-geselecteerd) lijst te staan.
    expect(screen.queryByText('Weg Ermee')).not.toBeInTheDocument()
  })
})
