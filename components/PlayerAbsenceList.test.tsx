import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { FootballEvent, AttendanceStatus } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import PlayerAbsenceList from '@/components/PlayerAbsenceList'

// De intrekknop heeft een aria-label i.p.v. "Intrekken" als accessible name
// (die label bevat bewust de datumrange, zie PlayerAbsenceList.tsx). Deze
// helper bouwt exact diezelfde tekst op om er in tests op te matchen.
function revokeAriaName(fromDate: string, toDate: string) {
  const range = `${formatDate(fromDate, nl.browserLocale)} – ${formatDate(toDate, nl.browserLocale)}`
  return nl.players.periodRevokeAria.replace('{range}', range)
}

vi.mock('@/app/actions/attendance', () => ({
  updateAttendance: vi.fn().mockResolvedValue(undefined),
  markAbsentForPeriod: vi.fn().mockResolvedValue({ periodId: 'period-new', affected: 1 }),
  revokeAbsencePeriod: vi.fn().mockResolvedValue({ restored: 1 }),
}))

// Zelfde precedent als wedstrijden-bulk-toevoegen.acceptance.test.tsx: een
// gestubde router zodat router.refresh() (bevinding 3) verifieerbaar is
// zonder een echte Next.js-routercontext nodig te hebben.
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: mockRefresh }),
}))

import { markAbsentForPeriod, revokeAbsencePeriod } from '@/app/actions/attendance'
const mockMarkAbsentForPeriod = markAbsentForPeriod as unknown as ReturnType<typeof vi.fn>
const mockRevokeAbsencePeriod = revokeAbsencePeriod as unknown as ReturnType<typeof vi.fn>

interface EventWithStatus extends FootballEvent {
  status: AttendanceStatus
}

function makeEvent(overrides: Partial<EventWithStatus> = {}): EventWithStatus {
  return {
    id: 'e1',
    type: 'training',
    date: '2026-08-15',
    time: '19:00:00',
    location: null,
    match_type: null,
    opponent: null,
    home_away: null,
    gather_time: null,
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-08-01T00:00:00Z',
    status: 'unknown',
    ...overrides,
  }
}

function listElement(overrides: Partial<Parameters<typeof PlayerAbsenceList>[0]> = {}) {
  return (
    <DictProvider dict={nl}>
      <PlayerAbsenceList
        playerId={overrides.playerId ?? 'p1'}
        events={overrides.events ?? []}
        periods={overrides.periods ?? []}
        defaultStatus={overrides.defaultStatus ?? 'present'}
      />
    </DictProvider>
  )
}

