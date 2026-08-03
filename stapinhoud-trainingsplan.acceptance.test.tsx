// Acceptatietests — Stap-inhoud op het trainingsplan (user story: als coach per
// oefening zelf de periodiseringsstap selecteren en direct de bijbehorende
// trainingsparameters zien, zonder de brontabel er apart bij te pakken).
//
// ── AC → test-mapping ──
//   AC1  → describe('AC1 — stapveld direct zichtbaar op de kaart ...')
//   AC2  → describe('AC2 — per categorie alleen de kolommen tonen die bestaan')
//   AC3  → describe('AC3 — wijziging toont direct (synchroon, vóór server-respons) ...')
//   AC4  → describe('AC4 — steigerungs toont inhoud alleen bij handmatige override')
//   AC5  → describe('AC5 — ook zichtbaar op de print-uitdraai (dual markup)')
//   AC6  → describe('AC6 — categorieën zonder brondata: ongewijzigd gedrag')
//   AC7  → describe('AC7 — berekende stap boven het maximum: clamp in de content, badge blijft ongewijzigd')
//   AC8  → describe('AC8 — stap_override wordt geclampt op het categorie-specifieke maximum')
//   AC9  → describe('AC9 — bestaande te-hoge stap_override in de database wordt bij het laden stil gecorrigeerd')
//   AC10 → describe('AC10 — decimaalnotatie wordt nooit afgerond of gelokaliseerd')
//   AC11 → describe('AC11 — kolomlabels en steigerungs-teksten zijn vertaald in alle 5 talen')
//   AC12 → describe('AC12 — bij een save-fout nooit de rauwe foutmelding, wel i18n + rollback')
//   AC13 → describe('AC13 — grenswaarden: stap 1 en stap maxStap per categorie')
//   AC14 → describe('AC14 — override leegmaken')
//   AC15 → describe('AC15 — meerdere oefeningen van dezelfde categorie tonen elk hun EIGEN content')
//
// ── Aanpak ──
// Render de ECHTE `TrainingPlanEditor` met realistische fixtures (zelfde
// patroon als teamindeling.acceptance.test.tsx): alleen `@/lib/supabase/server`
// (en `next/cache`) zijn gemockt, `app/actions/training-plan.ts` (met de
// ECHTE `updateKoppeling` + de ECHTE `clampStapOverride`/`stapInhoud` uit
// `lib/periodization-stappen.ts`) draait ongewijzigd. Dat bewijst de volledige
// keten van buitenaf: typen in het stapveld → client-clamp → server action →
// (gemockte) database-call → weergave — precies zoals een coach de feature
// ervaart. De lib-functies zelf worden hier NIET los unit-getest (dat is al
// gedekt door lib/periodization-stappen.test.ts van de backend-engineer);
// hier staat alleen wat de UI daadwerkelijk laat zien.
//
// Concrete brontabel-waarden (partijen_klein, sprints_weinig_rust, ...)
// hieronder zijn LETTERLIJK overgenomen uit lib/periodization-stappen.ts als
// vaste, van-buitenaf-bekende verwachtingen — niet als aanroep van de module.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { Dict } from '@/messages/nl'
import type { Oefening, OefeningCategorie, TrainingOefeningWithData } from '@/lib/types'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Gedeelde Supabase-mock (zelfde patroon als teamindeling.acceptance.test.tsx
// / app/actions/training-plan.test.ts). ──
type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    update: [] as { table: string; payload: Record<string, unknown> }[],
    eq: [] as { table: string; col: string; val: unknown }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'insert', 'delete']) {
      c[m] = () => c
    }
    c.eq = (col: string, val: unknown) => { calls.eq.push({ table, col, val }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
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

// Koppeling met een gejoinde bibliotheek-oefening in de gegeven categorie —
// zelfde helper-naam/vorm als app/actions/training-plan.test.ts.
function metCategorie(categorie: string, koppelingId = 'k1') {
  return makeSupabase({
    tables: {
      training_oefeningen: { data: { id: koppelingId, oefeningen: { categorie } }, error: null },
    },
  })
}

// ── Print-proxy helper (zelfde contract als afdrukken-trainingsplan.acceptance.test.tsx) ──
function hasPrintHiddenAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains('print:hidden')) return true
    node = node.parentElement
  }
  return false
}

