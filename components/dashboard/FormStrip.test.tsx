import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { matchResult } from '@/lib/match-analysis.mjs'
import FormStrip from '@/components/dashboard/FormStrip'

// Vijf afgeronde wedstrijden, nieuwste eerst — precies zoals de query in
// app/page.tsx ze aanlevert (win, draw, loss, win, draw).
const FIVE_ITEMS = [
  { id: 'm1', result: matchResult({ goals_for: 3, goals_against: 1 }) }, // win
  { id: 'm2', result: matchResult({ goals_for: 1, goals_against: 1 }) }, // draw
  { id: 'm3', result: matchResult({ goals_for: 0, goals_against: 2 }) }, // loss
  { id: 'm4', result: matchResult({ goals_for: 2, goals_against: 0 }) }, // win
  { id: 'm5', result: matchResult({ goals_for: 1, goals_against: 1 }) }, // draw
]

describe('FormStrip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rendert 5 items als 5 tekens, nieuwste (meest linkse) eerst, geen resorting', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={nl} />)
    expect(container.textContent).toBe('WGVWG')
  })

  it('gebruikt de letters uit de dictionary (en), niet hardcoded', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={en} />)
    expect(container.textContent).toBe('WDLWD')
  })

  it('gebruikt de letters uit de dictionary (de), niet hardcoded', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={de} />)
    expect(container.textContent).toBe('SUNSU')
  })

  it('gebruikt de juiste kleurtokens per uitslag', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={nl} />)
    const chips = container.querySelectorAll('span[aria-label]')
    expect(chips[0]).toHaveStyle({ color: 'var(--chip-green-fg)' }) // win
    expect(chips[1]).toHaveStyle({ color: 'var(--chip-amber-fg)' }) // draw
    expect(chips[2]).toHaveStyle({ color: 'var(--chip-red-fg)' }) // loss
  })

  it('elke chip heeft een aria-label met het volledige woord uit de dictionary', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={nl} />)
    const chips = container.querySelectorAll('span[aria-label]')
    expect(chips[0]).toHaveAttribute('aria-label', nl.home.formWin)
    expect(chips[1]).toHaveAttribute('aria-label', nl.home.formDraw)
    expect(chips[2]).toHaveAttribute('aria-label', nl.home.formLoss)
  })

  it('de container heeft role="group" en de juiste aria-label', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={nl} />)
    const group = container.querySelector('[role="group"]')
    expect(group).toHaveAttribute('aria-label', nl.home.formLabel)
  })

  it('result: unknown toont "?" met --faint op --track, geen groen/amber/rood', () => {
    const { container } = render(<FormStrip items={[{ id: 'u1', result: 'unknown' }]} t={nl} />)
    expect(container.textContent).toBe('?')
    const chip = container.querySelector('span[aria-label]') as HTMLElement
    expect(chip).toHaveStyle({ color: 'var(--faint)', background: 'var(--track)' })
    expect(chip).toHaveAttribute('aria-label', nl.home.formUnknown)
  })

  it('items: [] rendert niets (geen placeholder, geen lege strip)', () => {
    const { container } = render(<FormStrip items={[]} t={nl} />)
    expect(container.firstChild).toBeNull()
  })

  it('3 items renderen exact 3 tekens, geen opvulling tot 5', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS.slice(0, 3)} t={nl} />)
    expect(container.textContent).toBe('WGV')
  })

  it('regressie: geen hex-kleuren en geen light-mode-only classes in de output', () => {
    const { container } = render(<FormStrip items={FIVE_ITEMS} t={nl} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(container.innerHTML).not.toMatch(/text-gray-/)
    expect(container.innerHTML).not.toMatch(/bg-white/)
  })

  it('duplicate result-waarden met verschillende ids renderen zonder React key-warning', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const duplicateResults = [
      { id: 'd1', result: matchResult({ goals_for: 1, goals_against: 0 }) },
      { id: 'd2', result: matchResult({ goals_for: 1, goals_against: 0 }) },
      { id: 'd3', result: matchResult({ goals_for: 1, goals_against: 0 }) },
    ]
    render(<FormStrip items={duplicateResults} t={nl} />)
    const keyWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).toLowerCase().includes('key'),
    )
    expect(keyWarning).toBe(false)
  })
})
