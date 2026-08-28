import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { BezettingBasis } from '@/lib/oefening-bezetting'
import BezettingStepper from '@/components/BezettingStepper'

vi.mock('@/app/actions/training-plan', () => ({
  saveAantallenOverride: vi.fn().mockResolvedValue(undefined),
}))

import { saveAantallenOverride } from '@/app/actions/training-plan'
const mockSave = saveAantallenOverride as unknown as ReturnType<typeof vi.fn>

const exactBasis: BezettingBasis = {
  teams: [{ grootte: 4, formaties: [] }],
  aantal_neutralen: 0,
}

const flexibelTeam: BezettingBasis = {
  teams: [{ grootte: 4, formaties: [], grootteMax: 6 }],
  aantal_neutralen: 0,
}

const flexibelTeamEnNeutralen: BezettingBasis = {
  teams: [{ grootte: 4, formaties: [], grootteMax: 6 }],
  aantal_neutralen: 2,
  aantal_neutralen_max: 4,
}

function renderStepper(props: Partial<Parameters<typeof BezettingStepper>[0]> = {}) {
  return render(
    <DictProvider dict={nl}>
      <BezettingStepper
        koppelingId="k1"
        eventId="e1"
        basis={flexibelTeam}
        initialAantallen={null}
        aanwezigAantal={4}
        {...props}
      />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BezettingStepper — exacte oefening', () => {
  it('rendert geen enkel element bij een exacte oefening (geen bereik)', () => {
    const { container } = renderStepper({ basis: exactBasis })
    expect(container.textContent).toBe('')
  })
})

describe('BezettingStepper — startwaarde', () => {
  it('zonder opgeslagen override: startwaarde = suggestBezetting op basis van de opkomst', () => {
    // basis 4-6, aanwezigAantal 6 → rest = 6-4 = 2, kopruimte 2 → waarde 6.
    renderStepper({ initialAantallen: null, aanwezigAantal: 6 })
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText(nl.bezetting.notSavedHint)).toBeInTheDocument()
  })

  it('zonder opgeslagen override en te weinig aanwezigen: startwaarde blijft de basisvorm', () => {
    renderStepper({ initialAantallen: null, aanwezigAantal: 2 })
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('met een opgeslagen override: startwaarde = de override (aanwezigAantal telt dan niet mee)', () => {
    renderStepper({ initialAantallen: { teams: [6], neutralen: null }, aanwezigAantal: 4 })
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText(nl.bezetting.savedHint)).toBeInTheDocument()
  })
})

