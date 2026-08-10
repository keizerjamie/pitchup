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
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

vi.mock('@/app/actions/events', () => ({
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
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

// Nieuwe print-props (teamName/teamLogoUrl/homeAway/gatherTime/kickoffTime/
// selectedCount/formItems) krijgen hier neutrale standaardwaarden die het
// bestaande, file-lokale gedrag van vóór deze ronde ongewijzigd laten (geen
// logo/team/tijden/vorm, selectedCount = aantal doorgegeven spelers) — de
// nieuwe presentatie-eisen zelf worden gedekt door
// wedstrijdselectie-pdf.acceptance.test.tsx.
function renderPrintList(overrides: Partial<Parameters<typeof MatchSquadPrintList>[0]> = {}, dict = nl) {
  const players = overrides.players ?? mixedPlayers
  return render(
    <DictProvider dict={dict}>
      <MatchSquadPrintList
        players={players}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
        teamName={'teamName' in overrides ? overrides.teamName ?? null : null}
        teamLogoUrl={'teamLogoUrl' in overrides ? overrides.teamLogoUrl ?? null : null}
        homeAway={'homeAway' in overrides ? overrides.homeAway ?? null : null}
        gatherTime={'gatherTime' in overrides ? overrides.gatherTime ?? null : null}
        kickoffTime={'kickoffTime' in overrides ? overrides.kickoffTime ?? null : null}
        selectedCount={overrides.selectedCount ?? players.length}
        formItems={overrides.formItems ?? []}
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
        presentPlayerIds={overrides.presentPlayerIds ?? []}
        hasAnyActivePlayers={overrides.hasAnyActivePlayers ?? true}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
        teamName={'teamName' in overrides ? overrides.teamName ?? null : null}
        teamLogoUrl={'teamLogoUrl' in overrides ? overrides.teamLogoUrl ?? null : null}
        homeAway={'homeAway' in overrides ? overrides.homeAway ?? null : null}
        kickoffTime={'kickoffTime' in overrides ? overrides.kickoffTime ?? null : null}
        initialGatherTime={'initialGatherTime' in overrides ? overrides.initialGatherTime ?? null : null}
        formItems={overrides.formItems ?? []}
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

// Generieke Supabase-tabel-engine die de ECHTE .eq()/.neq()/.lt()/.in()/
// .order()/.limit()-method-chain van de productiecode toepast op een
// in-memory rijenset — zelfde precedent als dashboard-vorm.acceptance.test
// .tsx. Dit bewijst tenant-isolatie/faalpaden ECHT: vergeet de productiecode
// een team_id-filter, dan lekt een rij van een ander team ook hier door en
// faalt de test — in tegenstelling tot een mock die alleen registreert dát
// .eq() ooit is aangeroepen. Uitgebreid (deze ronde) met .neq()/.lt()/.in()
// en `nullsFirst` in .order(), nodig voor de nieuwe vorm-query in
// app/events/[id]/squad/page.tsx (zie het API-contract, punt 1).
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
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
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
  // Nieuw (validator-bevinding, Gap 2): de squad-pagina bevraagt sinds deze
  // ronde ook `settings` (team_name/team_logo_url). Zonder deze factory zou
  // elke settings-query altijd een lege tabel treffen en kan een ontbrekend
  // team_id-filter in de productiecode nooit zichtbaar worden in een test.
  settings?: Row[]
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const factories: Record<string, () => unknown> = {
    events: tableFactory(opts.events ?? []),
    players: tableFactory(opts.players ?? []),
    match_squad: tableFactory(opts.squad ?? []),
    attendance: tableFactory(opts.attendance ?? []),
    lineups: tableFactory(opts.lineups ?? []),
    settings: tableFactory(opts.settings ?? []),
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
    // De datum komt sinds deze ronde TWEE keer voor (datumregel + de nieuwe
    // footer, zie MatchSquadPrintList.tsx) — bewust géén regressie, dus
    // getAllByText i.p.v. getByText.
    expect(within(block).getAllByText('zondag 9 augustus 2026').length).toBeGreaterThanOrEqual(1)
  })

  it('opponent: null → geen vs-regel, maar de datum blijft staan (geen "vs null"/"vs undefined")', () => {
    const { container } = renderPrintList({ opponent: null, dateLabel: 'zondag 9 augustus 2026' })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toMatch(/vs\s*(null|undefined)/i)
    expect(within(block).queryByText(new RegExp(`^${nl.lineup.vsLabel}\\b`))).not.toBeInTheDocument()
    // Zie comment hierboven: de datum staat sinds deze ronde ook in de footer.
    expect(within(block).getAllByText('zondag 9 augustus 2026').length).toBeGreaterThanOrEqual(1)
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
// Story-AC8 (aanvullend) — BEWUSTE WIJZIGING (geen regressie): de nieuwe,
// goedgekeurde technische brief voor het clublogo/gather-time-vervolg maakt
// thuis/uit-informatie verplichte nieuwe inhoud van de datumregel (zie
// MatchSquadPrintList.tsx). De oorspronkelijke assertie hieronder ("bevat
// GEEN thuis/uit-label") is daarmee achterhaald en is hier vervangen door het
// omgekeerde: het label IS aanwezig wanneer `homeAway` is meegegeven. De
// assertie op wedstrijdtype/`match_type` blijft ongewijzigd staan — dat blijft
// wél uitgesloten, MatchSquadPrintList accepteert nog steeds geen match_type-
// achtige prop.
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC8 (aanvullend) — thuis/uit-label IS aanwezig (bewuste wijziging); wedstrijdtype blijft uitgesloten', () => {
  it('het print-blok toont het thuis-label wanneer homeAway="home" is meegegeven', () => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen', homeAway: 'home' })
    const block = getPrintBlock(container)
    expect(block.textContent).toContain(nl.calendar.homeLabel)
  })

  it('het print-blok toont het uit-label wanneer homeAway="away" is meegegeven', () => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen', homeAway: 'away' })
    const block = getPrintBlock(container)
    expect(block.textContent).toContain(nl.calendar.awayLabel)
  })

  it('geen enkel wedstrijdtype-label (match_type) staat in het print-blok — MatchSquadPrintList accepteert die prop niet', () => {
    const { container } = renderPrintList({ opponent: 'FC Rivalen', homeAway: 'home' })
    const block = getPrintBlock(container)
    for (const label of Object.values(nl.event.matchTypes)) {
      expect(block.textContent).not.toContain(label)
    }
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
    renderEditor({ players: [], initialSelectedIds: [], hasAnyActivePlayers: false })
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
// LET OP (kleine, goedgekeurde aanpassing na deze story): de selecteerbare
// lijst is inmiddels gefilterd op `attendance.status === 'present'` (unie met
// al-geselecteerde spelers) — zie het nieuwe blok "Aanwezigheidsfilter"
// verderop. Deze test geeft p1 daarom expliciet een present-rij mee, anders
// zou hij (terecht) niet meer in de selecteerbare lijst staan.
describe('Story-AC2 — selectiepagina werkt ook zonder bestaande opstelling', () => {
  it('rendert de selectiepagina succesvol zonder dat er ooit een lineups-rij bevraagd wordt (geen afhankelijkheid van de opstelling)', async () => {
    const { fromCalls } = await renderSquadPage({
      events: [matchEventRow()],
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
    })
    expect(screen.getByRole('heading', { name: nl.matchSquad.title })).toBeInTheDocument()
    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(fromCalls).not.toContain('lineups')
  })
})

// ── Story-AC3 ──
// LET OP (kleine, goedgekeurde aanpassing na deze story): de selectiepagina
// bevraagt `attendance` inmiddels wél — uitsluitend om te bepalen welke
// spelers SELECTEERBAAR zijn (zichtbaarheidsfilter), niet om de selectie
// zelf te bepalen. `match_squad` blijft de enige bron voor de daadwerkelijke
// selectie/teller — dat is wat dit AC bewijst.
describe('Story-AC3 — selectie los van attendance én van lineups: aantal geselecteerden hoeft niet gelijk te zijn aan aantal aanwezigen', () => {
  it('toont het werkelijke aantal geselecteerden (1 van de 4 spelers), onafhankelijk van wie er als aanwezig geregistreerd staat', async () => {
    const players = [
      playerRow({ id: 'p1', name: 'Piet Peters' }),
      playerRow({ id: 'p2', name: 'Jan Jansen' }),
      playerRow({ id: 'p3', name: 'Kees Klaassen' }),
      playerRow({ id: 'p4', name: 'Bram Bakker' }),
    ]
    const { fromCalls } = await renderSquadPage({
      events: [matchEventRow()],
      players,
      // p1 is geselecteerd maar NIET aanwezig; p2 is wél aanwezig maar niet
      // geselecteerd — de teller volgt uitsluitend match_squad (1), niet
      // attendance.
      squad: [{ id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM }],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p2', team_id: TEAM, status: 'present' }],
    })
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))).toBeInTheDocument()
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
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p2', team_id: TEAM, status: 'present' }],
    })

    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Oude Getrouwe` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Oude Getrouwe')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
    expect(toggle).not.toBeDisabled()

    // Niet-geselecteerde inactieve speler hoort niet in de (unie van actief +
    // aanwezig + al-geselecteerd) lijst te staan.
    expect(screen.queryByText('Weg Ermee')).not.toBeInTheDocument()
  })
})

// ── Deel B — Story-AC5 (vervolgronde: clublogo/vorm-blok) ──
// Dit criterium ("huidige wedstrijd zelf verschijnt NOOIT in zijn eigen
// vorm-blok, ook al ligt hij in het verleden") hangt volledig af van de
// `.neq('id', id)`-clausule in de vorm-query van app/events/[id]/squad/page
// .tsx. wedstrijdselectie-pdf.acceptance.test.tsx dekt uitdrukkelijk alleen
// de PRESENTATIE van al doorgegeven formItems (zie de kopcomment daar) en
// lib/match-form.test.ts test alleen de zuivere rij→item-mapping — geen van
// beide bewijst dat de query het huidige event daadwerkelijk uitsluit. Deze
// test rendert daarom de ECHTE pagina met de generieke tabel-engine (met
// werkende .neq()), zelfde precedent als Story-AC14 hierboven.
describe('Deel B Story-AC5 — het huidige (afgeronde) event verschijnt nooit in zijn eigen vorm-blok', () => {
  it('een event dat zelf aan alle vorm-querycriteria voldoet (type match, datum in het verleden, eigen team) wordt tóch uitgesloten van zijn eigen vorm-blok', async () => {
    const events = [
      // Het huidige event: zelf ook een afgeronde wedstrijd in het verleden,
      // zou zonder de .neq('id', id)-uitsluiting gewoon aan de vorm-query
      // voldoen.
      matchEventRow({ id: 'e1', date: '2020-01-04', opponent: 'FC Rivalen', goals_for: 3, goals_against: 0 }),
      matchEventRow({ id: 'e2', date: '2020-01-01', opponent: 'FC Alpha', goals_for: 2, goals_against: 0 }),
      matchEventRow({ id: 'e3', date: '2020-01-02', opponent: 'FC Beta', goals_for: 2, goals_against: 0 }),
      matchEventRow({ id: 'e4', date: '2020-01-03', opponent: 'FC Gamma', goals_for: 2, goals_against: 0 }),
    ]
    const { container } = await renderSquadPage({
      events,
      players: [playerRow()],
      // Zonder een aanwezige/geselecteerde speler blijft de selecteerbare
      // lijst leeg en toont de pagina de lege staat (geen print-blok) —
      // irrelevant voor dít criterium, dus p1 krijgt gewoon een present-rij.
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      id: 'e1',
    })
    const block = getPrintBlock(container)
    // 4 afgeronde wedstrijden zijn beschikbaar (e1..e4), maar zonder e1 zelf
    // blijven er precies 3 over — zonder de .neq()-uitsluiting zou dit 4 zijn
    // (binnen de limit(5)).
    expect(within(block).getAllByText(nl.home.formLetterWin).length).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ── Validator-bevinding (deze sessie), Gap 2 — tenant-isolatie: settings
// (team_logo_url/team_name) en de vorm-query zelf ──
// app/events/[id]/squad/page.tsx voegt sinds deze ronde twee nieuwe,
// tenant-gescoped queries toe (settings + de vorm-query op `events`). Beide
// dragen in de productiecode al `.eq('team_id', user.id)`, maar dat werd tot
// nu toe nergens met een "ghost-rij van een ander team" bewezen — in
// tegenstelling tot match_squad/attendance hierboven (Story-AC14, "een
// attendance-rij van een ander team"). Deze twee tests vullen dat gat, met
// dezelfde ECHTE, filterende tabel-engine (geen call-recording).
// ═══════════════════════════════════════════════════════════════════════
describe('Validator-bevinding (Gap 2) — een settings-rij van een ander team lekt niet het clublogo/teamnaam', () => {
  it('een "ghost"-settings-rij van OTHER_TEAM voor dezelfde key (team_logo_url) beïnvloedt het eigen logo niet: geen <img> want het EIGEN team heeft geen eigen rij', async () => {
    const { container } = await renderSquadPage({
      events: [matchEventRow()],
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      // Uitsluitend rijen van OTHER_TEAM, geen enkele rij van TEAM zelf. Als
      // de productiequery `.eq('team_id', user.id)` op settings ooit zou
      // wegvallen, zou deze ghost-rij wél doorlekken en verschijnt er ten
      // onrechte een logo/teamnaam.
      settings: [
        { team_id: OTHER_TEAM, key: 'team_logo_url', value: 'https://cdn.example.com/ghost-logo.png' },
        { team_id: OTHER_TEAM, key: 'team_name', value: 'Spookteam' },
      ],
    })
    const block = getPrintBlock(container)
    // Scoped op de kop-container zelf (`.border-b-4`), niet op het hele
    // print-blok: er staat sinds deze ronde ook altijd een vast Pitchup-
    // app-logo (/logo.png) in de footer, los van een team-eigen
    // team_logo_url — dat is bewust en irrelevant voor deze ghost-rij-
    // garantie, die uitsluitend over het CLUBlogo in de kop gaat.
    const kop = block.querySelector('.border-b-4') as HTMLElement
    expect(kop).not.toBeNull()
    expect(kop.querySelector('img')).toBeNull()
    expect(block.textContent).not.toContain('Spookteam')
    expect(block.textContent).not.toContain('ghost-logo.png')
  })

  it('de EIGEN team_logo_url/team_name-rij wordt wél getoond, ook met een gelijktijdige ghost-rij van OTHER_TEAM voor dezelfde keys ernaast', async () => {
    const { container } = await renderSquadPage({
      events: [matchEventRow()],
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      settings: [
        { team_id: TEAM, key: 'team_logo_url', value: 'https://cdn.example.com/eigen-logo.png' },
        { team_id: TEAM, key: 'team_name', value: 'FC Eigen' },
        { team_id: OTHER_TEAM, key: 'team_logo_url', value: 'https://cdn.example.com/ghost-logo.png' },
        { team_id: OTHER_TEAM, key: 'team_name', value: 'Spookteam' },
      ],
    })
    const block = getPrintBlock(container)
    const img = block.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://cdn.example.com/eigen-logo.png')
    expect(block.textContent).toContain('FC Eigen')
    expect(block.textContent).not.toContain('Spookteam')
    expect(block.textContent).not.toContain('ghost-logo.png')
  })
})

describe('Validator-bevinding (Gap 2) — een afgeronde wedstrijd van een ander team lekt niet in het eigen vorm-blok', () => {
  it('een wedstrijd van OTHER_TEAM die verder aan alle vorm-querycriteria voldoet (type match, datum in het verleden, niet het huidige event) verschijnt niet in het eigen vorm-blok', async () => {
    // Dit is NIET dezelfde test als "Deel B Story-AC5" hierboven: die bewijst
    // dat het HUIDIGE event zichzelf niet in zijn eigen vorm-blok toont
    // (.neq('id', id)). Hier gaat het om een wedstrijd van een ANDER team,
    // die toevallig aan alle overige criteria voldoet — dat moet tegengehouden
    // worden door .eq('team_id', user.id), niet door .neq('id', id).
    const events = [
      matchEventRow({ id: 'e1', date: '2020-01-05', opponent: 'FC Rivalen', goals_for: 1, goals_against: 0 }),
      matchEventRow({
        id: 'ghost-match',
        team_id: OTHER_TEAM,
        date: '2020-01-04',
        opponent: 'FC Spook',
        goals_for: 5,
        goals_against: 0,
      }),
    ]
    const { container } = await renderSquadPage({
      events,
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      id: 'e1',
    })
    const block = getPrintBlock(container)
    // Zonder de ghost-wedstrijd (en met e1 zelf al uitgesloten) blijft het
    // vorm-blok leeg: 0 kaartjes, en de tegenstandernaam van de ghost-rij
    // komt nergens voor.
    expect(within(block).queryAllByText(nl.home.formLetterWin).length).toBe(0)
    expect(block.textContent).not.toContain('FC Spook')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ── Validator-bevinding (deze sessie), Gap 3 — de vorm-query op de
// squad-pagina heeft geen eigen contractbewaking en de bestaande
// Deel-B-Story-AC5-test gebruikt uitsluitend 2020-events, waardoor een
// wegvallende .lt('date', todayLocal())- of .limit(5)-clausule niet zou
// worden gevangen ──
// ═══════════════════════════════════════════════════════════════════════

// Broncontract — codeniveau, zelfde precedent als scripts/match-form
// .acceptance.test.mjs ("de vorm-query in app/page.tsx volgt het afgesproken
// contract"), maar dan voor de KOPIE van die query in
// app/events/[id]/squad/page.tsx (met de extra .neq('id', id) erbij en
// todayLocal() i.p.v. een losse `today`-variabele). Verdwijnt de vorm-query
// (of één van de verplichte clausules) ooit uit dit bestand, dan faalt deze
// test hard in plaats van stilzwijgend over te slaan.
describe('Validator-bevinding (Gap 3) — de vorm-query in app/events/[id]/squad/page.tsx volgt het afgesproken contract', () => {
  it('bevat tenant-isolatie, alleen wedstrijden, uitsluiting van het huidige event, de cutoff via todayLocal() en .limit(5)', () => {
    const pageSrc = readFileSync(
      path.join(__dirname, 'app', 'events', '[id]', 'squad', 'page.tsx'),
      'utf-8',
    )
    const flat = pageSrc.replace(/\s+/g, ' ')
    const chunks = flat.split("from('events')").slice(1)
    const queryChunk = chunks.find((c) => c.includes(".lt('date', todayLocal())"))
    expect(queryChunk, "vorm-query ontbreekt: geen events-query met .lt('date', todayLocal())").toBeTruthy()

    const end = queryChunk!.indexOf('.limit(5)')
    expect(end, 'vorm-query moet .limit(5) bevatten (nooit meer dan 5 resultaten)').toBeGreaterThanOrEqual(0)
    const query = queryChunk!.slice(0, end + '.limit(5)'.length)

    expect(query, "tenant-isolatie: .eq('team_id', user.id) verplicht").toContain(".eq('team_id', user.id)")
    expect(query, "alleen wedstrijden: .eq('type', 'match')").toContain(".eq('type', 'match')")
    expect(query, "het huidige event moet zichzelf uitsluiten: .neq('id', id)").toContain(".neq('id', id)")
    expect(query, "cutoff: strikt .lt('date', todayLocal())").toContain(".lt('date', todayLocal())")
    expect(query).toMatch(/\.order\('date', \{ ascending: false/)
    expect(query, 'tie-break op created_at aflopend met nullsFirst: false').toMatch(
      /\.order\('created_at', \{ ascending: false, nullsFirst: false \}\)/,
    )
    expect(query, 'laatste tie-break op id aflopend').toMatch(/\.order\('id', \{ ascending: false/)
  })
})

describe('Validator-bevinding (Gap 3) — een wedstrijd met een datum in de TOEKOMST verschijnt niet in het vorm-blok', () => {
  it('een toekomstige wedstrijd die verder aan alle criteria voldoet (eigen team, type match, niet het huidige event) wordt uitgesloten van het vorm-blok', async () => {
    const events = [
      matchEventRow({ id: 'e1', date: '2020-01-05', opponent: 'FC Rivalen', goals_for: 1, goals_against: 0 }),
      // Ver in de toekomst t.o.v. elke realistische testklok — voldoet aan
      // alle overige criteria (eigen team, type match, niet het huidige
      // event), maar hoort te worden uitgesloten via .lt('date', todayLocal()).
      matchEventRow({ id: 'future1', date: '2099-01-01', opponent: 'FC Toekomst', goals_for: 3, goals_against: 0 }),
    ]
    const { container } = await renderSquadPage({
      events,
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      id: 'e1',
    })
    const block = getPrintBlock(container)
    expect(within(block).queryAllByText(nl.home.formLetterWin).length).toBe(0)
    expect(block.textContent).not.toContain('FC Toekomst')
  })
})

describe('Validator-bevinding (Gap 3) — meer dan 5 afgeronde wedstrijden in het verleden → precies 5 kaartjes, en wel de 5 meest recente', () => {
  it('7 afgeronde wedstrijden leveren precies 5 kaartjes op: de 5 met de meest recente datum, niet de 2 oudste', async () => {
    const events = [
      matchEventRow({ id: 'e1', date: '2020-02-01', opponent: 'FC Rivalen', goals_for: 1, goals_against: 0 }),
      ...Array.from({ length: 7 }, (_, i) =>
        matchEventRow({
          id: `m${i + 1}`,
          date: `2020-01-0${i + 1}`,
          opponent: `FC M${i + 1}`,
          goals_for: 3,
          goals_against: 0,
        }),
      ),
    ]
    const { container } = await renderSquadPage({
      events,
      players: [playerRow()],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' }],
      id: 'e1',
    })
    const block = getPrintBlock(container)
    // Precies 5 kaartjes — nooit meer, ondanks 7 beschikbare wedstrijden.
    expect(within(block).getAllByText(nl.home.formLetterWin).length).toBe(5)
    // De 5 MEEST RECENTE (m3..m7, data 01-03 t/m 01-07) horen erbij...
    for (const opponent of ['FC M3', 'FC M4', 'FC M5', 'FC M6', 'FC M7']) {
      expect(block.textContent).toContain(opponent)
    }
    // ...de 2 OUDSTE (m1, m2) horen er terecht NIET bij.
    for (const opponent of ['FC M1', 'FC M2']) {
      expect(block.textContent).not.toContain(opponent)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ── Aanwezigheidsfilter (kleine, goedgekeurde aanpassing na deze story) ──
// De selecteerbare lijst = spelers met attendance.status === 'present' voor
// dit event, VERENIGD met spelers die al in match_squad zitten (ongeacht hun
// huidige aanwezigheidsstatus of active-veld). match_squad blijft ongewijzigd
// en synchroniseert niet met attendance — dit is uitsluitend een filter op
// wat zichtbaar/selecteerbaar is.
// ═══════════════════════════════════════════════════════════════════════
describe('Aanwezigheidsfilter — niet-aanwezige, niet-geselecteerde speler verschijnt niet in de lijst', () => {
  it('een actieve speler zonder present-attendance-rij en niet in match_squad wordt weggelaten uit de selecteerbare lijst', async () => {
    const players = [
      playerRow({ id: 'p1', name: 'Piet Peters' }),
      playerRow({ id: 'p2', name: 'Jan Afwezig' }),
    ]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      attendance: [
        { id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' },
        { id: 'a2', event_id: 'e1', player_id: 'p2', team_id: TEAM, status: 'absent' },
      ],
    })
    expect(screen.getByText('Piet Peters')).toBeInTheDocument()
    expect(screen.queryByText('Jan Afwezig')).not.toBeInTheDocument()
  })

  it('een actieve speler zonder enige attendance-rij voor dit event (geen record) wordt eveneens weggelaten', async () => {
    const players = [playerRow({ id: 'p1', name: 'Nog Niet Gereageerd' })]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      attendance: [],
    })
    expect(screen.queryByText('Nog Niet Gereageerd')).not.toBeInTheDocument()
    // Validator-bevinding 1: het team heeft wél een actieve speler, alleen is
    // niemand aanwezig gemeld — dat is de "meld eerst aanwezigheid"-lege
    // staat, niet de "voeg eerst spelers toe"-lege staat.
    expect(screen.getByText(nl.matchSquad.emptyNoAttendance)).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.emptyTeam)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.matchSquad.emptyNoAttendanceLink })).toHaveAttribute(
      'href',
      '/events/e1',
    )
  })

  it('een actieve speler met een EXPLICIETE attendance-rij status "unknown" (wél een record, geen "present") wordt eveneens weggelaten', async () => {
    const players = [playerRow({ id: 'p1', name: 'Status Onbekend' })]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'unknown' }],
    })
    expect(screen.queryByText('Status Onbekend')).not.toBeInTheDocument()
    // Zelfde onderscheid als hierboven: team heeft een actieve speler, alleen
    // niet als aanwezig gemeld.
    expect(screen.getByText(nl.matchSquad.emptyNoAttendance)).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.emptyTeam)).not.toBeInTheDocument()
  })
})

describe('Aanwezigheidsfilter — niet-aanwezige, maar wél-geselecteerde speler blijft zichtbaar en blijft in het print-blok staan', () => {
  it('een speler die in match_squad zit maar niet als aanwezig geregistreerd staat, blijft in de selecteerbare lijst met het niet-aanwezig-label en blijft in het printbare exportblok', async () => {
    const players = [playerRow({ id: 'p1', name: 'Al Geselecteerd', active: true })]
    const { container } = await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [{ id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM }],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'absent' }],
    })

    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Al Geselecteerd` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Al Geselecteerd')).toBeInTheDocument()
    expect(within(row).getByText(`(${nl.matchSquad.notPresentLabel})`)).toBeInTheDocument()
    expect(toggle).not.toBeDisabled()

    // De export (print-blok) bevat deze speler nog gewoon — geen stille
    // verdwijning uit de PDF omdat hij niet aanwezig is.
    const printBlock = getPrintBlock(container)
    expect(within(printBlock).getByText('Al Geselecteerd')).toBeInTheDocument()
  })

  it('een speler die zowel inactief ALS niet-aanwezig (expliciet "absent") is en al geselecteerd staat, blijft zichtbaar met UITSLUITEND het inactief-label (nooit beide labels tegelijk), en blijft in het print-blok', async () => {
    const players = [playerRow({ id: 'p1', name: 'Dubbel Geval', active: false })]
    const { container } = await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [{ id: 's1', event_id: 'e1', player_id: 'p1', team_id: TEAM }],
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'absent' }],
    })

    const toggle = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Dubbel Geval` })
    const row = toggle.parentElement as HTMLElement
    expect(within(row).getByText('Dubbel Geval')).toBeInTheDocument()
    // Inactief weegt zwaarder: uitsluitend dit label, nooit het
    // niet-aanwezig-label ernaast.
    expect(within(row).getByText(`(${nl.players.inactiveLabel})`)).toBeInTheDocument()
    expect(within(row).queryByText(`(${nl.matchSquad.notPresentLabel})`)).not.toBeInTheDocument()
    expect(toggle).not.toBeDisabled()

    const printBlock = getPrintBlock(container)
    expect(within(printBlock).getByText('Dubbel Geval')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Aanwezigheidsfilter — tenant-isolatie van de attendance-query (validator-
// bevinding, gat 1). Analoog aan de bestaande match_squad-ghost-rijtest
// (Story-AC14 hierboven): een attendance-rij van een ANDER team, voor
// hetzelfde event_id en status 'present', mag de zichtbaarheid van die
// speler in ons team niet beïnvloeden. page.tsx bevraagt attendance met
// `.eq('event_id', id).eq('team_id', user.id)` — valt die team_id-filter
// ooit weg, dan lekt deze ghost-rij door en wordt de speler ten onrechte
// zichtbaar. Dit is de ECHTE, filterende tabel-engine (geen call-recording),
// dus deze test faalt dan ook daadwerkelijk.
// ═══════════════════════════════════════════════════════════════════════
describe('Aanwezigheidsfilter — tenant-isolatie: een attendance-rij van een ander team telt niet mee', () => {
  it('een "ghost"-attendance-rij van een ander team (zelfde event_id, status "present") maakt een speler niet zichtbaar in de selecteerbare lijst', async () => {
    const players = [playerRow({ id: 'p1', name: 'Piet Peters', active: true })]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [],
      // Geen enkele attendance-rij voor ONS team (TEAM) — uitsluitend een
      // rij van OTHER_TEAM. Voor ons team is er dus (terecht) niemand
      // aanwezig gemeld.
      attendance: [{ id: 'a1', event_id: 'e1', player_id: 'p1', team_id: OTHER_TEAM, status: 'present' }],
    })
    expect(screen.queryByText('Piet Peters')).not.toBeInTheDocument()
    // Bevestigt dat dit de "meld eerst aanwezigheid"-lege staat is (team
    // heeft wél een actieve speler), niet de "voeg eerst spelers toe"-staat —
    // zo sluiten we uit dat de speler om een andere reden ontbreekt.
    expect(screen.getByText(nl.matchSquad.emptyNoAttendance)).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.emptyTeam)).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Aanwezigheidsfilter — de `p.active &&`-clausule zelf (validator-bevinding,
// gat 2). Filter in page.tsx:
//   players.filter(p => selectedIds.has(p.id) || (p.active && presentIds.has(p.id)))
// Een speler die INACTIEF is, WÉL als aanwezig geregistreerd staat
// (status 'present'), en NIET al in match_squad zit, hoort te worden
// uitgesloten — de `p.active &&`-kortsluiting moet dat afdwingen. Niet te
// verwarren met Story-AC20/de "Dubbel Geval"-test hierboven, waar dezelfde
// combinatie (inactief + niet-aanwezig) WEL zichtbaar blijft omdat de speler
// daar al-geselecteerd is.
// ═══════════════════════════════════════════════════════════════════════
describe('Aanwezigheidsfilter — inactieve, wél-aanwezige maar NIET-geselecteerde speler blijft uitgesloten', () => {
  it('een inactieve speler met een present-attendance-rij, die niet al in match_squad zit, verschijnt niet in de selecteerbare lijst', async () => {
    const players = [
      playerRow({ id: 'p1', name: 'Inactief Maar Aanwezig', active: false }),
      playerRow({ id: 'p2', name: 'Actief En Aanwezig', active: true }),
    ]
    await renderSquadPage({
      events: [matchEventRow()],
      players,
      squad: [],
      attendance: [
        { id: 'a1', event_id: 'e1', player_id: 'p1', team_id: TEAM, status: 'present' },
        { id: 'a2', event_id: 'e1', player_id: 'p2', team_id: TEAM, status: 'present' },
      ],
    })
    // p2 (actief + aanwezig, niet-geselecteerd) hoort gewoon te verschijnen —
    // dit bewijst dat het uitsluiten van p1 niet toevallig komt doordat de
    // hele lijst leeg is (bijv. door een verkeerde lege-staat-branch).
    expect(screen.getByText('Actief En Aanwezig')).toBeInTheDocument()
    // p1 is inactief: ondanks een present-attendance-rij en zonder
    // al-geselecteerd te zijn, hoort hij uitgesloten te blijven.
    expect(screen.queryByText('Inactief Maar Aanwezig')).not.toBeInTheDocument()
  })
})
