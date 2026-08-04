import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TeamIndelingEditor from '@/components/TeamIndelingEditor'
import type { OefeningTeam, Player } from '@/lib/types'

vi.mock('@/app/actions/training-plan', () => ({
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
}))

import { saveSpelerindeling } from '@/app/actions/training-plan'
const mockSave = saveSpelerindeling as unknown as ReturnType<typeof vi.fn>

// jsdom kent geen native PointerEvent (zie DiagramEditor.test.tsx:9-26): bouw
// zelf een generiek Event met de clientX/clientY/pointerId-velden op, dat
// React's synthetic event-laag via directe property-toegang leest.
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

// Stubt de bounding rect van een teamkaart/pool-dropzone zodat zoneAt() in het
// component een voorspelbare uitkomst geeft (jsdom layout't niet echt).
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

const twoTeams: OefeningTeam[] = [
  { grootte: 2, formaties: [] },
  { grootte: 2, formaties: [] },
]

function renderEditor(overrides: {
  teams?: OefeningTeam[]
  initialIndeling?: string[][]
  players?: Player[]
  presentPlayerIds?: string[]
} = {}) {
  return render(
    <DictProvider dict={nl}>
      <TeamIndelingEditor
        koppelingId="k1"
        eventId="e1"
        teams={overrides.teams ?? twoTeams}
        initialIndeling={overrides.initialIndeling ?? []}
        players={overrides.players ?? players}
        presentPlayerIds={overrides.presentPlayerIds ?? ['p1', 'p2', 'p3', 'p4']}
      />
    </DictProvider>,
  )
}

describe('TeamIndelingEditor — pool en handmatig koppelen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('koppelt een poolspeler aan een team: verschijnt in de teamkaart en verdwijnt uit de pool', async () => {
    renderEditor()

    // Pool-chip toont jersey + naam samen — matchen op substring via de rol.
    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    // Speler staat nu als teamchip (kale naam, geen shirtnummer) — pool-variant is weg.
    expect(screen.getByText('Piet')).toBeInTheDocument()
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [['p1'], []]))
  })

  it('verwijdert een ingedeelde speler uit een team: hij komt terug in de pool', async () => {
    renderEditor({ initialIndeling: [['p1'], []] })

    expect(screen.getByText('Piet')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(`${nl.teamIndeling.remove}: Piet`))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [[], []]))
    // Terug als selecteerbare poolspeler (nu weer met shirtnummer in dezelfde knop).
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
  })

  it('een niet-aanwezige speler staat niet in de pool', () => {
    renderEditor({ presentPlayerIds: ['p1', 'p2'] })

    expect(screen.queryByRole('button', { name: /Kees/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bram/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jan/ })).toBeInTheDocument()
  })

  it('een al ingedeelde speler naar een ander team koppelen schuift hem automatisch mee', async () => {
    renderEditor({ initialIndeling: [['p1'], []] })

    // Selecteer de al-ingedeelde speler (teamchip, kale naam) en verplaats naar Team 2.
    fireEvent.click(screen.getByText('Piet'))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 2')))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [[], ['p1']]))
  })
})

