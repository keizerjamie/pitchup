// Acceptatietests — "Delen als PDF" (client-kant, jsdom). Gedrag van buitenaf:
// de echte knop op de vier schermen, met gemockte netwerkrand (fetch naar
// /api/pdf) en gemockte navigator.share. De server-kant staat in
// delen-als-pdf-route.acceptance.test.ts (andere testomgeving: node).
//
// ── AC → test-mapping (AC-nummers = acceptatiecriteria 1-16 uit de story) ──
//   AC1  → describe('AC1 — ...')                 vier schermen: tik -> fetch + deelmenu met PDF
//   AC2  → NIET te dekken (echt iOS-deelmenu); wel: share() krijgt een echt File-object
//   AC3  → server-kant (route-bestand) + hier: juiste doel/id/periode per scherm
//   AC4  → describe('AC4 — ...')
//   AC5  → describe('AC5 — ...')
//   AC6  → describe('AC6 — ...')
//   AC7  → describe('AC7 — ...') (client) + route-bestand (server)
//   AC8  → describe('AC8 — ...')
//   AC9  → describe('AC9 — ...') (client) + route-bestand (429)
//   AC10 → describe('AC10 — ...') (client) + route-bestand (401)
//   AC11 → describe('AC11 — ...')
//   AC12 → route-bestand
//   AC13 → describe('AC13 — ...') (client) + route-bestand
//   AC14 → describe('AC14 — ...')
//   AC15 → describe('AC15 — ...') (client) + route-bestand (timezoneId)
//   AC16 → describe('AC16 — ...') (client) + route-bestand
//   Besluit 2 (opgeslagen stand: eerst wachten op opslag) → de drie
//   'delen wacht op de opslag'-blokken onderaan.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import { concretiseerBezetting } from '@/lib/oefening-bezetting'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
  vormParallelGroep: vi.fn().mockResolvedValue({ groepId: 'g-new' }),
  voegToeAanParallelGroep: vi.fn().mockResolvedValue(undefined),
  haalUitParallelGroep: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/oefening-library', () => ({
  createOefening: vi.fn(),
  updateOefening: vi.fn().mockResolvedValue(undefined),
  deleteOefening: vi.fn(),
}))
vi.mock('@/app/actions/events', () => ({
  createEvent: vi.fn(),
  updateTrainingstype: vi.fn().mockResolvedValue(undefined),
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/match-squad', () => ({
  toggleSquadPlayer: vi.fn().mockResolvedValue(undefined),
}))
// Randen voor het renderen van de echte server-pagina's (trainingsplan, inzichten).
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import PrintButton from '@/components/PrintButton'
import { saveDoelstelling, updateKoppeling } from '@/app/actions/training-plan'
import { toggleSquadPlayer } from '@/app/actions/match-squad'
import { createClient } from '@/lib/supabase/server'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'
import InzichtenPage from '@/app/inzichten/page'
import AanwezigheidsOverzicht, { type OverzichtStaat } from '@/components/players/AanwezigheidsOverzicht'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'

const mockSaveDoelstelling = saveDoelstelling as unknown as ReturnType<typeof vi.fn>
const mockUpdateKoppeling = updateKoppeling as unknown as ReturnType<typeof vi.fn>
const mockToggle = toggleSquadPlayer as unknown as ReturnType<typeof vi.fn>