function renderList(overrides: Partial<Parameters<typeof PlayerAbsenceList>[0]> = {}) {
  return render(listElement(overrides))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkAbsentForPeriod.mockResolvedValue({ periodId: 'period-new', affected: 1 })
  mockRevokeAbsencePeriod.mockResolvedValue({ restored: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('periodelijst', () => {
  it('toont een lege staat als er geen periodes zijn', () => {
    renderList({ periods: [] })
    expect(screen.getByText(nl.players.periodListEmpty)).toBeInTheDocument()
  })

  it('toont per periode de datumrange met een intrekknop', () => {
    renderList({
      periods: [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }],
    })
    expect(screen.queryByText(nl.players.periodListEmpty)).not.toBeInTheDocument()
    expect(screen.getByText('ma 10 aug – do 20 aug')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }),
    ).toBeInTheDocument()
  })

  it('klikken op intrekken roept revokeAbsencePeriod aan met de juiste periodId', async () => {
    renderList({
      periods: [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }],
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })
    expect(mockRevokeAbsencePeriod).toHaveBeenCalledWith('period-1')
  })

  it('optimistische terugval: events zonder resterende dekking krijgen defaultStatus, events die nog door een andere periode gedekt worden blijven absent', async () => {
    const events = [
      makeEvent({ id: 'e-only-p1', date: '2026-08-12', status: 'absent' }),
      makeEvent({ id: 'e-overlap', date: '2026-08-18', status: 'absent' }),
    ]
    renderList({
      defaultStatus: 'unknown',
      events,
      periods: [
        { id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' },
        { id: 'period-2', player_id: 'p1', from_date: '2026-08-15', to_date: '2026-08-25' },
      ],
    })

    // period-1 loopt van/tot 10-20 aug.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })

    expect(mockRevokeAbsencePeriod).toHaveBeenCalledWith('period-1')
    // Nog maar 1 periode (period-2) over in de lijst.
    expect(
      screen.getByRole('button', { name: revokeAriaName('2026-08-15', '2026-08-25') }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Periode intrekken/ })).toHaveLength(1)

    // e-only-p1 (12 aug) viel alleen onder period-1 -> terug naar defaultStatus ('unknown'),
    // dus niet meer in de "afgemeld"-teller.
    // e-overlap (18 aug) valt ook onder period-2 (15-25 aug) -> blijft 'absent'.
    expect(screen.getByText(`${nl.players.absentFor} 1 ${nl.players.event}`)).toBeInTheDocument()
  })

  it('na een succesvolle markAbsentForPeriod-aanroep verschijnt de nieuwe periode in de lijst', async () => {
    mockMarkAbsentForPeriod.mockResolvedValueOnce({ periodId: 'period-abc', affected: 0 })
    renderList({
      events: [],
      periods: [],
    })

    const fromInput = screen.getByText(nl.players.periodFrom).parentElement?.querySelector('input') as HTMLInputElement
    const toInput = screen.getByText(nl.players.periodTo).parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } })
    fireEvent.change(toInput, { target: { value: '2026-09-10' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    expect(mockMarkAbsentForPeriod).toHaveBeenCalledWith('p1', '2026-09-01', '2026-09-10')
    expect(
      screen.getByRole('button', { name: revokeAriaName('2026-09-01', '2026-09-10') }),
    ).toBeInTheDocument()
  })
})

// Bevinding 7: de teller/melding moet de `affected`-waarde uit het
// servercontract volgen, niet een lokaal berekend aantal uit de (gelimiteerde,
// alleen-toekomstige) events-lijst.
describe('periode-teller volgt het servercontract, niet een lokale telling (bevinding 7)', () => {
  function fillPeriodDates(from: string, to: string) {
    const fromInput = screen.getByText(nl.players.periodFrom).parentElement?.querySelector('input') as HTMLInputElement
    const toInput = screen.getByText(nl.players.periodTo).parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: from } })
    fireEvent.change(toInput, { target: { value: to } })
  }

  it('toont de door de server geretourneerde affected-waarde, ook als die afwijkt van de lokale (toekomstige) events-lijst', async () => {
    // Lokaal ligt er geen enkel event in de gekozen range (bijv. omdat de
    // periode deels in het verleden ligt, buiten de lokaal geladen lijst) —
    // een lokale telling zou hier 0 opleveren — maar de server meldt dat er
    // wél 3 rijen zijn geraakt.
    mockMarkAbsentForPeriod.mockResolvedValueOnce({ periodId: 'period-x', affected: 3 })
    renderList({ events: [], periods: [] })

    fillPeriodDates('2026-01-01', '2026-01-31')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    expect(screen.getByText(`3 ${nl.players.periodSuccess}`)).toBeInTheDocument()
    expect(screen.queryByText(nl.players.periodNone)).not.toBeInTheDocument()
  })

  it('toont periodNone wanneer de server affected: 0 teruggeeft, ongeacht een lokaal aanwezig event in de range', async () => {
    const events = [makeEvent({ id: 'e-in-range', date: '2026-09-05', status: 'unknown' })]
    mockMarkAbsentForPeriod.mockResolvedValueOnce({ periodId: 'period-y', affected: 0 })
    renderList({ events, periods: [] })

    fillPeriodDates('2026-09-01', '2026-09-10')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    expect(screen.getByText(nl.players.periodNone)).toBeInTheDocument()
  })
})