describe('TeamIndelingEditor — drag & drop (unified Pointer Events)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('slepen van een poolspeler naar een teamkaart wijst hem aan dat team toe en slaat op', async () => {
    const { container } = renderEditor()
    const team0 = container.querySelector('[data-testid="teamindeling-team-0"]') as HTMLElement
    stubRect(team0, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByRole('button', { name: /Piet/ })
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 310 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 250, clientY: 50 }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [['p1'], []]))
  })

  it('slepen van team A naar team B verplaatst de speler (weg uit A)', async () => {
    const { container } = renderEditor({ initialIndeling: [['p1'], []] })
    const team1 = container.querySelector('[data-testid="teamindeling-team-1"]') as HTMLElement
    stubRect(team1, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByText('Piet')
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 250, clientY: 50 }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [[], ['p1']]))
  })

  it('slepen van een team naar de pool koppelt de speler los', async () => {
    const { container } = renderEditor({ initialIndeling: [['p1'], []] })
    const pool = container.querySelector('[data-testid="teamindeling-pool"]') as HTMLElement
    stubRect(pool, { left: 0, top: 300, right: 400, bottom: 400 })

    const chip = screen.getByText('Piet')
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointermove', { clientX: 50, clientY: 350 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 50, clientY: 350 }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [[], []]))
  })

  it('een klik (pointerdown+pointerup zonder noemenswaardige beweging) selecteert nog steeds', () => {
    renderEditor()

    const chip = screen.getByRole('button', { name: /Piet/ })
    fireEvent(chip, pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
    fireEvent(chip, pointerEvent('pointerup', { clientX: 11, clientY: 11 }))

    // Selectie is nog steeds actief: de "Verplaats naar"-knop verschijnt, net als bij een klik.
    expect(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1'))).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('slepen waarbij pointerdown + pointermove(s) + pointerup in ÉÉN React-batch binnenkomen (zoals een echte snelle muis-drag in de browser) verplaatst de speler i.p.v. hem te selecteren', async () => {
    // Regressietest voor een stale-state race: bij losse fireEvent-aanroepen
    // (elk hun eigen act()) rendert React tussenin, waardoor de bug in de
    // praktijk niet werd gevonden. Hier dispatchen we alle pointer-events
    // rechtstreeks op het element, samen in één `act()` — precies zoals ze in
    // een echte browser binnen dezelfde batch kunnen binnenkomen.
    const { container } = renderEditor()
    const team0 = container.querySelector('[data-testid="teamindeling-team-0"]') as HTMLElement
    stubRect(team0, { left: 200, top: 0, right: 300, bottom: 100 })

    const chip = screen.getByRole('button', { name: /Piet/ })

    await act(async () => {
      chip.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }))
      chip.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 30 }))
      chip.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 50 }))
      chip.dispatchEvent(pointerEvent('pointerup', { clientX: 250, clientY: 50 }))
    })

    // Verplaatst naar Team 1 en opgeslagen — géén selectie (dus ook geen
    // "Verplaats naar"-knop).
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', [['p1'], []]))
    expect(screen.queryByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1'))).not.toBeInTheDocument()
  })
})

describe('TeamIndelingEditor — genereer automatisch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('de auto-knop verdeelt aanwezige spelers over de open plekken', async () => {
    renderEditor()

    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    const result = mockSave.mock.calls[0][2] as string[][]
    // Alle 4 aanwezige spelers verdeeld over de 2 teams van grootte 2, niemand in de pool.
    expect(result.flat().sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(result[0]).toHaveLength(2)
    expect(result[1]).toHaveLength(2)
  })

  it('vult alleen open plekken aan: bestaande handmatige toewijzing blijft staan', async () => {
    renderEditor({ initialIndeling: [['p1'], []] })

    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    const result = mockSave.mock.calls[0][2] as string[][]
    expect(result[0][0]).toBe('p1')
    expect(result[0]).toHaveLength(2)
  })
})

