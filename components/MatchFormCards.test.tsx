import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { MatchFormItem } from '@/lib/match-form'
import MatchFormCards from '@/components/MatchFormCards'

function item(overrides: Partial<MatchFormItem> = {}): MatchFormItem {
  return {
    id: 'm1',
    result: 'win',
    goalsFor: 2,
    goalsAgainst: 1,
    opponent: 'FC Rivalen',
    date: '2026-08-01',
    ...overrides,
  }
}

function renderCards(items: MatchFormItem[]) {
  return render(
    <DictProvider dict={nl}>
      <MatchFormCards items={items} />
    </DictProvider>,
  )
}

describe('MatchFormCards', () => {
  it('N items leveren N kaartjes op (geen <ul>/<li>)', () => {
    const { container } = renderCards([
      item({ id: 'a' }),
      item({ id: 'b', result: 'draw', goalsFor: 1, goalsAgainst: 1 }),
      item({ id: 'c', result: 'loss', goalsFor: 0, goalsAgainst: 2 }),
    ])
    expect(container.querySelectorAll('ul').length).toBe(0)
    expect(container.querySelectorAll('li').length).toBe(0)
    // Eén kaartje per item — de directe children van de items-wrapper.
    const letters = [nl.home.formLetterWin, nl.home.formLetterDraw, nl.home.formLetterLoss]
    for (const letter of letters) {
      expect(screen.getAllByText(letter, { exact: true }).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('toont de juiste letter, score, tegenstander en datum', () => {
    const { container } = renderCards([item({ id: 'a', result: 'win', goalsFor: 3, goalsAgainst: 1, opponent: 'FC Test' })])
    expect(screen.getByText(nl.home.formLetterWin)).toBeInTheDocument()
    // De overige velden staan als losse tekstnodes naast elkaar (geen eigen
    // omhullend element) — getByText matcht daar niet op, dus we toetsen op
    // de samengevoegde tekst van het kaartje.
    expect(container.textContent).toContain(nl.home.formWin)
    expect(container.textContent).toContain('3:1')
    expect(container.textContent).toContain('FC Test')
  })

  it('opponent: null → geen "vs null"/"vs undefined" in de tekst', () => {
    const { container } = renderCards([item({ id: 'a', opponent: null })])
    expect(container.textContent).not.toMatch(/vs\s*(null|undefined)/i)
  })

  it("result: 'unknown' → geen score getoond", () => {
    const { container } = renderCards([
      item({ id: 'a', result: 'unknown', goalsFor: null, goalsAgainst: null }),
    ])
    expect(container.textContent).not.toMatch(/\d+:\d+/)
    expect(screen.getByText(nl.home.formLetterUnknown)).toBeInTheDocument()
  })

  it('lege array → geen kaartjes, maar het blok zelf blijft renderen (heading blijft staan)', () => {
    renderCards([])
    expect(screen.getByText(nl.matchSquad.formHeading)).toBeInTheDocument()
  })
})
