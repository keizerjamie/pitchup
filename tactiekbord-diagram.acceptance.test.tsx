// Acceptatietests — Oefening-tekening / tactiekbord (user story: auto-opzet uit
// teams/neutralen/veldzone, handmatig bewerken van markers/materiaal/lijnen,
// opnieuw genereren met bevestiging, live gekoppelde read-only weergave in
// bibliotheek en trainingsschema, server-side normalisatie/tenant-isolatie).
//
// Dit bestand dekt AC1 t/m AC23 van de goedgekeurde story expliciet, per
// criterium een eigen describe-blok. Sommige criteria zijn al aantoonbaar
// gedekt door bestaande tests (genoemd in het testverificatierapport) — dit
// bestand vult de gaten met AANVULLENDE tests, zonder duplicatie van wat al
// bewezen is. AC24/AC25 (responsive/touch-hardware, pixel-aspect-ratio) zijn
// niet netjes met jsdom te bewijzen; AC24 wordt gedeeltelijk aangetoond via
// pointer-event-simulatie (zie onderaan), AC25 is hier bewust NIET gedekt
// (zie rapport voor de reden en het alternatief).
//
// Net als de bestaande acceptatie-/actionstests wordt uitsluitend de
// Supabase-client (@/lib/supabase/server) en next/cache gemockt — de server
// actions, validatie (lib/oefening, lib/diagram, lib/authz) en componenten
// draaien ongewijzigd. Dit test het publieke gedrag "van buitenaf" (UI-
// interactie via pointer-events op de echte DOM, of het action-contract),
// nooit interne functies in isolatie los van hun publieke rol.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { OefeningInput } from '@/lib/oefening'
import type { Diagram, Oefening, OefeningTeam, TrainingOefeningWithData, Veldzone } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import { generateDiagram, DIAGRAM_MAX_MARKERS, DIAGRAM_MAX_MATERIAAL, DIAGRAM_MAX_LIJNEN, DIAGRAM_MAX_PUNTEN } from '@/lib/diagram'
import { validateOefening, oefeningRow } from '@/lib/oefening'
import DiagramEditor from '@/components/DiagramEditor'
import DiagramView from '@/components/DiagramView'
import OefeningEditor from '@/components/OefeningEditor'
import OefeningLibrary, { type OefeningWithUsage } from '@/components/OefeningLibrary'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createOefening, updateOefening } from '@/app/actions/oefening-library'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Gedeelde Supabase-mock (zelfde patroon als oefening-library.test.ts). ──
type TableResult = { data?: unknown; error?: unknown; count?: number }

function makeSupabase(opts: { user?: { id: string } | null; tables?: Record<string, TableResult> } = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown> }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq']) {
      c[m] = () => c
    }
    c.eq = () => c
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.delete = () => c
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }
  const supabase = { from: (t: string) => chain(t), auth: { getUser: async () => ({ data: { user } }) } }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

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

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> & { oefening?: Partial<Oefening> } = {}): TrainingOefeningMetBezetting {
  const { oefening, ...rest } = overrides
  const basis = makeOefening(oefening)
  const koppeling: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team-1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...koppeling, bezetting: concretiseerBezetting(koppeling.oefeningen, koppeling.aantallen_override ?? null) }
}

// ── Pointer-helpers (zelfde aanpak als DiagramEditor.test.tsx: jsdom heeft
// geen native PointerEvent, dus we bouwen clientX/clientY/pointerId/pointerType
// zelf op een generiek Event). ──
function pointerEvent(
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number; pointerType?: string },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    button: 0,
    isPrimary: true,
  })
  return event
}

function stubFieldRect(container: HTMLElement, testId = 'diagram-svg') {
  const svg = container.querySelector(`[data-testid="${testId}"]`) as SVGSVGElement
  // viewBox is 0 0 100 140 → een 1:1 rect maakt clientX/clientY gelijk aan veld-coördinaten.
  svg.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, toJSON() {} }) as DOMRect
  return svg
}

const noTeams: OefeningTeam[] = []
const noVeldzone: Veldzone | null = null

