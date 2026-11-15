import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TrainerZelfreviewSectie from '@/components/TrainerZelfreviewSectie'
import { ZELFREVIEW_STELLINGEN, type ZelfreviewWaarden } from '@/lib/trainer-zelfreview'

vi.mock('@/app/actions/trainer-zelfreview', () => ({ saveTrainerZelfreview: vi.fn() }))
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))
import { saveTrainerZelfreview } from '@/app/actions/trainer-zelfreview'
const mockSave = saveTrainerZelfreview as unknown as ReturnType<typeof vi.fn>

const e = nl.event
const stellingen = e.zelfreviewStellingen as Record<string, string>

const BESTAAND: ZelfreviewWaarden = {
  scores: { uitleg: 4, organisatie: 3, coaching: 5, sfeer: 2, tijdsbewaking: 1 },
  meeneem: 'Korter uitleggen',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockResolvedValue(undefined)
})

function renderSectie(o: Partial<React.ComponentProps<typeof TrainerZelfreviewSectie>> = {}) {
  return render(
    <DictProvider dict={nl}>
      <TrainerZelfreviewSectie
        eventId="ev1" initial={null} canEdit trainingGehouden bronFout={false} {...o}
      />
    </DictProvider>,
  )
}

const groep = (stelling: string) => screen.getByRole('group', { name: stellingen[stelling] })
const kies = (stelling: string, n: number) =>
  fireEvent.click(within(groep(stelling)).getByRole('button', { name: e.zelfreviewScoreWaarde.replace('{n}', String(n)) }))
const vulAlles = (n = 3) => ZELFREVIEW_STELLINGEN.forEach((s) => kies(s, n))
const opslaanKnop = (naam: string) => screen.getByRole('button', { name: naam })

