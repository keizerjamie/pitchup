import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import ParallelGroepEditor from '@/components/ParallelGroepEditor'
import type { Oefening, Player, TrainingOefeningWithData } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'

vi.mock('@/app/actions/training-plan', () => ({
  saveParallelIndeling: vi.fn().mockResolvedValue(undefined),
  verplaatsParallelSpeler: vi.fn().mockResolvedValue(undefined),
}))

import { saveParallelIndeling, verplaatsParallelSpeler } from '@/app/actions/training-plan'
const mockSave = saveParallelIndeling as unknown as ReturnType<typeof vi.fn>
const mockVerplaats = verplaatsParallelSpeler as unknown as ReturnType<typeof vi.fn>

// jsdom kent geen native PointerEvent — zelfde aanpak als TeamIndelingEditor.test.tsx:16-30.
function pointerEvent(type: string, init: { clientX: number; clientY: number; pointerId?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    clientX: init.clientX,
    clientY: init.clientY,
    pointerId: init.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  })
  return event
}

function stubRect(el: Element, rect: { left: number; top: number; right: number; bottom: number }) {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }) as DOMRect
}

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
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players: Player[] = [
  makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 1 }),
  makePlayer({ id: 'p2', name: 'Jan Jansen', jersey_number: 2 }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen', jersey_number: 3 }),
  makePlayer({ id: 'p4', name: 'Bram Bakker', jersey_number: 4 }),
]

function makeOefeningFixture(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team1',
    naam: 'Oefening A',
    beschrijving: null,
    categorie: 'positiespel',
    duur_min: 10,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [{ grootte: 2, formaties: [] }],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeLid(overrides: Partial<TrainingOefeningWithData> & { oefeningen?: Partial<Oefening> } = {}): TrainingOefeningMetBezetting {
  const { oefeningen, ...rest } = overrides
  const basis = { ...makeOefeningFixture(), ...oefeningen }
  const lid: TrainingOefeningWithData = {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    parallel_groep_id: 'g1',
    parallel_spelers: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: basis,
    ...rest,
  }
  return { ...lid, bezetting: concretiseerBezetting(lid.oefeningen, lid.aantallen_override ?? null) }
}

const twoLeden: TrainingOefeningMetBezetting[] = [
  makeLid({ id: 'k1', oefening_id: 'o1', oefeningen: makeOefeningFixture({ id: 'o1', naam: 'Oefening A' }) }),
  makeLid({ id: 'k2', oefening_id: 'o2', oefeningen: makeOefeningFixture({ id: 'o2', naam: 'Oefening B' }) }),
]

function renderEditor(overrides: {
  leden?: TrainingOefeningMetBezetting[]
  players?: Player[]
  presentPlayerIds?: string[]
} = {}) {
  return render(
    <DictProvider dict={nl}>
      <ParallelGroepEditor
        eventId="e1"
        groepId="g1"
        leden={overrides.leden ?? twoLeden}
        players={overrides.players ?? players}
        presentPlayerIds={overrides.presentPlayerIds ?? ['p1', 'p2', 'p3', 'p4']}
      />
    </DictProvider>,
  )
}

describe('ParallelGroepEditor — drag & drop (unified Pointer Events)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('slepen van een poolspeler naar lid X roept saveParallelIndeling aan met de juiste lijst', async () => {
    const { container } = renderEditor()
    const lid1 = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    stubRect(lid1, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByRole('button', { name: /Piet/ })
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 310 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 250, clientY: 50 }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    expect(mockSave).toHaveBeenCalledWith('k1', 'e1', ['p1'])
  })

  it('slepen van lid X naar lid Y roept de atomaire verplaatsParallelSpeler precies één keer aan', async () => {
    const { container } = renderEditor({
      leden: [{ ...twoLeden[0], parallel_spelers: ['p1'] }, twoLeden[1]],
    })
    const lid2 = container.querySelector('[data-testid="parallelgroep-lid-k2"]') as HTMLElement
    stubRect(lid2, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByText('Piet')
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 250, clientY: 50 }))

    await waitFor(() => expect(mockVerplaats).toHaveBeenCalledTimes(1))
    expect(mockVerplaats).toHaveBeenCalledWith('e1', 'k1', 'k2', 'p1')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('een klik (pointerdown+pointerup zonder noemenswaardige beweging) selecteert nog steeds', () => {
    renderEditor()

    const chip = screen.getByRole('button', { name: /Piet/ })
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 11, clientY: 11 }))

    expect(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A'))).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('slepen waarbij pointerdown + pointermove(s) + pointerup in ÉÉN React-batch binnenkomen wordt als sleep afgehandeld, niet als klik', async () => {
    const { container } = renderEditor()
    const lid1 = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    stubRect(lid1, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByRole('button', { name: /Piet/ })

    await act(async () => {
      chip.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
      chip.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 30 }))
      chip.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
      chip.dispatchEvent(pointerEvent('pointerup', { clientX: 250, clientY: 50 }))
    })

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', ['p1']))
    expect(screen.queryByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A'))).not.toBeInTheDocument()
  })
})

