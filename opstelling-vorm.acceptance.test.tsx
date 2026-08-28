// Acceptatietests — Vormgewogen spelersaanbeveling in de opstellingsbouwer
// (user story: als coach wil ik dat de spelersaanbeveling in de
// opstellingsbouwer — zowel de ranking in de spelerspopup als "automatisch
// opstellen" — rekening houdt met de recente vorm van een speler naast mijn
// handmatige beoordeling).
//
// ── AC → test-mapping ──
//   AC1        → NIET hier gedekt, zie toelichting in het dekkingsrapport
//                (al volledig op unit-niveau gedekt door lib/lineup-form.test.ts,
//                zie "describe('blendPlayerForm — succes')" en
//                "describe('buildPlayerForms — venster en volgorde')").
//   AC2        → describe('AC2 — subregel-formaat "positie · cijfer pijl (aantal)"')
//   AC3        → describe('AC3 — geblende score wint de aanbeveling, ook bij een lagere players.rating')
//   AC4        → describe('AC4 — automatisch opstellen gebruikt dezelfde geblende score als de popup')
//   AC5-AC9    → NIET hier gedekt (al volledig unit-getest in lib/lineup-form.test.ts),
//                zie het dekkingsrapport voor de expliciete controle per sub-AC.
//   AC10       → describe('AC10 — X=0: "(0)" zonder trendpijl')
//   AC11       → describe('AC11 — 0 < X < 5: het werkelijke aantal, geen padding')
//   AC12       → describe('AC12 — regressie: inactieve speler verschijnt nergens')
//   AC13       → describe('AC13 — ontbrekende/ongeldige match_ratings-waarde crasht niet')
//   AC14       → describe('AC14 — tenant-isolatie: een ander team levert nooit vorm-data')
//   Peildatum  → describe('Peildatum — events.date van het op te stellen event, geen klok')
//   Horizon    → describe('Horizon — FORM_MATCH_HORIZON (25) wordt als limit doorgegeven')
//   Trendpijl  → describe('Trendpijl — up/flat/down/none end-to-end door de echte pagina')
//   Gasten     → describe('Gasten — players.type = "guest" doet mee in de vormberekening')
//   Wedstrijdtypes → describe('Alle wedstrijdtypes tellen mee (friendly/league/cup)')
//   "Geen cijfer" → describe('"Geen cijfer": geen players.rating én count 0')
//   Faalpad    → describe('Faalpad — database-fouten in het vormvenster (stap 4 van de datastroom)')
//   Guards     → describe('Guards — login-redirect en notFound blijven werken')
//
// ── Aanvullingen na validatierondes ──
// Onderstaande punten zijn toegevoegd n.a.v. eerdere validatierapporten.
// Bewust GEEN nummerverwijzing naar een validatierapport: dat rapport
// hernummert bij elke ronde (een eerdere versie van dit bestand verwees naar
// "Bevinding 4", wat in een latere rapportronde ineens bevinding 6 bleek —
// verwarrend voor wie terugzoekt). In plaats daarvan: één label per
// onderwerp, herkenbaar aan het bijbehorende describe-blok hierboven.
//   • Faalpad-dekking (was ongedekt): het faalpad van de vorm-venster-query
//     op 'events' én van de match_ratings-query stond nergens getest — de
//     mock gaf altijd { error: null } terug. Nieuw blok "Faalpad" bewijst nu:
//     de pagina rendert door, iedereen valt terug op X=0 (het anker), er komt
//     geen ruwe PostgREST-foutmelding in beeld, en console.error (de echte
//     sink achter logError, lib/errors.ts:27-30) logt nooit de ruwe
//     boodschap — alleen het eigen contextlabel.
//   • AC14 — team_id-filter apart bewezen: de oorspronkelijke AC14-test gaf
//     alle vreemde rating-rijen ook een vreemd event_id, waardoor alleen
//     .in('event_id', …) werd bewezen en niet .eq('team_id', user.id) op
//     match_ratings zelf. Toegevoegd: een tweede AC14-test met een vreemde
//     rating-rij op een EIGEN event_id, zonder een eigen concurrerende rij
//     voor diezelfde wedstrijd — die kan dus alléén worden buitengesloten via
//     het team_id-filter.
//   • Horizon-afdwinging functioneel bewezen: de oorspronkelijke Horizon-test
//     bewees alleen het doorgegeven .limit()-argument. Toegevoegd: een test
//     met 30 wedstrijden waarvan alleen de 5 OUDSTE (buiten de 25 meest
//     recente) beoordeeld zijn — als de limit niet écht werd afgedwongen zou
//     de popup die beoordelingen alsnog tonen.
//   • AC3 — ★-toewijzing hard gemaakt: de oorspronkelijke assertie
//     vergeleek alleen DOM-volgorde. Toegevoegd: een directe check dat de
//     ★-geaccentueerde rij (de onmiddellijke DOM-sibling van het
//     "★ Aanbevolen"-label) daadwerkelijk de speler met de hoogste geblende
//     kwaliteit toont.
//   • Guards-dekking (was ongedekt): de guard-mocks (notFound/redirect)
//     stonden al klaar maar werden door geen enkele test aangesproken. Nieuw
//     blok "Guards" dekt beide paden.
// ── Testmethode ──
// Dit bestand rendert de ECHTE server-pagina app/events/[id]/lineup/page.tsx
// (een async server component — gewoon een functie die JSX teruggeeft),
// met uitsluitend @/lib/supabase/server, next/navigation en next/headers
// gestubd — zelfde precedent als dashboard-vorm.acceptance.test.tsx:31-55 en
// de paginaniveau-tests in wedstrijdselectie.acceptance.test.tsx (renderPage()
// met een generieke tabel-engine). De Supabase-mock hieronder is GEEN
// call-recorder: het is een tabel-engine die de ECHTE method-chain-aanroepen
// (.eq/.lt/.in/.order/.limit) van de pagina toepast op een gedeelde
// in-memory rijenset. Als de productiequery een filter, sorteer- of
// limit-stap zou missen, faalt deze test net zo hard als tegen een echte
// Postgres-database — met name voor AC14 (tenant-isolatie) en Horizon
// (de doorgegeven .limit()-waarde) is dat essentieel.
//
// De popup opent pas na een klik op een positie-slot — het blok met de
// JSX-comment `{/* Player markers */}` in components/LineupBuilder.tsx
// (bewust een naam-verwijzing, geen regelnummer: dat blok is al twee keer
// verschoven sinds de vorige validatieronde; de JSX-comment zelf verschuift
// niet mee met omringende wijzigingen). We gebruiken steeds de CM-slot in
// het standaard 4-3-3 (position_label 'CM', x=50/y=48), exact zoals
// components/LineupBuilder.test.tsx dat al doet — die tekst is uniek binnen
// die formatie zolang de slot nog onbezet is.
//
// getDict() (lib/i18n.ts) is gewrapt in React's cache() — binnen één
// testbestand blijft de locale daardoor op de EERST aangeroepen locale
// hangen. De cookies-mock geeft nooit een locale-cookie terug, dus dat is
// altijd 'nl' — precies wat we nodig hebben voor de komma-notatie ("7,6",
// niet "7.6").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { FORM_MATCH_HORIZON } from '@/lib/lineup-form'

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
import { notFound, redirect } from 'next/navigation'
import LineupPage from '@/app/events/[id]/lineup/page'

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // Stil gehouden (mockImplementation) zodat de testoutput niet vervuilt,
  // maar wél opgevraagd kan worden — nodig voor het Faalpad-blok, dat moet
  // bewijzen dat er NOOIT een ruwe PostgREST-foutmelding in de logs belandt.
  // logError zelf (lib/errors.ts:27-30) is hier NIET gemockt: dit is de
  // echte productiefunctie, console.error is de enige sink die we
  // onderscheppen.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

