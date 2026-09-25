// Acceptatietests — Assistent-trainers, fase 4: persoonlijke
// oefeningenbibliotheek + kopiëren vanuit een trainingsplan (goedgekeurde
// story v3, brief §2.7/§4.6, beslissingen 2/3/6/10).
//
// Scope van dit bestand (opdracht test-verifier): AC 18, 19, 20, 35, 36, 54,
// BR 54, 55, 56, beslissing 3 (ontkoppelen van andermans oefening).
//
// Aanvulling na validatorrapport frontend (21-validator-fase3-4-frontend.md):
//   B1 — render de ECHTE `TrainingPlanPage` (niet alleen het component) met
//   een gekoppelde oefening waarvan `oefeningen.team_id !== ctx.userId`, zodat
//   het weghalen van `userId={ctx.userId}` in
//   app/events/[id]/training-plan/page.tsx:260 deze suite hard laat falen.
//
// ── Testmethode ──
// Van buitenaf: de ECHTE, geëxporteerde server actions
// (kopieerOefeningNaarBibliotheek, updateOefening, deleteOefening,
// addOefeningToTraining, removeOefeningFromTraining) en de ECHTE componenten/
// pagina's (TrainingPlanEditor, CopyOefeningButton, TrainingPlanPage,
// OefeningenPage) worden gerenderd/aangeroepen tegen een ECHT FILTERENDE
// Supabase-tabel-engine (patroon assistent-fase1-fundament.acceptance
// .test.ts / teamwisselaar.acceptance.test.tsx — .eq/.in/.gt/.lt worden
// daadwerkelijk toegepast, insert/update/delete muteren de onderliggende
// rijenlijst echt). team_id ≠ user.id in elk scenario.
//
// ── Wat hier bewust NIET (opnieuw) getest wordt ──
// - Badge/kopieerknop/potlood-zichtbaarheid als LOS componentgedrag (mét
//   gemockte acties) staat al in components/TrainingPlanEditor.test.tsx
//   ("eigenaarschap van de gekoppelde oefening", 4 tests). Dit bestand bewijst
//   iets anders: dat de ECHTE server action daadwerkelijk een kopie
//   wegschrijft, en dat de ECHTE pagina `userId` doorgeeft (B1).
// - De RLS-laag (of een oefening voor een NIET-teamlid onzichtbaar is) is niet
//   in vitest te bewijzen (brief §5.1): onze tabel-engine kent geen RLS en zou
//   een "onzichtbare maar wel bestaande" oefening altijd teruggeven, ongeacht
//   wat de policy zou doen. Dat deel van AC 20's faalpad ("onzichtbaar")
//   draait daarom uitsluitend via supabase/team-rls-verificatie.sql blok 24;
//   hier wordt alleen het "onbekend" faalpad (id bestaat nergens) bewezen.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'
import OefeningenPage from '@/app/oefeningen/page'
import {
  kopieerOefeningNaarBibliotheek,
  updateOefening,
  deleteOefening,
} from '@/app/actions/oefening-library'
import { addOefeningToTraining, removeOefeningFromTraining } from '@/app/actions/training-plan'
import { ACTIVE_TEAM_COOKIE } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'
import type { OefeningInput } from '@/lib/oefening'