describe('TrainerZelfreviewSectie', () => {
  it('rendert sectie met anker, titel, privé-chip en vijf groepen van vijf knoppen', () => {
    const { container } = renderSectie()
    const sectie = container.querySelector('section#mijn-zelfreview')!
    expect(sectie).toHaveAttribute('aria-label', e.zelfreviewTitel)
    expect(screen.getByRole('heading', { level: 2, name: e.zelfreviewTitel })).toBeInTheDocument()
    expect(screen.getByText(e.zelfreviewPrive)).toBeInTheDocument()
    for (const s of ZELFREVIEW_STELLINGEN) expect(within(groep(s)).getAllByRole('button')).toHaveLength(5)
    // schaalankers alleen onder de eerste rij
    expect(screen.getAllByText(e.zelfreviewSchaalLaag)).toHaveLength(1)
    expect(screen.getAllByText(e.zelfreviewSchaalHoog)).toHaveLength(1)
    expect(opslaanKnop(e.zelfreviewOpslaan)).toBeEnabled()
  })

  it('sla niet op zonder alle scores: melding, focus op eerste lege, geen aanroep', () => {
    renderSectie()
    kies('uitleg', 4)
    fireEvent.click(opslaanKnop(e.zelfreviewOpslaan))
    expect(screen.getByRole('alert')).toHaveTextContent(e.zelfreviewOntbreekt)
    expect(mockSave).not.toHaveBeenCalled()
    // aria-invalid wordt niet ondersteund op role=group; de lege groepen verwijzen naar de melding.
    expect(groep('organisatie')).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
    expect(groep('uitleg')).not.toHaveAttribute('aria-describedby')
    expect(within(groep('organisatie')).getByRole('button', { name: /1 van 5/ })).toHaveFocus()
  })

  it('slaat op met getrimde tekst, toont "Opgeslagen" en ververst', async () => {
    renderSectie()
    vulAlles(4)
    fireEvent.change(screen.getByLabelText(e.zelfreviewMeeneemLabel), { target: { value: '  Meer tempo  ' } })
    fireEvent.click(opslaanKnop(e.zelfreviewOpslaan))
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    expect(mockSave).toHaveBeenCalledWith('ev1', {
      scores: { uitleg: 4, organisatie: 4, coaching: 4, sfeer: 4, tijdsbewaking: 4 },
      meeneem: 'Meer tempo',
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(nl.analysis.saved))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('lege tekst gaat als null mee', async () => {
    renderSectie()
    vulAlles(2)
    fireEvent.click(opslaanKnop(e.zelfreviewOpslaan))
    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(mockSave.mock.calls[0][1].meeneem).toBeNull()
  })

  it('knop is uitgeschakeld tijdens opslaan en toont de bezig-tekst', async () => {
    let klaar: () => void = () => {}
    mockSave.mockReturnValueOnce(new Promise<void>((r) => { klaar = r }))
    renderSectie()
    vulAlles()
    fireEvent.click(opslaanKnop(e.zelfreviewOpslaan))
    await waitFor(() => expect(opslaanKnop(e.zelfreviewOpslaanBezig)).toBeDisabled())
    klaar()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(nl.analysis.saved))
  })

  it('serverfout: generieke melding, waarden blijven staan, geen verversing', async () => {
    mockSave.mockRejectedValueOnce(new Error('RAW_DB_DETAIL'))
    renderSectie()
    vulAlles(5)
    fireEvent.change(screen.getByLabelText(e.zelfreviewMeeneemLabel), { target: { value: 'blijft' } })
    fireEvent.click(opslaanKnop(e.zelfreviewOpslaan))
    expect(await screen.findByRole('alert')).toHaveTextContent(e.zelfreviewOpslaanFout)
    expect(screen.queryByText(/RAW_DB_DETAIL/)).toBeNull()
    expect(screen.getByLabelText(e.zelfreviewMeeneemLabel)).toHaveValue('blijft')
    expect(within(groep('sfeer')).getByRole('button', { name: /5 van 5/ })).toHaveAttribute('aria-pressed', 'true')
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(opslaanKnop(e.zelfreviewOpslaan)).toBeEnabled()
  })

  it('met bestaande review: voorgevuld en knop "bijwerken"', () => {
    renderSectie({ initial: BESTAAND })
    expect(within(groep('coaching')).getByRole('button', { name: /5 van 5/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(groep('tijdsbewaking')).getByRole('button', { name: /1 van 5/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(e.zelfreviewMeeneemLabel)).toHaveValue('Korter uitleggen')
    expect(opslaanKnop(e.zelfreviewBijwerken)).toBeInTheDocument()
  })

  it('neemt een nieuwe initial over na verversing, maar niet over wat de trainer net typt', () => {
    const { rerender } = renderSectie({ initial: BESTAAND })
    const nieuw: ZelfreviewWaarden = { ...BESTAAND, meeneem: 'Van de server' }
    const el = (i: ZelfreviewWaarden) => (
      <DictProvider dict={nl}>
        <TrainerZelfreviewSectie eventId="ev1" initial={i} canEdit trainingGehouden bronFout={false} />
      </DictProvider>
    )
    rerender(el(nieuw))
    expect(screen.getByLabelText(e.zelfreviewMeeneemLabel)).toHaveValue('Van de server')
    fireEvent.change(screen.getByLabelText(e.zelfreviewMeeneemLabel), { target: { value: 'Mijn eigen tekst' } })
    rerender(el({ ...BESTAAND, meeneem: 'Weer anders' }))
    expect(screen.getByLabelText(e.zelfreviewMeeneemLabel)).toHaveValue('Mijn eigen tekst')
  })

  it('tekenteller verschijnt pas vanaf 900 tekens en de textarea begrenst op 1000', () => {
    renderSectie()
    const veld = screen.getByLabelText(e.zelfreviewMeeneemLabel)
    expect(veld).toHaveAttribute('maxLength', '1000')
    fireEvent.change(veld, { target: { value: 'a'.repeat(899) } })
    expect(screen.queryByText(/\/1000/)).toBeNull()
    fireEvent.change(veld, { target: { value: 'a'.repeat(900) } })
    expect(screen.getByText(e.zelfreviewTekens.replace('{n}', '900'))).toBeInTheDocument()
  })

  it('toekomstige training: alleen de uitleg, geen formulier', () => {
    renderSectie({ trainingGehouden: false })
    expect(screen.getByText(e.zelfreviewToekomst)).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('bronFout: niet-beschikbaar-melding, geen formulier', () => {
    renderSectie({ bronFout: true })
    expect(screen.getByText(e.zelfreviewNietBeschikbaar)).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('zonder recht maar mét review: alleen-lezen met scores en tekst, zonder knoppen', () => {
    renderSectie({ canEdit: false, initial: BESTAAND })
    expect(screen.getByText(e.zelfreviewAlleenLezen)).toBeInTheDocument()
    expect(screen.getByText('Korter uitleggen')).toBeInTheDocument()
    expect(screen.getByText(stellingen.coaching)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