describe('BezettingStepper — steppers', () => {
  it('toont het bereik gedempt achter de stepper, en de teamlabel', () => {
    renderStepper()
    expect(screen.getByText(nl.teamIndeling.teamLabel.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.getByText('4–6')).toBeInTheDocument()
  })

  it('− is disabled aan de ondergrens, + is disabled aan de bovengrens', () => {
    renderStepper({ initialAantallen: { teams: [4], neutralen: null } })
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    expect(screen.getByRole('button', { name: nl.bezetting.decreaseAria.replace('{label}', label) })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    expect(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) })).toBeDisabled()
  })

  it('+ / − passen alleen de lokale waarde aan, geen enkele save vóór expliciet bevestigen', () => {
    renderStepper({ initialAantallen: { teams: [4], neutralen: null } })
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('toont ook een stepper voor flexibele neutralen, met eigen bereik-label', () => {
    renderStepper({ basis: flexibelTeamEnNeutralen, initialAantallen: null, aanwezigAantal: 4 })
    expect(screen.getByText(nl.oefeningen.neutralsLabel)).toBeInTheDocument()
    expect(screen.getByText('2–4')).toBeInTheDocument()
  })
})

describe('BezettingStepper — "Bezetting vastleggen"', () => {
  it('stuurt de delta-vorm door aan saveAantallenOverride (basiswaarde blijft null, aangepaste waarde niet)', async () => {
    renderStepper({ initialAantallen: { teams: [4], neutralen: null }, aanwezigAantal: 4 })
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    fireEvent.click(screen.getByText(nl.bezetting.confirm))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', { teams: [5], neutralen: null }))
  })

  it('bij een mislukte save: rollback naar de laatst bevestigde waarde en de generieke i18n-melding, nooit de rauwe fout', async () => {
    mockSave.mockRejectedValueOnce(new Error('interne db-fout'))
    renderStepper({ initialAantallen: { teams: [4], neutralen: null }, aanwezigAantal: 4 })
    const label = nl.teamIndeling.teamLabel.replace('{n}', '1')
    fireEvent.click(screen.getByRole('button', { name: nl.bezetting.increaseAria.replace('{label}', label) }))
    fireEvent.click(screen.getByText(nl.bezetting.confirm))

    await waitFor(() => expect(screen.getByText(nl.bezetting.saveError)).toBeInTheDocument())
    expect(screen.queryByText('interne db-fout')).not.toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('BezettingStepper — "Terug naar basisvorm"', () => {
  it('is alleen zichtbaar bij een opgeslagen override', () => {
    renderStepper({ initialAantallen: null })
    expect(screen.queryByText(nl.bezetting.reset)).not.toBeInTheDocument()

    renderStepper({ initialAantallen: { teams: [6], neutralen: null } })
    expect(screen.getByText(nl.bezetting.reset)).toBeInTheDocument()
  })

  it('stuurt null (override wissen) en zet de steppers terug op de basiswaarden', async () => {
    renderStepper({ initialAantallen: { teams: [6], neutralen: null }, aanwezigAantal: 4 })
    fireEvent.click(screen.getByText(nl.bezetting.reset))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('k1', 'e1', null))
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('BezettingStepper — resync op verse serverdata', () => {
  it('een nieuwe `initialAantallen`-waarde van de server (na revalidatie) synct de steppers, een ongewijzigde herrender niet', () => {
    const { rerender } = renderStepper({ initialAantallen: { teams: [4], neutralen: null }, aanwezigAantal: 4 })
    expect(screen.getByText('4')).toBeInTheDocument()

    // Server bevestigt een override van 6 (nieuw object, andere waarde).
    rerender(
      <DictProvider dict={nl}>
        <BezettingStepper
          koppelingId="k1"
          eventId="e1"
          basis={flexibelTeam}
          initialAantallen={{ teams: [6], neutralen: null }}
          aanwezigAantal={4}
        />
      </DictProvider>,
    )
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('een wijziging in alleen `aanwezigAantal` (zonder nieuwe `initialAantallen`) herberekent de suggestie niet stilzwijgend', () => {
    const { rerender } = renderStepper({ initialAantallen: null, aanwezigAantal: 4 })
    expect(screen.getByText('4')).toBeInTheDocument()

    rerender(
      <DictProvider dict={nl}>
        <BezettingStepper
          koppelingId="k1"
          eventId="e1"
          basis={flexibelTeam}
          initialAantallen={null}
          aanwezigAantal={6}
        />
      </DictProvider>,
    )
    // De totaalregel toont wél meteen de nieuwe opkomst...
    expect(screen.getByText(nl.bezetting.totaal.replace('{n}', '4').replace('{m}', '6'))).toBeInTheDocument()
    // ...maar de stepper-waarde zelf blijft ongewijzigd (geen automatische herberekening).
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('BezettingStepper — overige', () => {
  it('de totaalregel toont het huidige totaal en het aantal aanwezigen', () => {
    renderStepper({ basis: flexibelTeamEnNeutralen, initialAantallen: { teams: [6], neutralen: 3 }, aanwezigAantal: 9 })
    // 6 (team) + 3 (neutralen) = 9
    expect(screen.getByText(nl.bezetting.totaal.replace('{n}', '9').replace('{m}', '9'))).toBeInTheDocument()
  })

  it('de wrapper is print:hidden', () => {
    const { container } = renderStepper()
    expect(container.querySelector('.print\\:hidden')).not.toBeNull()
  })

  it('de bevestigknop gebruikt --color-accent-strong (voldoende contrast onder witte tekst), niet --color-accent', () => {
    renderStepper()
    const knop = screen.getByText(nl.bezetting.confirm)
    expect(knop.style.background).toBe('var(--color-accent-strong)')
  })

  it('validator-bevinding 5: een corrupt team-element telt niet mee als NaN in de totaalregel', () => {
    // Team 1 is echt flexibel; team 2 is een corrupt element (bv. een lege
    // JSONB-slot) waarvan bereikVoorTeam een NaN-punt-bereik oplevert. Een
    // override van `null` op dat element valt terug op de (NaN) basis.
    const corruptBasis = {
      teams: [
        { grootte: 4, formaties: [], grootteMax: 6 },
        null as unknown as BezettingBasis['teams'][number],
      ],
      aantal_neutralen: 0,
    }
    renderStepper({
      basis: corruptBasis,
      initialAantallen: { teams: [4, null], neutralen: null },
      aanwezigAantal: 4,
    })
    // Alleen de eindige waarden (4 + 0) tellen mee — nooit "Totaal NaN".
    expect(screen.getByText(nl.bezetting.totaal.replace('{n}', '4').replace('{m}', '4'))).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })
})