describe('TeamIndelingEditor — waarschuwingen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toont een afwezig-waarschuwing voor een ingedeelde speler die niet meer aanwezig is, en verwijdert hem niet automatisch', () => {
    renderEditor({ initialIndeling: [['p1'], []], presentPlayerIds: ['p2', 'p3', 'p4'] })

    expect(screen.getByText(nl.teamIndeling.absentWarning)).toBeInTheDocument()
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('toont een generieke "onbekende speler"-waarschuwing voor een id die niet in players voorkomt, en verwijdert hem niet automatisch', () => {
    renderEditor({ initialIndeling: [['ghost-id'], []] })

    expect(screen.getByText(nl.teamIndeling.unknownPlayer)).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('toont een grootte-mismatch-waarschuwing zonder de indeling te wijzigen', () => {
    renderEditor({ initialIndeling: [['p1', 'p2', 'p3'], []] })

    expect(screen.getByText(nl.teamIndeling.sizeWarning.replace('{n}', '2'))).toBeInTheDocument()
    // De 3 spelers blijven allemaal ingedeeld in team 1 — niemand wordt losgekoppeld.
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Kees')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })
})

describe('TeamIndelingEditor — lege staten', () => {
  it('toont een nette lege staat als er geen aanwezige spelers zijn en er nog niemand is ingedeeld', () => {
    renderEditor({ presentPlayerIds: [] })
    expect(screen.getByText(nl.teamIndeling.noPresentPlayers)).toBeInTheDocument()
  })

  it('rendert niets voor een oefening zonder teams', () => {
    const { container } = renderEditor({ teams: [] })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TeamIndelingEditor — crash-risico bij ontbrekende/ongeldige initialIndeling', () => {
  // Rendert de component rechtstreeks (zonder de `?? []`-fallback van de
  // renderEditor-testhelper) zodat de defensieve normalize in het component
  // zelf wordt getoetst — precies het scenario van een niet-gemigreerde
  // `spelerindeling`-kolom die als `undefined` binnenkomt vanuit
  // TrainingPlanEditor.
  function renderWithRawIndeling(rawIndeling: unknown) {
    return render(
      <DictProvider dict={nl}>
        <TeamIndelingEditor
          koppelingId="k1"
          eventId="e1"
          teams={twoTeams}
          initialIndeling={rawIndeling as string[][]}
          players={players}
          presentPlayerIds={['p1', 'p2', 'p3', 'p4']}
        />
      </DictProvider>,
    )
  }

  it('crasht niet als initialIndeling undefined is (migratie nog niet gedraaid) en toont gewoon de teamkaarten + pool', () => {
    expect(() => renderWithRawIndeling(undefined)).not.toThrow()

    expect(screen.getByText(/Team 1/)).toBeInTheDocument()
    expect(screen.getByText(/Team 2/)).toBeInTheDocument()
    // Alle aanwezige spelers staan gewoon in de pool, niemand is ingedeeld.
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
  })

  it('crasht niet bij een niet-array initialIndeling (bv. null) en valt terug op een lege indeling', () => {
    expect(() => renderWithRawIndeling(null)).not.toThrow()
    expect(screen.getByText(nl.teamIndeling.poolLabel)).toBeInTheDocument()
  })
})

describe('TeamIndelingEditor — opslaan mislukt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toont een foutmelding en draait de optimistische state terug als saveSpelerindeling faalt', async () => {
    mockSave.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "training_oefeningen_pkey"'))
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    // Optimistisch verschijnt Piet meteen in het team...
    expect(screen.getByText('Piet')).toBeInTheDocument()

    // ...maar zodra de save faalt: nette, eigen i18n-foutmelding (nooit de
    // rauwe DB-foutmelding) en de indeling draait terug naar de laatst
    // bekende opgeslagen staat (Piet weer selecteerbaar in de pool).
    await waitFor(() => expect(screen.getByText(nl.teamIndeling.saveError)).toBeInTheDocument())
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Piet/ })).toBeInTheDocument()
  })
})

describe('TeamIndelingEditor — teams verkleind: spelers uit weggevallen teams terug naar de pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spelers uit een sub-array voorbij teams.length komen zichtbaar terug in de pool, met een waarschuwing, en de save-payload bevat exact teams.length sub-arrays', async () => {
    // De oefening heeft nu nog maar 2 teams, maar de opgeslagen indeling heeft
    // 3 sub-arrays — team 3 is dus weggevallen.
    renderEditor({ initialIndeling: [['p1'], ['p2'], ['p3']] })

    // Zichtbare melding dat er een team is weggevallen.
    expect(
      screen.getByText(nl.teamIndeling.teamsRemovedWarning.replace('{n}', '1')),
    ).toBeInTheDocument()

    // p3 (uit het weggevallen team 3) staat weer selecteerbaar in de pool.
    expect(screen.getByRole('button', { name: /Kees/ })).toBeInTheDocument()
    // p1 en p2 staan nog gewoon in hun (nog bestaande) teams.
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(screen.getByText('Jan')).toBeInTheDocument()

    // Een save erna (bv. automatisch indelen) levert exact teams.length
    // sub-arrays op, zodat validateSpelerindeling niet afketst.
    fireEvent.click(screen.getByText(nl.teamIndeling.autoAssign))
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    const result = mockSave.mock.calls[0][2] as string[][]
    expect(result).toHaveLength(2)
  })

  it('een weggevallen team met een niet-aanwezige/onbekende speler: het signaal blijft staan ook al is die speler nergens zichtbaar', () => {
    // Slechts 1 team over; het weggevallen 2e team bevatte een id die niet in
    // `players` voorkomt (dus nooit in de pool zichtbaar wordt).
    renderEditor({
      teams: [{ grootte: 2, formaties: [] }],
      initialIndeling: [['p1'], ['ghost-not-present']],
    })

    // Het signaal verdwijnt niet, ook al belandt de losgekoppelde speler niet
    // zichtbaar in de pool.
    expect(
      screen.getByText(nl.teamIndeling.teamsRemovedWarning.replace('{n}', '1')),
    ).toBeInTheDocument()
    // De tekst claimt niet langer een locatie ("in de pool") die hier niet
    // zou kloppen.
    expect(screen.queryByText(/in de pool/)).not.toBeInTheDocument()

    // p1 blijft gewoon ingedeeld in het resterende team.
    expect(screen.getByText('Piet')).toBeInTheDocument()
    // De onbekende/losgekoppelde speler duikt nergens op — noch als teamchip, noch in de pool.
    expect(screen.queryByText(/ghost-not-present/)).not.toBeInTheDocument()
  })
})

