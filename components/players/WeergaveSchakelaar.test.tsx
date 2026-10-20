import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import WeergaveSchakelaar from '@/components/players/WeergaveSchakelaar'

describe('WeergaveSchakelaar', () => {
  it('rendert twee links in een groep met aria-label', () => {
    render(<WeergaveSchakelaar actief="lijst" t={nl} />)
    const groep = screen.getByRole('group', { name: nl.players.weergaveLabel })
    expect(within(groep).getAllByRole('link')).toHaveLength(2)
    expect(within(groep).getByRole('link', { name: nl.players.weergaveLijst })).toHaveAttribute('href', '/players')
    expect(within(groep).getByRole('link', { name: nl.players.weergaveAanwezigheid })).toHaveAttribute('href', '/players?weergave=aanwezigheid')
  })

  it.each([
    ['lijst', 'weergaveLijst', 'weergaveAanwezigheid'],
    ['aanwezigheid', 'weergaveAanwezigheid', 'weergaveLijst'],
  ] as const)('actief=%s: alleen die link heeft aria-current="page" en de primaire achtergrond', (actief, aan, uit) => {
    render(<WeergaveSchakelaar actief={actief} t={nl} />)
    const actieveLink = screen.getByRole('link', { name: nl.players[aan] })
    const andere = screen.getByRole('link', { name: nl.players[uit] })
    expect(actieveLink).toHaveAttribute('aria-current', 'page')
    expect(actieveLink.style.background).toBe('var(--primary)')
    expect(andere).not.toHaveAttribute('aria-current')
    expect(andere.style.background).toBe('var(--surface-sunken)')
  })

  it('heeft een tikdoel van 44px (h-11) en drukfeedback', () => {
    render(<WeergaveSchakelaar actief="lijst" t={nl} />)
    const link = screen.getByRole('link', { name: nl.players.weergaveLijst })
    expect(link.className).toContain('h-11')
    expect(link.className).toContain('active:scale-[0.97]')
  })
})
