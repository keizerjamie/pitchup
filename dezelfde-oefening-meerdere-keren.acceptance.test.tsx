// Acceptatietests — Dezelfde oefening meerdere keren aan een training
// toevoegen (user story: bij het opsplitsen van de groep dezelfde variant
// meerdere keren kunnen inplannen, elk met eigen spelerindeling en eigen
// volgorde).
//
// Dekt AC1 t/m AC12 van de goedgekeurde story + de expliciet genoemde
// edge cases, één describe-blok per criterium — zelfde conventie als
// parallelle-oefeningen.acceptance.test.tsx en teamindeling.acceptance.test.tsx.
// Van buitenaf: waar de trainer een UI-actie zou nemen (OefeningPicker
// aanklikken, een kaart ontkoppelen) wordt de ECHTE component gerenderd en de
// ECHTE server action aangeroepen; voor server-only criteria (tenant-
// isolatie, faalpaden, parallelle-groep-opruiming) wordt de server action
// rechtstreeks aangeroepen — dat is het publieke, "van buitenaf" contract
// (de server actions zijn de enige manier waarop de client de database
// raakt), niet een interne functie. Uitsluitend @/lib/supabase/server wordt
// gemockt.
//
// Let op de getByText-valkuil (geheugen.md): twee identieke kaarten zetten
// dezelfde oefeningnaam meermaals in de DOM (scherm-regel + print-kopregel
// PER kaart). Overal getAllByText(...)+lengte-assertie of within(kaart).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Oefening, Player, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import OefeningPicker from '@/components/OefeningPicker'
import { countCategoryOccurrences } from '@/lib/periodization'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import {
  addOefeningToTraining,
  removeOefeningFromTraining,
  updateKoppeling,
  saveSpelerindeling,
  vormParallelGroep,
  voegToeAanParallelGroep,
  haalUitParallelGroep,
} from '@/app/actions/training-plan'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Gedeelde Supabase-mock, wachtrij-patroon per tabel-aanroep — identiek aan
// app/actions/training-plan.test.ts en parallelle-oefeningen.acceptance.test.tsx. ──
type Eq = { col: string; val: unknown }
type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  queues?: Record<string, TableResult[]>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const queues = opts.queues ?? {}
  const calls = {
    select: [] as { table: string; eqs: Eq[] }[],
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown>; eqs: Eq[] }[],
    delete: [] as { table: string; eqs: Eq[] }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }

  function nextResult(table: string): TableResult {
    const queue = queues[table]
    if (queue && queue.length > 0) return queue.length === 1 ? queue[0] : queue.shift()!
    return tables[table] ?? { data: [], error: null }
  }

  function chain(table: string) {
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    for (const m of ['gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.select = (cols: unknown) => { calls.select.push({ table, eqs }); void cols; return c }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); eqs.push({ col, val }); return c }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload, eqs }); return c }
    c.delete = () => { calls.delete.push({ table, eqs }); return c }
    c.single = () => Promise.resolve(nextResult(table))
    c.maybeSingle = () => Promise.resolve(nextResult(table))
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(nextResult(table))
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

// ── Fixtures ──
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: P1,
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 1,
    active: true,
    injured: false,
    type: 'regular',
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players2: Player[] = [
  makePlayer({ id: P1, name: 'Piet Peters', jersey_number: 1 }),
  makePlayer({ id: P2, name: 'Jan Jansen', jersey_number: 2 }),
]

// Teamloos (`teams: []`) als default — zelfde afweging als
// parallelle-oefeningen.acceptance.test.tsx: voorkomt dat TeamIndelingEditor
// ongewild meerendert en spelersnamen dupliceert.
function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'oX',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
    // Bewust null (i.p.v. een getal): zodra de print-kopregel méér dan de
    // naam alleen bevat (bv. "Rondo · 10 min"), splitst React dat in meerdere
    // tekst-nodes en matcht getByText/getAllByText('Rondo') die kopregel niet
    // meer als exacte node — dat zou de getByText-toets voor deze feature
    // juist verzwakken i.p.v. aantonen. duur_min: null houdt de kopregel
    // gelijk aan kale naam, zodat de dubbele-DOM-claim (scherm + print)
    // daadwerkelijk getoetst wordt.
    duur_min: null,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> = {}): TrainingOefeningMetBezetting {
  const { oefeningen, ...rest } = overrides
  const basis = { ...makeOefening(), ...oefeningen }
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'oX',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    parallel_groep_id: null,
    parallel_spelers: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

function renderPlan(
  koppelingen: TrainingOefeningMetBezetting[],
  opts: { library?: Oefening[]; players?: Player[]; presentPlayerIds?: string[] } = {},
) {
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={opts.library ?? []}
        currentSteps={{}}
        hasNulmeting={false}
        suggestion={null}
        players={opts.players ?? players2}
        presentPlayerIds={opts.presentPlayerIds ?? players2.map((p) => p.id)} startTijd={null} kopieerOpties={[]}
      />
    </DictProvider>,
  )
}

// Blok-badges dragen als enige de `print-club-bg-primary`-klasse — zelfde
// betrouwbare selector als parallelle-oefeningen.acceptance.test.tsx (losse
// getByText('1')/('2')-checks zijn niet uniek: rugnummers botsen ermee).
function blokBadges(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('span.print-club-bg-primary')).map((el) => el.textContent ?? '')
}

// ────────────────────────────────────────────────────────────────────────────
// AC1 — nogmaals klikken op X in de OefeningPicker levert een tweede,
// onafhankelijke kaart op.
// ────────────────────────────────────────────────────────────────────────────
describe('AC1 — nogmaals klikken op dezelfde oefening in de OefeningPicker', () => {
  it('twee koppelingen met dezelfde oefening_id en naam renderen als twee onafhankelijke kaarten', () => {
    const k1 = makeKoppeling({ id: 'k1', volgorde: 0, created_at: '2024-01-01T00:00:00Z' })
    const k2 = makeKoppeling({ id: 'k2', volgorde: 1, created_at: '2024-01-02T00:00:00Z' })

    const { container } = renderPlan([k1, k2])

    // Twee losse blokken (geen samenvoeging tot één parallelle groep-badge).
    expect(blokBadges(container)).toEqual(['1', '2'])

    // Naam staat 2x per kaart in de DOM (scherm-regel + print-kopregel,
    // TrainingPlanEditor.tsx:530) → 4 treffers voor 2 kaarten. getAllByText
    // i.p.v. getByText (getByText-valkuil, geheugen.md).
    expect(screen.getAllByText('Rondo')).toHaveLength(4)
  })

  it('via de echte OefeningPicker-UI: tweede klik op dezelfde bibliotheekoefening roept addOefeningToTraining opnieuw aan (geen client-dedupe)', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: { volgorde: -1 }, error: null },
      },
    })
    use(m)

    const onClose = vi.fn()
    render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="e1" library={[makeOefening({ id: 'oX', naam: 'Rondo' })]} onClose={onClose} aanwezigAantal={0} />
      </DictProvider>,
    )

    // De sheet blijft sinds de multi-add-flow open na een keuze, dus twee keer
    // dezelfde oefening aanklikken is nu precies wat een gebruiker ook echt
    // doet — deze test hoefde daar eerder omheen te werken (het component bleef
    // alleen "door de test" gemount na het sluiten).
    // De kaartknop is `disabled` zolang de transitie loopt (OefeningPicker).
    // Zonder daarop te wachten wordt de tweede klik stilzwijgend genegeerd en
    // is deze test tijdsafhankelijk.
    const kaart = () => screen.getByText('Rondo').closest('button') as HTMLButtonElement

    fireEvent.click(kaart())
    await waitFor(() =>
      expect(m.calls.insert.filter((i) => i.table === 'training_oefeningen')).toHaveLength(1),
    )
    await waitFor(() => expect(kaart()).not.toBeDisabled())

    fireEvent.click(kaart())
    await waitFor(() =>
      expect(m.calls.insert.filter((i) => i.table === 'training_oefeningen')).toHaveLength(2),
    )
    // Kernpunt blijft: een tweede klik voert een tweede, onafhankelijke
    // koppelactie uit i.p.v. een no-op — geen client-dedupe.
    expect(onClose).not.toHaveBeenCalled()

    const inserts = m.calls.insert.filter((i) => i.table === 'training_oefeningen')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].payload.oefening_id).toBe('oX')
    expect(inserts[1].payload.oefening_id).toBe('oX')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC2 — spelerindeling van de ene kaart wijzigen laat de andere ongewijzigd.