// Bevinding 3: na een succesvolle intrekking moet de serverstaat leidend
// worden via router.refresh() (zelfde patroon als components/PlayerList.tsx).
describe('router.refresh() na intrekken (bevinding 3)', () => {
  it('roept router.refresh() aan na een succesvolle revoke-call', async () => {
    renderList({
      periods: [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }],
    })

    expect(mockRefresh).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })

    expect(mockRevokeAbsencePeriod).toHaveBeenCalledWith('period-1')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  // router.refresh() haalt alleen nieuwe props op bij de server component; het
  // is React-rerendering, geen remount. Een useState-initializer (useState
  // (initialEvents)) draait dan niet opnieuw, dus zonder een expliciete sync
  // zou de lokale (optimistisch teruggezette) state blijven hangen op
  // defaultStatus, ook nadat de server met de echte waarheid (bijv.
  // injury_set of een handmatig gezette status) terugkomt. Deze test
  // simuleert die refresh door met bijgewerkte props te rerenderen.
  it('valt terug op de echte serverstatus (niet defaultStatus) zodra router.refresh() verse props oplevert', async () => {
    const events = [
      makeEvent({ id: 'e-injury', date: '2026-08-12', status: 'absent' }),
      makeEvent({ id: 'e-manual', date: '2026-08-14', status: 'absent' }),
    ]
    const periods = [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }]
    const { rerender } = render(listElement({ defaultStatus: 'unknown', events, periods }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })

    // Optimistisch (fout, vóór de refresh-props binnenkomen): beide events
    // terug naar defaultStatus, dus geen "afgemeld"-teller meer.
    expect(screen.queryByText(`${nl.players.absentFor} 2 ${nl.players.events}`)).not.toBeInTheDocument()

    // Simuleer wat router.refresh() feitelijk doet: de server-component
    // rendert opnieuw met de echte serverstaat als props. e-injury heeft
    // injury_set en e-manual is handmatig door de coach op 'absent' gezet —
    // de server houdt beide bewust op 'absent', ondanks de ingetrokken periode.
    rerender(
      listElement({
        defaultStatus: 'unknown',
        periods: [],
        events: [
          { ...events[0], status: 'absent' },
          { ...events[1], status: 'absent' },
        ],
      }),
    )

    expect(screen.getByText(`${nl.players.absentFor} 2 ${nl.players.events}`)).toBeInTheDocument()
    expect(screen.getByText(nl.players.periodListEmpty)).toBeInTheDocument()
  })
})

// Klein randgeval: de rollback-snapshots (previousEvents/previousPeriods) voor
// een periode-registratie/-intrekking worden uit de render-closure vastgelegd
// vóór de optimistische mutatie. Zolang die transitie loopt mogen de
// per-event statusknoppen niet aanklikbaar zijn, anders kan een los geklikte
// status door een eventuele rollback worden overschreven.
describe('statusknoppen uitgeschakeld tijdens een lopende periode-transitie', () => {
  it('schakelt de per-event statusknoppen uit zolang markAbsentForPeriod nog in behandeling is', async () => {
    let resolveMarkAbsent: (value: { periodId: string; affected: number }) => void
    mockMarkAbsentForPeriod.mockReturnValueOnce(
      new Promise((resolve) => { resolveMarkAbsent = resolve }),
    )
    const events = [makeEvent({ id: 'e1', date: '2026-09-05', status: 'unknown' })]
    renderList({ events, periods: [] })

    const fromInput = screen.getByText(nl.players.periodFrom).parentElement?.querySelector('input') as HTMLInputElement
    const toInput = screen.getByText(nl.players.periodTo).parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } })
    fireEvent.change(toInput, { target: { value: '2026-09-10' } })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    expect(screen.getByRole('button', { name: nl.players.present })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.players.absent })).toBeDisabled()

    await act(async () => {
      resolveMarkAbsent({ periodId: 'period-new', affected: 1 })
    })

    expect(screen.getByRole('button', { name: nl.players.present })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: nl.players.absent })).not.toBeDisabled()
  })

  it('schakelt de per-event statusknoppen uit zolang revokeAbsencePeriod nog in behandeling is', async () => {
    let resolveRevoke: (value: { restored: number }) => void
    mockRevokeAbsencePeriod.mockReturnValueOnce(
      new Promise((resolve) => { resolveRevoke = resolve }),
    )
    const events = [makeEvent({ id: 'e1', date: '2026-08-12', status: 'absent' })]
    renderList({
      defaultStatus: 'unknown',
      events,
      periods: [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }],
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })

    expect(screen.getByRole('button', { name: nl.players.present })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.players.absent })).toBeDisabled()

    await act(async () => {
      resolveRevoke({ restored: 1 })
    })

    expect(screen.getByRole('button', { name: nl.players.present })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: nl.players.absent })).not.toBeDisabled()
  })
})

