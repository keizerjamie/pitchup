// Acceptatietests — Assistent-trainers, fase 3: een team los verwijderen
// (goedgekeurde story v3, brief §2.5, AC 14/31/49).
//
// Scope van dit bestand (opdracht test-verifier): AC 14, 31, 49 — plus, na
// aanvulling op basis van het validatorrapport frontend
// (21-validator-fase3-4-frontend.md):
//   B2 — de owner-gate van de Teams-sectie op Instellingen (alleen zichtbaar
//   voor een hoofdtrainer, en toont dan uitsluitend eigen owner-teams, niet
//   een team waar je assistent bent) is niet getest.
//   K4 — een NEXT_REDIRECT-throw uit deleteTeam moet de "Verwijderen..."-
//   status laten staan zonder foutmelding (TeamsSection.tsx:71).
//
// ── Testmethode ──
// Van buitenaf: de ECHTE server actions (getTeamDeleteInfo, deleteTeam,
// leaveTeam uit app/actions/team.ts) en de ECHTE componenten/pagina's
// (TeamsSection, SettingsPage) tegen een ECHT FILTERENDE Supabase-tabel-
// engine (patroon assistent-fase1-fundament.acceptance.test.ts /
// teamwisselaar.acceptance.test.tsx — .eq/.in worden echt toegepast,
// insert/update/delete muteren de onderliggende rijenlijst echt).
// team_id ≠ user.id in elk scenario.
//
// ── Wat hier bewust NIET (opnieuw) getest wordt ──
// - De DB-cascade van `delete from teams` naar `team_members`/`team_invites`
//   (dat de assistenten écht hun lidmaatschap kwijtraken) is geen
//   applicatiecode maar een FK ON DELETE CASCADE — niet in vitest te bewijzen
//   (brief §5.1, geheugen.md "Vitest bewijst niets over RLS/cascades"). Dat
//   bewijst supabase/team-rls-verificatie.sql blok 22 tegen de echte
//   database. Hier wordt bewezen wat de APPLICATIELAAG doet: de dertien
//   TEAM_TABELLEN leegmaken en daarna `delete from teams where id = teamId`
//   aanroepen — exact de twee dingen die `lib/team-opruimen.ts` zelf doet en
//   die de tabel-engine WEL kan waarnemen.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// De echte redirect('/') in deleteTeam/leaveTeam moet net als in productie een
// fout gooien waarvan de message 'NEXT_REDIRECT' bevat — TeamsSection.tsx:71
// herkent PRECIES die substring om de "Verwijderen..."-status te laten staan
// zonder foutmelding (K4). `__redirect__:<pad>` (zoals andere testbestanden
// gebruiken) zou die check missen en het scenario dus niet echt bewijzen.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`) }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => null) }))
// StafSection (owner-only) roept deze twee acties aan; gemockt zodat dit
// bestand niet ook de admin-client/RPC-laag van listTeamMembers/
// getActiveInvite hoeft na te bootsen — die hebben hun eigen dekking
// (app/actions/team-members.test.ts, app/actions/team-invites.test.ts,
// assistent-rechten.acceptance.test.tsx). Dit bestand gaat over de
// TEAMS-sectie, niet over Staf.
vi.mock('@/app/actions/team-members', () => ({
  listTeamMembers: vi.fn().mockResolvedValue([]),
  updateMemberRights: vi.fn(),
  removeMember: vi.fn(),
}))
vi.mock('@/app/actions/team-invites', () => ({
  createInvite: vi.fn(),
  getActiveInvite: vi.fn().mockResolvedValue(null),
  revokeInvite: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getTeamDeleteInfo, deleteTeam, leaveTeam } from '@/app/actions/team'
import { ACTIVE_TEAM_COOKIE } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'
import TeamsSection from '@/components/settings/TeamsSection'
import SettingsPage from '@/app/settings/page'

// ────────────────────────────────────────────────
// Generieke, ECHT filterende Supabase-tabel-engine (eigen kopie per bestand,
// project-conventie — geheugen.md "Belangrijke gotchas").
// ────────────────────────────────────────────────
type Row = Record<string, unknown>

function realTable(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const resolveRows = () => rows.filter((r) => filters.every((f) => f(r)))
    let lastInserted: Row[] = []
    let pendingUpdate: Row | null = null
    let pendingDelete = false

    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain }
    chain.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return chain }
    chain.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain }
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: lastInserted[0] ?? resolveRows()[0] ?? null, error: null })
    chain.single = () => Promise.resolve({ data: lastInserted[0] ?? resolveRows()[0] ?? null, error: null })
    chain.insert = (payload: Row | Row[]) => {
      const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        id: (p as Row).id ?? `gen-${Math.random()}`,
        ...p,
      }))
      for (const item of items) rows.push(item)
      lastInserted = items
      return chain
    }
    chain.update = (payload: Row) => { pendingUpdate = payload; return chain }
    chain.delete = () => { pendingDelete = true; return chain }
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const matched = resolveRows()
      if (pendingUpdate) for (const r of matched) Object.assign(r, pendingUpdate)
      if (pendingDelete) for (const r of matched) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      if (lastInserted.length) return resolve({ data: lastInserted, error: null })
      return resolve({ data: matched, error: null })
    }
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
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
      // Nodig zodra nul teams overblijven: naVerliesVanTeam roept dan
      // wisTeamNaamVlag aan (lib/team-context.ts), die auth.updateUser
      // gebruikt om de geparkeerde teamnaam-vlag te wissen.
      updateUser: async () => ({ data: {}, error: null }),
    },
    from: (t: string) => {
      if (!store[t]) store[t] = []
      return realTable(store[t])()
    },
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
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
let cookieDeletes: string[]