let share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveDoelstelling.mockResolvedValue(undefined)
  mockUpdateKoppeling.mockResolvedValue(undefined)
  mockToggle.mockResolvedValue(undefined)
  // Touch-toestel dat bestanden kan delen -> delen-modus.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: coarse'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true })
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue({
    ok: true,
    status: 200,
    type: 'basic',
    headers: new Headers({ 'content-type': 'application/pdf' }),
    blob: async () => new Blob(['%PDF-1.7']),
  } as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'share')
  Reflect.deleteProperty(window.navigator, 'canShare')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderPlan(withKoppeling = false) {
  const oefening = {
    id: 'o1', team_id: 'team1', naam: 'Rondo', beschrijving: null, categorie: 'partijen_klein', duur_min: 10,
    breedte_m: null, lengte_m: null, orientatie: 'vrij', veldzone: null, teams: [], aantal_neutralen: 0,
    diagram: null, created_at: '2024-01-01T00:00:00Z',
  } as never
  const koppeling = {
    id: 'k1', team_id: 'team1', event_id: 'e1', oefening_id: 'o1', volgorde: 0, stap_override: null,
    genest_in: null, spelerindeling: [], duur_min: 10, created_at: '2024-01-01T00:00:00Z', oefeningen: oefening,
  } as never
  const k = withKoppeling ? [{ ...(koppeling as object), bezetting: concretiseerBezetting(oefening, null) }] : []
  return render(
    <DictProvider dict={nl}>
      <PrintButton pdf={{ doel: 'trainingsplan', eventId: 'e1', datum: '2026-10-28' }} />
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={k as never}
        library={[]}
        currentSteps={{}}
        hasNulmeting={true}
        suggestion={null}
        players={[] as Player[]}
        presentPlayerIds={[]}
        startTijd={null}
        kopieerOpties={[]}
        initialTrainingstype="vct"
        userId="team1"
      />
    </DictProvider>,
  )
}