function renderDiagramEditor(
  value: Diagram | null,
  onChange = vi.fn(),
  overrides: { teams?: OefeningTeam[]; aantalNeutralen?: number; veldzone?: Veldzone | null } = {},
) {
  const utils = render(
    <DictProvider dict={nl}>
      <DiagramEditor
        value={value}
        teams={overrides.teams ?? noTeams}
        aantalNeutralen={overrides.aantalNeutralen ?? 0}
        veldzone={overrides.veldzone ?? noVeldzone}
        onChange={onChange}
      />
    </DictProvider>,
  )
  return { ...utils, onChange }
}

// ────────────────────────────────────────────────────────────────────────────
// Criterium 1 — auto-opzet uit teams (grootte+formatie) + neutralen +
// veldzone bij openen zonder opgeslagen tekening.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 1 — auto-opzet bij openen zonder opgeslagen tekening', () => {
  it('DiagramEditor genereert bij mount (value=null) automatisch uit teams + neutralen + veldzone samen', () => {
    const teams: OefeningTeam[] = [{ grootte: 4, formaties: ['2-1'] }]
    const onChange = vi.fn()
    renderDiagramEditor(null, onChange, { teams, aantalNeutralen: 3, veldzone: 'rechts' })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(generateDiagram(teams, 3, 'rechts'))
    const generated = onChange.mock.calls[0][0] as Diagram
    // Teamgrootte 4 + 3 neutralen ⇒ 7 markers, geen materiaal/lijnen.
    expect(generated.markers).toHaveLength(4 + 3)
    expect(generated.materiaal).toEqual([])
    expect(generated.lijnen).toEqual([])
  })

  it('generateDiagram: veldzone beïnvloedt daadwerkelijk de x-posities (links vs. rechts leveren andere coördinaten)', () => {
    const teams: OefeningTeam[] = [{ grootte: 4, formaties: [] }]
    const links = generateDiagram(teams, 0, 'links')
    const rechts = generateDiagram(teams, 0, 'rechts')
    expect(links.markers.every((m) => m.x <= 55)).toBe(true)
    expect(rechts.markers.every((m) => m.x >= 45)).toBe(true)
    expect(links.markers.map((m) => m.x)).not.toEqual(rechts.markers.map((m) => m.x))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 2 — 2 teams met formatie tegenover elkaar (gespiegeld), elk
// exact teamgrootte markers, volgens formatie.
// Reeds volledig gedekt door lib/diagram.test.ts ('2 teams: team 1 is exact
// gespiegeld...') + lib/formations.test.ts (positions.length === teamgrootte
// voor elke bekende maat). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 3 — neutralen > 0 ⇒ aparte, afwijkende marker.
// Reeds gedekt door lib/diagram.test.ts ('neutralen: rol neutraal, teamIndex
// null...'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 4 / 13 — een oefening met al een opgeslagen tekening toont die
// opgeslagen versie bij openen en genereert NIET opnieuw; louter openen
// (zonder op "Opnieuw genereren" te klikken) laat de opgeslagen tekening
// ongewijzigd.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 4/13 — bestaande tekening bij openen tonen, niet regenereren', () => {
  it('DiagramEditor met een niet-lege value roept onChange niet aan bij mount en toont de opgeslagen data ongewijzigd', () => {
    // y=34 is bewust gekozen: generateDiagram voor één team van grootte 4 legt
    // alle markers op y>=70 (eigen helft) — 34 kan dus onmogelijk het resultaat
    // van een (stiekeme) auto-generatie zijn.
    const saved: Diagram = {
      markers: [{ x: 12, y: 34, teamIndex: 0, rol: 'speler', label: 'A' }],
      materiaal: [{ type: 'bal', x: 5, y: 5 }],
      lijnen: [],
    }
    const onChange = vi.fn()
    renderDiagramEditor(saved, onChange, { teams: [{ grootte: 4, formaties: [] }], aantalNeutralen: 2, veldzone: 'links' })

    expect(onChange).not.toHaveBeenCalled()
    const marker = screen.getByTestId('diagram-marker-0').querySelector('circle')!
    expect(marker.getAttribute('cx')).toBe('12')
    expect(marker.getAttribute('cy')).toBe('34')
    expect(screen.getByTestId('diagram-materiaal-0')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 5 — spelermarker verplaatsen blijft op de nieuwe positie.
// Reeds gedekt door components/DiagramEditor.test.tsx ('sleept een marker
// naar een nieuwe positie...'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 6 — materiaal toevoegen (pion=driehoek, bal=cirkel, doeltje=doel)
// op de getikte positie.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 6 — materiaal toevoegen op positie, met de juiste vorm per type', () => {
  it('tik met tool "bal" voegt een bal toe op de getikte coördinaat', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderDiagramEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolBal))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 33, clientY: 44 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].materiaal).toEqual([{ type: 'bal', x: 33, y: 44 }])
  })

  it('tik met tool "doeltje" voegt een doeltje toe op de getikte coördinaat, met de (default) variant "groot"', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderDiagramEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolDoeltje))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 70, clientY: 130 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    // Doeltje krijgt altijd een variant (@/lib/types DiagramDoelVariant); zonder
    // expliciete keuze in de variant-selector is de default 'groot', conform
    // validateDiagram's server-side default.
    expect(onChange.mock.calls[0][0].materiaal).toEqual([{ type: 'doeltje', x: 70, y: 130, variant: 'groot' }])
  })

  it('rendert de drie materiaaltypen met de voorgeschreven vorm: pion=driehoek(polygon), bal=cirkel, doeltje=doelvorm(rect)', () => {
    const diagram: Diagram = {
      markers: [],
      materiaal: [
        { type: 'pion', x: 10, y: 10 },
        { type: 'bal', x: 20, y: 20 },
        { type: 'doeltje', x: 30, y: 30 },
      ],
      lijnen: [],
    }
    render(<DiagramView diagram={diagram} />)
    expect(screen.getByTestId('diagram-view-materiaal-0').querySelector('polygon')).not.toBeNull()
    expect(screen.getByTestId('diagram-view-materiaal-1').querySelector('circle')).not.toBeNull()
    expect(screen.getByTestId('diagram-view-materiaal-2').querySelector('rect')).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 7 — materiaal verplaatsen/verwijderen werkt de tekening bij, en
// dat blijft behouden na heropenen (round-trip via OefeningEditor).
// (Verplaatsen/verwijderen zelf zijn al gedekt in DiagramEditor.test.tsx; hier
// het stuk dat nog ontbrak: de wijziging overleeft een "opslaan + heropenen".)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 7 — materiaalwijziging blijft behouden na opslaan en heropenen', () => {
  it('een verplaatst materiaal-item komt terecht in de opgeslagen input én verschijnt op de nieuwe positie bij heropenen', async () => {
    const initial = makeOefening({
      id: 'o1',
      teams: [{ grootte: 4, formaties: [] }],
      diagram: { markers: [], materiaal: [{ type: 'pion', x: 5, y: 5 }], lijnen: [] },
    })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={initial} onCancel={vi.fn()} onSubmit={onSubmit} />
      </DictProvider>,
    )

    // Tekening-editor openklappen.
    fireEvent.click(screen.getByText(new RegExp(nl.oefeningen.diagramToggle)))
    stubFieldRect(container)
    const item = screen.getByTestId('diagram-materiaal-0')

    fireEvent(item, pointerEvent('pointerdown', { clientX: 5, clientY: 5 }))
    fireEvent(item, pointerEvent('pointermove', { clientX: 30, clientY: 40 }))
    fireEvent(item, pointerEvent('pointerup', { clientX: 30, clientY: 40 }))

    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0][0] as OefeningInput
    expect(submitted.diagram!.materiaal).toEqual([{ type: 'pion', x: 30, y: 40 }])

    // Heropenen: een nieuwe editor-instantie met de "opgeslagen" (bijgewerkte) tekening
    // moet de nieuwe positie tonen — niet de oude, en niet een vers gegenereerde tekening.
    const reopened = makeOefening({ ...initial, diagram: submitted.diagram! })
    const { container: c2 } = render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={reopened} onCancel={vi.fn()} onSubmit={vi.fn()} />
      </DictProvider>,
    )
    fireEvent.click(within(c2).getByText(new RegExp(nl.oefeningen.diagramToggle)))
    const reopenedItem = within(c2).getByTestId('diagram-materiaal-0').querySelector('polygon')!
    expect(reopenedItem.getAttribute('points')).toContain('30,')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 8 — een lijn met ≥2 punten (incl. tussenpunten) wordt opgeslagen
// als geordende puntenreeks, MET pijlpunt.
// (De geordende puntenreeks zelf is al gedekt in DiagramEditor.test.tsx —
// hier het ontbrekende stuk: de pijlpunt in de daadwerkelijk gerenderde SVG.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 8 — lijn met pijlpunt (arrowhead) op het einde', () => {
  it('elke gerenderde lijn heeft marker-end naar de gedeelde pijlpunt-definitie, en die definitie bestaat in de SVG', () => {
    const diagram: Diagram = {
      markers: [],
      materiaal: [],
      lijnen: [{ stijl: 'pass', punten: [{ x: 1, y: 1 }, { x: 50, y: 50 }, { x: 90, y: 10 }] }],
    }
    const { container } = render(<DiagramView diagram={diagram} />)
    const path = screen.getByTestId('diagram-view-lijn-0')
    const markerEndAttr = path.getAttribute('marker-end')
    expect(markerEndAttr).toMatch(/^url\(#.+\)$/)
    const markerId = markerEndAttr!.slice(5, -1)
    expect(container.querySelector(`marker#${markerId}`)).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 9 — pass = doorgetrokken pijl, loop = gestippelde pijl,
// dribbel = golvende pijl.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 9 — visueel onderscheid tussen pass (doorgetrokken), loop (gestippeld), dribbel (golvend)', () => {
  it('pass: rechte lijn zonder stroke-dasharray', () => {
    const diagram: Diagram = { markers: [], materiaal: [], lijnen: [{ stijl: 'pass', punten: [{ x: 10, y: 10 }, { x: 40, y: 40 }] }] }
    render(<DiagramView diagram={diagram} />)
    const path = screen.getByTestId('diagram-view-lijn-0')
    expect(path.getAttribute('d')).toBe('M 10,10 L 40,40')
    expect(path.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('loop: rechte lijn MET stroke-dasharray (gestippeld)', () => {
    const diagram: Diagram = { markers: [], materiaal: [], lijnen: [{ stijl: 'loop', punten: [{ x: 10, y: 100 }, { x: 40, y: 90 }] }] }
    render(<DiagramView diagram={diagram} />)
    const path = screen.getByTestId('diagram-view-lijn-0')
    expect(path.getAttribute('d')).toBe('M 10,100 L 40,90')
    expect(path.getAttribute('stroke-dasharray')).toBe('2.5 1.5')
  })

  it('dribbel: golvend pad (geen stroke-dasharray, maar wél veel meer segmenten dan een rechte lijn tussen dezelfde punten)', () => {
    const diagram: Diagram = { markers: [], materiaal: [], lijnen: [{ stijl: 'dribbel', punten: [{ x: 10, y: 120 }, { x: 40, y: 110 }, { x: 60, y: 100 }] }] }
    render(<DiagramView diagram={diagram} />)
    const path = screen.getByTestId('diagram-view-lijn-0')
    const d = path.getAttribute('d')!
    expect(path.getAttribute('stroke-dasharray')).toBeNull()
    // Een rechte lijn tussen 3 punten heeft 2 " L "-segmenten; golvend sampelt
    // per segment tientallen punten.
    const segmentCount = d.split(' L ').length - 1
    expect(segmentCount).toBeGreaterThan(10)
    expect(d).not.toBe('M 10,120 L 40,110 L 60,100')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 10 — lijn verwijderen: volledig weg.
// Reeds gedekt door DiagramEditor.test.tsx ('tik op een lijn in
// verwijder-modus verwijdert die lijn'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 11 — spelermarkers kunnen NIET handmatig toegevoegd of verwijderd
// worden; alleen verplaatsen.
// (Niet-verwijderbaar is al gedekt in DiagramEditor.test.tsx. Hier het
// ontbrekende stuk: er bestaat geen "marker toevoegen"-tool en tikken op leeg
// veld in select-modus voegt niets toe.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 11 — markers zijn niet handmatig toe te voegen', () => {
  it('de toolbar bevat uitsluitend select/materiaal/lijn/verwijder — geen tool om een marker toe te voegen', () => {
    renderDiagramEditor({ markers: [], materiaal: [], lijnen: [] })
    const knownTools = [
      nl.oefeningen.toolSelect,
      nl.oefeningen.toolPion,
      nl.oefeningen.toolBal,
      nl.oefeningen.toolDoeltje,
      nl.oefeningen.toolLijn,
      nl.oefeningen.toolVerwijder,
    ]
    knownTools.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('tikken op leeg veld in select-modus (standaard) voegt geen marker toe', () => {
    const value: Diagram = { markers: [{ x: 10, y: 10, teamIndex: 0, rol: 'speler', label: 'A' }], materiaal: [], lijnen: [] }
    const { container, onChange } = renderDiagramEditor(value)
    const svg = stubFieldRect(container)
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement

    fireEvent(bg, pointerEvent('pointerdown', { clientX: 50, clientY: 50 }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByTestId(/diagram-marker-/)).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 12 — "Opnieuw genereren" vervangt de tekening volledig (handwerk
// verloren), MET bevestigingsstap.
// Reeds gedekt door DiagramEditor.test.tsx ('annuleren laat het diagram
// ongemoeid' + 'bevestigen roept onChange aan met een vers gegenereerd
// diagram'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// (Criterium 13 zie boven, samengevoegd met criterium 4.)

// ────────────────────────────────────────────────────────────────────────────
// Criterium 14 — precies één tekening per bibliotheek-oefening.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 14 — precies één tekening per bibliotheek-oefening', () => {
  it('validateOefening/oefeningRow leveren exact één "diagram"-sleutel met een los object (geen lijst van tekeningen)', () => {
    const v = validateOefening(baseInput({
      diagram: { markers: [{ x: 1, y: 1, teamIndex: 0, rol: 'speler' }], materiaal: [], lijnen: [] },
    }))
    const row = oefeningRow(v, 'team-1') as Record<string, unknown>
    expect(Object.keys(row).filter((k) => k === 'diagram')).toHaveLength(1)
    expect(Array.isArray(row.diagram)).toBe(false)
    expect(row.diagram).toEqual({ markers: [{ x: 1, y: 1, teamIndex: 0, rol: 'speler', label: undefined }], materiaal: [], lijnen: [] })
  })

  it('updateOefening vervangt de tekening volledig in één update op de oefeningen-rij (geen aparte tekeningen-tabel)', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'o1' }, error: null }, training_oefeningen: { data: [], error: null } } })
    use(m)
    const newDiagram: Diagram = { markers: [], materiaal: [{ type: 'bal', x: 2, y: 2 }], lijnen: [] }
    await updateOefening('o1', baseInput({ diagram: newDiagram }))
    expect(m.calls.update).toHaveLength(1)
    expect(m.calls.update[0].table).toBe('oefeningen')
    expect(m.calls.update[0].payload.diagram).toEqual(newDiagram)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 15/16/17 — de opgeslagen tekening is live gekoppeld: dezelfde
// actuele tekening wordt getoond op de bibliotheekkaart én in het
// trainingsschema, allebei read-only.
// (De "live, geen snapshot"-eigenschap voor oefeningdata in het algemeen —
// revalidatie van bibliotheek én elke gekoppelde training bij een update — is
// al gedekt door oefening-bibliotheek.acceptance.test.tsx, AC7/AC15; dat geldt
// onverkort voor het diagram-veld, want dat reist mee in dezelfde
// updateOefening-call. Hier wordt getoetst dat BEIDE weergaveplekken
// daadwerkelijk dezelfde tekening-data read-only renderen.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 15/16/17 — zelfde tekening, read-only, op bibliotheekkaart én in trainingsschema', () => {
  const diagram: Diagram = {
    markers: [{ x: 50, y: 90, teamIndex: 0, rol: 'keeper', label: 'K' }],
    materiaal: [{ type: 'bal', x: 50, y: 50 }],
    lijnen: [{ stijl: 'pass', punten: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }],
  }

  it('Criterium 16 — bibliotheekkaart toont een read-only DiagramView (geen FormationField-fallback) wanneer er een tekening is', () => {
    const oefening: OefeningWithUsage = { ...makeOefening({ diagram, teams: [{ grootte: 4, formaties: ['2-1'] }] }), koppelingCount: 0 }
    render(<DictProvider dict={nl}><OefeningLibrary oefeningen={[oefening]} /></DictProvider>)

    const view = screen.getByTestId('diagram-view')
    expect(view).toBeInTheDocument()
    expect(screen.queryByTestId('formation-field')).not.toBeInTheDocument()
    expect(view.querySelectorAll('button, input, select')).toHaveLength(0)
  })

  it('Criterium 17 — trainingsschema toont dezelfde tekening, ook read-only', () => {
    const koppeling = makeKoppeling({ oefening: { diagram, naam: 'Rondo' } })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[koppeling]} library={[]}
          currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[]} presentPlayerIds={[]} startTijd={null} kopieerOpties={[]}
        />
      </DictProvider>,
    )
    const view = screen.getByTestId('diagram-view')
    expect(view).toBeInTheDocument()
    expect(view.querySelectorAll('button, input, select')).toHaveLength(0)
  })

  it('Criterium 15 — bibliotheekkaart en trainingsschema renderen exact dezelfde tekening-data (zelfde markers/materiaal/lijnen)', () => {
    const oefening: OefeningWithUsage = { ...makeOefening({ diagram }), koppelingCount: 1 }
    const { unmount } = render(<DictProvider dict={nl}><OefeningLibrary oefeningen={[oefening]} /></DictProvider>)
    const libraryMarker = screen.getByTestId('diagram-view-marker-0').querySelector('circle')!
    const libraryCoords = { cx: libraryMarker.getAttribute('cx'), cy: libraryMarker.getAttribute('cy') }
    unmount()

    const koppeling = makeKoppeling({ oefening: { diagram } })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[koppeling]} library={[]}
          currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[]} presentPlayerIds={[]} startTijd={null} kopieerOpties={[]}
        />
      </DictProvider>,
    )
    const planMarker = screen.getByTestId('diagram-view-marker-0').querySelector('circle')!
    expect({ cx: planMarker.getAttribute('cx'), cy: planMarker.getAttribute('cy') }).toEqual(libraryCoords)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 18 — een ander team/tenant kan de oefening (en dus de tekening)
// niet bereiken: "niet gevonden".
// (Het generieke mechanisme is al gedekt in app/actions/oefening-library.test.ts;
// hier expliciet getoetst dát een diagram-payload de tenant-check niet omzeilt.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 18 — tenant-isolatie geldt onverkort voor oefeningen met een tekening', () => {
  it('updateOefening met een diagram-payload op andermans oefening-id → "Oefening niet gevonden", geen update uitgevoerd', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: null } } })
    use(m)
    const diagram: Diagram = { markers: [{ x: 1, y: 1, teamIndex: 0, rol: 'speler' }], materiaal: [], lijnen: [] }
    await expect(updateOefening('andermans-oefening', baseInput({ diagram }))).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 19 — een tekening met ongeldige structuur/coördinaten wordt
// server-side genormaliseerd/geclamped, onbekende typen/velden gestript, en
// er gaat geen ruwe fout naar de client.
// (De normalisatie zelf is al puur-functioneel gedekt in lib/diagram.test.ts;
// hier het ontbrekende stuk: op de daadwerkelijke server-action-grens gooit
// een corrupte tekening geen fout, en wat wordt opgeslagen is genormaliseerd.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 19 — corrupte tekening: geen ruwe fout, wél server-side normalisatie op de action-grens', () => {
  it('createOefening met een corrupt diagram-object gooit geen fout en slaat een genormaliseerde tekening op', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'new-id' }, error: null } } })
    use(m)
    const corrupt = {
      markers: [{ x: 'NaN', y: 999, teamIndex: 'x', rol: 'buitenaards', foo: 'bar' }],
      materiaal: [{ type: 'raket', x: 1, y: 1 }],
      lijnen: [{ stijl: 'onbekend', punten: [{ x: 1, y: 1 }] }],
      rommelVeld: true,
    } as unknown as Diagram

    await expect(createOefening(baseInput({ diagram: corrupt }))).resolves.toEqual({ id: 'new-id' })

    const saved = m.calls.insert[0].payload.diagram as Diagram
    expect(saved.markers[0]).toMatchObject({ x: 0, y: 140, teamIndex: 0, rol: 'speler' })
    expect('foo' in saved.markers[0]).toBe(false)
    expect(saved.materiaal).toHaveLength(0) // onbekend type 'raket' → gestript
    expect(saved.lijnen).toHaveLength(0) // onbekende stijl → gestript
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 20 — coördinaten buiten het veld worden geclamped binnen bereik.
// Reeds gedekt door lib/diagram.test.ts ('clampt coördinaten binnen
// [0,100]/[0,140]') en (aanvullend, op de action-grens) door de y:999 → 140
// clamp in de Criterium 19-test hierboven. Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 21 — coördinatenstelsel x/y 0-100 × 0-140 (viewBox 0 0 100 140),
// consistent tussen editor en read-only weergave.
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 21 — viewBox "0 0 100 140" in zowel de editor als de read-only weergave', () => {
  it('DiagramEditor en DiagramView delen exact dezelfde viewBox', () => {
    const { container: editorContainer } = renderDiagramEditor({ markers: [], materiaal: [], lijnen: [] })
    expect(editorContainer.querySelector('[data-testid="diagram-svg"]')?.getAttribute('viewBox')).toBe('0 0 100 140')

    render(<DiagramView diagram={{ markers: [], materiaal: [], lijnen: [] }} />)
    expect(screen.getByTestId('diagram-view').querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 140')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 22 — elke lijn heeft minstens 2 punten.
// Reeds gedekt door lib/diagram.test.ts ('lijn met minder dan 2 punten wordt
// gedropt') en DiagramEditor.test.tsx ('verwerpt een lijn met minder dan 2
// punten (Klaar-knop is uitgeschakeld)'). Geen aanvullende test nodig.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Criterium 23 — aantallen boven de maxima worden server-side afgekapt
// (markers 100 / materiaal 50 / lijnen 40 / punten-per-lijn 20).
// (De pure normalisatie is al gedekt in lib/diagram.test.ts; hier het
// ontbrekende stuk: dit geldt ook echt op de createOefening-actiegrens.)
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 23 — maxima worden ook op de createOefening-actiegrens afgekapt', () => {
  it('createOefening kapt overtollige markers/materiaal/lijnen/punten-per-lijn af tot de maxima', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    const bigDiagram: Diagram = {
      markers: Array.from({ length: 150 }, () => ({ x: 1, y: 1, teamIndex: 0, rol: 'speler' as const })),
      materiaal: Array.from({ length: 80 }, () => ({ type: 'pion' as const, x: 1, y: 1 })),
      lijnen: Array.from({ length: 50 }, () => ({
        stijl: 'pass' as const,
        punten: Array.from({ length: 30 }, () => ({ x: 1, y: 1 })),
      })),
    }
    await createOefening(baseInput({ diagram: bigDiagram }))
    const saved = m.calls.insert[0].payload.diagram as Diagram
    expect(saved.markers).toHaveLength(DIAGRAM_MAX_MARKERS)
    expect(saved.materiaal).toHaveLength(DIAGRAM_MAX_MATERIAAL)
    expect(saved.lijnen).toHaveLength(DIAGRAM_MAX_LIJNEN)
    expect(saved.lijnen[0].punten).toHaveLength(DIAGRAM_MAX_PUNTEN)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Criterium 24 — de editor werkt met muis én touch (unified pointer).
// NIET volledig met jsdom te bewijzen: jsdom simuleert geen echte
// touch-hardware/multi-touch-gedrag. Wél aantoonbaar: dezelfde handler-code
// reageert identiek op een pointer-event met pointerType 'touch' als op
// 'mouse' (het contract is pointerType-onafhankelijk). Zie testrapport voor
// het volledige "hoe wél" (handmatig op device / Playwright met echte
// touch-emulatie).
// ────────────────────────────────────────────────────────────────────────────
describe('Criterium 24 — unified pointer: gedeeltelijk aantoonbaar via pointerType-simulatie', () => {
  it('een marker verplaatsen werkt identiek met pointerType "touch" als met "mouse" (zelfde handler-pad, geen muis-only logica)', () => {
    const value: Diagram = { markers: [{ x: 10, y: 10, teamIndex: 0, rol: 'speler', label: 'A' }], materiaal: [], lijnen: [] }
    const { container, onChange } = renderDiagramEditor(value)
    stubFieldRect(container)
    const marker = screen.getByTestId('diagram-marker-0')

    fireEvent(marker, pointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerType: 'touch' }))
    fireEvent(marker, pointerEvent('pointermove', { clientX: 45, clientY: 60, pointerType: 'touch' }))
    fireEvent(marker, pointerEvent('pointerup', { clientX: 45, clientY: 60, pointerType: 'touch' }))

    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last.markers[0]).toMatchObject({ x: 45, y: 60 })
  })
})

// Criterium 25 (aspect ratio 100/140, geen horizontale scroll) is bewust NIET
// opgenomen als test: jsdom rekent geen CSS-layout uit (geen echte
// pixelbreedte/-hoogte, geen scrollbar-detectie), dus elke "test" hiervoor zou
// een schijnzekerheid zijn. Zie testrapport voor het alternatief.