// ────────────────────────────────────────────────
// Generieke, ECHT filterende Supabase-tabel-engine (eigen kopie per bestand,
// project-conventie — geheugen.md "Belangrijke gotchas"). insert/update/
// delete muteren de onderliggende rijenlijst echt, zodat een verkeerd
// team_id/user_id-filter een rij ONAANGEROERD laat in plaats van een test die
// alleen "er was een call" bewijst.
// ────────────────────────────────────────────────
type Row = Record<string, unknown>
let genTeller = 0

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
    chain.gt = (col: string, val: unknown) => { filters.push((r) => (r[col] as number | string) > (val as number | string)); return chain }
    chain.gte = (col: string, val: unknown) => { filters.push((r) => (r[col] as number | string) >= (val as number | string)); return chain }
    chain.lt = (col: string, val: unknown) => { filters.push((r) => (r[col] as number | string) < (val as number | string)); return chain }
    chain.lte = (col: string, val: unknown) => { filters.push((r) => (r[col] as number | string) <= (val as number | string)); return chain }
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: lastInserted[0] ?? resolveRows()[0] ?? null, error: null })
    chain.single = () => Promise.resolve({ data: lastInserted[0] ?? resolveRows()[0] ?? null, error: null })
    chain.insert = (payload: Row | Row[]) => {
      const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        id: (p as Row).id ?? `gen-${genTeller++}`,
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

// Variant UITSLUITEND voor `.from('training_oefeningen').select('*,
// oefeningen(*)')`, zoals de echte trainingsplan-pagina doet
// (app/events/[id]/training-plan/page.tsx:75). De generieke tabel-engine
// hierboven kent geen joins; dit bootst PostgREST' embedded resource na door
// bij elke gematchte rij de bijbehorende `oefeningen`-rij (op `oefening_id`)
// erbij te zetten. Alleen gebruikt in het B1-scenario (de ECHTE pagina).
function realTrainingOefeningenMetOefeningJoin(rows: Row[], oefeningenRows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain }
    chain.order = () => chain
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const matched = rows.filter((r) => filters.every((f) => f(r)))
      const embedded = matched.map((r) => ({
        ...r,
        oefeningen: oefeningenRows.find((o) => o.id === r.oefening_id) ?? null,
      }))
      return resolve({ data: embedded, error: null })
    }
    return chain
  }
}