describe('ParallelGroepEditor — klik-fallback (toetsenbord/screenreader)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selecteren via klik en toewijzen via de "Verplaats naar"-knop werkt zonder pointer-events', async () => {
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: /Jan/ }))
    fireEvent.click(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening B')))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k2', 'e1', ['p2']))
  })
})

describe('ParallelGroepEditor — opslaan mislukt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rolt terug naar de laatst bevestigde verdeling en toont de generieke i18n-melding, niet de rauwe serverstring', async () => {
    mockSave.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.parallelGroep.moveTo.replace('{target}', 'Oefening A')))

    // Optimistisch verschijnt Piet meteen bij Oefening A...
    await waitFor(() => expect(screen.getAllByText('Piet').length).toBeGreaterThan(0))

    // ...maar zodra de save faalt: generieke melding, geen rauwe DB-fout, en
    // Piet is weer selecteerbaar in de pool (rollback).
    await waitFor(() => expect(screen.getByText(nl.parallelGroep.saveError)).toBeInTheDocument())
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
  })

  it('lid → lid: als verplaatsParallelSpeler faalt, rolt de UI terug, toont de generieke melding en verdwijnt de speler niet stilzwijgend', async () => {
    mockVerplaats.mockRejectedValueOnce(new Error('Speler in meerdere oefeningen'))
    const { container } = renderEditor({
      leden: [{ ...twoLeden[0], parallel_spelers: ['p1'] }, twoLeden[1]],
    })
    const lid2 = container.querySelector('[data-testid="parallelgroep-lid-k2"]') as HTMLElement
    stubRect(lid2, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByText('Piet')
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 250, clientY: 50 }))

    await waitFor(() => expect(mockVerplaats).toHaveBeenCalledTimes(1))

    // Generieke melding, geen rauwe serverstring.
    await waitFor(() => expect(screen.getByText(nl.parallelGroep.saveError)).toBeInTheDocument())
    expect(screen.queryByText(/Speler in meerdere oefeningen/)).not.toBeInTheDocument()

    // Rollback: Piet staat weer (alleen) bij lid k1, is niet stilzwijgend verdwenen.
    const lid1 = container.querySelector('[data-testid="parallelgroep-lid-k1"]') as HTMLElement
    expect(lid1.textContent).toContain('Piet')
    const lid2El = container.querySelector('[data-testid="parallelgroep-lid-k2"]') as HTMLElement
    expect(lid2El.textContent).not.toContain('Piet')
  })
})

describe('ParallelGroepEditor — print (V6: alleen namen, geen tekort/overschot)', () => {
  it('het print-blok toont alleen namen per oefening, het scherm-blok toont wel het tekort', () => {
    const { container } = renderEditor({
      leden: [
        { ...twoLeden[0], parallel_spelers: ['p1'] }, // 1 van de 2 benodigd → tekort
        twoLeden[1],
      ],
    })

    // Scherm: tekort-melding zichtbaar.
    expect(screen.getByText(nl.parallelGroep.tekort.replace('{n}', '1'))).toBeInTheDocument()

    // Print-blok: alleen naam + oefeningnaam, geen tekort/overschot-tekst.
    const printBlok = container.querySelector('[data-testid="parallelgroep-print"]') as HTMLElement
    expect(printBlok.textContent).toContain('Oefening A')
    expect(printBlok.textContent).toContain('Piet Peters')
    expect(printBlok.textContent).not.toContain(nl.parallelGroep.tekort.replace('{n}', '1'))
  })
})

describe('ParallelGroepEditor — waarschuwingen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toont een afwezig-waarschuwing voor een ingedeelde speler die niet meer aanwezig is, zonder hem te verwijderen', () => {
    renderEditor({
      leden: [{ ...twoLeden[0], parallel_spelers: ['p1'] }, twoLeden[1]],
      presentPlayerIds: ['p2', 'p3', 'p4'],
    })

    expect(screen.getByText(nl.parallelGroep.absentWarning)).toBeInTheDocument()
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })
})