// ── Fixtures ──
function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
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

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {}): TrainingOefeningWithData {
  const { oefening, ...rest } = overrides
  return {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: makeOefening(oefening),
    ...rest,
  }
}

function renderPlan(
  koppelingen: TrainingOefeningWithData[],
  opts: { currentSteps?: Record<string, number | null>; hasNulmeting?: boolean; dict?: Dict } = {},
) {
  return render(
    <DictProvider dict={opts.dict ?? nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={null}
        initialOefeningen={koppelingen}
        library={[]}
        currentSteps={opts.currentSteps ?? {}}
        hasNulmeting={opts.hasNulmeting ?? true}
        suggestion={null}
        players={[]}
        presentPlayerIds={[]}
      />
    </DictProvider>,
  )
}

function stapInput(koppelingId: string): HTMLInputElement {
  return document.getElementById(`stap-override-${koppelingId}`) as HTMLInputElement
}
function stapBlock(koppelingId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="stap-inhoud-${koppelingId}"]`)
}
function stapPrintBlock(koppelingId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="stap-inhoud-print-${koppelingId}"]`)
}

const CATS_WITH_DATA: OefeningCategorie[] = [
  'sprints_weinig_rust', 'sprints_veel_rust', 'partijen_groot', 'partijen_midden', 'partijen_klein', 'steigerungs',
]
const CATS_WITHOUT_DATA: OefeningCategorie[] = ['warming_up', 'positiespel', 'pass_trap', 'overig']

