// Acceptatietests — Assistent-trainers, fase 2: teamwisselaar en meerdere
// teams per account (goedgekeurde story v3, brief §2.4/§2.5/§4.1/§4.2).
//
// Scope van dit bestand (opdracht test-verifier): AC 11, 12, 13, 16, 17, 34,
// 52, 53.
//
// ── Wat hier bewust NIET (opnieuw) getest wordt ──
// `components/TeamSwitcher.test.tsx` (frontend-eigen unit-test) dekt al
// grondig het POPOVER/BOTTOM-SHEET-gedrag van TeamSwitcher in isolatie: één
// team → geen chevron/popover, meerdere teams → items + aria-checked, een
// mislukte wissel → foutmelding, "Nieuw team aanmaken"-formulier. Dat
// bestand mockt de acties (`@/app/actions/team`) volledig weg — hier draait
// juist de ECHTE keten: de echte server actions tegen een echt filterende
// tabel-engine, en de ECHTE pagina's die de daadwerkelijke tenant-isolatie
// en rechten van het GEKOZEN team moeten tonen (AC 12/13/34 zijn precies
// dat: geen UI-detail maar een dataclaim, alleen van buitenaf te bewijzen
// door de hele keten te draaien).
//
// ── Testmethode ──
// Tabel-engine: zelfde kopie/patroon als assistent-rechten.acceptance
// .test.tsx / assistent-fase1-fundament.acceptance.test.ts (.eq/.in worden
// echt toegepast). team_id ≠ user.id in elk scenario (validatorpunt 8,
// 13-validator-fase2-backend.md).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// `usePathname` leest een module-scope variabele (`huidigPathname`) i.p.v.
// een vaste string, zodat losse tests AppShell op een ander pad kunnen
// renderen (AC16/52: /settings blijft bereikbaar zonder team) zonder
// vi.resetModules()/dynamic import-gymnastiek. De closure wordt pas bij
// RENDER aangeroepen (niet bij het definiëren van de mock), dus de variabele
// bestaat dan al.
let huidigPathname = '/'
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  usePathname: () => huidigPathname,
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/components/PageTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/Navigation', () => ({ default: () => <nav data-testid="nav" /> }))
vi.mock('@/components/GlobalFab', () => ({ default: () => <div data-testid="fab" /> }))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { setActiveTeam, createTeam } from '@/app/actions/team'
import { canEdit, getTeamContext, ACTIVE_TEAM_COOKIE } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'
import PlayersPage from '@/app/players/page'
import AppShell from '@/components/AppShell'
import EmptyTeamState from '@/components/EmptyTeamState'

// ────────────────────────────────────────────────
// Generieke, ECHT filterende Supabase-tabel-engine (eigen kopie per bestand,
// project-conventie) — inclusief de rpc('create_team', ...)-nabootsing uit
// assistent-fase1-fundament.acceptance.test.ts, zodat createTeam() hier
// ECHT (niet gemockt) door de RPC-laag heen loopt.
// ────────────────────────────────────────────────
type Row = Record<string, unknown>

function realTable(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const resolveRows = () => rows.filter((r) => filters.every((f) => f(r)))
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain }
    chain.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain }
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null })
    chain.single = () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null })
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: resolveRows(), error: null })
    return chain
  }
}

function makeSupabase(opts: { user: { id: string } | null; members: Row[]; settings?: Row[]; tables?: Record<string, Row[]> }) {
  const store: Record<string, Row[]> = {
    team_members: opts.members,
    settings: opts.settings ?? [],
    ...(opts.tables ?? {}),
  }
  return {
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from: (t: string) => {
      if (!store[t]) store[t] = []
      return realTable(store[t])()
    },
    // create_team (M5) — zelfde nabootsing als assistent-fase1-fundament: één
    // transactie die een teams-rij, een owner-rij (ALLE_RECHTEN) en de
    // teamnaam-settingsrij aanmaakt.
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn !== 'create_team') throw new Error(`onverwachte rpc in dit testbestand: ${fn}`)
      if (!store.teams) store.teams = []
      if (args?.p_alleen_zonder_team === true) {
        const bestaand = store.team_members.find((r) => r.user_id === opts.user?.id)
        if (bestaand) return { data: bestaand.team_id, error: null }
      }
      const nieuwTeamId = String(args?.p_naam ?? '') === '' ? 'ONGELDIG' : `nieuw-team-${store.teams.length + 1}`
      store.teams.push({ id: nieuwTeamId })
      store.team_members.push({
        team_id: nieuwTeamId, user_id: opts.user?.id, rol: 'owner', ...rechtenNaarKolommen(ALLE_RECHTEN),
      })
      store.settings.push({ team_id: nieuwTeamId, key: 'team_name', value: args?.p_naam })
      return { data: nieuwTeamId, error: null }
    },
    store,
  }
}

