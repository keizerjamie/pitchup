// Acceptatietests — F2 "Trainingsvoorstel in één tik + plannen bovenaan op mobiel"
// — de UI-kant, van buitenaf via de ECHTE trainingsplan-pagina.
//
// Aanpak: de echte server component (app/events/[id]/training-plan/page.tsx)
// wordt aangeroepen en met RTL gerenderd, mét de ECHTE server actions
// (stelTrainingVoor, wisselOefening) erachter. Alleen de rand is gestubd:
// Supabase (tabel-engine die filters écht toepast, zie
// trainingsvoorstel.tabel-engine.ts), next/cache, next/headers, next/navigation.
// "Zonder handmatige verversing" (C2): jsdom heeft geen Next-router die op
// revalidatePath herlaadt; de test bewijst daarom (a) dat de action
// revalidatePath(`/events/<id>/training-plan`) aanroept en (b) dat een
// her-render van de pagina op de bijgewerkte data het plan toont en de lege
// staat + knop laat verdwijnen. Het herladen zelf is Next-gedrag.
//
// Criteria-nummers (C1..C23) verwijzen naar f2-02-story.md. De serverkant (C2-C6,
// C8, C11, C12, C14, C17-C19) staat in trainingsvoorstel.acceptance.test.ts.
//
// C20-C22 (mobiel boven/desktop ongewijzigd) zijn ALLEEN structureel te toetsen:
// jsdom rekent geen Tailwind-breekpunten of CSS-`order` door. De visuele volgorde
// op een echt scherm blijft handmatig (zie rapport).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/components/ui/Toast'
import { nl } from '@/messages/nl'
import { CYCLUS_CORRECTIE_KEY } from '@/lib/periodization'
import { addDays } from '@/lib/utils'
import { makeEngine, resetIdTeller, type Row, type Fail } from './trainingsvoorstel.tabel-engine'

const refreshMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('__notFound__')
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
  headers: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'

// ────────────────────────────────────────────────
// Wereld
// ────────────────────────────────────────────────
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TEAM_A = uid(1)
const ASSISTENT = uid(3)
const EVENT_A = uid(10)
const EVENT_VORIGE = uid(13)
const EVENT_DATUM = '2026-11-16'

const owner = (id: string): Row => ({ team_id: id, user_id: id, rol: 'owner' })
const assistent = (over: Row = {}): Row => ({
  team_id: TEAM_A,
  user_id: ASSISTENT,
  rol: 'assistent',
  mag_training_bewerken: true,
  ...over,
})

