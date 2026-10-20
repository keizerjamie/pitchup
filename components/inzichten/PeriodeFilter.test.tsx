import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import PeriodeFilter from '@/components/inzichten/PeriodeFilter'

describe('PeriodeFilter', () => {
  it('zonder hrefVoor blijven de /inzichten-links ongewijzigd', () => {
    render(<PeriodeFilter actief="seizoen" t={nl} />)
    expect(screen.getByRole('link', { name: nl.insights.periodeSeizoen })).toHaveAttribute('href', '/inzichten')
    expect(screen.getByRole('link', { name: nl.insights.periode4w })).toHaveAttribute('href', '/inzichten?periode=4w')
    expect(screen.getByRole('link', { name: nl.insights.periode8w })).toHaveAttribute('href', '/inzichten?periode=8w')
  })

  it('met hrefVoor bepaalt de aanroeper de links', () => {
    render(<PeriodeFilter actief="4w" t={nl} hrefVoor={(p) => `/elders?p=${p}`} />)
    expect(screen.getByRole('link', { name: nl.insights.periode4w })).toHaveAttribute('href', '/elders?p=4w')
    expect(screen.getByRole('link', { name: nl.insights.periodeSeizoen })).toHaveAttribute('href', '/elders?p=seizoen')
  })

  it('markeert alleen de actieve periode met aria-current', () => {
    render(<PeriodeFilter actief="8w" t={nl} />)
    expect(screen.getByRole('link', { name: nl.insights.periode8w })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: nl.insights.periode4w })).not.toHaveAttribute('aria-current')
  })
})