describe('TeamIndelingEditor — rollback bij overlappende saves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('als save A faalt nadat save B al is geslaagd, valt de UI niet terug naar de verouderde staat van vóór A', async () => {
    let rejectA: (err: unknown) => void = () => {}
    let resolveB: () => void = () => {}
    mockSave
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectA = reject }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveB = resolve }))

    renderEditor()

    // Save A: koppel Piet aan Team 1 (blijft hangen).
    fireEvent.click(screen.getByRole('button', { name: /Piet/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    // Save B: koppel ook Jan aan Team 1, terwijl save A nog niet is afgerond.
    fireEvent.click(screen.getByRole('button', { name: /Jan/ }))
    fireEvent.click(screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1')))

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(screen.getByText('Jan')).toBeInTheDocument()

    // Save B slaagt eerst.
    resolveB()
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2))

    // Save A faalt daarna — de rollback mag B's geslaagde wijziging niet
    // ongedaan maken door terug te vallen op de staat van vóór A (leeg).
    rejectA(new Error('conflict'))
    await waitFor(() => expect(screen.getByText(nl.teamIndeling.saveError)).toBeInTheDocument())

    expect(screen.getByText('Piet')).toBeInTheDocument()
    expect(screen.getByText('Jan')).toBeInTheDocument()
  })
})

describe('TeamIndelingEditor — laadindicatie tijdens opslaan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disablet de "Genereer automatisch"-knop zolang een save nog loopt', async () => {
    let resolveSave: () => void = () => {}
    mockSave.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveSave = resolve }),
    )
    renderEditor()

    const autoBtn = screen.getByText(nl.teamIndeling.autoAssign)
    fireEvent.click(autoBtn)

    await waitFor(() => expect(autoBtn).toBeDisabled())

    resolveSave()
    await waitFor(() => expect(autoBtn).not.toBeDisabled())
  })
})