function installSupabase(m: { store?: Record<string, Row[]> }) {
  vi.mocked(createClient).mockResolvedValue(m as unknown as Awaited<ReturnType<typeof createClient>>)
  return m
}

function memberRow(teamId: string, userId: string, rol: 'owner' | 'assistent', rechten: Partial<TeamRechten> = {}): Row {
  return { team_id: teamId, user_id: userId, rol, ...rechtenNaarKolommen({ ...GEEN_RECHTEN, ...rechten } as TeamRechten) }
}

function teamNameRow(teamId: string, naam: string): Row {
  return { team_id: teamId, key: 'team_name', value: naam }
}

let cookieWaarde: string | undefined
let cookieSets: { naam: string; value: string }[]

beforeEach(() => {
  vi.clearAllMocks()
  cookieWaarde = undefined
  cookieSets = []
  huidigPathname = '/'
  vi.mocked(cookies).mockResolvedValue({
    get: (naam: string) => (naam === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined ? { value: cookieWaarde } : undefined),
    set: (naam: string, value: string) => { cookieSets.push({ naam, value }) },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

// team_id EXPLICIET los van elk user-id (validatorpunt 8).
const GEBRUIKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_A = '11111111-1111-4111-8111-111111111111' // eigenaar
const TEAM_B = '22222222-2222-4222-8222-222222222222' // assistent, beperkt recht
const VREEMD_TEAM = '99999999-9999-4999-8999-999999999999'

// ════════════════════════════════════════════════════════════════════════
// AC12/13/34 — na het wisselen toont de app UITSLUITEND data van het
// gekozen team, met de rechten van DAT team. Hoofdtrainerschap bij team A
// heeft geen enkel effect binnen team B.
// ════════════════════════════════════════════════════════════════════════
describe('AC12/13/34 — wisselen toont uitsluitend het gekozen team, met de rechten van dát team', () => {
  function fixture() {
    return installSupabase(makeSupabase({
      user: { id: GEBRUIKER },
      members: [
        // Hoofdtrainer bij team A (alle rechten) EN assistent bij team B met
        // het spelers-recht bewust UIT — als de code ooit per ongeluk het
        // owner-lidmaatschap van team A zou lekken naar team B, staat hier
        // canEdit ineens ten onrechte op true.
        memberRow(TEAM_A, GEBRUIKER, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, GEBRUIKER, 'assistent', { spelers: false }),
      ],
      settings: [teamNameRow(TEAM_A, 'FC Alpha'), teamNameRow(TEAM_B, 'FC Beta')],
      tables: {
        players: [
          { id: 'pa', team_id: TEAM_A, name: 'Speler A', position: 'Spits', jersey_number: 1, active: true },
          { id: 'pb', team_id: TEAM_B, name: 'Speler B', position: 'Spits', jersey_number: 2, active: true },
        ],
      },
    }))
  }

  it('actief team = B (assistent, spelers-recht UIT): alleen Speler B is zichtbaar, geen "Speler toevoegen"-knop', async () => {
    fixture()
    cookieWaarde = TEAM_B
    const el = await PlayersPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByText('Speler B')).toBeInTheDocument()
    expect(screen.queryByText('Speler A')).toBeNull()
    // canEdit(ctx,'spelers') moet hier FALSE zijn — ook al is deze gebruiker
    // owner van team A. Zonder "Speler toevoegen" is dat aangetoond.
    expect(screen.queryByText(nl.players.add)).toBeNull()
  })

  it('actief team = A (owner): alleen Speler A is zichtbaar, mét "Speler toevoegen"', async () => {
    fixture()
    cookieWaarde = TEAM_A
    const el = await PlayersPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByText('Speler A')).toBeInTheDocument()
    expect(screen.queryByText('Speler B')).toBeNull()
    expect(screen.getByText(nl.players.add)).toBeInTheDocument()
  })

  it('rechten-controle rechtstreeks op de context: canEdit(ctx, "spelers") is precies het recht van het ACTIEVE team, nooit van het andere lidmaatschap', async () => {
    fixture()
    cookieWaarde = TEAM_B
    const ctxB = await getTeamContext()
    expect(ctxB?.teamId).toBe(TEAM_B)
    expect(ctxB?.rol).toBe('assistent')
    expect(canEdit(ctxB!, 'spelers')).toBe(false)
    // Het hoofdtrainerschap bij team A staat er nog wél in `teams`, maar
    // heeft geen effect op `rol`/`rechten` van de actieve context (AC13/34).
    const teamAInLijst = ctxB!.teams.find((t) => t.teamId === TEAM_A)
    expect(teamAInLijst?.rol).toBe('owner')
    expect(ctxB!.rol).not.toBe(teamAInLijst?.rol)
  })
})

// ════════════════════════════════════════════════════════════════════════
// setActiveTeam(X) weigert een team-id waar geen lidmaatschap voor bestaat,
// en laat de cookie ongemoeid (de cookie is nooit een autorisatiebron).
// ════════════════════════════════════════════════════════════════════════
describe('setActiveTeam — een team-id zonder eigen lidmaatschap wordt geweigerd', () => {
  it('gooit "Team niet gevonden" voor een team dat niet in de eigen lidmaatschappen zit, en zet GEEN cookie', async () => {
    installSupabase(makeSupabase({
      user: { id: GEBRUIKER },
      members: [memberRow(TEAM_A, GEBRUIKER, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
    }))
    await expect(setActiveTeam(VREEMD_TEAM)).rejects.toThrow('Team niet gevonden')
    expect(cookieSets).toEqual([])
  })

  it('slaagt wél voor een team waar wél een lidmaatschap voor bestaat (en eindigt in een redirect)', async () => {
    installSupabase(makeSupabase({
      user: { id: GEBRUIKER },
      members: [
        memberRow(TEAM_A, GEBRUIKER, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, GEBRUIKER, 'assistent', { spelers: true }),
      ],
      settings: [teamNameRow(TEAM_A, 'FC Alpha'), teamNameRow(TEAM_B, 'FC Beta')],
    }))
    await expect(setActiveTeam(TEAM_B)).rejects.toThrow('__redirect__:/')
    expect(cookieSets).toEqual([{ naam: ACTIVE_TEAM_COOKIE, value: TEAM_B }])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC17/53 — automatische val-terug bij een ongeldige/vervallen cookie, met
// meerdere lidmaatschappen: het eerstvolgende team, alfabetisch op naam.
// ════════════════════════════════════════════════════════════════════════
describe('AC17/53 — automatische val-terug bij een ongeldige cookie, alfabetisch op teamnaam', () => {
  it('cookie wijst naar een team waar geen lidmaatschap meer voor bestaat → valt terug op het eerste team ALFABETISCH op naam (niet op volgorde van lidmaatschap of teamId)', async () => {
    installSupabase(makeSupabase({
      user: { id: GEBRUIKER },
      // Lidmaatschapsvolgorde is bewust "verkeerd om" t.o.v. alfabetisch, en
      // teamId-volgorde ook: dit bewijst dat de sortering op NAAM gaat, niet
      // op invoervolgorde of id.
      members: [
        memberRow(TEAM_B, GEBRUIKER, 'assistent', { spelers: true }),
        memberRow(TEAM_A, GEBRUIKER, 'owner', ALLE_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_B, 'Zeta FC'), teamNameRow(TEAM_A, 'Alpha FC')],
    }))
    cookieWaarde = VREEMD_TEAM // bestaat niet (meer) in de lidmaatschappen
    const ctx = await getTeamContext()
    expect(ctx?.teamId).toBe(TEAM_A) // "Alpha FC" komt alfabetisch vóór "Zeta FC"
    expect(ctx?.teams.map((t) => t.naam)).toEqual(['Alpha FC', 'Zeta FC'])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC11 — createTeam() maakt de aanroeper hoofdtrainer van het nieuwe team.
// ════════════════════════════════════════════════════════════════════════
describe('AC11 — createTeam maakt de aanroeper hoofdtrainer (owner) van een gloednieuw team', () => {
  it('roept de RPC met p_alleen_zonder_team=false aan en laat een owner-rij met ALLE_RECHTEN + de teamnaam-rij achter; cookie op het nieuwe team, redirect naar "/"', async () => {
    const m = installSupabase(makeSupabase({
      user: { id: GEBRUIKER },
      members: [memberRow(TEAM_A, GEBRUIKER, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
    }))
    await expect(createTeam('Nieuw team JO9')).rejects.toThrow('__redirect__:/')

    const nieuweRij = m.store!.team_members.find((r) => r.user_id === GEBRUIKER && r.team_id !== TEAM_A)
    expect(nieuweRij).toMatchObject({ rol: 'owner', mag_spelers_bewerken: true, mag_periodisering_bewerken: true })
    const nieuwTeamId = (nieuweRij as Row).team_id as string
    expect(m.store!.settings).toContainEqual({ team_id: nieuwTeamId, key: 'team_name', value: 'Nieuw team JO9' })
    expect(cookieSets).toEqual([{ naam: ACTIVE_TEAM_COOKIE, value: nieuwTeamId }])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC16/52 — lege staat zonder team: "Team aanmaken" + uitleg over
// uitnodigingslinks, geen geblokkeerde toegang.
// ════════════════════════════════════════════════════════════════════════
// LET OP — dit blok is tijdens het schrijven van deze verificatie tweemaal
// bijgesteld, omdat er GELIJKTIJDIG een andere sessie in dezelfde working
// tree aan AppShell.tsx/SidebarNav.tsx/layout.tsx werkte (het patroon dat
// geheugen.md al eerder documenteerde). Tijdens het testen bleek eerst dat
// AppShell.tsx (client) `EmptyTeamState` (async server component,
// `next/headers` via getDict) rechtstreeks importeerde en als JSX
// renderde — bevestigd met een ECHTE `npm run build`
// ("You're importing a module that depends on \"next/headers\" ... Import
// trace: lib/i18n.ts → components/EmptyTeamState.tsx →
// components/AppShell.tsx [Client Component Browser]") — én dat
// `components/AppShell.tsx` `hasTeam` niet doorgaf aan `SidebarNav`
// (`npm run typecheck`: "Property 'hasTeam' is missing ... but required"),
// wat de desktop-zijbalk voor IEDEREEN tot alleen "Instellingen" had
// teruggebracht. Beide zijn tussentijds gefixt (AppShell.tsx kreeg een
// `emptyState: React.ReactNode`-prop, server-side opgebouwd in
// app/layout.tsx; SidebarNav krijgt nu `hasTeam={hasTeam}` mee) — hieronder
// staat de test tegen de HUIDIGE, gefixte contractvorm. Zie het testrapport
// voor de volledige tijdlijn van deze bevinding.
describe('AC16/52 — lege staat zonder enig team', () => {
  it('EmptyTeamState toont de uitleg en een "Team aanmaken"-knop', async () => {
    const el = await EmptyTeamState()
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.getByText(nl.team.noTeamTitle)).toBeInTheDocument()
    expect(screen.getByText(nl.team.noTeamInviteHint, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.team.createTeam })).toBeInTheDocument()
  })

  function renderShell(pathname: string, hasTeam: boolean, children: React.ReactNode) {
    huidigPathname = pathname
    const teams = hasTeam ? [{ teamId: 'team-x', naam: 'FC Voorbeeld', rol: 'owner' as const, rechten: ALLE_RECHTEN }] : []
    return render(
      <DictProvider dict={nl}>
        <AppShell
          emptyState={<div data-testid="empty-state">{nl.team.noTeamTitle}</div>}
          teamName={hasTeam ? 'FC Voorbeeld' : null} teamLogoUrl={null} userEmail="coach@example.com"
          hasTeam={hasTeam} teamId={hasTeam ? 'team-x' : null}
          rol={hasTeam ? 'owner' : null} rechten={hasTeam ? ALLE_RECHTEN : null} teams={teams}
        >
          {children}
        </AppShell>
      </DictProvider>,
    )
  }

  it('geen team, pad "/" → toont de meegegeven emptyState i.p.v. de pagina-inhoud, en verbergt Navigation/FAB', () => {
    renderShell('/', false, <div>Pagina-inhoud</div>)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.queryByText('Pagina-inhoud')).toBeNull()
    expect(screen.queryByTestId('nav')).toBeNull()
    expect(screen.queryByTestId('fab')).toBeNull()
  })

  it('/settings blijft bereikbaar zonder team: de pagina-inhoud (niet de lege staat) wordt getoond, zodat uitloggen/accountverwijdering/invite-verzilvering mogelijk blijven', () => {
    renderShell('/settings', false, <div>Instellingen-inhoud</div>)
    expect(screen.getByText('Instellingen-inhoud')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-state')).toBeNull()
  })

  it('regressiebewaking — AppShell importeert EmptyTeamState nooit rechtstreeks (moet als emptyState-prop binnenkomen, opgebouwd door een Server Component)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const bron = readFileSync(path.join(__dirname, 'components', 'AppShell.tsx'), 'utf-8')
    expect(bron).not.toMatch(/from ['"]@\/components\/EmptyTeamState['"]/)
    expect(bron).toMatch(/emptyState/)
  })

  it('regressiebewaking — met een team toont de desktop-zijbalk meer dan alleen "Instellingen" (hasTeam bereikt SidebarNav)', () => {
    renderShell('/', true, <div>Pagina-inhoud</div>)
    expect(screen.getByText(nl.nav.dashboard)).toBeInTheDocument()
    expect(screen.getByText('Pagina-inhoud')).toBeInTheDocument()
  })
})
