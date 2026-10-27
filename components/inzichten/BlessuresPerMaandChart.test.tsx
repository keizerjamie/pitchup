import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nl } from '@/messages/nl'
import BlessuresPerMaandChart from './BlessuresPerMaandChart'

const i = nl.insights
const MAANDEN = [
  { maand: '2026-09', geblesseerd: 2 },
  { maand: '2026-10', geblesseerd: 0 },
  { maand: '2026-11', geblesseerd: null },
]

describe('BlessuresPerMaandChart', () => {
  it('sr-only tabel: maanden in volgorde, 0 blijft 0, null is geenGegevens', () => {
    render(<BlessuresPerMaandChart maanden={MAANDEN} fout={false} t={nl} />)
    const rows = Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.textContent)
    expect(rows).toEqual(['Sep 20262', 'Okt 20260', `Nov 2026${i.geenGegevens}`])
  })

  it('role="img" met aria-label (— bij geen gegevens); de tabel staat er NIET in', () => {
    render(<BlessuresPerMaandChart maanden={MAANDEN} fout={false} t={nl} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(i.blessuresSummary.replace('{reeks}', 'Sep 2026: 2, Okt 2026: 0, Nov 2026: —'))
    expect(img.querySelector('table')).toBeNull()
    expect(document.querySelector('table.sr-only')).not.toBeNull()
    expect(screen.getByRole('columnheader', { name: i.kolomGeblesseerd })).toBeInTheDocument()
  })

  it('alle waarden null: lege staat zonder grafiek', () => {
    render(<BlessuresPerMaandChart maanden={[{ maand: '2026-09', geblesseerd: null }]} fout={false} t={nl} />)
    expect(screen.getByText(i.blessuresEmpty)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('geen maanden: lege staat', () => {
    render(<BlessuresPerMaandChart maanden={[]} fout={false} t={nl} />)
    expect(screen.getByText(i.blessuresEmpty)).toBeInTheDocument()
  })

  it('foutstaat', () => {
    render(<BlessuresPerMaandChart maanden={MAANDEN} fout t={nl} />)
    expect(screen.getByText(i.bronFout)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('één maand met 0 rendert zonder crash', () => {
    expect(() => render(<BlessuresPerMaandChart maanden={[{ maand: '2026-09', geblesseerd: 0 }]} fout={false} t={nl} />)).not.toThrow()
    expect(within(screen.getByRole('img')).queryByText('NaN')).toBeNull()
  })

  it('geen hardcoded hex in markup of in style-blokken van de bron', () => {
    const { container } = render(<BlessuresPerMaandChart maanden={MAANDEN} fout={false} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    const source = readFileSync(path.join(process.cwd(), 'components/inzichten/BlessuresPerMaandChart.tsx'), 'utf-8')
    for (const block of source.match(/style=\{\{[\s\S]*?\}\}/g) ?? []) expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
