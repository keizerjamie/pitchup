import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { SpelerStatistieken } from '@/lib/inzichten'
import PlayerStatsTab from '@/components/players/PlayerStatsTab'

function makeStats(overrides: Partial<SpelerStatistieken> = {}): SpelerStatistieken {
  return {
    aanwezig: 8,
    afwezig: 2,
    aanwezigheidPercentage: 80,
    ratingReeks: [],
    gemiddeldeRating: null,
    tellingen: { doelpunten: 0, assists: 0, geel: 0, rood: 0 },
    ...overrides,
  }
}

describe('PlayerStatsTab', () => {
  it('toont de lege staat met een link naar /settings wanneer stats null is (AC18)', () => {
    render(<PlayerStatsTab stats={null} statsError={false} excludedHint={false} t={nl} />)
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    const link = screen.getByText(nl.insights.goToSettings).closest('a')
    expect(link).toHaveAttribute('href', '/settings')
    // Geen cijfers in de DOM bij de lege staat.
    expect(screen.queryByText('%')).not.toBeInTheDocument()
  })

  it('toont NOOIT "0%" wanneer aanwezigheidPercentage null is', () => {
    render(<PlayerStatsTab stats={makeStats({ aanwezigheidPercentage: null })} statsError={false} excludedHint={false} t={nl} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByText(nl.players.statsAttendanceEmpty)).toBeInTheDocument()
  })

  it('toont vier zichtbare nullen bij lege tellingen (AC17)', () => {
    render(
      <PlayerStatsTab
        stats={makeStats({ tellingen: { doelpunten: 0, assists: 0, geel: 0, rood: 0 } })}
        statsError={false}
        excludedHint={false}
        t={nl}
      />,
    )
    expect(screen.getAllByText('0')).toHaveLength(4)
  })

  it('rondt de gemiddelde beoordeling af op 1 decimaal', () => {
    render(<PlayerStatsTab stats={makeStats({ gemiddeldeRating: 7.666 })} statsError={false} excludedHint={false} t={nl} />)
    expect(screen.getByText('7.7')).toBeInTheDocument()
  })

  it('toont de statsExcludedHint bij een gast- of inactieve speler', () => {
    render(<PlayerStatsTab stats={makeStats()} statsError={false} excludedHint t={nl} />)
    expect(screen.getByText(nl.players.statsExcludedHint)).toBeInTheDocument()
  })

  it('toont geen statsExcludedHint bij een reguliere actieve speler', () => {
    render(<PlayerStatsTab stats={makeStats()} statsError={false} excludedHint={false} t={nl} />)
    expect(screen.queryByText(nl.players.statsExcludedHint)).not.toBeInTheDocument()
  })

  describe('Fouttoestand (validator-bevinding: getSpelerStatistieken kan gooien)', () => {
    it('toont een generieke melding bij statsError, nooit de rauwe actionfout', () => {
      render(<PlayerStatsTab stats={null} statsError t={nl} excludedHint={false} />)
      expect(screen.getByText(nl.players.statsLoadError)).toBeInTheDocument()
      // Geen "geen seizoen"-lege staat en geen link naar /settings in de fouttoestand.
      expect(screen.queryByText(nl.insights.noSeason)).not.toBeInTheDocument()
      expect(screen.queryByText(nl.insights.goToSettings)).not.toBeInTheDocument()
    })

    it('statsError wint van stats === null (fout ≠ "geen seizoen")', () => {
      render(<PlayerStatsTab stats={null} statsError t={nl} excludedHint={false} />)
      expect(screen.getByText(nl.players.statsLoadError)).toBeInTheDocument()
    })

    it('toont geen cijfers wanneer statsError true is, ook niet als stats toevallig data bevat', () => {
      render(<PlayerStatsTab stats={makeStats({ gemiddeldeRating: 7.5 })} statsError t={nl} excludedHint={false} />)
      expect(screen.getByText(nl.players.statsLoadError)).toBeInTheDocument()
      expect(screen.queryByText('7.5')).not.toBeInTheDocument()
    })
  })
})