// Bevinding 4: bij een afwijzing van markAbsentForPeriod/revokeAbsencePeriod
// moet de optimistische update teruggedraaid worden en een foutmelding
// getoond worden — zelfde patroon als components/DeleteAccountSection.tsx en
// components/NulmetingManager.tsx (lokale error-state met err.message).
describe('foutafhandeling rond markAbsentForPeriod/revokeAbsencePeriod (bevinding 4)', () => {
  it('draait de optimistische periode-afmelding terug en toont een foutmelding als markAbsentForPeriod afwijst', async () => {
    mockMarkAbsentForPeriod.mockRejectedValueOnce(new Error('Periode kon niet worden opgeslagen'))
    const events = [makeEvent({ id: 'e1', date: '2026-09-05', status: 'unknown' })]
    renderList({ events, periods: [] })

    const fromInput = screen.getByText(nl.players.periodFrom).parentElement?.querySelector('input') as HTMLInputElement
    const toInput = screen.getByText(nl.players.periodTo).parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } })
    fireEvent.change(toInput, { target: { value: '2026-09-10' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    // Foutmelding zichtbaar.
    expect(screen.getByText('Periode kon niet worden opgeslagen')).toBeInTheDocument()
    // Geen periode toegevoegd aan de lijst.
    expect(screen.getByText(nl.players.periodListEmpty)).toBeInTheDocument()
    // De optimistische statuswijziging op het event is teruggedraaid: geen
    // "afgemeld"-teller meer zichtbaar.
    expect(screen.queryByText(`${nl.players.absentFor} 1 ${nl.players.event}`)).not.toBeInTheDocument()
  })

  it('toont een generieke foutmelding als markAbsentForPeriod afwijst zonder Error-instance', async () => {
    mockMarkAbsentForPeriod.mockRejectedValueOnce('boom')
    renderList({ events: [], periods: [] })

    const fromInput = screen.getByText(nl.players.periodFrom).parentElement?.querySelector('input') as HTMLInputElement
    const toInput = screen.getByText(nl.players.periodTo).parentElement?.querySelector('input') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '2026-09-01' } })
    fireEvent.change(toInput, { target: { value: '2026-09-10' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.players.periodButton }))
    })

    expect(screen.getByText(nl.players.periodError)).toBeInTheDocument()
  })

  it('draait de optimistische terugval terug en toont een foutmelding als revokeAbsencePeriod afwijst', async () => {
    mockRevokeAbsencePeriod.mockRejectedValueOnce(new Error('Periode niet gevonden'))
    const events = [makeEvent({ id: 'e1', date: '2026-08-12', status: 'absent' })]
    renderList({
      defaultStatus: 'unknown',
      events,
      periods: [{ id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }],
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }))
    })

    // Foutmelding zichtbaar.
    expect(screen.getByText('Periode niet gevonden')).toBeInTheDocument()
    // De periode staat weer in de lijst (optimistische verwijdering teruggedraaid).
    expect(
      screen.getByRole('button', { name: revokeAriaName('2026-08-10', '2026-08-20') }),
    ).toBeInTheDocument()
    // Het event staat weer op 'absent' (optimistische terugval teruggedraaid).
    expect(screen.getByText(`${nl.players.absentFor} 1 ${nl.players.event}`)).toBeInTheDocument()
    // Geen refresh bij een mislukte call.
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
