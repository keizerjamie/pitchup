import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Diagram } from '@/lib/types'
import DiagramView from '@/components/DiagramView'

const diagram: Diagram = {
  markers: [
    { x: 50, y: 90, teamIndex: 0, rol: 'keeper', label: 'K' },
    { x: 30, y: 60, teamIndex: 1, rol: 'speler', label: 'V' },
    { x: 70, y: 20, teamIndex: null, rol: 'neutraal', label: '' },
  ],
  materiaal: [
    { type: 'pion', x: 20, y: 20 },
    { type: 'bal', x: 50, y: 50 },
    { type: 'doeltje', x: 80, y: 80 },
  ],
  lijnen: [
    { stijl: 'pass', punten: [{ x: 10, y: 10 }, { x: 40, y: 40 }] },
    { stijl: 'loop', punten: [{ x: 10, y: 100 }, { x: 40, y: 90 }] },
    { stijl: 'dribbel', punten: [{ x: 10, y: 120 }, { x: 40, y: 110 }, { x: 60, y: 100 }] },
  ],
}

describe('DiagramView', () => {
  it('rendert niets wanneer diagram null is', () => {
    const { container } = render(<DiagramView diagram={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('rendert markers, materiaal en lijnen read-only zonder te crashen', () => {
    render(<DiagramView diagram={diagram} />)
    expect(screen.getByTestId('diagram-view')).toBeInTheDocument()
    diagram.markers.forEach((_, i) => expect(screen.getByTestId(`diagram-view-marker-${i}`)).toBeInTheDocument())
    diagram.materiaal.forEach((_, i) => expect(screen.getByTestId(`diagram-view-materiaal-${i}`)).toBeInTheDocument())
    diagram.lijnen.forEach((_, i) => expect(screen.getByTestId(`diagram-view-lijn-${i}`)).toBeInTheDocument())
  })

  it('bevat geen interactieve elementen (geen buttons/inputs, geen pointer-handlers vereist)', () => {
    render(<DiagramView diagram={diagram} />)
    const view = screen.getByTestId('diagram-view')
    expect(view.querySelectorAll('button, input, select')).toHaveLength(0)
  })

  it('rendert een lege maar geldige svg wanneer alle lijsten leeg zijn', () => {
    render(<DiagramView diagram={{ markers: [], materiaal: [], lijnen: [] }} />)
    expect(screen.getByTestId('diagram-view')).toBeInTheDocument()
  })

  it('markers zijn klein/proportioneel (r ≤ 2.7 in het 0-100×0-140-stelsel)', () => {
    render(<DiagramView diagram={diagram} />)
    diagram.markers.forEach((_, i) => {
      const circle = screen.getByTestId(`diagram-view-marker-${i}`).querySelector('circle')
      expect(circle).not.toBeNull()
      const r = Number(circle!.getAttribute('r'))
      expect(r).toBeGreaterThan(0)
      expect(r).toBeLessThanOrEqual(2.7)
    })
  })

  it('de bal wordt getekend als voetbal: witte cirkel + zwarte centrale vijfhoek', () => {
    render(<DiagramView diagram={diagram} />)
    const bal = screen.getByTestId('diagram-view-materiaal-1')
    expect(bal.querySelector('circle')).not.toBeNull()
    const pentagon = bal.querySelector('polygon')
    expect(pentagon).not.toBeNull()
    expect(pentagon!.getAttribute('fill')).toBe('#111827')
  })

  it('doeltje zonder variant valt terug op "groot" (default van validateDiagram)', () => {
    render(<DiagramView diagram={diagram} />)
    const doeltje = screen.getByTestId('diagram-view-materiaal-2')
    expect(doeltje.querySelector('rect')).not.toBeNull()
  })

  it('marker zonder label (undefined, geen key) rendert zonder crash en zonder <text>', () => {
    // Backend: een team zonder formatie wordt losjes geplaatst → marker zonder
    // 'label'-veld (niet eens een lege string, het veld ontbreekt helemaal).
    const zonderLabel: Diagram = {
      markers: [{ x: 40, y: 60, teamIndex: 0, rol: 'speler' }],
      materiaal: [],
      lijnen: [],
    }
    render(<DiagramView diagram={zonderLabel} />)
    const marker = screen.getByTestId('diagram-view-marker-0')
    expect(marker.querySelector('circle')).not.toBeNull()
    expect(marker.querySelector('text')).toBeNull()
  })

  it('marker met keeper-rol zonder label rendert zonder crash (geen keeper vereist bij losse plaatsing)', () => {
    const zonderKeeperLabel: Diagram = {
      markers: [{ x: 20, y: 130, teamIndex: 1, rol: 'speler' }, { x: 50, y: 130, teamIndex: 1, rol: 'speler' }],
      materiaal: [],
      lijnen: [],
    }
    render(<DiagramView diagram={zonderKeeperLabel} />)
    expect(screen.getByTestId('diagram-view-marker-0').querySelector('text')).toBeNull()
    expect(screen.getByTestId('diagram-view-marker-1').querySelector('text')).toBeNull()
  })

  it('rendert de drie doeltje-varianten met een duidelijk verschillende breedte, zonder te crashen', () => {
    const withVariants: Diagram = {
      markers: [],
      materiaal: [
        { type: 'doeltje', x: 20, y: 20, variant: 'groot' },
        { type: 'doeltje', x: 50, y: 50, variant: 'klein' },
        { type: 'doeltje', x: 80, y: 80, variant: 'mini' },
      ],
      lijnen: [],
    }
    render(<DiagramView diagram={withVariants} />)
    const widths = [0, 1, 2].map((i) => {
      const rect = screen.getByTestId(`diagram-view-materiaal-${i}`).querySelector('rect')
      expect(rect).not.toBeNull()
      return Number(rect!.getAttribute('width'))
    })
    const [groot, klein, mini] = widths
    expect(groot).toBeGreaterThan(klein)
    expect(klein).toBeGreaterThan(mini)
  })
})
