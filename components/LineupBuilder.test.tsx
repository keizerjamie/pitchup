import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import type { PlayerForm } from '@/lib/lineup-form'
import LineupBuilder from '@/components/LineupBuilder'
import { saveLineup } from '@/app/actions/attendance'

vi.mock('@/app/actions/attendance', () => ({
  saveLineup: vi.fn().mockResolvedValue({ legePosities: 0, selectieAutomatischGevuld: false, selectieFout: false }),
}))

beforeEach(() => {
  // LineupBuilder gebruikt useReducedMotion (lib/use-reduced-motion.ts) voor de
  // inslag-animatie bij het plaatsen van een speler; jsdom kent
  // window.matchMedia niet standaard. Zelfde stub als
  // components/PlayerList.test.tsx.
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
function renderBuilder(players: Player[], playerForm: Record<string, PlayerForm>, canEdit?: boolean) {
  return render(
    <DictProvider dict={nl}>
      <LineupBuilder eventId="event-1" players={players} playerForm={playerForm} canEdit={canEdit} />
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

describe('canEdit (assistent-trainers fase 2, brief §4.5)', () => {
  it('canEdit=false verbergt "Automatisch opstellen", de opslaan-knop, en een tik op een slot doet niets', () => {
    const players = [player({ id: 'p1', name: 'Eva Fontein' })]
    const playerForm = { p1: form() }
    renderBuilder(players, playerForm, false)

    expect(screen.queryByText(nl.lineup.autoLineup)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.lineup.save })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('CM'))
    // Geen popup: geen "Eva" als selecteerbare speler in een lijst.
    expect(screen.queryByText('Eva')).not.toBeInTheDocument()
  })

  it('canEdit=true (default) toont de auto-opstelknop en de opslaan-knop gewoon', () => {
    const players = [player({ id: 'p1', name: 'Eva Fontein' })]
    renderBuilder(players, { p1: form() })
    expect(screen.getByText(nl.lineup.autoLineup)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.lineup.save })).toBeInTheDocument()
  })
})

// Kloppende cijfers (punt 4): saveLineup geeft een SaveLineupResultaat terug;
// LineupBuilder meldt een onvolledige opstelling, een mislukte auto-selectie en
// een mislukte opslag.
describe('LineupBuilder — meldingen na opslaan (SaveLineupResultaat)', () => {
  const resultaat = (o: Partial<{ legePosities: number | null; selectieAutomatischGevuld: boolean; selectieFout: boolean }> = {}) =>
    ({ legePosities: 0, selectieAutomatischGevuld: false, selectieFout: false, ...o })

  async function slaOp() {
    renderBuilder([player()], { p1: form() })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
  }

  it('3 lege posities: meervoud met aantal, in een role=status', async () => {
    vi.mocked(saveLineup).mockResolvedValueOnce(resultaat({ legePosities: 3 }))
    await slaOp()
    const tekst = nl.lineup.savedIncompleteMany.replace('{n}', '3')
    expect(await screen.findByText(tekst)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(tekst)
  })

  it('1 lege positie: enkelvoud', async () => {
    vi.mocked(saveLineup).mockResolvedValueOnce(resultaat({ legePosities: 1 }))
    await slaOp()
    expect(await screen.findByText(nl.lineup.savedIncompleteOne)).toBeInTheDocument()
  })

  it('0 of onbekend (null) aantal lege posities: geen melding', async () => {
    vi.mocked(saveLineup).mockResolvedValueOnce(resultaat({ legePosities: null }))
    await slaOp()
    await screen.findByText(nl.lineup.saved)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('selectieFout: opstelling wel opgeslagen, aparte melding over de selectie', async () => {
    vi.mocked(saveLineup).mockResolvedValueOnce(resultaat({ selectieFout: true }))
    await slaOp()
    expect(await screen.findByText(nl.lineup.squadAutoFillError)).toBeInTheDocument()
    expect(screen.getByText(nl.lineup.saved)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gooit saveLineup: role=alert met saveError, geen "opgeslagen"-staat', async () => {
    vi.mocked(saveLineup).mockRejectedValueOnce(new Error('boom'))
    await slaOp()
    expect(await screen.findByRole('alert')).toHaveTextContent(nl.lineup.saveError)
    expect(screen.queryByText(nl.lineup.saved)).not.toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('wist de melding bij de volgende wijziging van de opstelling', async () => {
    vi.mocked(saveLineup).mockResolvedValueOnce(resultaat({ legePosities: 2 }))
    await slaOp()
    await screen.findByText(nl.lineup.savedIncompleteMany.replace('{n}', '2'))
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
  })
})