beforeEach(() => {
  vi.clearAllMocks()
  cookieWaarde = undefined
  cookieSets = []
  cookieDeletes = []
  vi.mocked(cookies).mockResolvedValue({
    get: (naam: string) => (naam === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined ? { value: cookieWaarde } : undefined),
    set: (naam: string, value: string) => { cookieSets.push({ naam, value }) },
    delete: (naam: string) => { cookieDeletes.push(naam) },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

// team_id EXPLICIET los van elk user-id (validatorpunt 8).
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSISTENT1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ASSISTENT2_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NIET_LID_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const TEAM_A = '11111111-1111-4111-8111-111111111111' // wordt verwijderd
const TEAM_B = '22222222-2222-4222-8222-222222222222' // blijft intact
const TEAM_C = '33333333-3333-4333-8333-333333333333' // OWNER is hier assistent
const VREEMD_TEAM = '99999999-9999-4999-8999-999999999999'

// Vult alle 13 TEAM_TABELLEN + `teams` met één rij per team, herkenbaar aan
// het teamId zodat "leeg voor TEAM_A, intact voor TEAM_B" aantoonbaar is.
function vulTeamTabellen(teamId: string, suffix: string): Record<string, Row> {
  const rijen: Record<string, Row> = {}
  for (const tabel of TEAM_TABELLEN) {
    rijen[tabel] = { id: `${tabel}-${suffix}`, team_id: teamId }
  }
  return rijen
}

// ════════════════════════════════════════════════════════════════════════
// B2 (validatorrapport frontend) — de owner-gate en de owner-only-filter van
// de Teams-sectie op de ECHTE Instellingenpagina.
// ════════════════════════════════════════════════════════════════════════
describe('B2 — Teams-sectie op Instellingen: owner-gate en filter op eigen teams', () => {
  it('een assistent (geen hoofdtrainer van het actieve team) ziet de Teams-sectie helemaal niet', async () => {
    installSupabase(makeSupabase({
      user: { id: ASSISTENT1_ID },
      members: [memberRow(TEAM_A, ASSISTENT1_ID, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
    }))
    const el = await SettingsPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.queryByText(nl.teamsBeheer.section)).toBeNull()
    expect(screen.queryByText(nl.teamsBeheer.deleteTeam)).toBeNull()
  })

  it('hoofdtrainer van TEAM_A én assistent bij TEAM_C (actief = TEAM_A): de Teams-lijst toont ALLEEN TEAM_A, nooit TEAM_C', async () => {
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [
        memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_C, OWNER_ID, 'assistent', GEEN_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'FC Aowner'), teamNameRow(TEAM_C, 'FC Cassist')],
    }))
    cookieWaarde = TEAM_A
    const el = await SettingsPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.getByText(nl.teamsBeheer.section)).toBeInTheDocument()
    expect(screen.getByText('FC Aowner')).toBeInTheDocument()
    expect(screen.queryByText('FC Cassist')).toBeNull()
  })

  it('is de gebruiker bij het ACTIEVE team assistent, dan verschijnt de Teams-sectie niet — ook al is hij elders wél hoofdtrainer (dezelfde gate als Staf, brief §4.3)', async () => {
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [
        memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_C, OWNER_ID, 'assistent', GEEN_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'FC Aowner'), teamNameRow(TEAM_C, 'FC Cassist')],
    }))
    cookieWaarde = TEAM_C
    const el = await SettingsPage()
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.queryByText(nl.teamsBeheer.section)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC14/49 — het bevestigingsscherm: teamnaam, aantal assistenten (uit de
// server, niet uit de client), de vaste onderdelen van backend-contract §4,
// en de typ-VERWIJDER-drempel. Gerenderd via het ECHTE TeamsSection-
// component met de ECHTE getTeamDeleteInfo/deleteTeam-acties.
// ════════════════════════════════════════════════════════════════════════
describe('AC14/49 — TeamsSection: bevestigingsscherm en VERWIJDER-drempel', () => {
  function fixture() {
    return installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [
        memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_A, ASSISTENT1_ID, 'assistent', GEEN_RECHTEN),
        memberRow(TEAM_A, ASSISTENT2_ID, 'assistent', GEEN_RECHTEN),
      ],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
      tables: { teams: [{ id: TEAM_A }] },
    }))
  }

  it('toont teamnaam, het ECHTE aantal assistenten (2, uit getTeamDeleteInfo) en alle vaste onderdelen uit contract §4', async () => {
    fixture()
    render(<DictProvider dict={nl}>
      <TeamsSection teams={[{ teamId: TEAM_A, naam: 'FC Alpha' }]} />
    </DictProvider>)

    fireEvent.click(screen.getByText(nl.teamsBeheer.deleteTeam))
    await waitFor(() => expect(screen.getByText(nl.teamsBeheer.deleteTeamTitle)).toBeInTheDocument())

    // Beslissing/contract §4: teamnaam + welke data verdwijnt + accounts
    // blijven + oefeningen blijven (alleen koppelingen verdwijnen) + andere
    // teams blijven ongemoeid — allemaal in dezelfde hint-tekst.
    expect(screen.getByText(nl.teamsBeheer.deleteTeamHint.replace('{team}', 'FC Alpha'))).toBeInTheDocument()
    expect(screen.getByText(nl.teamsBeheer.deleteTeamAssistants.replace('{n}', '2'))).toBeInTheDocument()
  })

  it('typ-VERWIJDER-drempel: verkeerd woord houdt de knop disabled, het exacte woord (hoofdletterongevoelig) maakt hem klikbaar', async () => {
    fixture()
    render(<DictProvider dict={nl}>
      <TeamsSection teams={[{ teamId: TEAM_A, naam: 'FC Alpha' }]} />
    </DictProvider>)

    fireEvent.click(screen.getByText(nl.teamsBeheer.deleteTeam))
    await waitFor(() => expect(screen.getByText(nl.settings.deleteConfirmFinal)).toBeInTheDocument())

    const invoer = screen.getByLabelText(nl.settings.deleteConfirmPrompt)
    const bevestigKnop = screen.getByText(nl.settings.deleteConfirmFinal).closest('button') as HTMLButtonElement
    expect(bevestigKnop).toBeDisabled()

    fireEvent.change(invoer, { target: { value: 'verwijderen' } })
    expect(bevestigKnop).toBeDisabled()

    fireEvent.change(invoer, { target: { value: 'VERWIJDER' } })
    expect(bevestigKnop).not.toBeDisabled()
  })
})

