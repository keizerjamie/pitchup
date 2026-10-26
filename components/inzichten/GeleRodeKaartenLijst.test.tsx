import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { SpelerMomentenRij } from '@/lib/inzichten'
import GeleRodeKaartenLijst from './GeleRodeKaartenLijst'

const speler = (o: Partial<SpelerMomentenRij>): SpelerMomentenRij => ({
  player_id: 'p', naam: 'Piet', gast: false, doelpunten: 0, assists: 0, geel: 0, rood: 0, ...o,
})
const i = nl.insights

describe('GeleRodeKaartenLijst', () => {
  it('toont de betekenis in tekst, met aria-hidden chipjes in tokenkleuren', () => {
    const { container } = render(
      <GeleRodeKaartenLijst rijen={[speler({ geel: 2, rood: 1 }), speler({ player_id: 'g', naam: 'Gijs', gast: true, geel: 1 })]} fout={false} t={nl} />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('2 geel · 1 rood')
    expect(items[1]).toHaveTextContent(i.gastLabel)
    const chips = Array.from(container.querySelectorAll('span[aria-hidden="true"]')) as HTMLElement[]
    expect(chips.length).toBe(3)
    expect(chips[0].style.background).toBe('var(--chip-amber-fg)')
    expect(chips[1].style.background).toBe('var(--chip-red-fg)')
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('lege staat en foutstaat', () => {
    const { rerender } = render(<GeleRodeKaartenLijst rijen={[]} fout={false} t={nl} />)
    expect(screen.getByText(i.kaartenEmpty)).toBeInTheDocument()
    rerender(<GeleRodeKaartenLijst rijen={[]} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
  })
})