function loggedErrors(): string {
  return consoleErrorSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'
const EVENT_ID = 'e1'
const EVENT_DATE = '2026-08-10'

type Row = Record<string, unknown>

// ── Generieke Supabase-tabel-engine (zie kopcomment) ──
// `opts.error`: laat élke read op deze tabel { data: null, error } teruggeven
// — zoals een echte Supabase/PostgREST-fout. Nodig voor het Faalpad-blok
// hieronder; voor tabellen zonder fout blijft dit ongebruikt en gedraagt de
// engine zich exact als voorheen.
function tableFactory(rows: Row[], opts: { error?: unknown } = {}) {
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
      maybeSingle: () =>
        Promise.resolve({ data: opts.error ? null : resolveRows()[0] ?? null, error: opts.error ?? null }),
      single: () =>
        Promise.resolve({ data: opts.error ? null : resolveRows()[0] ?? null, error: opts.error ?? null }),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve({ data: opts.error ? null : resolveRows(), error: opts.error ?? null }),
    }
    return chain
  }
}

// Zelfde tabel-engine, maar geeft ALLEEN een fout terug voor de specifieke
// vorm-venster-query (herkenbaar aan .eq('type','match') gecombineerd met
// .lt('date', …), de enige combinatie die de pagina op 'events' gebruikt met
// allebei die filters) — de hoofdquery (.eq('id', …).single()) op dezelfde
// tabel blijft gewoon werken. Zelfde precedent als
// dashboard-vorm.acceptance.test.tsx (tableFactoryVormError).
function tableFactoryVormError(rows: Row[], rawError: unknown) {
  const base = tableFactory(rows)
  return () => {
    const chain = base() as Record<string, unknown>
    let sawTypeMatch = false
    let sawDateLt = false
    const origEq = chain.eq as (col: string, val: unknown) => unknown
    const origLt = chain.lt as (col: string, val: unknown) => unknown
    const origThen = chain.then as (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) => unknown
    chain.eq = (col: string, val: unknown) => {
      if (col === 'type' && val === 'match') sawTypeMatch = true
      return origEq(col, val)
    }
    chain.lt = (col: string, val: unknown) => {
      sawDateLt = true
      return origLt(col, val)
    }
    chain.then = (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) => {
      if (sawTypeMatch && sawDateLt) return resolve({ data: null, error: rawError })
      return origThen(resolve)
    }
    return chain
  }
}

