import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import DiagramEditor from '@/components/DiagramEditor'
import { generateDiagram } from '@/lib/diagram'
import type { Diagram, OefeningTeam, Veldzone } from '@/lib/types'

// jsdom kent geen native PointerEvent (Object.getPrototypeOf(window.PointerEvent)
// is undefined), dus @testing-library/react's fireEvent.pointerDown/Move/Up
// valt terug op een kale window.Event zonder clientX/clientY/pointerId. Bouw
// die velden zelf op een generiek Event — React's synthetic event-laag leest
// ze via directe property-toegang op het native event, dus dit volstaat om
// onPointerDown/Move/Up-handlers te triggeren met bruikbare coördinaten.
function pointerEvent(type: string, init: { clientX: number; clientY: number; pointerId?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  })
  return event
}

function stubFieldRect(container: HTMLElement) {
  const svg = container.querySelector('[data-testid="diagram-svg"]') as SVGSVGElement
  // viewBox is 0 0 100 140 → een 1:1 rect (breedte 100, hoogte 140) maakt
  // clientX/clientY direct gelijk aan veld-coördinaten, zonder herschaling.
  svg.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, toJSON() {} }) as DOMRect
  return svg
}

const noTeams: OefeningTeam[] = []
const noVeldzone: Veldzone | null = null

function renderEditor(value: Diagram | null, onChange = vi.fn(), overrides: { teams?: OefeningTeam[]; aantalNeutralen?: number; veldzone?: Veldzone | null } = {}) {
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

describe('DiagramEditor — auto-genereren bij mount', () => {
  it('genereert automatisch een diagram wanneer value null is, en niet opnieuw bij een volgende render met nog steeds null', () => {
    const teams: OefeningTeam[] = [{ grootte: 4, formaties: [] }]
    const onChange = vi.fn()
    const { rerender } = renderEditor(null, onChange, { teams })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(generateDiagram(teams, 0, null))

    rerender(
      <DictProvider dict={nl}>
        <DiagramEditor value={null} teams={teams} aantalNeutralen={0} veldzone={null} onChange={onChange} />
      </DictProvider>,
    )
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('DiagramEditor — materiaal toevoegen', () => {
  it('tik op het veld met tool "pion" voegt een pion toe op de getikte coördinaat', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolPion))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 20, clientY: 28 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].materiaal).toEqual([{ type: 'pion', x: 20, y: 28 }])
  })

  it('respecteert DIAGRAM_MAX_MATERIAAL (voegt niets meer toe wanneer het maximum bereikt is)', () => {
    const materiaal = Array.from({ length: 50 }, (_, i) => ({ type: 'bal' as const, x: i, y: 0 }))
    const full: Diagram = { markers: [], materiaal, lijnen: [] }
    const { container, onChange } = renderEditor(full)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolBal))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 60, clientY: 60 }))

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('DiagramEditor — speler-tool (markers vrij toevoegen)', () => {
  it('tik op leeg veld met tool "Speler" + kleur "Licht" voegt een team-0-speler toe (geen label)', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    // 'Licht' is de default keuze, maar we klikken 'm expliciet aan voor de duidelijkheid.
    fireEvent.click(screen.getByText(nl.oefeningen.spelerLicht))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 20, clientY: 30 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].markers).toEqual([{ x: 20, y: 30, teamIndex: 0, rol: 'speler' }])
  })

  it('tik op leeg veld met tool "Speler" + kleur "Oranje" voegt een team-1-speler toe', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    fireEvent.click(screen.getByText(nl.oefeningen.spelerOranje))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 60, clientY: 40 }))

    expect(onChange.mock.calls[0][0].markers).toEqual([{ x: 60, y: 40, teamIndex: 1, rol: 'speler' }])
  })

  it('tik op leeg veld met tool "Speler" + kleur "Neutraal" voegt een neutrale marker toe (teamIndex null)', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    fireEvent.click(screen.getByText(nl.oefeningen.spelerNeutraal))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 50, clientY: 70 }))

    expect(onChange.mock.calls[0][0].markers).toEqual([{ x: 50, y: 70, teamIndex: null, rol: 'neutraal' }])
  })

  it('respecteert DIAGRAM_MAX_MARKERS (voegt niets meer toe wanneer het maximum bereikt is)', () => {
    const markers = Array.from({ length: 100 }, () => ({ x: 1, y: 1, teamIndex: 0, rol: 'speler' as const }))
    const full: Diagram = { markers, materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(full)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('werkt ook zonder teams (0 teams): de speler-tool is niet afhankelijk van teams/formaties', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty, vi.fn(), { teams: [] })
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolSpeler))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 33, clientY: 44 }))

    expect(onChange.mock.calls[0][0].markers).toEqual([{ x: 33, y: 44, teamIndex: 0, rol: 'speler' }])
  })
})