// ────────────────────────────────────────────────────────────────────────────
describe('AC2 — spelerindeling van twee identieke kaarten blijft onafhankelijk', () => {
  it('saveSpelerindeling("k2", ...) schrijft uitsluitend naar id = k2, niet naar k1', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: {
          data: { id: 'k2', oefeningen: { teams: [{ grootte: 1, formaties: [] }, { grootte: 1, formaties: [] }] } },
          error: null,
        },
        players: { data: [{ id: P1 }, { id: P2 }] },
      },
    })
    use(m)

    await saveSpelerindeling('k2', 'e1', [[P1], [P2]])

    const updates = m.calls.update.filter((u) => u.table === 'training_oefeningen')
    expect(updates).toHaveLength(1)
    expect(updates[0].eqs).toContainEqual({ col: 'id', val: 'k2' })
    expect(updates[0].eqs).toContainEqual({ col: 'team_id', val: 'team-1' })
    expect(updates[0].eqs.some((e) => e.col === 'id' && e.val === 'k1')).toBe(false)
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k1'))).toBe(false)
  })

  // UI-niveau (validatorbevinding): het bovenstaande bewijst alleen dat de
  // server action op de juiste rij schrijft. Deze test bewijst het
  // story-gedrag zelf — dat een indeling-wijziging op kaart 1, via de ECHTE
  // TeamIndelingEditor-UI, kaart 2 zichtbaar ongemoeid laat — door teams
  // mee te geven zodat TeamIndelingEditor daadwerkelijk meerendert
  // (components/TrainingPlanEditor.tsx:707-714 geeft elke kaart haar eigen
  // instantie mee via koppelingId={k.id}).
  it('UI: een speler indelen op kaart 1 (via TeamIndelingEditor) laat de pool en teamindeling van kaart 2 zichtbaar ongemoeid', async () => {
    const teams = [{ grootte: 2, formaties: [] }, { grootte: 2, formaties: [] }]
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', oefeningen: { teams } }, error: null },
        players: { data: [{ id: P1 }, { id: P2 }] },
      },
    })
    use(m)

    const k1 = makeKoppeling({ id: 'k1', volgorde: 0, oefeningen: makeOefening({ teams }) })
    const k2 = makeKoppeling({ id: 'k2', volgorde: 1, oefeningen: makeOefening({ teams }) })
    renderPlan([k1, k2], { players: players2, presentPlayerIds: [P1, P2] })

    const pools = screen.getAllByTestId('teamindeling-pool')
    const team1Zones = screen.getAllByTestId('teamindeling-team-0')
    expect(pools).toHaveLength(2)
    expect(team1Zones).toHaveLength(2)

    // Vooraf: Piet staat in de pool van BEIDE kaarten (nog niets ingedeeld).
    expect(within(pools[0]).getByRole('button', { name: /Piet/ })).toBeInTheDocument()
    expect(within(pools[1]).getByRole('button', { name: /Piet/ })).toBeInTheDocument()

    // Op kaart 1: Piet selecteren en naar Team 1 verplaatsen.
    fireEvent.click(within(pools[0]).getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    await waitFor(() => expect(within(team1Zones[0]).getByText('Piet')).toBeInTheDocument())
    // Kaart 1: Piet weg uit de pool, aanwezig in Team 1.
    expect(within(pools[0]).queryByRole('button', { name: /Piet/ })).not.toBeInTheDocument()

    // Kaart 2: volledig ongewijzigd — Piet staat nog steeds in DIE pool en
    // niet in DIE Team 1-zone.
    expect(within(pools[1]).getByRole('button', { name: /Piet/ })).toBeInTheDocument()
    expect(within(team1Zones[1]).queryByText('Piet')).not.toBeInTheDocument()

    // De server action is uitsluitend voor k1 aangeroepen.
    const updates = m.calls.update.filter((u) => u.table === 'training_oefeningen')
    expect(updates.every((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k1'))).toBe(true)
    expect(updates.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC3 — stap_override zetten op de ene kaart raakt de andere niet.
// ────────────────────────────────────────────────────────────────────────────
describe('AC3 — stap_override van twee identieke kaarten blijft onafhankelijk', () => {
  it('updateKoppeling("k2", ..., { stap_override: 5 }) raakt uitsluitend k2', async () => {
    const m = makeSupabase({
      tables: {
        training_oefeningen: { data: { id: 'k2', oefeningen: { categorie: 'partijen_klein' } }, error: null },
      },
    })
    use(m)

    await updateKoppeling('k2', 'e1', { stap_override: 5 })

    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].payload.stap_override).toBe(5)
    expect(m.calls.update[0].eqs).toEqual([
      { col: 'id', val: 'k2' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k1'))).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC4 — een tweede toevoeging van X krijgt volgorde = max + 1 en verschijnt
// onderaan (nextVolgordeForEvent, app/actions/training-plan.ts:150-164).
// ────────────────────────────────────────────────────────────────────────────
describe('AC4 — tweede toevoeging krijgt volgorde = max + 1', () => {
  it('mock training_oefeningen: { data: { volgorde: 4 } } → insert.payload.volgorde === 5', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: { volgorde: 4 }, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'oX')
    const insert = m.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.volgorde).toBe(5)
  })

  it('verschijnt onderaan in het gerenderde plan (hoogste volgorde = laatste blok)', () => {
    const k1 = makeKoppeling({ id: 'k1', volgorde: 0, created_at: '2024-01-01T00:00:00Z' })
    const k2 = makeKoppeling({ id: 'k2', volgorde: 5, created_at: '2024-01-02T00:00:00Z' })
    const { container } = renderPlan([k1, k2])
    expect(blokBadges(container)).toEqual(['1', '2'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC5 — één van twee identieke kaarten verwijderen laat de andere intact met
// eigen spelerindeling en volgorde.
// ────────────────────────────────────────────────────────────────────────────
describe('AC5 — één van twee identieke kaarten verwijderen laat de andere intact', () => {
  it('via de echte "Ontkoppelen"-knop op kaart 2: removeOefeningFromTraining krijgt koppeling-id k2, kaart 1 blijft in de DOM', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(m)

    const k1 = makeKoppeling({ id: 'k1', volgorde: 0, created_at: '2024-01-01T00:00:00Z' })
    const k2 = makeKoppeling({ id: 'k2', volgorde: 1, created_at: '2024-01-02T00:00:00Z' })
    const { container } = renderPlan([k1, k2])
    expect(blokBadges(container)).toEqual(['1', '2'])

    const unlinkButtons = screen.getAllByLabelText(nl.trainingPlan.unlink)
    expect(unlinkButtons).toHaveLength(2)
    fireEvent.click(unlinkButtons[1]) // kaart 2 (k2)
    fireEvent.click(screen.getByText(nl.trainingPlan.confirmYes))

    await waitFor(() => expect(blokBadges(container)).toEqual(['1']))
    // Precies k2 is aan de server action doorgegeven, niet k1.
    expect(m.calls.delete.some((d) => d.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(true)
    expect(m.calls.delete.some((d) => d.eqs.some((e) => e.col === 'id' && e.val === 'k1'))).toBe(false)
    // De overgebleven kaart (k1) staat nog gewoon in de DOM.
    expect(screen.getAllByText('Rondo')).toHaveLength(2) // scherm + print-kopregel van kaart 1
  })

  // UI-niveau (validatorbevinding): het bovenstaande bewijst alleen dat de
  // kaart in de DOM blijft — niet het story-deel "met eigen spelerindeling
  // en volgorde". Deze test geeft beide kaarten een EIGEN, al opgeslagen
  // spelerindeling mee (net als een server zou terugleveren) en bewijst dat
  // die van kaart 1 zowel vóór als NA het verwijderen van kaart 2 intact en
  // zichtbaar blijft, samen met haar eigen (ongewijzigde) volgorde-positie.
  it('UI: kaart 1 behoudt haar eigen spelerindeling én volgorde-positie nadat identieke kaart 2 verwijderd is', async () => {
    const teams = [{ grootte: 2, formaties: [] }, { grootte: 2, formaties: [] }]
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(m)

    const k1 = makeKoppeling({
      id: 'k1', volgorde: 0, created_at: '2024-01-01T00:00:00Z',
      spelerindeling: [[P1], []], // Piet al ingedeeld in Team 1 van kaart 1
      oefeningen: makeOefening({ teams }),
    })
    const k2 = makeKoppeling({
      id: 'k2', volgorde: 1, created_at: '2024-01-02T00:00:00Z',
      spelerindeling: [[P2], []], // Jan al ingedeeld in Team 1 van kaart 2 (andere speler, eigen indeling)
      oefeningen: makeOefening({ teams }),
    })
    const { container } = renderPlan([k1, k2], { players: players2, presentPlayerIds: [P1, P2] })

    expect(blokBadges(container)).toEqual(['1', '2'])
    let team1Zones = screen.getAllByTestId('teamindeling-team-0')
    expect(within(team1Zones[0]).getByText('Piet')).toBeInTheDocument()
    expect(within(team1Zones[1]).getByText('Jan')).toBeInTheDocument()

    const unlinkButtons = screen.getAllByLabelText(nl.trainingPlan.unlink)
    fireEvent.click(unlinkButtons[1]) // kaart 2 (k2, met Jan)
    fireEvent.click(screen.getByText(nl.trainingPlan.confirmYes))

    await waitFor(() => expect(blokBadges(container)).toEqual(['1'])) // eigen volgorde-positie: nog steeds badge "1"

    // Precies 1 team-1-zone over: die van kaart 1, met Piet nog steeds
    // ingedeeld — haar eigen spelerindeling is door het verwijderen van de
    // identieke kaart 2 niet aangeraakt.
    team1Zones = screen.getAllByTestId('teamindeling-team-0')
    expect(team1Zones).toHaveLength(1) // nog maar 1 kaart, dus 1 Team-1-zone
    expect(within(team1Zones[0]).getByText('Piet')).toBeInTheDocument()
    // Jan (Team 1 van de verwijderde kaart 2) staat NIET in de teamindeling
    // van de overgebleven kaart 1 — die kende Jan sowieso nooit, want elke
    // TeamIndelingEditor-instantie kent alleen haar eigen `spelerindeling`
    // (props via koppelingId={k.id}, TrainingPlanEditor.tsx:707-714).
    expect(within(team1Zones[0]).queryByText('Jan')).not.toBeInTheDocument()
    // Ook de tweede team-kaart (Team 2, leeg gebleven) is nu enkelvoudig.
    expect(screen.getAllByTestId('teamindeling-team-1')).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC6 — oefening-id buiten de eigen bibliotheek → "Oefening niet gevonden",
// nul inserts.
// ────────────────────────────────────────────────────────────────────────────
describe('AC6 — oefening buiten de eigen bibliotheek: geen insert', () => {
  it('addOefeningToTraining("e1", "vreemd") gooit "Oefening niet gevonden" en voegt niets toe', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: null },
      },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'vreemd')).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC7 — event-id buiten het eigen team → "Event niet gevonden", nul inserts.
// ────────────────────────────────────────────────────────────────────────────
describe('AC7 — event buiten het eigen team: geen insert', () => {
  it('addOefeningToTraining("vreemd", "oX") gooit "Event niet gevonden" en voegt niets toe', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: null },
        oefeningen: { data: { id: 'oX' } },
      },
    })
    use(m)
    await expect(addOefeningToTraining('vreemd', 'oX')).rejects.toThrow('Event niet gevonden')
    expect(m.calls.insert).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC8 — verwijderen met een koppeling-id dat niet bij dit event/team hoort:
// niets verwijderd, beide kaarten blijven staan.
// ────────────────────────────────────────────────────────────────────────────
describe('AC8 — verwijderen met een koppeling-id buiten dit event/team', () => {
  it('removeOefeningFromTraining("vreemd", "e1"): de delete blijft gescoped op id + event_id + team_id', async () => {
    // Dit is bewust een acceptatietest op het server-action-niveau (het
    // publieke contract), niet via de UI: een gebruiker kan in de UI nooit
    // een koppeling-id van een andere training/team aanklikken — dat id komt
    // altijd van een echt gerenderde eigen kaart. Bij mismatch matchen de
    // eq-filters geen rij in een echte database, dus 0 rijen worden
    // verwijderd; deze mock kan dat "0 rijen geraakt" zelf niet simuleren
    // (zie rapport), maar bewijst wél dat de query zelf getenant-scoped is.
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: null, error: null }, // geen koppeling gevonden voor dit id/event/team
      },
    })
    use(m)

    await removeOefeningFromTraining('vreemd', 'e1')

    const del = m.calls.delete.find((d) => d.table === 'training_oefeningen')!
    expect(del.eqs).toEqual([
      { col: 'id', val: 'vreemd' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC9 — geen limiet op het aantal keren dat dezelfde oefening toegevoegd mag
// worden (incl. edge case: 3x of vaker).
// ────────────────────────────────────────────────────────────────────────────
describe('AC9 — geen limiet op herhaalde toevoeging (3x en vaker identiek aan de 2e keer)', () => {
  it('dezelfde oefening 4x achter elkaar toevoegen levert 4 aparte inserts op met oplopende volgorde', async () => {
    let hoogsteVolgorde: number | null = null
    for (let i = 0; i < 4; i++) {
      const m = makeSupabase({
        tables: {
          events: { data: { id: 'e1' } },
          oefeningen: { data: { id: 'oX' } },
          training_oefeningen: { data: hoogsteVolgorde === null ? null : { volgorde: hoogsteVolgorde }, error: null },
        },
      })
      use(m)
      await addOefeningToTraining('e1', 'oX')
      const insert = m.calls.insert.find((it) => it.table === 'training_oefeningen')!
      expect(insert.payload.volgorde).toBe(i)
      expect(insert.payload.oefening_id).toBe('oX')
      hoogsteVolgorde = i
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC10 — UNIQUE (event_id, oefening_id) blokkeert niet meer: een tweede
// toevoeging levert altijd een echte nieuwe rij op, geen stilzwijgende no-op.
// ────────────────────────────────────────────────────────────────────────────
describe('AC10 — geen stilzwijgende no-op meer bij een tweede identieke toevoeging', () => {
  it('eerste + tweede toevoeging van dezelfde oefening zijn allebei ECHTE inserts (niet 1 insert, geen skip)', async () => {
    const eerste = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(eerste)
    await addOefeningToTraining('e1', 'oX')
    expect(eerste.calls.insert.filter((i) => i.table === 'training_oefeningen')).toHaveLength(1)
    expect(eerste.calls.insert[0].payload.volgorde).toBe(0)
    expect(eerste.calls.insert[0].payload.event_id).toBe('e1')
    expect(eerste.calls.insert[0].payload.oefening_id).toBe('oX')
    expect(eerste.calls.insert[0].payload.team_id).toBe('team-1') // tenant-isolatie bij toevoegen

    const tweede = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: { volgorde: 0 }, error: null },
      },
    })
    use(tweede)
    await addOefeningToTraining('e1', 'oX')
    const insert = tweede.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.volgorde).toBe(1)
    expect(insert.payload.oefening_id).toBe('oX')
  })

  it('een echte DB-fout op de insert wordt nooit als stille no-op afgehandeld: de generieke fout gooit door', async () => {
    // Gespied (i.p.v. echt naar console.error te laten loggen tijdens de
    // testrun) — zelfde conventie als app/actions/oefening-library.test.ts en
    // het "niet-23505"-blok hieronder.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      },
    })
    use(m)
    await expect(addOefeningToTraining('e1', 'oX')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    consoleError.mockRestore()
  })

  describe('niet-23505 DB-fout bij insert', () => {
    let consoleError: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleError.mockRestore()
    })

    it('geeft GENERIC_ERROR_MESSAGE, nooit de rauwe Postgres-melding', async () => {
      const m = makeSupabase({
        tables: {
          events: { data: { id: 'e1' } },
          oefeningen: { data: { id: 'oX' } },
          training_oefeningen: { data: null, error: { code: '23503', message: 'insert or update on table violates foreign key constraint "geheime-tabelnaam"' } },
        },
      })
      use(m)
      await expect(addOefeningToTraining('e1', 'oX')).rejects.toThrow(GENERIC_ERROR_MESSAGE)
      const logged = consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
      expect(logged).toContain('trainingPlan.addOefeningToTraining')
      expect(logged).not.toContain('geheime-tabelnaam')
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC11 — de OefeningPicker toont de bibliotheek ongewijzigd: geen markering,
// teller of disabled-state voor al-toegevoegde oefeningen.
// ────────────────────────────────────────────────────────────────────────────
describe('AC11 — OefeningPicker markeert al-toegevoegde oefeningen niet', () => {
  it('OefeningPicker krijgt geen koppelingen-prop en kan een al-toegevoegde oefening dus structureel niet markeren', () => {
    // Render de picker terwijl de training X al 2x bevat — de picker zelf
    // krijgt alleen `library`, geen `koppelingen`, dus er is geen databron om
    // een markering op te baseren.
    render(
      <DictProvider dict={nl}>
        <OefeningPicker eventId="e1" library={[makeOefening({ id: 'oX', naam: 'Rondo' })]} onClose={vi.fn()} aanwezigAantal={0} />
      </DictProvider>,
    )
    const item = screen.getByText('Rondo').closest('button') as HTMLButtonElement
    expect(item).not.toBeNull()
    expect(item.disabled).toBe(false)
    expect(item.textContent).not.toMatch(/toegevoegd|2x|✓/i)
    // Alleen de categorie-badge en evt. duur staan naast de naam — geen
    // extra teller-element.
    expect(within(item).queryAllByText(/\d+x/)).toHaveLength(0)
  })

  it('via de echte trainingsplan-flow: picker openen terwijl X al 2x gekoppeld is, toont X onveranderd en klikbaar', () => {
    const k1 = makeKoppeling({ id: 'k1', volgorde: 0 })
    const k2 = makeKoppeling({ id: 'k2', volgorde: 1 })
    renderPlan([k1, k2], { library: [makeOefening({ id: 'oX', naam: 'Rondo' })] })

    // Twee "+ Oefening toevoegen"-knoppen in de DOM (sectiekop + onderaan de
    // lijst) zodra er al koppelingen zijn — de eerste volstaat om de picker te openen.
    fireEvent.click(screen.getAllByText(nl.trainingPlan.addExercise)[0])
    const pickerItem = screen.getByRole('button', { name: /Rondo/ })
    expect(pickerItem.hasAttribute('disabled')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC12 — periodisering blijft per training één telling per categorie
// hanteren, ook als die categorie door twee identieke oefeningen wordt
// vertegenwoordigd (lib/periodization.ts:141-147, ongewijzigd).
// ────────────────────────────────────────────────────────────────────────────
describe('AC12 — periodisering telt per training één keer per categorie, ook bij 2 identieke oefeningen', () => {
  it('twee koppelingen van dezelfde oefening (zelfde categorie) in één training tellen als 1', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: [{ id: 't1' }] },
        training_oefeningen: {
          data: [
            { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } },
            { event_id: 't1', oefeningen: { categorie: 'partijen_groot' } }, // 2e koppeling, zelfde oefening
          ],
        },
      },
    })
    use(m)
    const occ = await countCategoryOccurrences(m.supabase as unknown as SupabaseClient, 'team-1', '2026-01-01', '2026-02-01')
    expect(occ.partijen_groot).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Edge case — combinatie met parallelle groepen: twee identieke kaarten
// moeten onafhankelijk wel/niet in een parallelle groep geplaatst kunnen
// worden, zonder samenvoeging of verwarring.
// ────────────────────────────────────────────────────────────────────────────
describe('Edge case — parallelle groepen met twee identieke koppelingen (zelfde oefening_id)', () => {
  it('haalUitParallelGroep op k1 (in groep g1) laat de identieke, niet-gegroepeerde k2 (zelfde oefening_id) ongemoeid', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k1', parallel_groep_id: 'g1' } }, // koppeling zelf
          { error: null }, // update: groep eraf
          { data: [{ id: 'k1' }] }, // resterende leden van g1 → nog maar 1 → groep vervalt
          { error: null }, // ruimEenzameGroepOp update
          { data: [ // normaliseerBlokVolgorde: k1 los, k2 los
            { id: 'k1', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await haalUitParallelGroep('e1', 'k1')

    // Geen enkele update/delete raakt k2.
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
    expect(m.calls.delete.some((d) => d.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
  })

  it('vormParallelGroep(["k1","k3"]) met identieke k2 buiten de groep laat k2 ongemoeid', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: [{ id: 'k1', parallel_groep_id: null }, { id: 'k3', parallel_groep_id: null }] }, // membership-check
          { error: null }, // update k1
          { error: null }, // update k3
          { data: [ // normaliseerBlokVolgorde
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g-nieuw', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await vormParallelGroep('e1', ['k1', 'k3'])

    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
  })

  it('voegToeAanParallelGroep(k3, g1) met identieke k2 (dezelfde oefening_id als k1 in g1, maar zelf geen lid) laat k2 ongemoeid', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'k3', parallel_groep_id: null } }, // koppeling zelf
          { data: { id: 'k1' } }, // bestaand lid van g1
          { error: null }, // update
          { data: [ // normaliseerBlokVolgorde
            { id: 'k1', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-01T00:00:00Z' },
            { id: 'k2', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
            { id: 'k3', volgorde: 0, parallel_groep_id: 'g1', created_at: '2024-01-03T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await voegToeAanParallelGroep('e1', 'k3', 'g1')

    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'k2'))).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Edge case — ruimEenzameGroepOp bij verwijderen van een gegroepeerde kaart
// mag de andere identieke kaart niet raken. A en B identiek (zelfde
// oefening_id); A zit met C in een groep. A verwijderen laat C uit de groep
// vallen, maar raakt B niet — die filtert op parallel_groep_id, event_id,
// team_id (training-plan.ts:503-517), nooit op oefening_id.
// ────────────────────────────────────────────────────────────────────────────
describe('Edge case — ruimEenzameGroepOp raakt nooit een identieke, niet-gegroepeerde kaart', () => {
  it('koppeling A (in groep met C) verwijderen laat C ontgroeperen, maar raakt B (identieke oefening_id, buiten de groep) niet', async () => {
    const m = makeSupabase({
      tables: { events: { data: { id: 'e1' } } },
      queues: {
        training_oefeningen: [
          { data: { id: 'kA', parallel_groep_id: 'g1' } }, // groep vóór het verwijderen van A
          { error: null },                                  // delete van A zelf
          { data: [{ id: 'kC' }] },                          // resterende leden van g1 → alleen C over
          { error: null },                                   // opruim-update op C
          { data: [ // normaliseerBlokVolgorde: C los, B (identiek aan A) blijft los en ongemoeid
            { id: 'kB', volgorde: 0, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
            { id: 'kC', volgorde: 1, parallel_groep_id: null, created_at: '2024-01-02T00:00:00Z' },
          ] },
        ],
      },
    })
    use(m)

    await removeOefeningFromTraining('kA', 'e1')

    // De opruim-update raakt uitsluitend C (het overgebleven groepslid).
    const opruimUpdates = m.calls.update.filter((u) => u.payload.parallel_groep_id === null)
    expect(opruimUpdates).toHaveLength(1)
    expect(opruimUpdates[0].eqs).toContainEqual({ col: 'id', val: 'kC' })
    // B wordt nergens geüpdatet of verwijderd.
    expect(m.calls.update.some((u) => u.eqs.some((e) => e.col === 'id' && e.val === 'kB'))).toBe(false)
    expect(m.calls.delete.some((d) => d.eqs.some((e) => e.col === 'id' && e.val === 'kB'))).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Edge case — afdrukken/printen: beide kaarten los, elk op eigen
// volgorde-positie met eigen spelerindeling/stap, niet samengevoegd.
// Regressie tegen afdrukken-trainingsplan.acceptance.test.tsx (72 tests, apart
// gedraaid — zie rapport) — hier de kernbewering voor DIT scenario (twee
// identieke oefeningen) zelf aangetoond.
// ────────────────────────────────────────────────────────────────────────────
describe('Edge case — print: twee identieke kaarten blijven los, elk met eigen stap', () => {
  it('elke kaart heeft haar eigen print-kopregel met haar eigen stap_override, niet samengevoegd', () => {
    const k1 = makeKoppeling({
      id: 'k1', volgorde: 0, created_at: '2024-01-01T00:00:00Z', stap_override: 3,
      oefeningen: makeOefening({ categorie: 'sprints_weinig_rust' }),
    })
    const k2 = makeKoppeling({
      id: 'k2', volgorde: 1, created_at: '2024-01-02T00:00:00Z', stap_override: 7,
      oefeningen: makeOefening({ categorie: 'sprints_weinig_rust' }),
    })
    const { container } = renderPlan([k1, k2])

    // Twee losse print-kopregels — geselecteerd op de klasse die UNIEK is
    // voor de oefening-kopregel (print:text-[10px], TrainingPlanEditor.tsx:544),
    // niet de generieke 'hidden print:block' die ook de doelstelling-print-
    // paragraaf (:316) deelt.
    const kopregels = Array.from(container.querySelectorAll('p.print\\:text-\\[10px\\]'))
    expect(kopregels).toHaveLength(2)
    expect(kopregels[0].textContent).toContain('3')
    expect(kopregels[1].textContent).toContain('7')
    expect(kopregels[0].textContent).not.toEqual(kopregels[1].textContent)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Edge case — tenant-isolatie bij toevoegen én verwijderen.
// ────────────────────────────────────────────────────────────────────────────
describe('Edge case — tenant-isolatie bij toevoegen en verwijderen', () => {
  it('addOefeningToTraining schrijft team_id: user.id in de insert-payload', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'oX')
    const insert = m.calls.insert.find((i) => i.table === 'training_oefeningen')!
    expect(insert.payload.team_id).toBe('team-1')
  })

  it('removeOefeningFromTraining scoped de delete op id + event_id + team_id', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        training_oefeningen: { data: { id: 'k1', parallel_groep_id: null }, error: null },
      },
    })
    use(m)
    await removeOefeningFromTraining('k1', 'e1')
    const del = m.calls.delete.find((d) => d.table === 'training_oefeningen')!
    expect(del.eqs).toEqual([
      { col: 'id', val: 'k1' },
      { col: 'event_id', val: 'e1' },
      { col: 'team_id', val: 'team-1' },
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Regressie — eerste toevoeging van een oefening blijft functioneel
// ongewijzigd (geen dubbele koppeling ontstaat uit één klik).
// ────────────────────────────────────────────────────────────────────────────
describe('Regressie — eerste toevoeging van een oefening blijft ongewijzigd', () => {
  it('eenmalig addOefeningToTraining aanroepen levert precies 1 insert op met volgorde 0', async () => {
    const m = makeSupabase({
      tables: {
        events: { data: { id: 'e1' } },
        oefeningen: { data: { id: 'oX' } },
        training_oefeningen: { data: null, error: null },
      },
    })
    use(m)
    await addOefeningToTraining('e1', 'oX')
    const inserts = m.calls.insert.filter((i) => i.table === 'training_oefeningen')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload.volgorde).toBe(0)
  })

  it('één enkele koppeling rendert nog altijd als precies 1 kaart met badge "1"', () => {
    const k1 = makeKoppeling({ id: 'k1', volgorde: 0 })
    const { container } = renderPlan([k1])
    expect(blokBadges(container)).toEqual(['1'])
    expect(screen.getAllByText('Rondo')).toHaveLength(2) // scherm + print-kopregel, 1 kaart
  })
})