// Zelfde tabel-engine, maar registreert het doorgegeven .limit()-argument
// zodra de specifieke vorm-venster-query herkend wordt (de enige combinatie
// die app/events/[id]/lineup/page.tsx op 'events' gebruikt met zowel
// .eq('type','match') als .lt('date', …)) — nodig om Horizon van buitenaf te
// bewijzen (de doorgegeven limit, niet een aanname over de implementatie).
function tableFactoryCaptureHorizonLimit(rows: Row[], onLimit: (n: number) => void) {
  const base = tableFactory(rows)
  return () => {
    const chain = base() as Record<string, unknown>
    let sawTypeMatch = false
    let sawDateLt = false
    const origEq = chain.eq as (col: string, val: unknown) => unknown
    const origLt = chain.lt as (col: string, val: unknown) => unknown
    const origLimit = chain.limit as (n: number) => unknown
    chain.eq = (col: string, val: unknown) => {
      if (col === 'type' && val === 'match') sawTypeMatch = true
      return origEq(col, val)
    }
    chain.lt = (col: string, val: unknown) => {
      sawDateLt = true
      return origLt(col, val)
    }
    chain.limit = (n: number) => {
      if (sawTypeMatch && sawDateLt) onLimit(n)
      return origLimit(n)
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

// Wedstrijd in het vormvenster (een eerdere match van hetzelfde of een ander
// team_id — beide via `teamId` te sturen voor AC14).
function vormMatchRow(overrides: Row = {}): Row {
  return {
    id: 'vm',
    team_id: TEAM,
    type: 'match',
    date: '2026-08-01',
    time: null,
    location: null,
    match_type: 'league',
    opponent: 'Eerdere tegenstander',
    home_away: 'home',
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-07-01T10:00:00Z',
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
    jersey_number: 8,
    active: true,
    injured: false,
    type: 'regular',
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function ratingRow(overrides: Row = {}): Row {
  return {
    event_id: 'vm',
    player_id: 'p1',
    rating: 7,
    team_id: TEAM,
    ...overrides,
  }
}

function attendanceRow(overrides: Row = {}): Row {
  return {
    event_id: EVENT_ID,
    team_id: TEAM,
    player_id: 'p1',
    status: 'present',
    ...overrides,
  }
}

function makeSupabaseMock(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  attendance?: Row[]
  lineups?: Row[]
  ratings?: Row[]
  // Wedstrijdselectie en clubkleuren: de pagina bevraagt deze twee tabellen
  // sinds de bank/poppetjes-wijziging. Standaard leeg = geen selectie gekozen
  // en geen clubkleur ingesteld, precies de uitgangssituatie van de tests
  // hieronder (bank = de aanwezige spelers, poppetjes wit).
  matchSquad?: Row[]
  settings?: Row[]
  onVormLimit?: (n: number) => void
  // Faalpad-dekking: laat de vorm-venster-query resp. de match_ratings-query
  // op een echte DB-fout stuiten ({ data: null, error }), zonder de rest van
  // de pagina te raken.
  vormEventsError?: unknown
  ratingsError?: unknown
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const eventsFactory = opts.onVormLimit
    ? tableFactoryCaptureHorizonLimit(opts.events ?? [], opts.onVormLimit)
    : opts.vormEventsError
      ? tableFactoryVormError(opts.events ?? [], opts.vormEventsError)
      : tableFactory(opts.events ?? [])
  const playersFactory = tableFactory(opts.players ?? [])
  const attendanceFactory = tableFactory(opts.attendance ?? [])
  const lineupsFactory = tableFactory(opts.lineups ?? [])
  const ratingsFactory = tableFactory(opts.ratings ?? [], { error: opts.ratingsError })
  const matchSquadFactory = tableFactory(opts.matchSquad ?? [])
  const settingsFactory = tableFactory(opts.settings ?? [])
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === 'events') return eventsFactory()
      if (table === 'players') return playersFactory()
      if (table === 'attendance') return attendanceFactory()
      if (table === 'lineups') return lineupsFactory()
      if (table === 'match_ratings') return ratingsFactory()
      if (table === 'match_squad') return matchSquadFactory()
      if (table === 'settings') return settingsFactory()
      throw new Error(`Onverwachte tabel in test: ${table}`)
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

// Opent de (enige) onbezette CM-slot in het standaard 4-3-3.
function openCmSlot() {
  fireEvent.click(screen.getByText('CM'))
}

// Bouwt N matches + bijbehorende beoordelingen vóór EVENT_DATE, recent-eerst
// (ratings[0] = de meest recente wedstrijd, meteen vóór de peildatum).
// team_id is instelbaar zodat AC14 dezelfde helper kan hergebruiken voor het
// team van een ander team.
function vormReeks(playerId: string, ratings: (number | null | string)[], teamId = TEAM) {
  const matches: Row[] = []
  const ratingRows: Row[] = []
  ratings.forEach((rating, i) => {
    const dag = 9 - i // 2026-08-09, -08, -07, ... allemaal vóór EVENT_DATE (2026-08-10)
    const id = `vm-${i + 1}`
    matches.push(
      vormMatchRow({ id, team_id: teamId, date: `2026-08-${String(dag).padStart(2, '0')}` }),
    )
    if (rating !== null) {
      ratingRows.push(ratingRow({ event_id: id, player_id: playerId, rating, team_id: teamId }))
    }
  })
  return { matches, ratings: ratingRows }
}

// Echte (rollover-veilige) datumrekenkunde, nodig voor de Horizon-test met
// 30 wedstrijden — de simpele 'dag - i'-truc van vormReeks() loopt bij i > 9
// uit de maand. Zelfde patroon als addDaysFixed() in dashboard-vorm
// .acceptance.test.tsx.
function addDaysFixed(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════════════
// AC2 — subregel-formaat "positie · cijfer pijl (aantal)"
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — subregel-formaat "positie · cijfer pijl (aantal)"', () => {
  it('een speler met 5 beoordeelde wedstrijden toont de letterlijke subregel "CM · 7,6 ↑ (5)" (anker 7, ratings [9,9,6,6,6] → quality 7,56, trend up)', async () => {
    const { matches, ratings } = vormReeks('p1', [9, 9, 6, 6, 6])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    expect(screen.getByText('CM · 7,6 ↑ (5)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — geblende score wint de aanbeveling, ook bij een lagere players.rating
// (dit is de test die de hele story koopt)
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — geblende score wint de aanbeveling, ook bij een lagere players.rating', () => {
  it('speler met de HOOGSTE players.rating (6) maar géén recente vorm verliest de ★-aanbeveling van een speler met een LAGERE rating (3) maar uitstekende recente vorm', async () => {
    // p1: rating 6, geen enkele beoordeelde wedstrijd → quality blijft exact 6 (het anker).
    // p2: rating 3, maar 5x een 10 beoordeeld → quality ≈ 7,9 (0,3·3 + 0,7·10), ruim hoger dan p1.
    // Beide spelen 'Centrale middenvelder' → identieke positie-fit (1.0) voor de CM-slot,
    // dus de ranking wordt uitsluitend door de geblende kwaliteit bepaald.
    const { matches, ratings } = vormReeks('p2', [10, 10, 10, 10, 10])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [
        playerRow({ id: 'p1', name: 'Hoge Rating', rating: 6 }),
        playerRow({ id: 'p2', name: 'Beste Vorm', rating: 3 }),
      ],
      attendance: [attendanceRow({ player_id: 'p1' }), attendanceRow({ player_id: 'p2' })],
      ratings,
    })
    openCmSlot()
    const label = screen.getByText('★ Aanbevolen')
    expect(label).toBeInTheDocument()
    // Een DOM-volgorde-check alleen bewijst niet dat de ★-geaccentueerde rij
    // ZELF de juiste speler toont — alleen dat hij ergens vóór de rest staat.
    // De ★-rij zit in components/LineupBuilder.tsx in het blok met de
    // JSX-comment `{/* Recommended */}` (een naam-verwijzing, geen regelnummer
    // — zie de toelichting bovenaan dit bestand) als de onmiddellijke
    // DOM-sibling van het "★ Aanbevolen"-label (beide rechtstreeks kinderen
    // van dezelfde <> </>-fragment), dus we pakken die rij rechtstreeks en
    // controleren de speler daarbinnen.
    const accentRow = label.nextElementSibling as HTMLElement
    expect(accentRow).not.toBeNull()
    expect(within(accentRow).getByText('Beste', { exact: false })).toBeInTheDocument()
    expect(within(accentRow).queryByText('Hoge', { exact: false })).toBeNull()
    // Aanvullend (behouden): de aanbevolen speler staat ook vóór de rest van
    // de lijst in de DOM-volgorde van de popup.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    const besteIdx = buttons.findIndex((t) => t.includes('Beste'))
    const hogeIdx = buttons.findIndex((t) => t.includes('Hoge'))
    expect(besteIdx).toBeGreaterThanOrEqual(0)
    expect(hogeIdx).toBeGreaterThanOrEqual(0)
    expect(besteIdx).toBeLessThan(hogeIdx)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — automatisch opstellen gebruikt dezelfde geblende score als de popup
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — automatisch opstellen gebruikt dezelfde geblende score als de popup', () => {
  it('"Automatisch opstellen" zet de speler met de hoogste geblende kwaliteit (niet de hoogste players.rating) op de CM-slot', async () => {
    // Zelfde fixture als AC3: p1 rating 6 (X=0), p2 rating 3 maar quality ≈ 7,9 (X=5).
    const { matches, ratings } = vormReeks('p2', [10, 10, 10, 10, 10])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [
        playerRow({ id: 'p1', name: 'Hoge Rating', rating: 6 }),
        playerRow({ id: 'p2', name: 'Beste Vorm', rating: 3 }),
      ],
      attendance: [attendanceRow({ player_id: 'p1' }), attendanceRow({ player_id: 'p2' })],
      ratings,
    })
    // Vind de CM-slot-knop VÓÓR het auto-opstellen (de tekst 'CM' bestaat dan
    // nog, de knop is nog onbezet) en bewaar de referentie — React behoudt
    // dezelfde DOM-node bij een update van dezelfde lijst-key.
    const cmButton = screen.getByText('CM').closest('button')!
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    expect(within(cmButton).getByText('Beste')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — X=0: "(0)" zonder trendpijl
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — X=0: "(0)" zonder trendpijl', () => {
  it('een speler zonder enige beoordeelde wedstrijd toont "(0)" en geen enkel pijlteken (↑ → ↓)', async () => {
    await renderLineupPage({
      events: [eventRow()],
      players: [playerRow({ id: 'p1', rating: 6 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [],
    })
    openCmSlot()
    const row = screen.getByText('CM · 6,0 (0)')
    expect(row).toBeInTheDocument()
    expect(row.textContent).not.toMatch(/[↑↓→]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — 0 < X < 5: het werkelijke aantal, geen padding
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — 0 < X < 5: het werkelijke aantal, geen padding', () => {
  it('X=3 toont "(3)" (anker 8, ratings [8,8,8] → quality 8,0, trend flat)', async () => {
    const { matches, ratings } = vormReeks('p1', [8, 8, 8])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 8 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    expect(screen.getByText('CM · 8,0 → (3)')).toBeInTheDocument()
  })

  it('X=2 toont "(2)" en géén trendpijl (X < 3), ook al verschillen de cijfers (anker 5, ratings [9,9] → quality 6,1)', async () => {
    const { matches, ratings } = vormReeks('p1', [9, 9])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 5 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    const row = screen.getByText('CM · 6,1 (2)')
    expect(row).toBeInTheDocument()
    expect(row.textContent).not.toMatch(/[↑↓→]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC12 — regressie: inactieve speler verschijnt nergens in de opstellingsbouwer
// ═══════════════════════════════════════════════════════════════════════
describe('AC12 — regressie: inactieve speler verschijnt nergens', () => {
  it('een speler met players.active = false komt niet voor in de popup, de bank of het spelersoverzicht', async () => {
    await renderLineupPage({
      events: [eventRow()],
      players: [
        playerRow({ id: 'p1', name: 'Actieve Speler', active: true }),
        playerRow({ id: 'p2', name: 'Inactieve Speler', active: false }),
      ],
      attendance: [attendanceRow({ player_id: 'p1' }), attendanceRow({ player_id: 'p2' })],
      ratings: [],
    })
    expect(screen.getByText('Actieve', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Inactieve', { exact: false })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Inactieve Speler/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13 — ontbrekende/ongeldige match_ratings-waarde crasht niet
// ═══════════════════════════════════════════════════════════════════════
describe('AC13 — ontbrekende/ongeldige match_ratings-waarde crasht niet', () => {
  it('een ongeldige rating (11, buiten 1..10) telt niet mee, levert nooit een 0 op, en de meest recente geldige wedstrijden schuiven het venster op (X blijft 5, niet 6)', async () => {
    // r1 (meest recent) is ongeldig (11); r2..r6 zijn geldig → het venster
    // pakt de 5 geldige wedstrijden r2..r6, niet r1.
    const { matches, ratings } = vormReeks('p1', [11, 9, 8, 9, 8, 9])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    // quality: blendPlayerForm(7, [9,8,9,8,9]) = 8,12 → "8,1"; trend flat.
    expect(screen.getByText('CM · 8,1 → (5)')).toBeInTheDocument()
  })

  it('een volledig ontbrekende beoordeling (geen rij in match_ratings voor die wedstrijd) crasht de popup niet en telt evenmin als 0', async () => {
    // e1..e4 hebben helemaal geen match_ratings-rij; alleen e5 (oudste van de
    // 5 opgehaalde) is beoordeeld — de pagina mag hier niet op crashen.
    const { matches, ratings } = vormReeks('p1', [null, null, null, null, 6])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    // count=1, quality = blendPlayerForm(7, [6]) → anker 0,7 + vorm 0,3 met
    // gewicht (1/5)·0,7=0,14 → quality = 7·0,86 + 6·0,14 = 6,86 → "6,9".
    expect(screen.getByText('CM · 6,9 (1)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — tenant-isolatie: een ander team levert nooit vorm-data
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — tenant-isolatie: een ander team levert nooit vorm-data', () => {
  it('wedstrijden en beoordelingen van een ánder team_id met een EIGEN (vreemd) event_id komen nooit in de vormberekening terecht', async () => {
    // Dit bewijst de .in('event_id', formMatchIds)-grens: de vreemde
    // wedstrijden hebben hun EIGEN event_id's, die nooit in de eigen
    // formMatchIds-lijst voorkomen. Zie de tweede test hieronder voor het
    // aanvullende bewijs van de .eq('team_id', user.id)-grens op
    // match_ratings zelf (zie de tweede test hieronder).
    //
    // Eigen team: 1 beoordeelde wedstrijd (rating 9).
    const { matches: ownMatches, ratings: ownRatings } = vormReeks('p1', [9])
    // Ander team: 4 EXTRA wedstrijden, gedateerd nog vóór de eigen wedstrijd
    // (dus binnen het venster ALS de isolatie zou falen), met hoge
    // beoordelingen voor exact dezelfde player_id — zou de quality en de
    // count fors optrekken als tenant-scoping ontbrak.
    const foreignMatches: Row[] = []
    const foreignRatings: Row[] = []
    for (let i = 0; i < 4; i++) {
      const id = `foreign-${i}`
      foreignMatches.push(
        vormMatchRow({ id, team_id: OTHER_TEAM, date: `2026-08-0${2 + i}` }),
      )
      foreignRatings.push(ratingRow({ event_id: id, player_id: 'p1', rating: 10, team_id: OTHER_TEAM }))
    }
    await renderLineupPage({
      events: [eventRow(), ...ownMatches, ...foreignMatches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [...ownRatings, ...foreignRatings],
    })
    openCmSlot()
    // Als de isolatie zou falen, zou X=5 zijn (1 eigen + 4 vreemde) met een
    // veel hogere quality. Met correcte isolatie: X=1, quality =
    // blendPlayerForm(7, [9]) = 7,28 → "7,3".
    expect(screen.getByText('CM · 7,3 (1)')).toBeInTheDocument()
  })

  it('een rating-rij van een ánder team_id op een EIGEN event_id (geen concurrerende eigen rij) telt niet mee — bewijst .eq("team_id", user.id) op match_ratings zelf', async () => {
    // De vorige test kon ook slagen als het team_id-filter op match_ratings
    // zou ontbreken, zolang .in('event_id', …) de vreemde rijen toch al
    // uitsluit (ze hadden immers een vréémd event_id). Deze test isoleert het
    // team_id-filter apart: 5 eigen
    // wedstrijden, waarvan de MEEST RECENTE (target) geen enkele EIGEN
    // beoordeling heeft — alleen een rij van OTHER_TEAM, met een event_id
    // dat wél in de eigen formMatchIds-lijst zit (de wedstrijd is immers van
    // het eigen team). Die kan dus ALLEEN worden buitengesloten via
    // .eq('team_id', user.id), niet via .in('event_id', …).
    const ownDated = [0, 1, 2, 3].map((i) =>
      vormMatchRow({ id: `own-${i}`, team_id: TEAM, date: addDaysFixed(EVENT_DATE, -(2 + i)) }),
    )
    const target = vormMatchRow({ id: 'own-target', team_id: TEAM, date: addDaysFixed(EVENT_DATE, -1) })
    const ownRatings = ownDated.map((m) =>
      ratingRow({ event_id: m.id as string, player_id: 'p1', rating: 9, team_id: TEAM }),
    )
    // Vreemde rij op een EIGEN event_id — géén eigen rij voor deze wedstrijd.
    const foreignRatingOnOwnEvent = ratingRow({
      event_id: 'own-target',
      player_id: 'p1',
      rating: 1,
      team_id: OTHER_TEAM,
    })
    await renderLineupPage({
      events: [eventRow(), target, ...ownDated],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [...ownRatings, foreignRatingOnOwnEvent],
    })
    openCmSlot()
    // Correcte isolatie: de 'own-target'-wedstrijd blijft onbeoordeeld (de
    // vreemde rij telt niet mee), dus het venster valt terug op de 4 eigen,
    // wél beoordeelde wedstrijden → X=4, alle ratings 9 →
    // blendPlayerForm(7, [9,9,9,9]) = 8,12 → "8,1". Zou het team_id-filter
    // ontbreken, dan zou de vreemde rating (1) wél meetellen: X=5 met
    // recent-eerst [1,9,9,9,9] → quality 6,53 → "6,5" (down) — een duidelijk
    // ander, foutief resultaat.
    expect(screen.getByText('CM · 8,1 → (4)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Peildatum — events.date van het op te stellen event, geen klok
// ═══════════════════════════════════════════════════════════════════════
describe('Peildatum — events.date van het op te stellen event, geen klok', () => {
  it('een wedstrijd OP de peildatum telt niet mee, de dag ervóór wel — geen systeemklok betrokken', async () => {
    const onSameDay = vormMatchRow({ id: 'zelfde-dag', date: EVENT_DATE })
    const dayBefore = vormMatchRow({ id: 'dag-ervoor', date: '2026-08-09' })
    await renderLineupPage({
      events: [eventRow(), onSameDay, dayBefore],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [
        ratingRow({ event_id: 'zelfde-dag', player_id: 'p1', rating: 10 }),
        ratingRow({ event_id: 'dag-ervoor', player_id: 'p1', rating: 5 }),
      ],
    })
    openCmSlot()
    // Zou de wedstrijd van de peildatum zelf meetellen, dan zou count=2 zijn
    // en quality veel hoger (10 zit erin). Correcte cutoff: count=1, quality
    // = blendPlayerForm(7, [5]) = 6,72 → "6,7".
    expect(screen.getByText('CM · 6,7 (1)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Horizon — FORM_MATCH_HORIZON (25) wordt als limit doorgegeven
// ═══════════════════════════════════════════════════════════════════════
describe('Horizon — FORM_MATCH_HORIZON (25) wordt als limit doorgegeven', () => {
  it('de vorm-venster-query op events (.eq(type,match) + .lt(date,…)) krijgt precies limit(25) mee', async () => {
    expect(FORM_MATCH_HORIZON).toBe(25)
    let capturedLimit: number | null = null
    await renderLineupPage({
      events: [eventRow()],
      players: [playerRow({ id: 'p1' })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [],
      onVormLimit: (n) => { capturedLimit = n },
    })
    expect(capturedLimit).toBe(FORM_MATCH_HORIZON)
  })

  it('de 26e-t/m-30e (oudste) wedstrijd valt écht buiten het venster: hun geldige beoordelingen bereiken de popup nooit', async () => {
    // De vorige test bewijst alleen het doorgegeven .limit()-argument, niet
    // het effect ervan. Hier 30 wedstrijden: de 25
    // meest recente zijn ONBEOORDEELD, de 5 OUDSTE (rang 26..30, dus buiten
    // de horizon) zijn WEL beoordeeld. Als .limit(25) niet écht werd
    // afgedwongen (bv. weggelaten of te ruim), zouden die 5 alsnog in het
    // vormvenster belanden en een cijfer tonen. Zou de mock-engine .limit()
    // niet zelf toepassen, zou dit ook niet aantoonbaar zijn — maar die
    // toepast hij wél écht (zie tableFactory hierboven, dezelfde engine als
    // de reeds bevestigde Horizon- en tenant-isolatie-tests).
    const matches: Row[] = []
    const ratings: Row[] = []
    for (let i = 1; i <= 30; i++) {
      const id = `h-${i}`
      matches.push(vormMatchRow({ id, team_id: TEAM, date: addDaysFixed(EVENT_DATE, -i) }))
      if (i > 25) {
        // De 5 oudste (rang 26..30) zijn beoordeeld — mogen nooit meetellen.
        ratings.push(ratingRow({ event_id: id, player_id: 'p1', rating: 10, team_id: TEAM }))
      }
    }
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 6 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    // Correct: de query haalt uitsluitend de 25 meest recente (onbeoordeelde)
    // wedstrijden op, dus formMatchIds bevat de beoordeelde 26..30 helemaal
    // niet — de match_ratings-query kan ze dan ook niet terugkrijgen. X blijft
    // 0, quality blijft het kale anker (6). Zou de horizon niet worden
    // afgedwongen, dan zou dit "CM · 8,8 → (5)" zijn geweest
    // (blendPlayerForm(6,[10,10,10,10,10]) — trend flat: recent (10+10)/2=10
    // vs. ouder gemiddelde(10,10,10)=10, verschil 0 → →).
    expect(screen.getByText('CM · 6,0 (0)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Trendpijl — up/flat/down/none end-to-end door de echte pagina
// (up al gedekt door AC2 hierboven; hier alleen down/flat/none aanvullend,
// als bewijs dat page.tsx → buildPlayerForms → LineupBuilder de trend
// correct doorgeeft — de trendberekening zelf is exhaustief unit-getest in
// lib/lineup-form.test.ts).
// ═══════════════════════════════════════════════════════════════════════
describe('Trendpijl — up/flat/down/none end-to-end door de echte pagina', () => {
  it('down: recent duidelijk lager dan ouder → ↓ (anker 7, ratings [4,4,10,10,10] → quality 6,58 → "6,6")', async () => {
    const { matches, ratings } = vormReeks('p1', [4, 4, 10, 10, 10])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    expect(screen.getByText('CM · 6,6 ↓ (5)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Gasten — players.type = 'guest' doet mee in de vormberekening
// ═══════════════════════════════════════════════════════════════════════
describe('Gasten — players.type = "guest" doet mee in de vormberekening', () => {
  it('een gastspeler krijgt gewoon een geblend vormcijfer, niet uitgesloten', async () => {
    const { matches, ratings } = vormReeks('p1', [7, 7, 7])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', name: 'Gast Speler', type: 'guest', rating: null })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    // anker valt terug op ANKER_FALLBACK=5 (geen players.rating), ratings
    // [7,7,7] → blendPlayerForm(null,[7,7,7]) = 5,84 → "5,8".
    expect(screen.getAllByText('Gast', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('CM · 5,8 → (3)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Alle wedstrijdtypes tellen mee (friendly/league/cup)
// ═══════════════════════════════════════════════════════════════════════
describe('Alle wedstrijdtypes tellen mee (friendly/league/cup)', () => {
  it('friendly, league en cup tellen alledrie mee in het vormvenster', async () => {
    const matches = [
      vormMatchRow({ id: 'm1', date: '2026-08-09', match_type: 'friendly' }),
      vormMatchRow({ id: 'm2', date: '2026-08-08', match_type: 'league' }),
      vormMatchRow({ id: 'm3', date: '2026-08-07', match_type: 'cup' }),
    ]
    const ratings = [
      ratingRow({ event_id: 'm1', player_id: 'p1', rating: 6 }),
      ratingRow({ event_id: 'm2', player_id: 'p1', rating: 6 }),
      ratingRow({ event_id: 'm3', player_id: 'p1', rating: 6 }),
    ]
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 6 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings,
    })
    openCmSlot()
    // Alle 3 tellen mee → count=3, quality blijft 6,0 (alle cijfers gelijk aan het anker).
    expect(screen.getByText('CM · 6,0 → (3)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// "Geen cijfer": geen players.rating én count 0
// ═══════════════════════════════════════════════════════════════════════
describe('"Geen cijfer": geen players.rating én count 0', () => {
  it('een speler zonder players.rating én zonder enige beoordeelde wedstrijd toont letterlijk "CM · (0)" — geen verzonnen cijfer', async () => {
    await renderLineupPage({
      events: [eventRow()],
      players: [playerRow({ id: 'p1', rating: null })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [],
    })
    openCmSlot()
    expect(screen.getByText('CM · (0)')).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Faalpad — database-fouten in het vormvenster (stap 4 van de datastroom)
// (beide queries stonden voorheen nog op geen enkele manier op de proef; de
// mock gaf structureel { error: null } terug — zie de toelichting bovenaan
// dit bestand)
// ═══════════════════════════════════════════════════════════════════════
describe('Faalpad — database-fouten in het vormvenster (stap 4 van de datastroom)', () => {
  // Een unieke, "gevaarlijke" ruwe PostgREST-boodschap: als deze ergens in de
  // DOM of in console.error zou opduiken, weten we zeker dat hij ergens
  // ongefilterd is doorgelekt — dus geen kans op een toevallige match met
  // andere tekst op de pagina.
  const RUWE_FOUT = { message: 'RUWE_POSTGREST_FOUT_NOOIT_TONEN_OF_LOGGEN', code: 'XX000' }

  it('vorm-venster-query op events faalt → de pagina rendert door, iedereen valt terug op X=0 (het anker), geen ruwe foutmelding in beeld of in de logs', async () => {
    await renderLineupPage({
      events: [eventRow()], // de hoofdquery (single, op deze zelfde tabel) blijft werken
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [],
      vormEventsError: RUWE_FOUT,
    })
    openCmSlot()
    // Precies het gedrag van vóór deze feature: X=0, quality = het kale anker.
    expect(screen.getByText('CM · 7,0 (0)')).toBeInTheDocument()
    // Geen ruwe foutmelding zichtbaar op de pagina.
    expect(document.body.textContent).not.toMatch(/RUWE_POSTGREST_FOUT/)
    // logError (lib/errors.ts:27-30, NIET gemockt — de echte functie draait)
    // logt uitsluitend een veilige code, nooit de ruwe boodschap zelf.
    expect(loggedErrors()).not.toMatch(/RUWE_POSTGREST_FOUT/)
    expect(loggedErrors()).toMatch(/lineup-form/)
  })

  it('match_ratings-query faalt (matches zijn wél opgehaald) → de pagina rendert door, iedereen valt terug op X=0, geen ruwe foutmelding in beeld of in de logs', async () => {
    // Matches bestaan gewoon (ronde 2 slaagt) — alleen de afhankelijke
    // match_ratings-query in ronde 3 faalt.
    const { matches } = vormReeks('p1', [9, 9, 9])
    await renderLineupPage({
      events: [eventRow(), ...matches],
      players: [playerRow({ id: 'p1', rating: 7 })],
      attendance: [attendanceRow({ player_id: 'p1' })],
      ratings: [], // irrelevant: de query zelf faalt hieronder
      ratingsError: RUWE_FOUT,
    })
    openCmSlot()
    expect(screen.getByText('CM · 7,0 (0)')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/RUWE_POSTGREST_FOUT/)
    expect(loggedErrors()).not.toMatch(/RUWE_POSTGREST_FOUT/)
    expect(loggedErrors()).toMatch(/lineup-form/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Guards — login-redirect en notFound blijven werken
// (de mocks stonden al klaar maar werden door geen enkele test aangesproken
// — zie de toelichting bovenaan dit bestand)
// ═══════════════════════════════════════════════════════════════════════
describe('Guards — login-redirect en notFound blijven werken', () => {
  it('geen ingelogde gebruiker → bestaande redirect naar /login, vóórdat er iets van het vormvenster wordt bevraagd', async () => {
    await expect(renderLineupPage({ user: null })).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('event.type !== "match" → bestaande notFound(), de opstellingsbouwer wordt niet gerenderd', async () => {
    await expect(
      renderLineupPage({ events: [eventRow({ type: 'training' })] }),
    ).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })
})