// ────────────────────────────────────────────────────────────────────────────
// AC1 — stapveld direct zichtbaar op de kaart, niet meer verstopt achter "Bewerken".
// ────────────────────────────────────────────────────────────────────────────
describe('AC1 — stapveld direct zichtbaar op de kaart voor categorieën met brondata', () => {
  it.each(CATS_WITH_DATA)('toont het stapveld voor %s direct, zonder eerst op "Bewerken" te klikken', (categorie) => {
    const k = makeKoppeling({ id: 'k1', oefening: { categorie } })
    renderPlan([k])

    expect(stapInput('k1')).toBeInTheDocument()
    // Precies één stapveld — geen dubbele input via het oude "Bewerken"-paneel.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC2 — per categorie alleen de kolommen tonen die voor die categorie bestaan.
// ────────────────────────────────────────────────────────────────────────────
describe('AC2 — per categorie alleen de kolommen tonen die daadwerkelijk bestaan', () => {
  it('partijen_groot en partijen_midden hebben GEEN Series/Rust series', () => {
    const kGroot = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_groot' }, stap_override: 1 })
    const kMidden = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_midden' }, stap_override: 1 })
    renderPlan([kGroot, kMidden])

    for (const id of ['k1', 'k2']) {
      const block = stapBlock(id)!
      expect(within(block).getByText(`${nl.periodization.stepWork}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepReps}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepRestReps}:`)).toBeInTheDocument()
      expect(within(block).queryByText(`${nl.periodization.stepSeries}:`)).not.toBeInTheDocument()
      expect(within(block).queryByText(`${nl.periodization.stepRestSeries}:`)).not.toBeInTheDocument()
    }
  })

  it('sprints_veel_rust heeft Rust series maar GEEN Series', () => {
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'sprints_veel_rust' }, stap_override: 1 })
    renderPlan([k])
    const block = stapBlock('k1')!
    expect(within(block).queryByText(`${nl.periodization.stepSeries}:`)).not.toBeInTheDocument()
    expect(within(block).getByText(`${nl.periodization.stepRestSeries}:`)).toBeInTheDocument()
  })

  it('sprints_weinig_rust en partijen_klein hebben alle 5 kolommen', () => {
    const kSprint = makeKoppeling({ id: 'k1', oefening: { categorie: 'sprints_weinig_rust' }, stap_override: 1 })
    const kKlein = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_klein' }, stap_override: 1 })
    renderPlan([kSprint, kKlein])
    for (const id of ['k1', 'k2']) {
      const block = stapBlock(id)!
      expect(within(block).getByText(`${nl.periodization.stepWork}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepReps}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepRestReps}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepSeries}:`)).toBeInTheDocument()
      expect(within(block).getByText(`${nl.periodization.stepRestSeries}:`)).toBeInTheDocument()
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC3 — wijziging van de override toont direct (synchroon, vóór server-respons)
// de nieuwe stap-inhoud.
// ────────────────────────────────────────────────────────────────────────────
describe('AC3 — wijziging toont direct (synchroon, vóór server-respons) de nieuwe stap-inhoud', () => {
  it('toont de inhoud van de nieuw gekozen stap onmiddellijk, terwijl de server-call nog hangt', async () => {
    // De categorie-lookup (select) in updateKoppeling blijft bewust hangen —
    // bewijst dat de UI niet op de server wacht om de nieuwe inhoud te tonen.
    let resolveSelect!: (v: unknown) => void
    const pendingSelect = new Promise((resolve) => { resolveSelect = resolve })
    const supabase = {
      from: () => {
        const c: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'insert', 'update', 'delete', 'order', 'limit', 'in', 'gt', 'lt', 'gte', 'lte', 'neq']) {
          c[m] = () => c
        }
        c.maybeSingle = () => pendingSelect
        c.single = () => pendingSelect
        return c
      },
      auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
    }
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>)

    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 1 })
    renderPlan([k])

    // Vooraf: stap 1-inhoud staat er (herhalingen '6', uniek voor stap 1-9).
    expect(within(stapBlock('k1')!).getByText('6')).toBeInTheDocument()

    fireEvent.change(stapInput('k1'), { target: { value: '13' } })

    // Direct na de wijziging (GEEN await/waitFor hiervoor) toont het blok al
    // de inhoud van stap 13 (herhalingen '10', uniek voor stap 13) — de
    // server-call hangt nog op `pendingSelect` en is dus aantoonbaar nog niet
    // afgerond.
    expect(within(stapBlock('k1')!).getByText('10')).toBeInTheDocument()
    expect(within(stapBlock('k1')!).queryByText('6')).not.toBeInTheDocument()

    // Opruimen: laat de hangende belofte alsnog afronden zodat er geen
    // niet-afgehandelde state-update na deze test overblijft.
    resolveSelect({ data: null })
    await waitFor(() => expect(screen.getByText(nl.trainingPlan.stapOpslaanMislukt)).toBeInTheDocument())
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC4 — steigerungs toont zijn inhoud alleen bij een handmatige override.
// ────────────────────────────────────────────────────────────────────────────
describe('AC4 — steigerungs toont inhoud alleen bij handmatige override', () => {
  it('toont geen inhoud zonder override, en de vertaalde stap-tekst zodra een override gezet wordt', async () => {
    const m = metCategorie('steigerungs')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'steigerungs' }, stap_override: null })
    renderPlan([k], { currentSteps: { steigerungs: null } })

    // AC1: het veld staat er wél.
    expect(stapInput('k1')).toBeInTheDocument()
    // Maar zonder override geen inhoud, ook niet op print.
    expect(screen.queryByText(nl.periodization.steigerungsSteps[0])).not.toBeInTheDocument()
    expect(stapPrintBlock('k1')).not.toBeInTheDocument()

    fireEvent.change(stapInput('k1'), { target: { value: '3' } })

    expect(within(stapBlock('k1')!).getByText(nl.periodization.steigerungsSteps[2])).toBeInTheDocument()

    // Laat de achtergrond-save afronden zodat de test schoon eindigt.
    await waitFor(() => expect(m.calls.update).toHaveLength(1))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC5 — ook zichtbaar op de print-uitdraai (dual markup: hidden print:block
// naast print:hidden op het scherm-blok).
// ────────────────────────────────────────────────────────────────────────────
describe('AC5 — ook zichtbaar op de print-uitdraai (dual markup)', () => {
  it('het scherm-blok is print:hidden, het print-blok is "hidden print:block" met dezelfde inhoud', () => {
    // Stap 8 (niet stap 5): bij stap 5 zijn arbeid ÉN rustHH allebei '1 min',
    // wat de binnen-scope assertie hieronder dubbelzinnig zou maken.
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 8 })
    renderPlan([k])

    const screenBlock = stapBlock('k1')!
    expect(hasPrintHiddenAncestor(screenBlock)).toBe(true)

    const printBlock = stapPrintBlock('k1')!
    expect(printBlock).toBeInTheDocument()
    expect(printBlock.classList.contains('hidden')).toBe(true)
    expect(printBlock.classList.contains('print:block')).toBe(true)
    // Omgekeerde bewaking: het print-blok zelf mag NOOIT onder een
    // print:hidden-voorouder hangen, anders verdwijnt het alsnog op papier.
    expect(hasPrintHiddenAncestor(printBlock)).toBe(false)

    // Stap 8 (partijen_klein): rustHH '1 min' — dezelfde inhoud in beide blokken.
    expect(printBlock.textContent).toContain('1 min')
    expect(within(screenBlock).getByText('1 min')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC6 — categorieën zonder brondata behouden het ongewijzigde gedrag.
// ────────────────────────────────────────────────────────────────────────────
describe('AC6 — categorieën zonder brondata behouden het ongewijzigde gedrag', () => {
  it.each(CATS_WITHOUT_DATA)('verstopt het stapveld achter "Bewerken" voor %s, en toont nooit een content-blok', (categorie) => {
    const k = makeKoppeling({ id: 'k1', oefening: { categorie } })
    renderPlan([k])

    // Vóór "Bewerken": geen stapveld, geen content-blok.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(stapBlock('k1')).not.toBeInTheDocument()
    expect(stapPrintBlock('k1')).not.toBeInTheDocument()

    // Na "Bewerken": het (ongewijzigde) invoerveld verschijnt, nog steeds geen content-blok.
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.detailsToggle }))
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    expect(stapBlock('k1')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC7 — berekende stap boven het categorie-maximum toont de content van de
// zwaarste beschikbare stap; badge/stapnummer zelf blijft ongewijzigd.
// ────────────────────────────────────────────────────────────────────────────
describe('AC7 — berekende stap boven het maximum: content clamt, badge blijft ongewijzigd', () => {
  it('toont de inhoud van stap 13 (max van partijen_klein) terwijl de badge "20/13" blijft tonen', () => {
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: null })
    renderPlan([k], { currentSteps: { partijen_klein: 20 } })

    // Badge: ongeclampt, toont de rauwe berekende stap 20 (boven het max van 13).
    expect(screen.getByText(`${nl.trainingPlan.stepBadge} 20/13`)).toBeInTheDocument()

    // Content: geclampt naar de zwaarste rij (stap 13: arbeid '3 min', herhalingen '10', rustHH '1 min').
    const block = stapBlock('k1')!
    expect(within(block).getByText('3 min')).toBeInTheDocument()
    expect(within(block).getByText('10')).toBeInTheDocument()
    expect(within(block).getByText('1 min')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC8 — stap_override geclampt op het categorie-specifieke maximum, ondergrens
// altijd 1; categorieën zonder brondata blijven begrensd op 99.
// ────────────────────────────────────────────────────────────────────────────
describe('AC8 — stap_override wordt geclampt op het categorie-specifieke maximum', () => {
  it('clamt een te hoge waarde meteen in de UI én in de opgeslagen waarde (partijen_klein, max 13)', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 1 })
    renderPlan([k])

    fireEvent.change(stapInput('k1'), { target: { value: '999' } })
    expect(stapInput('k1').value).toBe('13')

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.stap_override).toBe(13)
  })

  it('clamt een te lage/ongeldige waarde naar de ondergrens 1', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 5 })
    renderPlan([k])

    fireEvent.change(stapInput('k1'), { target: { value: '0' } })
    expect(stapInput('k1').value).toBe('1')

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.stap_override).toBe(1)
  })

  it('een categorie zonder brondata (warming_up) blijft begrensd op 99', async () => {
    const m = metCategorie('warming_up')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'warming_up' }, stap_override: null })
    renderPlan([k])

    // Dit veld zit hier (AC6) achter "Bewerken".
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.detailsToggle }))
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '150' } })
    expect(input.value).toBe('99')

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.stap_override).toBe(99)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC9 — bestaande te-hoge stap_override-waarden in de database worden bij het
// laden van de pagina stil gecorrigeerd (invoerveld + inhoud), zonder een
// save-call puur door te renderen.
// ────────────────────────────────────────────────────────────────────────────
describe('AC9 — bestaande te-hoge stap_override in de database wordt bij het laden stil gecorrigeerd', () => {
  it('toont het geclampte maximum in het invoerveld én in de inhoud, zonder save-call', () => {
    const m = metCategorie('partijen_klein')
    use(m)
    // Een DB-waarde ver boven het (nieuwe) categorie-maximum van 13.
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 999 })
    renderPlan([k])

    expect(stapInput('k1').value).toBe('13')
    const block = stapBlock('k1')!
    expect(within(block).getByText('3 min')).toBeInTheDocument() // arbeid van stap 13
    expect(within(block).getByText('10')).toBeInTheDocument() // herhalingen van stap 13

    // Puur door te renderen (geen enkele interactie) mag er geen save-call zijn gedaan.
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC10 — decimaalnotatie wordt nooit afgerond of gelokaliseerd, in elke taal.
// ────────────────────────────────────────────────────────────────────────────
describe('AC10 — decimaalnotatie wordt nooit afgerond of gelokaliseerd', () => {
  it.each([
    ['nl', nl], ['en', en], ['de', de], ['fr', fr], ['es', es],
  ] as const)('toont "4,5 min" / "2,5 min" / "1,5 min" exact zoals de brontabel, ook in de %s-vertaling', (_locale, dict) => {
    const kMidden = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_midden' }, stap_override: 2 })
    const kKlein2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_klein' }, stap_override: 2 })
    const kKlein4 = makeKoppeling({ id: 'k3', oefening: { categorie: 'partijen_klein' }, stap_override: 4 })
    renderPlan([kMidden, kKlein2, kKlein4], { dict: dict as Dict })

    expect(within(stapBlock('k1')!).getByText('4,5 min')).toBeInTheDocument() // partijen_midden stap 2, arbeid
    expect(within(stapBlock('k2')!).getByText('2,5 min')).toBeInTheDocument() // partijen_klein stap 2, rustHH
    expect(within(stapBlock('k3')!).getByText('1,5 min')).toBeInTheDocument() // partijen_klein stap 4, rustHH

    // Nooit een gelokaliseerde punt-variant, in geen enkele taal.
    expect(screen.queryByText('4.5 min')).not.toBeInTheDocument()
    expect(screen.queryByText('2.5 min')).not.toBeInTheDocument()
    expect(screen.queryByText('1.5 min')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC11 — steigerungs-teksten en kolomlabels zijn vertaald in alle 5 talen
// (niet leeg, niet identiek aan elkaar).
// ────────────────────────────────────────────────────────────────────────────
describe('AC11 — kolomlabels en steigerungs-teksten zijn vertaald in alle 5 talen', () => {
  it('toont per taal een eigen, niet-lege waarde voor het "Arbeid"-label en de steigerungs-stap-1-tekst', () => {
    const dicts: Record<string, Dict> = { nl, en, de, fr, es }
    const labels = new Set<string>()
    const steigerungsTexts = new Set<string>()

    for (const [locale, dict] of Object.entries(dicts)) {
      const kSprint = makeKoppeling({ id: `k-${locale}`, oefening: { categorie: 'sprints_weinig_rust' }, stap_override: 1 })
      const kSteig = makeKoppeling({ id: `s-${locale}`, oefening: { categorie: 'steigerungs' }, stap_override: 1 })
      const { unmount } = renderPlan([kSprint, kSteig], { dict })

      const label = dict.periodization.stepWork
      expect(label.trim().length).toBeGreaterThan(0)
      expect(within(stapBlock(`k-${locale}`)!).getByText(`${label}:`)).toBeInTheDocument()
      labels.add(label)

      const steigTekst = dict.periodization.steigerungsSteps[0]
      expect(steigTekst.trim().length).toBeGreaterThan(0)
      expect(within(stapBlock(`s-${locale}`)!).getByText(steigTekst)).toBeInTheDocument()
      steigerungsTexts.add(steigTekst)

      unmount()
    }

    // Alle 5 vertalingen zijn onderling verschillend (geen kopie van elkaar).
    expect(labels.size).toBe(5)
    expect(steigerungsTexts.size).toBe(5)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC12 — bij een save-fout ('Koppeling niet gevonden') wordt NOOIT de rauwe
// foutmelding getoond — een eigen i18n-string + rollback naar de laatst
// bevestigde waarde.
// ────────────────────────────────────────────────────────────────────────────
describe('AC12 — bij een save-fout nooit de rauwe foutmelding, wel i18n + rollback', () => {
  it('rolt terug naar de laatst bevestigde waarde en toont de eigen foutmelding, niet de rauwe serverfout', async () => {
    // De categorie-select in updateKoppeling levert niets op (koppeling "weg"),
    // waardoor de ECHTE server action `Koppeling niet gevonden` gooit.
    const m = makeSupabase({ tables: { training_oefeningen: { data: null } } })
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 5 })
    renderPlan([k])

    fireEvent.change(stapInput('k1'), { target: { value: '8' } })
    // Optimistisch: toont eerst de nieuwe waarde.
    expect(stapInput('k1').value).toBe('8')

    await waitFor(() => expect(screen.getByText(nl.trainingPlan.stapOpslaanMislukt)).toBeInTheDocument())

    // Rollback naar de laatst bevestigde waarde (5), niet blijven hangen op 8.
    expect(stapInput('k1').value).toBe('5')
    // De rauwe serverfout-tekst staat nergens in de DOM.
    expect(screen.queryByText('Koppeling niet gevonden')).not.toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC13 — grenswaarden: stap 1 en stap maxStap per categorie tonen de juiste
// rij (geen off-by-one).
// ────────────────────────────────────────────────────────────────────────────
describe('AC13 — grenswaarden: stap 1 en stap maxStap per categorie tonen de juiste rij', () => {
  it('sprints_weinig_rust (max 14): stap 1 en stap 14 tonen hun eigen rij', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'sprints_weinig_rust' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'sprints_weinig_rust' }, stap_override: 14 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText('15m')).toBeInTheDocument()
    expect(within(stapBlock('k1')!).getByText('6')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('20m')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('10')).toBeInTheDocument()
  })

  it('sprints_veel_rust (max 13): stap 1 en stap 13 tonen hun eigen rij', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'sprints_veel_rust' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'sprints_veel_rust' }, stap_override: 13 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText('6/4/2')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('10/8/6')).toBeInTheDocument()
  })

  it('partijen_groot (max 21): stap 1 en stap 21 tonen hun eigen rij', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_groot' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_groot' }, stap_override: 21 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText('10 min')).toBeInTheDocument()
    expect(within(stapBlock('k1')!).getByText('2')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('15 min')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('6')).toBeInTheDocument()
  })

  it('partijen_midden (max 15): stap 1 en stap 15 tonen hun eigen rij', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_midden' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_midden' }, stap_override: 15 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText('4 min')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('8 min')).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText('6')).toBeInTheDocument()
  })

  it('partijen_klein (max 13): stap 1 en stap 13 tonen hun eigen rij', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_klein' }, stap_override: 13 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText('3 min')).toBeInTheDocument() // rustHH stap 1
    expect(within(stapBlock('k2')!).getByText('1 min')).toBeInTheDocument() // rustHH stap 13
    expect(within(stapBlock('k2')!).getByText('10')).toBeInTheDocument() // herhalingen stap 13
  })

  it('steigerungs (max 5): stap 1 en stap 5 tonen hun eigen vertaalde tekst', () => {
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'steigerungs' }, stap_override: 1 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'steigerungs' }, stap_override: 5 })
    renderPlan([k1, k2])
    expect(within(stapBlock('k1')!).getByText(nl.periodization.steigerungsSteps[0])).toBeInTheDocument()
    expect(within(stapBlock('k2')!).getByText(nl.periodization.steigerungsSteps[4])).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC14 — override leegmaken: bij een meting-categorie valt de content terug op