// ════════════════════════════════════════════════════════════════════════
// K4 (validatorrapport frontend) — een NEXT_REDIRECT-throw uit de ECHTE
// deleteTeam laat de "Verwijderen..."-status staan, zonder foutmelding.
// ════════════════════════════════════════════════════════════════════════
describe('K4 — de redirect-tak van deleteTeam wordt genegeerd, geen foutmelding', () => {
  it('na bevestigen blijft "Verwijderen..." staan; deleteFailed verschijnt NIET (de NEXT_REDIRECT-throw is geen echte fout)', async () => {
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
      tables: { teams: [{ id: TEAM_A }] },
    }))
    render(<DictProvider dict={nl}>
      <TeamsSection teams={[{ teamId: TEAM_A, naam: 'FC Alpha' }]} />
    </DictProvider>)

    fireEvent.click(screen.getByText(nl.teamsBeheer.deleteTeam))
    await waitFor(() => expect(screen.getByText(nl.settings.deleteConfirmFinal)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(nl.settings.deleteConfirmPrompt), { target: { value: 'VERWIJDER' } })

    await act(async () => {
      fireEvent.click(screen.getByText(nl.settings.deleteConfirmFinal))
    })

    await waitFor(() => expect(screen.getByText(nl.teamsBeheer.deleting)).toBeInTheDocument())
    expect(screen.queryByText(nl.teamsBeheer.deleteFailed)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC14/31/49 — deleteTeam als owner van TWEE teams: de dertien TEAM_TABELLEN
// van het VERWIJDERDE team zijn leeg, het ANDERE team is volledig intact,
// oefeningen (persoonlijk bezit, BR54) blijven onaangeroerd, en daarna wordt
// `delete from teams where id = teamId` aangeroepen. Direct via de ECHTE
// action, tegen de tabel-engine (§2.5/brief).
// ════════════════════════════════════════════════════════════════════════
describe('AC14/49 — deleteTeam wist exact TEAM_TABELLEN van dat ene team, laat de rest intact', () => {
  function fixture() {
    // `settings` is zelf ook één van de TEAM_TABELLEN (lib/team-opruimen.ts),
    // en moet daarnaast de teamnaam-rijen bevatten die getTeamDeleteInfo/
    // ctx.teams nodig hebben — beide samengevoegd in ÉÉN array, anders
    // overschrijft de generieke tabellenvulling hieronder de teamnaam-rijen
    // (makeSupabase spreidt `tables` NA `settings`).
    const tables: Record<string, Row[]> = {}
    for (const tabel of TEAM_TABELLEN) {
      if (tabel === 'settings') continue
      tables[tabel] = [vulTeamTabellen(TEAM_A, 'a')[tabel], vulTeamTabellen(TEAM_B, 'b')[tabel]]
    }
    tables.teams = [{ id: TEAM_A }, { id: TEAM_B }]
    // Oefeningen zijn persoonlijk bezit (team_id = eigenaar-user, nooit
    // teams.id) en horen door deleteTeam NOOIT geraakt te worden (BR54).
    tables.oefeningen = [{ id: 'oef-1', team_id: OWNER_ID, naam: 'Mijn oefening' }]

    return installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [
        memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_B, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(TEAM_A, ASSISTENT1_ID, 'assistent', GEEN_RECHTEN),
      ],
      settings: [
        { id: 'settings-a', team_id: TEAM_A },
        { id: 'settings-b', team_id: TEAM_B },
        teamNameRow(TEAM_A, 'FC Alpha'),
        teamNameRow(TEAM_B, 'FC Beta'),
      ],
      tables,
    }))
  }

  it('elke TEAM_TABELLEN-tabel verliest precies de rij van TEAM_A, de rij van TEAM_B blijft staan', async () => {
    const m = fixture()
    cookieWaarde = TEAM_B // actief team is NIET het team dat verdwijnt
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')

    for (const tabel of TEAM_TABELLEN) {
      const overgebleven = m.store![tabel]
      expect(overgebleven.some((r) => r.team_id === TEAM_A), `${tabel} bevat nog een TEAM_A-rij`).toBe(false)
      expect(overgebleven.some((r) => r.team_id === TEAM_B), `${tabel} verloor zijn TEAM_B-rij`).toBe(true)
    }
  })

  it('oefeningen (persoonlijk bezit) blijven volledig onaangeroerd', async () => {
    const m = fixture()
    cookieWaarde = TEAM_B
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')
    expect(m.store!.oefeningen).toEqual([{ id: 'oef-1', team_id: OWNER_ID, naam: 'Mijn oefening' }])
  })

  it('daarna wordt `delete from teams where id = TEAM_A` uitgevoerd: TEAM_A verdwijnt uit `teams`, TEAM_B blijft staan', async () => {
    const m = fixture()
    cookieWaarde = TEAM_B
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')
    expect(m.store!.teams.map((r) => r.id)).toEqual([TEAM_B])
  })

  it('het actieve team was TEAM_B (niet verwijderd): de cookie blijft op TEAM_B staan', async () => {
    fixture()
    cookieWaarde = TEAM_B
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')
    expect(cookieSets.at(-1)).toEqual({ naam: ACTIVE_TEAM_COOKIE, value: TEAM_B })
  })

  it('het actieve team WAS het verwijderde team: de cookie schakelt over naar het overgebleven team (AC17/53)', async () => {
    fixture()
    cookieWaarde = TEAM_A
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')
    expect(cookieSets.at(-1)).toEqual({ naam: ACTIVE_TEAM_COOKIE, value: TEAM_B })
  })

  it('getTeamDeleteInfo(TEAM_A) telt precies de assistenten van TEAM_A (1), niet die van TEAM_B', async () => {
    fixture()
    cookieWaarde = TEAM_A
    const info = await getTeamDeleteInfo(TEAM_A)
    expect(info).toEqual({ naam: 'FC Alpha', aantalAssistenten: 1 })
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC31 — een niet-hoofdtrainer (assistent of geen lid) kan een team NIET
// verwijderen; er wordt niets gewist.
// ════════════════════════════════════════════════════════════════════════
describe('AC31 — deleteTeam/getTeamDeleteInfo door een niet-hoofdtrainer: "Geen toegang", niets gewist', () => {
  function fixture() {
    return installSupabase(makeSupabase({
      user: { id: ASSISTENT1_ID },
      members: [memberRow(TEAM_A, ASSISTENT1_ID, 'assistent', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
      tables: {
        teams: [{ id: TEAM_A }],
        players: [{ id: 'p1', team_id: TEAM_A }],
      },
    }))
  }

  it('een assistent (ook met alle zes rechten) krijgt "Geen toegang" van deleteTeam, en de teamdata blijft intact', async () => {
    const m = fixture()
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('Geen toegang')
    expect(m.store!.players).toHaveLength(1)
    expect(m.store!.teams).toHaveLength(1)
  })

  it('een assistent krijgt ook "Geen toegang" van getTeamDeleteInfo (verraadt niet of hij lid is of niet)', async () => {
    fixture()
    await expect(getTeamDeleteInfo(TEAM_A)).rejects.toThrow('Geen toegang')
  })

  it('een NIET-lid krijgt exact dezelfde "Geen toegang" voor een vreemd team', async () => {
    installSupabase(makeSupabase({
      user: { id: NIET_LID_ID },
      members: [memberRow(TEAM_B, NIET_LID_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_B, 'FC Beta')],
    }))
    await expect(deleteTeam(TEAM_A)).rejects.toThrow('Geen toegang')
    await expect(getTeamDeleteInfo(TEAM_A)).rejects.toThrow('Geen toegang')
  })

  it('een ongeldig team-id (geen UUID) geeft ook "Geen toegang" — nooit het actieve team als fallback-doel', async () => {
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
      tables: { teams: [{ id: TEAM_A }] },
    }))
    cookieWaarde = TEAM_A
    // @ts-expect-error - expres een ongeldige/ontbrekende waarde, zoals een
    // gemanipuleerde client-aanroep die zou kunnen sturen.
    await expect(deleteTeam(undefined)).rejects.toThrow('Geen toegang')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Beslissing 8 (goedkeuring brief) — leaveTeam staat een eigen vertrek toe,
// maar weigert een hoofdtrainer (er is geen overdracht van het
// hoofdtrainerschap; dat gaat via deleteTeam).
// ════════════════════════════════════════════════════════════════════════
describe('Beslissing 8 — leaveTeam weigert een hoofdtrainer, slaagt voor een assistent (eigen vertrek)', () => {
  it('een hoofdtrainer die zijn EIGEN team probeert te verlaten krijgt "Geen toegang"; het lidmaatschap blijft bestaan', async () => {
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
    }))
    await expect(leaveTeam(TEAM_A)).rejects.toThrow('Geen toegang')
    expect(m.store!.team_members).toHaveLength(1)
  })

  it('een assistent kan zijn eigen lidmaatschap opzeggen; alleen zijn team_members-rij verdwijnt, de teamdata blijft staan (AC21)', async () => {
    const m = installSupabase(makeSupabase({
      user: { id: ASSISTENT1_ID },
      members: [memberRow(TEAM_A, ASSISTENT1_ID, 'assistent', GEEN_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
      tables: { players: [{ id: 'p1', team_id: TEAM_A }] },
    }))
    await expect(leaveTeam(TEAM_A)).rejects.toThrow('NEXT_REDIRECT:/')
    expect(m.store!.team_members).toHaveLength(0)
    expect(m.store!.players).toHaveLength(1)
  })

  it('een team waar de aanroeper geen lid van is geeft "Team niet gevonden" (verraadt niet of het team bestaat)', async () => {
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM_A, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM_A, 'FC Alpha')],
    }))
    await expect(leaveTeam(VREEMD_TEAM)).rejects.toThrow('Team niet gevonden')
  })
})