describe('trainingsplan: delen wacht op de opslag', () => {
  it('doelstelling typen en meteen delen: saveDoelstelling direct (zonder 1000 ms) en vóór de fetch', async () => {
    renderPlan()
    fireEvent.change(document.getElementById('trainingsplan-doelstelling') as HTMLTextAreaElement, {
      target: { value: 'Opbouwen van achteruit' },
    })
    expect(mockSaveDoelstelling).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mockSaveDoelstelling).toHaveBeenCalledWith('e1', 'Opbouwen van achteruit')
    expect(mockSaveDoelstelling.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    // De debounce is leeggemaakt: na 1000 ms volgt geen tweede opslag.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(mockSaveDoelstelling).toHaveBeenCalledTimes(1)
  })

  it('een lopende opslag wordt afgewacht: fetch volgt pas na de resolve', async () => {
    let klaar!: () => void
    mockSaveDoelstelling.mockReturnValue(new Promise<void>((res) => { klaar = res }))
    renderPlan()
    fireEvent.change(document.getElementById('trainingsplan-doelstelling') as HTMLTextAreaElement, {
      target: { value: 'Pressing' },
    })
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
    await waitFor(() => expect(mockSaveDoelstelling).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { klaar() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('duur die nog in de 500 ms-debounce staat wordt eerst opgeslagen', async () => {
    renderPlan(true)
    const duur = screen.getAllByRole('spinbutton').find((el) => (el as HTMLInputElement).value === '10') as HTMLInputElement
    fireEvent.change(duur, { target: { value: '25' } })
    expect(mockUpdateKoppeling).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mockUpdateKoppeling).toHaveBeenCalledWith('k1', 'e1', { duur_min: 25 })
    expect(mockUpdateKoppeling.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0])
  })
})

describe('wedstrijdselectie: delen wacht op de opslag', () => {
  function renderSquad() {
    const players = [{
      id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9,
      active: true, injured: false, type: 'regular', rating: 5, created_at: '2024-01-01T00:00:00Z',
    }] as unknown as Player[]
    return render(
      <DictProvider dict={nl}>
        <MatchSquadEditor
          eventId="e1"
          players={players}
          initialSelectedIds={[]}
          presentPlayerIds={['p1']}
          hasAnyActivePlayers={true}
          opponent="FC Rivalen"
          eventDate="2026-08-09"
          dateLabel="zondag 9 augustus 2026"
          teamName={null}
          teamLogoUrl={null}
          homeAway={null}
          kickoffTime={null}
          location={null}
          initialGatherTime={null}
          formItems={[]}
          primaryColor="#004f3b"
          secondaryColor="#009966"
          canEdit={true}
        />
      </DictProvider>,
    )
  }

  it('een toggle met een openstaande toggleSquadPlayer: fetch volgt pas na de resolve; doel en datum kloppen', async () => {
    let klaar!: () => void
    mockToggle.mockReturnValue(new Promise<void>((res) => { klaar = res }))
    renderSquad()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` }))
    })
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', true)

    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => { klaar() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const params = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams
    expect(params.get('doel')).toBe('selectie')
    expect(params.get('id')).toBe('e1')
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect((share.mock.calls[0][0].files?.[0] as File).name).toBe('Wedstrijdselectie 09-08-2026.pdf')
  })

  it('zonder geselecteerde spelers blijft de knop uitgeschakeld (geen fetch)', () => {
    renderSquad()
    const knop = screen.getByRole('button', { name: nl.trainingPlan.share })
    expect(knop).toBeDisabled()
    fireEvent.click(knop)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Hulpfuncties voor de AC-blokken hieronder
// ═══════════════════════════════════════════════════════════════════════

type PdfResponseOver = Partial<{ ok: boolean; status: number; type: string; contentType: string; blob: () => Promise<Blob> }>
function pdfResponse(over: PdfResponseOver = {}): Response {
  return {
    ok: over.ok ?? true,
    status: over.status ?? 200,
    type: over.type ?? 'basic',
    headers: new Headers({ 'content-type': over.contentType ?? 'application/pdf' }),
    blob: over.blob ?? (async () => new Blob(['%PDF-1.7 inhoud'])),
  } as unknown as Response
}

function zetToestel(o: { touch?: boolean; standalone?: boolean; canShare?: boolean }) {
  const { touch = true, standalone = false, canShare = true } = o
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: touch && query.includes('pointer: coarse'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(window.navigator, 'standalone', { value: standalone, configurable: true })
  // standalone telt alleen op een iOS-toestel (een Dock-app op macOS zet het ook).
  if (standalone) Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', configurable: true })
  else Reflect.deleteProperty(window.navigator, 'userAgent')
  if (canShare) Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true })
  else Reflect.deleteProperty(window.navigator, 'canShare')
}

function stubPrint() {
  const spy = vi.fn()
  Object.defineProperty(window, 'print', { value: spy, writable: true, configurable: true })
  return spy
}

// Computer: de knop opent synchroon een leeg tabblad en zet daar na de fetch de
// blob-URL van de server-PDF in. jsdom kent createObjectURL niet, dus stubben.
type NepTabblad = { closed: boolean; close: ReturnType<typeof vi.fn>; location: { href: string } }
function stubTabblad(o: { geblokkeerd?: boolean } = {}) {
  const tab: NepTabblad = { closed: false, close: vi.fn(), location: { href: '' } }
  const open = vi.fn(() => (o.geblokkeerd ? null : tab))
  Object.defineProperty(window, 'open', { value: open, writable: true, configurable: true })
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:pitchup-pdf'), writable: true, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true, configurable: true })
  return { open, tab }
}

const deelKnop = () => screen.getByRole('button', { name: nl.trainingPlan.share })

// Wat navigator.share() ontving: precies één PDF-bestand, zonder title/text.
function gedeeldBestand(): File {
  expect(share).toHaveBeenCalledTimes(1)
  const data = share.mock.calls[0][0]
  expect(Object.keys(data)).toEqual(['files'])
  expect(data.files).toHaveLength(1)
  const bestand = data.files![0] as File
  expect(bestand).toBeInstanceOf(File)
  expect(bestand.type).toBe('application/pdf')
  expect(bestand.size).toBeGreaterThan(0)
  return bestand
}

function fetchParams(): URLSearchParams {
  return new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams
}

function fetchPad(): string {
  return new URL(fetchMock.mock.calls[0][0], 'http://localhost').pathname
}

function abortFout() { return Object.assign(new Error('x'), { name: 'AbortError' }) }

// ── Supabase-mock voor de echte server-pagina's ──
function teamMembersChain(userId: string | undefined, rol = 'owner') {
  const rows = userId ? [{ team_id: userId, user_id: userId, rol }] : []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) chain[op] = () => chain
  chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length })
  return chain
}
function tableChain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'eq', 'is', 'not']) c[m] = () => c
  c.single = () => Promise.resolve(result)
  c.maybeSingle = () => Promise.resolve(result)
  ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
  return c
}
function mockSupabase(tables: Record<string, unknown[]>, user: { id: string } | null = { id: 'team-1' }, rpcData: unknown = []) {
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => (t === 'team_members' ? teamMembersChain(user?.id) : tableChain({ data: tables[t] ?? [] })),
    rpc: (naam: string) =>
      Promise.resolve({ data: naam === 'inzichten_aanwezigheid' ? [{ aanwezig: 3, afwezig: 1 }] : rpcData, error: null }),
    auth: { getUser: async () => ({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>)
}

async function renderTrainingPage() {
  const event = { id: 'e1', team_id: 'team-1', type: 'training', date: '2026-10-28', doelstelling: null }
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => (t === 'team_members' ? teamMembersChain('team-1') : tableChain(t === 'events' ? { data: event } : { data: [] })),
    auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>)
  const el = await TrainingPlanPage({ params: Promise.resolve({ id: 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

async function renderInzichtenPage(periode?: string) {
  mockSupabase({
    settings: [
      { team_id: 'team-1', key: 'season_start', value: '2026-08-01' },
      { team_id: 'team-1', key: 'season_end', value: '2027-06-30' },
    ],
  })
  const el = periode === undefined ? await InzichtenPage() : await InzichtenPage({ searchParams: Promise.resolve({ periode }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

const OVERZICHT_RIJ = { playerId: 'p1', naam: 'Piet Peters', aanwezig: 3, afwezig: 1, geblesseerd: 0, pctIncl: 75, pctZonder: 75 }
function renderAanwezigheid(staat: OverzichtStaat, dict = nl) {
  return render(
    <DictProvider dict={dict}>
      <AanwezigheidsOverzicht staat={staat} t={dict} />
    </DictProvider>,
  )
}

function renderSquadEditor(o: { selected?: string[]; canEdit?: boolean; dict?: typeof nl } = {}) {
  const players = [{
    id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9,
    active: true, injured: false, type: 'regular', rating: 5, created_at: '2024-01-01T00:00:00Z',
  }] as unknown as Player[]
  return render(
    <DictProvider dict={o.dict ?? nl}>
      <MatchSquadEditor
        eventId="e1" players={players} initialSelectedIds={o.selected ?? ['p1']} presentPlayerIds={['p1']}
        hasAnyActivePlayers={true} opponent="FC Rivalen" eventDate="2026-08-09" dateLabel="zondag 9 augustus 2026"
        teamName={null} teamLogoUrl={null} homeAway={null} kickoffTime={null} location={null} initialGatherTime={null}
        formItems={[]} primaryColor="#004f3b" secondaryColor="#009966" canEdit={o.canEdit ?? true}
      />
    </DictProvider>,
  )
}

const OORSPRONKELIJKE_TZ = process.env.TZ
afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'standalone')
  if (OORSPRONKELIJKE_TZ === undefined) delete process.env.TZ
  else process.env.TZ = OORSPRONKELIJKE_TZ
})

// ═══════════════════════════════════════════════════════════════════════
// AC1 (+ AC3-query, AC5-bestandsnaam, AC2-bestandsobject) — vier schermen
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — op elk van de vier schermen opent een tik het deelmenu met een PDF als bijlage', () => {
  it('trainingsplan (echte pagina): tik -> GET /api/pdf?doel=trainingsplan&id=… -> share({files:[pdf]}); AC5: "Trainingsplan 28-10-2026.pdf"', async () => {
    await renderTrainingPage()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetchPad()).toBe('/api/pdf')
    const p = fetchParams()
    expect(p.get('doel')).toBe('trainingsplan')
    expect(p.get('id')).toBe('e1')
    expect(p.has('periode')).toBe(false)
    expect(p.get('tz')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(gedeeldBestand().name).toBe('Trainingsplan 28-10-2026.pdf')
  })

  it('wedstrijdselectie: doel=selectie; AC5: "Wedstrijdselectie 09-08-2026.pdf" (wedstrijddatum)', async () => {
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const p = fetchParams()
    expect(p.get('doel')).toBe('selectie')
    expect(p.get('id')).toBe('e1')
    expect(p.has('periode')).toBe(false)
    expect(gedeeldBestand().name).toBe('Wedstrijdselectie 09-08-2026.pdf')
  })

  it('aanwezigheidsoverzicht: doel=aanwezigheid&periode=8w; AC5: datum van vandaag op het toestel', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0))
    renderAanwezigheid({ soort: 'data', periode: '8w', rijen: [OVERZICHT_RIJ] })
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const p = fetchParams()
    expect(p.get('doel')).toBe('aanwezigheid')
    expect(p.get('periode')).toBe('8w')
    expect(p.has('id')).toBe(false)
    expect(gedeeldBestand().name).toBe('Aanwezigheid 25-10-2026.pdf')
  })

  it('inzichten (echte pagina): doel=inzichten&periode=4w; AC5: "Seizoensrapport <vandaag>.pdf"', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0))
    await renderInzichtenPage('4w')
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const p = fetchParams()
    expect(p.get('doel')).toBe('inzichten')
    expect(p.get('periode')).toBe('4w')
    expect(p.has('id')).toBe(false)
    expect(gedeeldBestand().name).toBe('Seizoensrapport 25-10-2026.pdf')
  })

  it('inzichten zonder ?periode= geeft de standaardperiode (seizoen) door', async () => {
    await renderInzichtenPage()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetchParams().get('periode')).toBe('seizoen')
  })

  it('de PDF-bytes van de server zijn de inhoud van het gedeelde bestand (AC2: bestandsobject, niet het echte iOS-menu)', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ blob: async () => new Blob(['%PDF-1.7 abc']) }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const inhoud = await new Promise<string>((res) => {
      const lezer = new FileReader()
      lezer.onload = () => res(String(lezer.result))
      lezer.readAsText(gedeeldBestand())
    })
    expect(inhoud).toBe('%PDF-1.7 abc')
  })

  it('het fetch-verzoek is een same-origin leesverzoek (cookies mee, geen body) ', async () => {
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const init = fetchMock.mock.calls[0][1]
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(fetchMock.mock.calls[0][0].startsWith('/api/pdf?')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 + AC8 — iOS-beginscherm-app en toestellen zonder bestand-delen
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — in de iOS-beginscherm-app verschijnt de "Link kopiëren"-melding niet meer (mits bestanden delen kan)', () => {
  it('standalone + canShare: knop "Delen", tik deelt de PDF en toont geen link-melding', async () => {
    zetToestel({ touch: false, standalone: true, canShare: true })
    renderSquadEditor()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).toBeNull()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(nl.trainingPlan.printStandaloneHint)).toBeNull()
  })
})

describe('AC8 — toestel kan geen bestanden delen: fallback, nooit stil falen', () => {
  it('iOS-beginscherm-app zonder canShare: bestaande "Link kopiëren"-melding als noodroute (besluit 6/8)', () => {
    zetToestel({ touch: true, standalone: true, canShare: false })
    renderSquadEditor()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(nl.trainingPlan.printStandaloneHint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.trainingPlan.printCopyLink })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })

  it('touch-toestel zonder canShare (niet-beginscherm): server-PDF in een nieuw tabblad', async () => {
    zetToestel({ touch: true, standalone: false, canShare: false })
    const print = stubPrint()
    const { open, tab } = stubTabblad()
    renderSquadEditor()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(print).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })

  it('share() faalt met een onverwachte fout: zichtbare vaste melding (niet stil)', async () => {
    share.mockRejectedValue(Object.assign(new Error('geheime-interne-fout'), { name: 'DataError' }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.shareFailed)
    expect(alert.textContent).not.toContain('geheime-interne-fout')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6 — deelmenu annuleren
// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — deelmenu annuleren: geen foutmelding, scherm ongewijzigd', () => {
  it('AbortError van share(): geen alert/status, knop weer "Delen" en direct opnieuw bruikbaar', async () => {
    share.mockRejectedValueOnce(abortFout())
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(deelKnop()).not.toHaveAttribute('aria-busy')
    expect(deelKnop()).toBeEnabled()
    // Opnieuw kunnen delen.
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 — PDF maken mislukt
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — PDF maken mislukt: vaste vertaalde melding, geen ruwe fout', () => {
  it.each([400, 403, 404, 429, 500, 502])('server geeft %i: één vaste melding, body/foutcode niet getoond, geen deelmenu', async (status) => {
    fetchMock.mockResolvedValue({
      ok: false, status, type: 'basic',
      headers: new Headers({ 'content-type': 'application/json' }),
      blob: async () => new Blob(['{"fout":"pdf_mislukt","stack":"RUWE-STACK"}']),
      json: async () => ({ fout: 'pdf_mislukt', stack: 'RUWE-STACK' }),
    } as unknown as Response)
    renderSquadEditor()
    fireEvent.click(deelKnop())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.shareFailed)
    expect(document.body.textContent).not.toContain('RUWE-STACK')
    expect(document.body.textContent).not.toContain('pdf_mislukt')
    expect(share).not.toHaveBeenCalled()
  })

  it('netwerkfout (offline): vaste melding', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch https://geheim.example'))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.shareFailed)
    expect(document.body.textContent).not.toContain('geheim.example')
  })

  it('200 met een niet-PDF content-type (bv. HTML-foutpagina): vaste melding, niets gedeeld', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ contentType: 'text/html' }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
    expect(share).not.toHaveBeenCalled()
  })

  it('na de fout kan de gebruiker opnieuw proberen (melding sluit met Escape)', async () => {
    fetchMock.mockResolvedValueOnce(pdfResponse({ ok: false, status: 500, contentType: 'application/json' }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await screen.findByRole('alert')
    // Laat de effecten (sluit-listener) eerst aankoppelen.
    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })

  it('de foutmelding bestaat vertaald in alle 5 talen en verschilt per taal', () => {
    const melding = [nl, en, de, fr, es].map((d) => d.trainingPlan.shareFailed)
    expect(melding.every((m) => typeof m === 'string' && m.length > 10)).toBe(true)
    expect(new Set(melding).size).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — nogmaals tikken tijdens het maken
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — nogmaals tikken tijdens het maken: geen tweede PDF/deelmenu', () => {
  it('knop in bezig-staat; drie snelle tikken geven precies één fetch en één share', async () => {
    let klaar!: (r: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((res) => { klaar = res }))
    renderSquadEditor()
    const knop = deelKnop()
    fireEvent.click(knop)
    fireEvent.click(knop)
    fireEvent.click(knop)
    await waitFor(() => expect(knop).toHaveAttribute('aria-busy', 'true'))
    expect(knop).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: nl.trainingPlan.shareBusy })).toBe(knop)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { klaar(pdfResponse()) })
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(knop).not.toHaveAttribute('aria-busy')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — niet ingelogd / sessie verlopen
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — sessie verlopen: geen PDF met teamdata, bestaand inlog-gedrag', () => {
  let assign: ReturnType<typeof vi.fn<(url: string) => void>>
  beforeEach(() => {
    assign = vi.fn<(url: string) => void>()
    vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost/' })
  })

  it('proxy-redirect (opaqueredirect): naar /login, geen foutmelding, niets gedeeld', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ ok: false, status: 0, type: 'opaqueredirect' }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(share).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('401 uit de route zelf: ook naar /login, niets gedeeld', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ ok: false, status: 401, contentType: 'application/json' }))
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(share).not.toHaveBeenCalled()
  })

  it('het verzoek gebruikt redirect:"manual", zodat de redirect-pagina nooit als PDF wordt gelezen', async () => {
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — knopstaten
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — knopstaten blijven', () => {
  it('selectie met 0 spelers: knop uitgeschakeld, tik doet niets', () => {
    renderSquadEditor({ selected: [] })
    const knop = deelKnop()
    expect(knop).toBeDisabled()
    fireEvent.click(knop)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('selectie met >=1 speler: knop actief', () => {
    renderSquadEditor({ selected: ['p1'] })
    expect(deelKnop()).toBeEnabled()
  })

  it('selectie: speler aan- en afvinken schakelt de knop mee', async () => {
    renderSquadEditor({ selected: [] })
    expect(deelKnop()).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` })) })
    expect(deelKnop()).toBeEnabled()
  })

  it.each<[string, OverzichtStaat, boolean]>([
    ['data', { soort: 'data', periode: 'seizoen', rijen: [OVERZICHT_RIJ] }, true],
    ['leeg', { soort: 'leeg', periode: 'seizoen' }, false],
    ['fout', { soort: 'fout', periode: 'seizoen' }, false],
    ['geenSeizoen', { soort: 'geenSeizoen' }, false],
  ])('aanwezigheidsoverzicht, staat "%s": deelknop aanwezig = %s', (_naam, staat, verwacht) => {
    renderAanwezigheid(staat)
    expect(screen.queryByRole('button', { name: nl.trainingPlan.share }) !== null).toBe(verwacht)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13 — leesactie, veilig herhaalbaar
// ═══════════════════════════════════════════════════════════════════════
describe('AC13 — delen is een leesactie, veilig herhaalbaar', () => {
  it('twee keer na elkaar delen: twee identieke GET-verzoeken, geen enkele schrijfactie', async () => {
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.body).toBeUndefined()
    }
    expect(mockToggle).not.toHaveBeenCalled()
    expect(mockSaveDoelstelling).not.toHaveBeenCalled()
    expect(mockUpdateKoppeling).not.toHaveBeenCalled()
  })

  it('delen zonder openstaande wijzigingen start geen opslag op het trainingsplan', async () => {
    renderPlan()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(mockSaveDoelstelling).not.toHaveBeenCalled()
    expect(mockUpdateKoppeling).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — desktop: "Afdrukken" opent dezelfde server-PDF in een nieuw tabblad
// (besluit Jamie 2026-10-29: telefoon-PDF is mooier dan de browserafdruk)
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — desktop: knop "Afdrukken" opent de server-PDF in een nieuw tabblad', () => {
  beforeEach(() => zetToestel({ touch: false, standalone: false, canShare: false }))

  it('trainingsplan (echte pagina): tabblad synchroon open, daarna de PDF erin; geen window.print/share', async () => {
    const print = stubPrint()
    const { open, tab } = stubTabblad()
    await renderTrainingPage()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.share })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    // Synchroon in de klik, anders blokkeert de popup-blokker het tabblad.
    expect(open).toHaveBeenCalledWith('', '_blank')
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
    expect(fetchPad()).toBe('/api/pdf')
    expect(fetchParams().get('doel')).toBe('trainingsplan')
    const bestand = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as File
    expect(bestand.type).toBe('application/pdf')
    expect(bestand.name).toBe('Trainingsplan 28-10-2026.pdf')
    expect(print).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('inzichten (echte pagina)', async () => {
    const { tab } = stubTabblad()
    await renderInzichtenPage()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
    expect(fetchParams().get('doel')).toBe('inzichten')
  })

  it('aanwezigheid en selectie', async () => {
    const { tab } = stubTabblad()
    renderAanwezigheid({ soort: 'data', periode: 'seizoen', rijen: [OVERZICHT_RIJ] })
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchParams().get('doel')).toBe('aanwezigheid')
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
    tab.location.href = ''
    renderSquadEditor()
    fireEvent.click(screen.getAllByRole('button', { name: nl.trainingPlan.print })[1])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(new URL(fetchMock.mock.calls[1][0], 'http://localhost').searchParams.get('doel')).toBe('selectie')
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
  })

  it('tabblad geblokkeerd: de PDF wordt gedownload met de juiste bestandsnaam', async () => {
    stubTabblad({ geblokkeerd: true })
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await renderTrainingPage()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      await waitFor(() => expect(klik).toHaveBeenCalledTimes(1))
      const a = klik.mock.contexts[0] as HTMLAnchorElement
      expect(a.download).toBe('Trainingsplan 28-10-2026.pdf')
      expect(a.getAttribute('href')).toBe('blob:pitchup-pdf')
    } finally {
      klik.mockRestore()
    }
  })

  it('PDF mislukt: leeg tabblad dicht en de vaste foutmelding, geen ruwe tekst', async () => {
    const { tab } = stubTabblad()
    fetchMock.mockResolvedValue({ ok: false, status: 500, type: 'basic', headers: new Headers({ 'content-type': 'application/json' }), blob: async () => new Blob(['{"fout":"pdf_mislukt"}']) } as unknown as Response)
    await renderTrainingPage()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('pdf_mislukt')
  })

  it('sessie verlopen (opaqueredirect): leeg tabblad dicht en naar /login', async () => {
    const { tab } = stubTabblad()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as unknown as Location)
    fetchMock.mockResolvedValue({ ok: false, status: 0, type: 'opaqueredirect', headers: new Headers() } as unknown as Response)
    await renderTrainingPage()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(tab.close).toHaveBeenCalledTimes(1)
  })

  it('dubbelklik tijdens het maken: één tabblad en één PDF-verzoek', async () => {
    const { open, tab } = stubTabblad()
    await renderTrainingPage()
    const knop = screen.getByRole('button', { name: nl.trainingPlan.print })
    fireEvent.click(knop)
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.shareBusy }))
    await waitFor(() => expect(tab.location.href).toBe('blob:pitchup-pdf'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('desktop MET canShare (bv. Safari/Chrome op Mac): blijft "Afdrukken"', () => {
    zetToestel({ touch: false, standalone: false, canShare: true })
    renderSquadEditor()
    expect(screen.getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.share })).toBeNull()
  })

  it('iPad met trackpad-UA (Macintosh + maxTouchPoints>1) en canShare: "Delen"', () => {
    zetToestel({ touch: false, standalone: false, canShare: true })
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true })
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    try {
      renderSquadEditor()
      expect(deelKnop()).toBeInTheDocument()
    } finally {
      ua.mockRestore()
      Reflect.deleteProperty(window.navigator, 'maxTouchPoints')
    }
  })

  it('label "Delen" en "Afdrukken" bestaan in alle 5 talen (story-vraag 12)', () => {
    for (const d of [nl, en, de, fr, es]) {
      expect(d.trainingPlan.share.length).toBeGreaterThan(2)
      expect(d.trainingPlan.print.length).toBeGreaterThan(2)
    }
    expect([nl, en, de, fr, es].map((d) => d.trainingPlan.share)).toEqual(['Delen', 'Share', 'Teilen', 'Partager', 'Compartir'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — datums en tijdzones
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — eventdatums verschuiven niet; toesteldatum voor aanwezigheid/inzichten', () => {
  it.each(['Pacific/Auckland', 'America/Los_Angeles', 'Europe/Amsterdam', 'UTC'])(
    'eventdatum 2026-10-28 blijft 28-10-2026 in tijdzone %s (trainingsplan)',
    async (tz) => {
      process.env.TZ = tz
      vi.setSystemTime(new Date('2026-10-27T23:30:00Z'))
      await renderTrainingPage()
      fireEvent.click(deelKnop())
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
      expect(gedeeldBestand().name).toBe('Trainingsplan 28-10-2026.pdf')
    },
  )

  it('aanwezigheid: 23:30 UTC op 27-10 is 28-10 op een Amsterdams toestel en 27-10 op een New Yorks toestel', async () => {
    process.env.TZ = 'Europe/Amsterdam'
    vi.setSystemTime(new Date('2026-10-27T23:30:00Z'))
    expect(new Date().getDate()).toBe(28) // controle dat TZ echt gewisseld is
    const a = renderAanwezigheid({ soort: 'data', periode: 'seizoen', rijen: [OVERZICHT_RIJ] })
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(gedeeldBestand().name).toBe('Aanwezigheid 28-10-2026.pdf')
    a.unmount()
    share.mockClear()

    process.env.TZ = 'America/New_York'
    vi.setSystemTime(new Date('2026-10-27T23:30:00Z'))
    expect(new Date().getDate()).toBe(27)
    renderAanwezigheid({ soort: 'data', periode: 'seizoen', rijen: [OVERZICHT_RIJ] })
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(gedeeldBestand().name).toBe('Aanwezigheid 27-10-2026.pdf')
  })

  it('de tijdzone van het toestel gaat mee in het verzoek (tz=…)', async () => {
    process.env.TZ = 'America/New_York'
    renderSquadEditor()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchParams().get('tz')).toBe('America/New_York')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC16 — rechten: iedereen die het scherm mag zien
// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — geen rolcheck: ook zonder bewerkrechten kan de selectie gedeeld worden', () => {
  it('canEdit=false (assistent-trainer): knop actief en deelt', async () => {
    renderSquadEditor({ canEdit: false, selected: ['p1'] })
    expect(deelKnop()).toBeEnabled()
    fireEvent.click(deelKnop())
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Tweestaps-route (bekend iOS-risico; besluit 3 van de brief)
// ═══════════════════════════════════════════════════════════════════════
describe('Verlopen gebaar: tweestaps "PDF maken" -> "PDF delen"', () => {
  it('NotAllowedError: label "PDF delen" + hint; tweede tik deelt zonder nieuwe fetch', async () => {
    share.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' })).mockResolvedValue(undefined)
    renderSquadEditor()
    fireEvent.click(deelKnop())
    expect(await screen.findByRole('status')).toHaveTextContent(nl.trainingPlan.shareReadyHint)
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.shareReady }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((share.mock.calls[1][0].files![0] as File).type).toBe('application/pdf')
  })
})