// de automatisch berekende stap; bij steigerungs verdwijnt de content volledig.
// ────────────────────────────────────────────────────────────────────────────
describe('AC14 — override leegmaken', () => {
  it('bij een meting-categorie valt de content terug op de automatisch berekende stap', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein' }, stap_override: 5 })
    renderPlan([k], { currentSteps: { partijen_klein: 2 } })

    fireEvent.change(stapInput('k1'), { target: { value: '' } })

    // contentStep valt terug op currentSteps.partijen_klein = 2 → rustHH '2,5 min'.
    expect(within(stapBlock('k1')!).getByText('2,5 min')).toBeInTheDocument()

    // Laat de achtergrond-save (stap_override: null) afronden.
    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.stap_override).toBe(null)
  })

  it('bij steigerungs verdwijnt de content volledig (geen override = geen berekening mogelijk)', async () => {
    const m = metCategorie('steigerungs')
    use(m)
    const k = makeKoppeling({ id: 'k1', oefening: { categorie: 'steigerungs' }, stap_override: 3 })
    renderPlan([k], { currentSteps: { steigerungs: null } })

    expect(within(stapBlock('k1')!).getByText(nl.periodization.steigerungsSteps[2])).toBeInTheDocument()

    fireEvent.change(stapInput('k1'), { target: { value: '' } })

    expect(screen.queryByText(nl.periodization.steigerungsSteps[2])).not.toBeInTheDocument()
    expect(stapPrintBlock('k1')).not.toBeInTheDocument()

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC15 — meerdere oefeningen van dezelfde categorie (incl. genest via
// genest_in) tonen elk hun EIGEN, onafhankelijke content.
// ────────────────────────────────────────────────────────────────────────────
describe('AC15 — meerdere oefeningen van dezelfde categorie tonen elk hun EIGEN content', () => {
  it('twee partijen_klein-oefeningen in dezelfde training, waarvan één genest, blijven onafhankelijk', async () => {
    const m = metCategorie('partijen_klein')
    use(m)
    const k1 = makeKoppeling({ id: 'k1', oefening: { categorie: 'partijen_klein', naam: 'Rondo A' }, stap_override: 2 })
    const k2 = makeKoppeling({ id: 'k2', oefening: { categorie: 'partijen_klein', naam: 'Rondo B' }, stap_override: 11, genest_in: 'k1' })
    renderPlan([k1, k2])

    expect(within(stapBlock('k1')!).getByText('2,5 min')).toBeInTheDocument() // stap 2: rustHH
    expect(within(stapBlock('k2')!).getByText('8')).toBeInTheDocument() // stap 11: herhalingen

    // Wijziging op k1 raakt de content van k2 niet.
    fireEvent.change(stapInput('k1'), { target: { value: '13' } })
    expect(within(stapBlock('k1')!).getByText('10')).toBeInTheDocument() // k1 nu stap 13: herhalingen
    expect(within(stapBlock('k2')!).getByText('8')).toBeInTheDocument() // k2 ongewijzigd op stap 11

    await waitFor(() => expect(m.calls.update).toHaveLength(1))
    expect(m.calls.update[0].payload.stap_override).toBe(13)

    // De nesting-relatie is onderdeel van dezelfde, onafhankelijke weergave.
    expect(screen.getByText(nl.trainingPlan.nestedInBadge.replace('{name}', 'Rondo A'))).toBeInTheDocument()
  })
})
