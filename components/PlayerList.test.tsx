import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import PlayerList from '@/components/PlayerList'

vi.mock('@/app/actions/players', () => ({
  markInjured: vi.fn().mockResolvedValue(undefined),
  markRecovered: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    type: 'regular',
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderList(active: Player[], inactive: Player[] = []) {
  return render(
    <DictProvider dict={nl}>
      <PlayerList active={active} inactive={inactive} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // PlayerList gebruikt useReducedMotion (lib/use-reduced-motion.ts) voor de
  // bottom-sheet-animatie; jsdom kent window.matchMedia niet standaard. Zelfde
  // stub als wedstrijden-bulk-toevoegen.acceptance.test.tsx.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Gast-badge', () => {
  it('toont geen Gast-badge bij een reguliere speler', () => {
    renderList([makePlayer({ type: 'regular' })])
    expect(screen.queryByText(nl.players.guestBadge)).not.toBeInTheDocument()
  })

  it('toont de Gast-badge bij een gastspeler', () => {
    renderList([makePlayer({ type: 'guest' })])
    expect(screen.getByText(nl.players.guestBadge)).toBeInTheDocument()
  })

  it('toont BEIDE badges (Gast + Geblesseerd) als een gast ook geblesseerd is', () => {
    renderList([makePlayer({ type: 'guest', injured: true })])
    expect(screen.getByText(nl.players.guestBadge)).toBeInTheDocument()
    expect(screen.getByText(nl.players.injuredBadge)).toBeInTheDocument()
  })

  it('een inactieve gast staat gedimd in de inactief-sectie mét de Gast-badge', () => {
    renderList([], [makePlayer({ id: 'p2', name: 'Oud Gediende', type: 'guest', active: false })])
    expect(screen.getByText(nl.players.inactiveLabel)).toBeInTheDocument()
    const row = screen.getByText('Oud Gediende').closest('button') as HTMLElement
    expect(within(row).getByText(nl.players.guestBadge)).toBeInTheDocument()
    expect(row.className).toContain('opacity-55')
  })
})