function makeSupabase(opts: {
  user: { id: string } | null
  members: Row[]
  settings?: Row[]
  tables?: Record<string, Row[]>
  joinTrainingOefeningen?: boolean
}) {
  const store: Record<string, Row[]> = {
    team_members: opts.members,
    settings: opts.settings ?? [],
    ...(opts.tables ?? {}),
  }
  return {
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from: (t: string) => {
      if (!store[t]) store[t] = []
      if (opts.joinTrainingOefeningen && t === 'training_oefeningen') {
        if (!store.oefeningen) store.oefeningen = []
        return realTrainingOefeningenMetOefeningJoin(store[t], store.oefeningen)()
      }
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

beforeEach(() => {
  vi.clearAllMocks()
  genTeller = 0
  cookieWaarde = undefined
  cookieSets = []
  vi.mocked(cookies).mockResolvedValue({
    get: (naam: string) => (naam === ACTIVE_TEAM_COOKIE && cookieWaarde !== undefined ? { value: cookieWaarde } : undefined),
    set: (naam: string, value: string) => { cookieSets.push({ naam, value }) },
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

// team_id EXPLICIET los van elk user-id (validatorpunt 8, herhaald in fase 4).
const TEAM = '11111111-1111-4111-8111-111111111111'
const ANDER_TEAM = '22222222-2222-4222-8222-222222222222'
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ASSISTENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OEFENING_ONBEKEND = '99999999-9999-4999-8999-999999999999'

function oefeningRij(overrides: Partial<Row> = {}): Row {
  return {
    id: 'o1',
    team_id: ASSISTENT_ID,
    naam: 'Rondo 4v2',
    beschrijving: 'Positiespel in vak',
    categorie: 'positiespel',
    duur_min: 10,
    breedte_m: 20,
    lengte_m: 20,
    orientatie: 'vrij',
    veldzone: null,
    teams: [{ grootte: 6, formaties: [] }],
    aantal_neutralen: 2,
    aantal_neutralen_max: null,
    diagram: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeKoppeling(oefening: Oefening, overrides: Partial<TrainingOefeningWithData> = {}): TrainingOefeningMetBezetting {
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: TEAM,
    event_id: 'e1',
    oefening_id: oefening.id,
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2026-01-01T00:00:00.000Z',
    oefeningen: oefening,
    ...overrides,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

function renderPlan(koppelingen: TrainingOefeningMetBezetting[], userId: string) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1" initialDoelstelling={null} initialOefeningen={koppelingen} library={[]} currentSteps={{}}
        hasNulmeting={false} suggestion={null} players={[]} presentPlayerIds={[]} startTijd={null}
        kopieerOpties={[]} initialTrainingstype="vct" canEdit={true} userId={userId}
      />
    </DictProvider>,
  )
}

// ════════════════════════════════════════════════════════════════════════
// AC19/AC35 — badge "Van een teamgenoot", kopieerknop en het ONTBREKEN van
// de bewerkknop, gerenderd via het ECHTE TrainingPlanEditor-component.
// ════════════════════════════════════════════════════════════════════════
describe('AC19/35 — TrainingPlanEditor: badge + kopieerknop bij andermans oefening, geen bewerkknop', () => {
  it('oefening van een teamgenoot (team_id !== userId): badge + "Kopiëren naar mijn bibliotheek" zichtbaar, bewerkpotlood NIET zichtbaar', () => {
    const oefening = oefeningRij({ id: 'o-teamgenoot', team_id: ASSISTENT_ID, naam: 'Rondo teamgenoot' }) as unknown as Oefening
    renderPlan([makeKoppeling(oefening)], OWNER_ID)

    expect(screen.getByText(nl.oefeningen.fromTeammate)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary })).toBeInTheDocument()
    expect(screen.queryByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo teamgenoot'))).toBeNull()
  })

  it('eigen oefening (team_id === userId): geen badge, geen kopieerknop, bewerkpotlood WEL zichtbaar', () => {
    const oefening = oefeningRij({ id: 'o-eigen', team_id: OWNER_ID, naam: 'Rondo eigen' }) as unknown as Oefening
    renderPlan([makeKoppeling(oefening)], OWNER_ID)

    expect(screen.queryByText(nl.oefeningen.fromTeammate)).toBeNull()
    expect(screen.queryByRole('button', { name: nl.oefeningen.copyToLibrary })).toBeNull()
    expect(screen.getByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo eigen'))).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// B1 (validatorrapport frontend, 21-validator-fase3-4-frontend.md) — niets in
// de bestaande suite bewaakte dat de ECHTE trainingsplan-pagina `userId`
// doorgeeft. Dit rendert de pagina zelf (niet alleen het component): haalt
// iemand `userId={ctx.userId}` weg uit
// app/events/[id]/training-plan/page.tsx:260, dan valt TrainingPlanEditor
// terug op "alles is eigen" en faalt deze test hard (badge/knop verdwijnen,
// het potlood verschijnt alsnog op andermans oefening).
// ════════════════════════════════════════════════════════════════════════
describe('B1 — de ECHTE TrainingPlanPage geeft ctx.userId door (AC 19/35)', () => {
  it('een gekoppelde oefening van een teamgenoot toont badge + kopieerknop en geen bewerkpotlood, via de volledige serverpagina', async () => {
    const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const koppelingId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const oefeningId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      joinTrainingOefeningen: true,
      tables: {
        events: [{ id: eventId, team_id: TEAM, type: 'training', date: '2026-09-24', time: null, doelstelling: null, trainingstype: 'vct' }],
        players: [],
        attendance: [],
        categorie_metingen: [],
        oefeningen: [oefeningRij({ id: oefeningId, team_id: ASSISTENT_ID, naam: 'Rondo teamgenoot (pagina)' })],
        training_oefeningen: [{
          id: koppelingId, team_id: TEAM, event_id: eventId, oefening_id: oefeningId,
          volgorde: 0, stap_override: null, genest_in: null, spelerindeling: [], created_at: '2026-01-01T00:00:00.000Z',
        }],
      },
    }))

    const el = await TrainingPlanPage({ params: Promise.resolve({ id: eventId }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)

    expect(screen.getByText(nl.oefeningen.fromTeammate)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary })).toBeInTheDocument()
    expect(screen.queryByLabelText(nl.oefeningen.editAriaNamed.replace('{name}', 'Rondo teamgenoot (pagina)'))).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC20 — een klik op de ECHTE kopieerknop roept de ECHTE server action aan en
// schrijft een echte, nieuwe rij weg (component + actie + tabel-engine).
// ════════════════════════════════════════════════════════════════════════
describe('AC20 — klik op "Kopiëren naar mijn bibliotheek" maakt echt een kopie aan', () => {
  const OEFENING_TEAMGENOOT = 'e1111111-1111-4111-8111-111111111111'

  it('CopyOefeningButton → kopieerOefeningNaarBibliotheek (ongemockt) → nieuwe rij in oefeningen met team_id = OWNER_ID', async () => {
    const oefening = oefeningRij({ id: OEFENING_TEAMGENOOT, team_id: ASSISTENT_ID, naam: 'Rondo teamgenoot' })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: { oefeningen: [oefening] },
    }))

    renderPlan([makeKoppeling(oefening as unknown as Oefening)], OWNER_ID)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.oefeningen.copyToLibrary }))
    })
    await waitFor(() => expect(screen.getByText(nl.oefeningen.copied)).toBeInTheDocument())

    const kopieën = m.store!.oefeningen.filter((r) => r.team_id === OWNER_ID)
    expect(kopieën).toHaveLength(1)
    expect(kopieën[0]).toMatchObject({ naam: 'Rondo teamgenoot', categorie: 'positiespel', duur_min: 10 })
    expect(kopieën[0].id).not.toBe(OEFENING_TEAMGENOOT)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC20/BR56/beslissing 10 — kopieerOefeningNaarBibliotheek rechtstreeks: geen
// rechtencheck nodig, onafhankelijke kopie, onbekende oefening geweigerd.
// ════════════════════════════════════════════════════════════════════════
describe('AC20/BR56 — kopieerOefeningNaarBibliotheek (directe actie-aanroep, tabel-engine)', () => {
  const OEFENING_BRON = 'f1111111-1111-4111-8111-111111111111'

  function setup(rechten: Partial<TeamRechten>) {
    const bron = oefeningRij({ id: OEFENING_BRON, team_id: ASSISTENT_ID, naam: 'Origineel' })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'assistent', rechten)],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: { oefeningen: [bron] },
    }))
    return { m, bron }
  }

  it('AC20 — kopiëren SLAAGT zonder enig Training-bewerkrecht (geen recht-check, elk teamlid dat het plan mag lezen mag kopiëren)', async () => {
    const { m } = setup(GEEN_RECHTEN)
    const { id } = await kopieerOefeningNaarBibliotheek(OEFENING_BRON)
    const kopie = m.store!.oefeningen.find((r) => r.id === id)
    expect(kopie).toMatchObject({ team_id: OWNER_ID, naam: 'Origineel' })
  })

  it('BR56 — beslissing 10: de kopie heeft LETTERLIJK dezelfde naam en inhoud, een nieuw id, en team_id = de kopiërende gebruiker (nooit ctx.teamId)', async () => {
    const { m } = setup(GEEN_RECHTEN)
    const { id } = await kopieerOefeningNaarBibliotheek(OEFENING_BRON)
    const kopie = m.store!.oefeningen.find((r) => r.id === id)!
    expect(kopie.id).not.toBe(OEFENING_BRON)
    expect(kopie.team_id).toBe(OWNER_ID)
    expect(kopie.team_id).not.toBe(TEAM)
    expect(kopie).toMatchObject({
      naam: 'Origineel', beschrijving: 'Positiespel in vak', categorie: 'positiespel', duur_min: 10,
      breedte_m: 20, lengte_m: 20, orientatie: 'vrij', aantal_neutralen: 2,
    })
  })

  it('BR56 — een latere wijziging aan het ORIGINEEL raakt de kopie niet (volledig onafhankelijke rijen)', async () => {
    const { m } = setup(GEEN_RECHTEN)
    const { id: kopieId } = await kopieerOefeningNaarBibliotheek(OEFENING_BRON)

    // Het origineel wordt na het kopiëren gewijzigd (rechtstreeks in de
    // fixture-store, zoals de eigenaar dat via updateOefening zou doen).
    const origineel = m.store!.oefeningen.find((r) => r.id === OEFENING_BRON)!
    origineel.naam = 'Origineel, later hernoemd'
    origineel.duur_min = 99

    const kopie = m.store!.oefeningen.find((r) => r.id === kopieId)!
    expect(kopie.naam).toBe('Origineel')
    expect(kopie.duur_min).toBe(10)
  })

  it('faalpad — een ONBEKENDE oefening-id (bestaat nergens) geeft "Oefening niet gevonden"', async () => {
    const { m } = setup(GEEN_RECHTEN)
    await expect(kopieerOefeningNaarBibliotheek(OEFENING_ONBEKEND)).rejects.toThrow('Oefening niet gevonden')
    expect(m.store!.oefeningen).toHaveLength(1) // niets bijgeschreven
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC35/BR55 — alleen de eigenaar mag een oefening bewerken of verwijderen,
// ook niet de hoofdtrainer van het team waarin ze gekoppeld staat.
// ════════════════════════════════════════════════════════════════════════
describe('AC35 — updateOefening/deleteOefening op andermans oefening: geweigerd, ook als team-owner', () => {
  function setupAlsOwner() {
    const oefening = oefeningRij({ id: 'o-assistent', team_id: ASSISTENT_ID, naam: 'Van de assistent' })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'owner', ALLE_RECHTEN)],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: { oefeningen: [oefening], training_oefeningen: [] },
    }))
    return m
  }

  const input: OefeningInput = { naam: 'Gemanipuleerd', categorie: 'overig', teams: [], aantal_neutralen: 0 }

  it('updateOefening geweigerd: "Oefening niet gevonden", de rij blijft ongewijzigd', async () => {
    const m = setupAlsOwner()
    await expect(updateOefening('o-assistent', input)).rejects.toThrow('Oefening niet gevonden')
    const rij = m.store!.oefeningen.find((r) => r.id === 'o-assistent')!
    expect(rij.naam).toBe('Van de assistent')
  })

  it('deleteOefening geweigerd: "Oefening niet gevonden", de rij blijft bestaan', async () => {
    const m = setupAlsOwner()
    await expect(deleteOefening('o-assistent')).rejects.toThrow('Oefening niet gevonden')
    expect(m.store!.oefeningen.some((r) => r.id === 'o-assistent')).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC36 — koppelen aan een trainingsplan zonder Training-bewerkrecht wordt
// geweigerd; ook met recht blijft koppelen beperkt tot EIGEN oefeningen
// (BR54/55 — het Training-recht regelt alleen het koppelen, niet het
// eigenaarschap).
// ════════════════════════════════════════════════════════════════════════
describe('AC36 — addOefeningToTraining: geweigerd zonder Training-recht, en geweigerd bij andermans oefening', () => {
  const EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

  it('zonder Training-bewerkrecht: "Geen toegang", geen enkele koppeling geschreven', async () => {
    const eigenOefening = oefeningRij({ id: 'o-eigen', team_id: OWNER_ID })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'assistent', { training: false })],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: {
        events: [{ id: EVENT, team_id: TEAM, type: 'training' }],
        oefeningen: [eigenOefening],
        training_oefeningen: [],
      },
    }))
    await expect(addOefeningToTraining(EVENT, 'o-eigen')).rejects.toThrow('Geen toegang')
    expect(m.store!.training_oefeningen).toHaveLength(0)
  })

  it('MET Training-recht, maar de oefening is van een teamgenoot: "Oefening niet gevonden" (de lookup filtert op ctx.userId, BR54/55)', async () => {
    const vreemdeOefening = oefeningRij({ id: 'o-teamgenoot', team_id: ASSISTENT_ID })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'assistent', { training: true })],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: {
        events: [{ id: EVENT, team_id: TEAM, type: 'training' }],
        oefeningen: [vreemdeOefening],
        training_oefeningen: [],
      },
    }))
    await expect(addOefeningToTraining(EVENT, 'o-teamgenoot')).rejects.toThrow('Oefening niet gevonden')
    expect(m.store!.training_oefeningen).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC18/54 — de eigen bibliotheek is persoonlijk bezit: /oefeningen toont
// uitsluitend eigen oefeningen, ongeacht welk team actief is.
// ════════════════════════════════════════════════════════════════════════
describe('AC18/54 — /oefeningen toont uitsluitend eigen oefeningen, ongeacht het actieve team', () => {
  it('dezelfde gebruiker, twee lidmaatschappen: de bibliotheek is op beide teams identiek en bevat nooit andermans oefeningen', async () => {
    const eigenOefening = oefeningRij({ id: 'o-eigen', team_id: OWNER_ID, naam: 'Mijn eigen oefening' })
    const anderMansOefening = oefeningRij({ id: 'o-teamgenoot', team_id: ASSISTENT_ID, naam: 'Niet van mij' })
    installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [
        memberRow(TEAM, OWNER_ID, 'owner', ALLE_RECHTEN),
        memberRow(ANDER_TEAM, OWNER_ID, 'assistent', GEEN_RECHTEN),
      ],
      settings: [teamNameRow(TEAM, 'JO13-1'), teamNameRow(ANDER_TEAM, 'JO15-1')],
      tables: { oefeningen: [eigenOefening, anderMansOefening], training_oefeningen: [] },
    }))

    cookieWaarde = TEAM
    const opTeamA = await OefeningenPage()
    const { unmount } = render(<DictProvider dict={nl}>{opTeamA}</DictProvider>)
    expect(screen.getByText('Mijn eigen oefening')).toBeInTheDocument()
    expect(screen.queryByText('Niet van mij')).toBeNull()
    unmount()

    cookieWaarde = ANDER_TEAM
    const opTeamB = await OefeningenPage()
    render(<DictProvider dict={nl}>{opTeamB}</DictProvider>)
    expect(screen.getByText('Mijn eigen oefening')).toBeInTheDocument()
    expect(screen.queryByText('Niet van mij')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Beslissing 3 (goedkeuring brief) — ontkoppelen van andermans gekoppelde
// oefening valt onder het Training-bewerkrecht, niet onder eigenaarschap.
// ════════════════════════════════════════════════════════════════════════
describe('Beslissing 3 — ontkoppelen van andermans oefening slaagt met Training-recht', () => {
  it('removeOefeningFromTraining verwijdert de koppeling, ook al is de oefening van een teamgenoot', async () => {
    const EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const KOPPELING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const vreemdeOefening = oefeningRij({ id: 'o-teamgenoot', team_id: ASSISTENT_ID })
    const m = installSupabase(makeSupabase({
      user: { id: OWNER_ID },
      members: [memberRow(TEAM, OWNER_ID, 'assistent', { training: true })],
      settings: [teamNameRow(TEAM, 'JO13-1')],
      tables: {
        events: [{ id: EVENT, team_id: TEAM, type: 'training' }],
        oefeningen: [vreemdeOefening],
        training_oefeningen: [{
          id: KOPPELING, team_id: TEAM, event_id: EVENT, oefening_id: 'o-teamgenoot',
          volgorde: 0, stap_override: null, genest_in: null, parallel_groep_id: null,
        }],
      },
    }))

    await removeOefeningFromTraining(KOPPELING, EVENT)
    expect(m.store!.training_oefeningen).toHaveLength(0)
  })
})