let oefTeller = 100
function oef(eigenaar: string, naam: string, categorie: string, over: Row = {}): Row {
  return {
    id: uid(oefTeller++),
    team_id: eigenaar,
    naam,
    beschrijving: null,
    categorie,
    duur_min: 15,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const METING_CATS = ['partijen_groot', 'partijen_midden', 'partijen_klein', 'sprints_weinig_rust', 'sprints_veel_rust']
// Week 2: nulmeting 7 dagen voor de training.
const metingenWeek2 = (): Row[] =>
  METING_CATS.map((categorie, i) => ({
    id: `m-${i}`, team_id: TEAM_A, categorie, datum: addDays(EVENT_DATUM, -7), stap: 1, notes: null, created_at: '2026-01-01T00:00:00Z',
  }))

function koppelingRij(id: string, event: string, oefeningId: string, over: Row = {}): Row {
  return {
    id, team_id: TEAM_A, event_id: event, oefening_id: oefeningId, volgorde: 0, stap_override: null, duur_min: null,
    genest_in: null, parallel_groep_id: null, parallel_spelers: [], spelerindeling: [], aantallen_override: null,
    created_at: '2026-02-02T00:00:00Z', ...over,
  }
}

type Opts = {
  user?: string
  members?: Row[]
  event?: Row
  tables?: Record<string, Row[]>
  fail?: Fail[]
  holdInsert?: Promise<void>
}

function wereld(o: Opts = {}) {
  const m = makeEngine({
    user: { id: o.user ?? TEAM_A },
    members: o.members ?? [owner(TEAM_A)],
    holdInsert: o.holdInsert,
    fail: o.fail,
    tables: {
      events: [{ id: EVENT_A, team_id: TEAM_A, type: 'training', date: EVENT_DATUM, time: '19:00', trainingstype: 'vct', doelstelling: null, ...(o.event ?? {}) }],
      players: [{ id: 'p1', team_id: TEAM_A, name: 'Piet Peters', position: 'Spits', jersey_number: 1, active: true, injured: false, type: 'regular', rating: 5, secondary_positions: [] }],
      attendance: [{ event_id: EVENT_A, team_id: TEAM_A, player_id: 'p1', status: 'present' }],
      categorie_metingen: metingenWeek2(),
      training_oefeningen: [],
      oefeningen: [],
      ...(o.tables ?? {}),
    },
  })
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
  return m
}
type Engine = ReturnType<typeof wereld>

async function paginaElement() {
  return TrainingPlanPage({ params: Promise.resolve({ id: EVENT_A }) })
}
async function renderPage() {
  const el = await paginaElement()
  return render(
    <DictProvider dict={nl}>
      <ToastProvider teamId={TEAM_A}>{el}</ToastProvider>
    </DictProvider>,
  )
}

const voorstelKnop = () => screen.queryByRole('button', { name: nl.trainingPlan.voorstelKnop })
const inserts = (m: Engine) => m.calls.filter((c) => c.table === 'training_oefeningen' && c.op === 'insert')
const updates = (m: Engine) => m.calls.filter((c) => c.table === 'training_oefeningen' && c.op === 'update')
const zichtbaar = (tekst: string) => screen.queryAllByText(tekst).length > 0
const wisselKnop = (naam: string) => screen.queryByRole('button', { name: nl.trainingPlan.wisselAria.replace('{name}', naam) })

beforeEach(() => {
  vi.clearAllMocks()
  resetIdTeller()
  oefTeller = 100
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ════════════════════════════════════════════════
// C1 — knop in de lege staat
// ════════════════════════════════════════════════
describe('C1 — vct-training met cyclusweek en zonder oefeningen: knop "Stel een training voor" in de lege staat', () => {
  it('toont naast "Nog geen oefeningen" een primaire knop voor het voorstel (in dezelfde lege-staat-kaart)', async () => {
    wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    await renderPage()

    const leeg = screen.getByText(nl.trainingPlan.noExercises)
    const knop = voorstelKnop()
    expect(knop).not.toBeNull()
    expect(knop).toBeEnabled()
    // dezelfde lege-staat-kaart
    const kaart = leeg.closest('div')!
    expect(kaart.contains(knop)).toBe(true)
  })

  it('de knoptekst bestaat in alle vijf talen (i18n-sleutel aanwezig, niet leeg)', async () => {
    const talen = await Promise.all([import('@/messages/en'), import('@/messages/de'), import('@/messages/fr'), import('@/messages/es')])
    for (const mod of talen) {
      const dict = Object.values(mod)[0] as typeof nl
      expect(dict.trainingPlan.voorstelKnop.length).toBeGreaterThan(0)
      expect(dict.trainingPlan.voorstelFout.algemeen.length).toBeGreaterThan(0)
      expect(dict.trainingPlan.wisselAria).toContain('{name}')
    }
  })
})

// ════════════════════════════════════════════════
// C2 / C6 / C15 — tik, resultaat zichtbaar, knop weg
// ════════════════════════════════════════════════
describe('C2/C6/C15 — tik op de knop', () => {
  it('C2+C6: een tik slaat de blokken op, roept revalidatePath aan en na de herlaad toont de pagina de blokken; lege staat en knop zijn weg', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs'), oef(TEAM_A, 'Midden A', 'partijen_midden')] },
    })
    const { unmount } = await renderPage()

    fireEvent.click(voorstelKnop()!)

    await waitFor(() => expect(inserts(m)).toHaveLength(1))
    // succesmelding (toast) met aantal
    await waitFor(() => expect(screen.getByText(nl.trainingPlan.voorstelGelukt.replace('{n}', '2'))).toBeInTheDocument())
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_A}/training-plan`)
    expect(m.store.training_oefeningen).toHaveLength(2)

    // "revalidatie": pagina opnieuw opbouwen op de bijgewerkte data
    unmount()
    await renderPage()
    expect(zichtbaar('Groot A')).toBe(true)
    expect(zichtbaar('Steigerung A')).toBe(true)
    expect(zichtbaar('Midden A')).toBe(false) // niet aan de beurt in week 2
    expect(screen.queryByText(nl.trainingPlan.noExercises)).not.toBeInTheDocument()
    expect(voorstelKnop()).toBeNull() // C15: knop verdwijnt zodra er een blok is
  })

  it('C15: tijdens het verwerken is de knop uitgeschakeld (aria-busy, "Voorstel maken…") en een tweede tik maakt geen dubbele blokken', async () => {
    let laat!: () => void
    const gate = new Promise<void>((r) => { laat = r })
    const m = wereld({
      holdInsert: gate,
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs')] },
    })
    await renderPage()

    fireEvent.click(voorstelKnop()!)
    const bezig = await screen.findByRole('button', { name: nl.trainingPlan.voorstelBezig })
    expect(bezig).toBeDisabled()
    expect(bezig).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(bezig) // tweede tik terwijl de eerste loopt

    laat()
    await waitFor(() => expect(m.store.training_oefeningen).toHaveLength(2))
    expect(inserts(m)).toHaveLength(1)
  })

  it('C15: bij een plan met oefeningen is er geen voorstelknop', async () => {
    const o = oef(TEAM_A, 'Groot A', 'partijen_groot')
    wereld({ tables: { oefeningen: [o], training_oefeningen: [koppelingRij(uid(50), EVENT_A, String(o.id))] } })
    await renderPage()
    expect(zichtbaar('Groot A')).toBe(true)
    expect(voorstelKnop()).toBeNull()
  })
})

// ════════════════════════════════════════════════
// C9 — geen nulmeting / geen correctie
// ════════════════════════════════════════════════
describe('C9 — zonder nulmeting en correctie', () => {
  it('geen werkende knop maar uitleg; de lege staat blijft bruikbaar (kopieerknop, toevoegen) en er is geen foutmelding', async () => {
    const vorigeOef = oef(TEAM_A, 'Groot A', 'partijen_groot')
    wereld({
      tables: {
        categorie_metingen: [],
        oefeningen: [vorigeOef],
        events: [
          { id: EVENT_A, team_id: TEAM_A, type: 'training', date: EVENT_DATUM, time: '19:00', trainingstype: 'vct', doelstelling: null },
          { id: EVENT_VORIGE, team_id: TEAM_A, type: 'training', date: '2026-11-09', time: '19:00', trainingstype: 'vct' },
        ],
        training_oefeningen: [koppelingRij(uid(50), EVENT_VORIGE, String(vorigeOef.id))],
      },
    })
    await renderPage()

    expect(voorstelKnop()).toBeNull()
    expect(screen.getByText(nl.trainingPlan.voorstelGeenCyclusweek)).toBeInTheDocument()
    expect(screen.getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.trainingPlan.copyPrevious })).toBeEnabled()
    expect(screen.getByRole('button', { name: nl.trainingPlan.addExercise })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('een handmatige cyclusweek-correctie zonder nulmeting telt als cyclusweek: knop is er dan wel', async () => {
    // De correctie vervalt als het anker verandert; zonder metingen is het anker null,
    // snapshot (leeg derde segment) blijft dus geldig.
    wereld({
      tables: {
        categorie_metingen: [],
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')],
        settings: [{ team_id: TEAM_A, key: CYCLUS_CORRECTIE_KEY, value: `2|${addDays(EVENT_DATUM, -3)}|` }],
      },
    })
    await renderPage()
    expect(voorstelKnop()).not.toBeNull()
  })
})

// ════════════════════════════════════════════════
// C10 — lege bibliotheek
// ════════════════════════════════════════════════
describe('C10 — lege bibliotheek', () => {
  it('toont de melding met link naar /oefeningen en geen werkende voorstelknop', async () => {
    wereld({ tables: { oefeningen: [] } })
    await renderPage()

    expect(screen.getByText(nl.trainingPlan.voorstelLegeBibliotheek)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: nl.trainingPlan.voorstelNaarBibliotheek })
    expect(link).toHaveAttribute('href', '/oefeningen')
    expect(voorstelKnop()).toBeNull()
  })

  it('assistent met lege eigen bibliotheek (hoofdtrainer heeft wel oefeningen) ziet dezelfde melding, geen knop', async () => {
    wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent()],
      tables: { oefeningen: [oef(TEAM_A, 'Van de hoofdtrainer', 'partijen_groot')] },
    })
    await renderPage()

    expect(screen.getByText(nl.trainingPlan.voorstelLegeBibliotheek)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.trainingPlan.voorstelNaarBibliotheek })).toHaveAttribute('href', '/oefeningen')
    expect(voorstelKnop()).toBeNull()
  })

  it('assistent MET training-recht en eigen bibliotheek krijgt de knop wel', async () => {
    wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent()],
      tables: { oefeningen: [oef(ASSISTENT, 'Eigen groot', 'partijen_groot')] },
    })
    await renderPage()
    expect(voorstelKnop()).not.toBeNull()
  })
})

// ════════════════════════════════════════════════
// C11 / C12 — fout-feedback in de UI
// ════════════════════════════════════════════════
describe('C11/C12 — foutpaden in de UI', () => {
  it('C11: niets passend -> vertaalde melding (role=alert), geen blokken, knop blijft beschikbaar', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Midden A', 'partijen_midden')] } })
    await renderPage()
    fireEvent.click(voorstelKnop()!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.voorstelFout.niets_passend)
    expect(m.store.training_oefeningen).toHaveLength(0)
    // de transitie rondt na het zetten van de melding af: wacht tot de knop weer actief is
    await waitFor(() => expect(voorstelKnop()).toBeEnabled())
  })

  it('C11: één categorie zonder oefening -> toast noemt de overgeslagen categorie', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    await renderPage()
    fireEvent.click(voorstelKnop()!)
    const verwacht = nl.trainingPlan.voorstelOvergeslagen
      .replace('{n}', '1')
      .replace('{categorieen}', nl.periodization.categories.steigerungs)
    await waitFor(() => expect(screen.getByText(verwacht)).toBeInTheDocument())
    expect(m.store.training_oefeningen).toHaveLength(1)
  })

  it('C12: opslag mislukt -> generieke vertaalde melding zonder ruwe fout, plan blijft leeg, knop weer bruikbaar', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs')] },
      fail: [{ table: 'training_oefeningen', op: 'insert', message: 'violates constraint geheim-detail' }],
    })
    await renderPage()
    fireEvent.click(voorstelKnop()!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.voorstelFout.algemeen)
    expect(document.body.textContent).not.toContain('geheim-detail')
    expect(m.store.training_oefeningen).toHaveLength(0)
    expect(screen.getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    await waitFor(() => expect(voorstelKnop()).toBeEnabled())
  })

  it('edge twee tabbladen: plan intussen gevuld -> melding "al oefeningen" en de pagina wordt ververst, geen dubbele blokken', async () => {
    const o = oef(TEAM_A, 'Groot A', 'partijen_groot')
    const m = wereld({ tables: { oefeningen: [o, oef(TEAM_A, 'Steigerung A', 'steigerungs')] } })
    await renderPage() // pagina ziet een leeg plan
    m.store.training_oefeningen.push(koppelingRij(uid(50), EVENT_A, String(o.id))) // ander tabblad was sneller
    fireEvent.click(voorstelKnop()!)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nl.trainingPlan.voorstelFout.plan_niet_leeg)
    expect(refreshMock).toHaveBeenCalled()
    expect(inserts(m)).toHaveLength(0)
    expect(m.store.training_oefeningen).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════
// C13 — geen bewerkrecht
// ════════════════════════════════════════════════
describe('C13 — assistent zonder training-recht ziet geen knop en geen wissel', () => {
  it('lege planner: geen voorstelknop, geen uitleg-/bibliotheekmelding', async () => {
    wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent({ mag_training_bewerken: false })],
      tables: { oefeningen: [oef(ASSISTENT, 'Eigen groot', 'partijen_groot')] },
    })
    await renderPage()
    expect(screen.getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    expect(voorstelKnop()).toBeNull()
    expect(screen.queryByText(nl.trainingPlan.voorstelLegeBibliotheek)).toBeNull()
  })

  it('gevulde planner: geen Wissel-knoppen; mét recht staan ze er wel', async () => {
    const o = oef(ASSISTENT, 'Eigen groot', 'partijen_groot')
    const tabellen = { oefeningen: [o], training_oefeningen: [koppelingRij(uid(50), EVENT_A, String(o.id))] }

    wereld({ user: ASSISTENT, members: [owner(TEAM_A), assistent({ mag_training_bewerken: false })], tables: tabellen })
    const eerste = await renderPage()
    expect(zichtbaar('Eigen groot')).toBe(true)
    expect(wisselKnop('Eigen groot')).toBeNull()
    eerste.unmount()

    wereld({ user: ASSISTENT, members: [owner(TEAM_A), assistent()], tables: tabellen })
    await renderPage()
    expect(wisselKnop('Eigen groot')).not.toBeNull()
  })
})

// ════════════════════════════════════════════════
// C16 — teamtactisch
// ════════════════════════════════════════════════
describe('C16 — bij teamtactisch is de knop verborgen', () => {
  it('geen voorstelknop, ook geen uitleg- of bibliotheekregel', async () => {
    wereld({
      event: { trainingstype: 'teamtactisch' },
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] },
    })
    await renderPage()
    expect(screen.getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    expect(voorstelKnop()).toBeNull()
    expect(screen.queryByText(nl.trainingPlan.voorstelGeenCyclusweek)).toBeNull()
    expect(screen.queryByText(nl.trainingPlan.voorstelLegeBibliotheek)).toBeNull()
  })
})

// ════════════════════════════════════════════════
// C7 — Wissel per blok
// ════════════════════════════════════════════════
describe('C7 — "Wissel" per blok', () => {
  function planMetWissel(fail: Fail[] = []) {
    const groot1 = oef(TEAM_A, 'Groot 1', 'partijen_groot')
    const groot2 = oef(TEAM_A, 'Groot 2', 'partijen_groot')
    const steig = oef(TEAM_A, 'Steigerung 1', 'steigerungs')
    const sprint = oef(TEAM_A, 'Sprint 1', 'sprints_weinig_rust')
    const k1 = koppelingRij(uid(60), EVENT_A, String(groot1.id), { volgorde: 0 })
    const k2 = koppelingRij(uid(61), EVENT_A, String(steig.id), { volgorde: 1 })
    const m = wereld({ fail, tables: { oefeningen: [groot1, groot2, steig, sprint], training_oefeningen: [k1, k2] } })
    return { m, groot1, groot2, steig, sprint }
  }

  it('picker opent voorgefilterd op de categorie van dat blok, zonder de huidige oefening en zonder "nieuw maken"; keuze vervangt het blok ter plekke, het andere blok blijft ongewijzigd', async () => {
    const { m, groot2 } = planMetWissel()
    await renderPage()
    const andereVoor = JSON.stringify(m.store.training_oefeningen.find((r) => r.id === uid(61)))

    fireEvent.click(wisselKnop('Groot 1')!)

    expect(await screen.findByText(nl.oefeningen.wisselTitel)).toBeInTheDocument()
    const filter = screen.getByLabelText(nl.oefeningen.filterCategoryLabel) as HTMLSelectElement
    expect(filter.value).toBe('partijen_groot')
    expect(screen.queryByText(nl.oefeningen.pickerCreateNew)).toBeNull()
    const sheet = filter.closest('div[class*="space-y-4"]') as HTMLElement
    // alleen het alternatief in dezelfde categorie
    expect(within(sheet).getByText('Groot 2')).toBeInTheDocument()
    expect(within(sheet).queryByText('Sprint 1')).toBeNull()
    expect(within(sheet).queryByText('Steigerung 1')).toBeNull()
    expect(within(sheet).queryByText('Groot 1')).toBeNull() // huidige oefening eruit

    fireEvent.click(within(sheet).getByText('Groot 2'))

    await waitFor(() => expect(updates(m)).toHaveLength(1))
    const rij = m.store.training_oefeningen.find((r) => r.id === uid(60))!
    expect(rij.oefening_id).toBe(groot2.id)
    expect(rij.volgorde).toBe(0) // zelfde plek
    expect(m.store.training_oefeningen).toHaveLength(2)
    expect(JSON.stringify(m.store.training_oefeningen.find((r) => r.id === uid(61)))).toBe(andereVoor)
    // picker sluit na de wissel
    await waitFor(() => expect(screen.queryByText(nl.oefeningen.wisselTitel)).toBeNull())
  })

  it('wisselen zonder alternatief: melding in de picker, geen wijziging in de planning', async () => {
    const solo = oef(TEAM_A, 'Enige groot', 'partijen_groot')
    const m = wereld({ tables: { oefeningen: [solo], training_oefeningen: [koppelingRij(uid(60), EVENT_A, String(solo.id))] } })
    await renderPage()
    fireEvent.click(wisselKnop('Enige groot')!)

    expect(await screen.findByText(nl.oefeningen.wisselGeenAlternatief)).toBeInTheDocument()
    expect(updates(m)).toHaveLength(0)
    expect(m.store.training_oefeningen[0].oefening_id).toBe(solo.id)
  })

  it('mislukte wissel -> generieke vertaalde melding (geen ruwe fout), blok ongewijzigd, picker blijft open', async () => {
    const { m, groot1 } = planMetWissel([{ table: 'training_oefeningen', op: 'update', message: 'geheim-detail' }])
    await renderPage()
    fireEvent.click(wisselKnop('Groot 1')!)
    fireEvent.click(await screen.findByText('Groot 2'))

    expect(await screen.findByText(nl.oefeningen.wisselFout)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('geheim-detail')
    expect(m.store.training_oefeningen.find((r) => r.id === uid(60))!.oefening_id).toBe(groot1.id)
  })

  it('de Wissel-knop is er op elk blok (ook bij handmatig toegevoegde blokken)', async () => {
    planMetWissel()
    await renderPage()
    expect(wisselKnop('Groot 1')).not.toBeNull()
    expect(wisselKnop('Steigerung 1')).not.toBeNull()
  })
})

// ════════════════════════════════════════════════
// C20 / C21 / C22 / C23 — mobiele volgorde, desktop, print (structureel)
// ════════════════════════════════════════════════
describe('C20-C23 — layout: planner boven aanwezigheid op mobiel, desktop en print ongewijzigd (STRUCTUREEL; jsdom rekent geen breekpunten door)', () => {
  const klassen = (el: Element) => Array.from(el.classList)

  async function layout() {
    wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    await renderPage()
    const container = document.querySelector('.print-plan-layout') as HTMLElement
    expect(container).not.toBeNull()
    const [eerste, tweede] = Array.from(container.children) as HTMLElement[]
    return { container, eerste, tweede }
  }

  it('C20: onder het desktop-breekpunt is de container een flex-kolom en staat de planner (order-1, mét lege staat en knop) boven de aanwezigheid (order-2)', async () => {
    const { container, eerste, tweede } = await layout()
    const k = klassen(container)
    expect(k).toContain('flex')
    expect(k).toContain('flex-col')
    expect(k).not.toContain('grid') // niet-geprefixte grid zou mobiel breken
    // aanwezigheid: order-2 ; planner: order-1 (ongeprefixt = ook op mobiel)
    expect(klassen(eerste)).toContain('order-2')
    expect(klassen(tweede)).toContain('order-1')
    expect(klassen(eerste).some((c) => /^lg:order-/.test(c))).toBe(false)
    // de planner met lege staat + voorstelknop zit in de order-1-wrapper
    expect(within(tweede).getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    expect(within(tweede).getByRole('button', { name: nl.trainingPlan.voorstelKnop })).toBeInTheDocument()
  })

  it('C21: aanwezigheid blijft bereikbaar onder de planner (in de DOM, niet verborgen, geen hidden-klasse)', async () => {
    const { eerste } = await layout()
    expect(within(eerste).getByRole('heading', { name: nl.event.attendance })).toBeInTheDocument()
    expect(klassen(eerste)).not.toContain('hidden')
    expect(klassen(eerste).some((c) => /(^|:)hidden$/.test(c) && !c.startsWith('print:'))).toBe(false)
  })

  it('C22: vanaf het desktop-breekpunt blijft het grid [planner 1fr | aanwezigheid 19rem] met sticky aanwezigheid; de order-klassen leveren links planner / rechts aanwezigheid', async () => {
    const { container, eerste } = await layout()
    const k = klassen(container)
    expect(k).toContain('lg:grid')
    expect(k).toContain('lg:grid-cols-[1fr_19rem]')
    expect(k).toContain('lg:gap-8')
    expect(k).toContain('lg:items-start')
    // sticky zit op de aanwezigheid-component (print-attendance-col), zoals eerder
    const kolom = eerste.querySelector('.print-attendance-col') as HTMLElement
    expect(kolom).not.toBeNull()
    expect(klassen(kolom)).toContain('lg:sticky')
    expect(klassen(kolom)).toContain('lg:top-10')
  })

  it('C23: print ongewijzigd — DOM-volgorde blijft aanwezigheid -> planner (de print-float leunt daarop)', async () => {
    const { container, eerste, tweede } = await layout()
    expect(container.children.length).toBe(2)
    expect(eerste.querySelector('.print-attendance-col')).not.toBeNull()
    expect(tweede.querySelector('.print-attendance-col')).toBeNull()
    expect(within(tweede).getByRole('heading', { name: nl.trainingPlan.exercisesHeading })).toBeInTheDocument()
  })

  it('C23: de print-CSS-override staat er nog: .print-plan-layout { display: block !important } schakelt flex/grid uit; order/gap/margin-resets bewaren de float-lay-out', () => {
    const css = readFileSync(path.resolve(__dirname, 'app', 'globals.css'), 'utf8')
    const m = /\.print-plan-layout\s*\{([^}]*)\}/.exec(css)
    expect(m).not.toBeNull()
    expect(m![1].replace(/\s+/g, ' ')).toMatch(/display:\s*block\s*!important/)
  })
})