describe('DiagramEditor — element verplaatsen', () => {
  it('sleept een marker naar een nieuwe positie (select-modus, standaard)', () => {
    const value: Diagram = {
      markers: [{ x: 10, y: 10, teamIndex: 0, rol: 'speler', label: 'A' }],
      materiaal: [],
      lijnen: [],
    }
    const { container, onChange } = renderEditor(value)
    stubFieldRect(container)
    const marker = screen.getByTestId('diagram-marker-0')

    fireEvent(marker, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(marker, pointerEvent('pointermove', { clientX: 40, clientY: 55 }))
    fireEvent(marker, pointerEvent('pointerup', { clientX: 40, clientY: 55 }))

    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last.markers[0]).toEqual({ x: 40, y: 55, teamIndex: 0, rol: 'speler', label: 'A' })
  })

  it('sleept een materiaal-item naar een nieuwe positie', () => {
    const value: Diagram = { markers: [], materiaal: [{ type: 'pion', x: 5, y: 5 }], lijnen: [] }
    const { container, onChange } = renderEditor(value)
    stubFieldRect(container)
    const item = screen.getByTestId('diagram-materiaal-0')

    fireEvent(item, pointerEvent('pointerdown', { clientX: 5, clientY: 5 }))
    fireEvent(item, pointerEvent('pointermove', { clientX: 30, clientY: 20 }))
    fireEvent(item, pointerEvent('pointerup', { clientX: 30, clientY: 20 }))

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last.materiaal[0]).toEqual({ type: 'pion', x: 30, y: 20 })
  })
})

describe('DiagramEditor — verwijderen', () => {
  it('tik op een materiaal-item in verwijder-modus verwijdert het', () => {
    const value: Diagram = { markers: [], materiaal: [{ type: 'bal', x: 20, y: 20 }], lijnen: [] }
    const { container, onChange } = renderEditor(value)
    stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolVerwijder))
    const item = screen.getByTestId('diagram-materiaal-0')
    fireEvent(item, pointerEvent('pointerdown', { clientX: 20, clientY: 20 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].materiaal).toEqual([])
  })

  it('tik op een lijn in verwijder-modus verwijdert die lijn', () => {
    const value: Diagram = {
      markers: [],
      materiaal: [],
      lijnen: [{ stijl: 'pass', punten: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
    }
    const { container, onChange } = renderEditor(value)
    stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolVerwijder))
    const lijn = screen.getByTestId('diagram-lijn-0')
    fireEvent(lijn, pointerEvent('pointerdown', { clientX: 5, clientY: 5 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].lijnen).toEqual([])
  })

  it('markers zijn nu ook verwijderbaar: tik op een marker in verwijder-modus verwijdert die marker', () => {
    // Sinds markers vrij bewerkbaar zijn (toevoegen/slepen/verwijderen) geldt
    // de oude regel "markers zijn niet handmatig te verwijderen" niet meer.
    const value: Diagram = { markers: [{ x: 10, y: 10, teamIndex: 0, rol: 'speler', label: 'A' }], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(value)
    stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolVerwijder))
    const marker = screen.getByTestId('diagram-marker-0')
    fireEvent(marker, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].markers).toEqual([])
  })
})

