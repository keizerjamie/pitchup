import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { nl } from '@/messages/nl'
import type { AttendanceStatus } from '@/lib/types'
import Availability, { type AvailabilityItem } from '@/components/dashboard/Availability'

function item(id: string, status: AttendanceStatus, overrides: Partial<AvailabilityItem> = {}): AvailabilityItem {
  return { id, initials: 'AB', avatarBg: '#000', name: `Speler ${id}`, num: 7, pos: 'Spits', status, injured: false, ...overrides }
}

describe('Availability', () => {
  it('toont de lege staat zonder items', () => {
    render(<Availability items={[]} t={nl} />)
    expect(screen.getByText(nl.home.empty)).toBeInTheDocument()
  })

  it('rendert een chip per status, met het juiste label', () => {
    render(<Availability items={[item('a', 'present'), item('b', 'absent'), item('c', 'unknown')]} t={nl} />)
    expect(screen.getByText(nl.home.present)).toBeInTheDocument()
    expect(screen.getByText(nl.home.absent)).toBeInTheDocument()
    expect(screen.getByText(nl.home.noResponse)).toBeInTheDocument()
  })

  it('crasht niet op status "injured" en toont label Geblesseerd met dezelfde rode tint als afwezig', () => {
    render(<Availability items={[item('a', 'absent'), item('b', 'injured')]} t={nl} />)
    const afwezig = screen.getByText(nl.home.absent)
    const geblesseerd = screen.getByText(nl.home.injuredStatus)
    expect(geblesseerd).toBeInTheDocument()
    expect(geblesseerd.style.background).toBe(afwezig.style.background)
    expect(geblesseerd.style.color).toBe(afwezig.style.color)
  })
})
