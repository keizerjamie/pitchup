import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { telPerKwartier } from '@/lib/inzichten'
import KwartierChart from './KwartierChart'

const i = nl.insights

describe('KwartierChart', () => {
  it('role="img" met samenvatting; datatabel is sibling (niet erbinnen) met alle zeven bakken', () => {
    const { container } = render(
      <KwartierChart telling={telPerKwartier([{ minuut: 10, aantal: 2 }, { minuut: 95, aantal: 1 }, { minuut: null, aantal: 1 }])} fout={false} t={nl} />,
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toContain('1–15: 2')
    expect(img.getAttribute('aria-label')).toContain('90+: 1')
    expect(img.querySelector('table')).toBeNull()
    const tabel = container.querySelector('table.sr-only') as HTMLElement
    expect(within(tabel).getAllByRole('row')).toHaveLength(8) // kop + 7 bakken
    expect(screen.getByText('3 van 4 doelpunten met minuut')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('alleen doelpunten zonder minuut: lege staat (geen kolom "onbekend")', () => {
    render(<KwartierChart telling={telPerKwartier([{ minuut: null, aantal: 3 }])} fout={false} t={nl} />)
    expect(screen.getByText(i.kwartierEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('foutstaat', () => {
    render(<KwartierChart telling={telPerKwartier([])} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
  })
})
