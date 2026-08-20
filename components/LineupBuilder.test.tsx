import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import type { PlayerForm } from '@/lib/lineup-form'
import LineupBuilder from '@/components/LineupBuilder'

vi.mock('@/app/actions/attendance', () => ({
  saveLineup: vi.fn().mockResolvedValue(undefined),
}))

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Speler Een',
    position: 'Centrale middenvelder',
    secondary_positions: [],
    jersey_number: 8,
    active: true,
    injured: false,
    type: 'regular',
    rating: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function form(overrides: Partial<PlayerForm> = {}): PlayerForm {
  return { quality: 5, count: 0, trend: 'none', ...overrides }
}

// De formatiepositie op x=50,y=48 in het 4-3-3 (lib/types.ts) heeft
// position_label 'CM', wat via POSITION_LABEL_MAP naar 'Centrale
// middenvelder' vertaalt — dezelfde positie als onze testspelers.
function renderBuilder(players: Player[], playerForm: Record<string, PlayerForm>) {
  return render(
    <DictProvider dict={nl}>
      <LineupBuilder eventId="event-1" players={players} playerForm={playerForm} />
    </DictProvider>,
  )
}

function openCmSlot() {
  // De onbezette CM-slot in het standaard 4-3-3 toont zijn position_label
  // ('CM') als bijschrift — dat is uniek binnen deze formatie.
  fireEvent.click(screen.getByText('CM'))
}

describe('LineupBuilder — spelersvorm in de popup', () => {
  it('toont cijfer met pijl bij X >= 3 (trend up)', () => {
    const players = [player({ id: 'p1', name: 'Anna Bakker', rating: 7 })]
    const playerForm = { p1: form({ quality: 7.4, count: 5, trend: 'up' }) }
    renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('CM · 7,4 ↑ (5)')).toBeInTheDocument()
  })

  it('toont cijfer zonder pijl bij X < 3', () => {
    const players = [player({ id: 'p1', name: 'Bram Claes', rating: 6 })]
    const playerForm = { p1: form({ quality: 6.2, count: 2, trend: 'none' }) }
    renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('CM · 6,2 (2)')).toBeInTheDocument()
  })

  it('toont "(0)" met cijfer wanneer players.rating handmatig is gezet maar er geen beoordeelde wedstrijden zijn', () => {
    const players = [player({ id: 'p1', name: 'Carla Dijk', rating: 6 })]
    const playerForm = { p1: form({ quality: 6, count: 0, trend: 'none' }) }
    renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('CM · 6,0 (0)')).toBeInTheDocument()
  })

  it('toont géén cijfer wanneer zowel players.rating als count 0 ontbreken', () => {
    const players = [player({ id: 'p1', name: 'Dirk Evers', rating: null })]
    const playerForm = { p1: form({ quality: 5, count: 0, trend: 'none' }) }
    renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('CM · (0)')).toBeInTheDocument()
  })

  it('toont géén cijfer wanneer players.rating buiten 1..10 valt en count 0 is', () => {
    // Een ongeldige handmatige rating (bijv. 0 of 11) is geen coachoordeel —
    // form.quality is dan de rekenfallback ANKER_FALLBACK (5), die hier niet
    // als "5,0" mag verschijnen.
    const players = [player({ id: 'p1', name: 'Guus Hendriks', rating: 11 })]
    const playerForm = { p1: form({ quality: 5, count: 0, trend: 'none' }) }
    renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('CM · (0)')).toBeInTheDocument()
  })

  it('rankt op formOf(p).quality, niet op players.rating — een lagere rating met hogere quality wint de aanbeveling', () => {
    // p1 heeft de hoogste players.rating (9) maar een lage vormkwaliteit.
    // p2 heeft een lagere players.rating (4) maar de hoogste vormkwaliteit.
    const players = [
      player({ id: 'p1', name: 'Eva Fontein', rating: 9 }),
      player({ id: 'p2', name: 'Finn Groen', rating: 4 }),
    ]
    const playerForm = {
      p1: form({ quality: 3, count: 5, trend: 'down' }),
      p2: form({ quality: 8.5, count: 5, trend: 'up' }),
    }
    const { container } = renderBuilder(players, playerForm)
    openCmSlot()
    expect(screen.getByText('★ Aanbevolen')).toBeInTheDocument()
    // De aanbevolen speler (hoogste quality) staat vóór de andere
    // beschikbare speler in de DOM-volgorde van de popup.
    const names = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '')
    const finnIdx = names.findIndex((t) => t.includes('Finn'))
    const evaIdx = names.findIndex((t) => t.includes('Eva'))
    expect(finnIdx).toBeGreaterThanOrEqual(0)
    expect(evaIdx).toBeGreaterThanOrEqual(0)
    expect(finnIdx).toBeLessThan(evaIdx)
  })
})