describe('DiagramEditor — lijn tekenen met meerdere punten', () => {
  it('3 tikken + Klaar geeft een lijn met 3 punten in de gekozen stijl', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolLijn))
    fireEvent.click(screen.getByText(nl.oefeningen.lijnStijlLoop))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 40, clientY: 40 }))
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 70, clientY: 20 }))

    fireEvent.click(screen.getByText(nl.oefeningen.lijnKlaar))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].lijnen).toEqual([
      { stijl: 'loop', punten: [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 70, y: 20 }] },
    ])
  })

  it('verwerpt een lijn met minder dan 2 punten (Klaar-knop is uitgeschakeld)', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolLijn))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))

    expect(screen.getByText(nl.oefeningen.lijnKlaar)).toBeDisabled()
  })
})

describe('DiagramEditor — doeltje-varianten', () => {
  it('plaatst een doeltje met de gekozen variant (klein)', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolDoeltje))
    fireEvent.click(screen.getByText(nl.oefeningen.doelKlein))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 50, clientY: 70 }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].materiaal).toEqual([{ type: 'doeltje', x: 50, y: 70, variant: 'klein' }])
  })

  it('gebruikt "groot" als default wanneer geen variant expliciet gekozen is', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolDoeltje))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 50, clientY: 70 }))

    expect(onChange.mock.calls[0][0].materiaal).toEqual([{ type: 'doeltje', x: 50, y: 70, variant: 'groot' }])
  })

  it('pion en bal krijgen geen variant-veld (alleen doeltje heeft een variant)', () => {
    const empty: Diagram = { markers: [], materiaal: [], lijnen: [] }
    const { container, onChange } = renderEditor(empty)
    const svg = stubFieldRect(container)

    fireEvent.click(screen.getByText(nl.oefeningen.toolPion))
    const bg = svg.querySelector('[data-testid="diagram-field-bg"]') as SVGRectElement
    fireEvent(bg, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))

    expect(onChange.mock.calls[0][0].materiaal[0]).not.toHaveProperty('variant')
  })

  it('rendert de drie doeltje-varianten zonder te crashen', () => {
    const value: Diagram = {
      markers: [],
      materiaal: [
        { type: 'doeltje', x: 20, y: 20, variant: 'groot' },
        { type: 'doeltje', x: 50, y: 50, variant: 'klein' },
        { type: 'doeltje', x: 80, y: 80, variant: 'mini' },
      ],
      lijnen: [],
    }
    renderEditor(value)
    expect(screen.getByTestId('diagram-materiaal-0')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-materiaal-1')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-materiaal-2')).toBeInTheDocument()
  })
})

describe('DiagramEditor — opnieuw genereren', () => {
  it('annuleren laat het diagram ongemoeid', () => {
    const value: Diagram = { markers: [], materiaal: [{ type: 'pion', x: 1, y: 1 }], lijnen: [] }
    const { onChange } = renderEditor(value)

    fireEvent.click(screen.getByText(nl.oefeningen.regenerate))
    expect(screen.getByText(nl.oefeningen.regenerateConfirm)).toBeInTheDocument()
    fireEvent.click(screen.getByText(nl.trainingPlan.cancel))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(nl.oefeningen.regenerateConfirm)).not.toBeInTheDocument()
  })

  it('bevestigen roept onChange aan met een vers gegenereerd diagram (via generateDiagram)', () => {
    const teams: OefeningTeam[] = [{ grootte: 4, formaties: ['2-1'] }]
    const value: Diagram = { markers: [], materiaal: [{ type: 'pion', x: 1, y: 1 }], lijnen: [] }
    const { onChange } = renderEditor(value, vi.fn(), { teams, aantalNeutralen: 2, veldzone: 'links' })

    fireEvent.click(screen.getByText(nl.oefeningen.regenerate))
    fireEvent.click(screen.getByText(nl.oefeningen.regenerateConfirmButton))

    expect(onChange).toHaveBeenCalledWith(generateDiagram(teams, 2, 'links'))
  })
})
