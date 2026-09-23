// Acceptatietest — AC2 (trainingsdetailpagina stat-cards), zie BRIEF.md
// §"ACCEPTATIECRITERIA" en §7.2. Rendert de ECHTE clientcomponent
// components/TrainingAttendance.tsx met RTL, alleen de server action
// gemockt (nooit echt aangeroepen in deze tests — geen enkele test wacht op
// een transitie, de stat-cards herberekenen synchroon uit lokale state).
// Zelfde mockpatroon als gastspelers.acceptance.test.tsx:67-70.
//
// ── AC2 → test-mapping ──
//   AC2.a (Afwezig = alleen niet-gast+absent)      → 'AC2 — 20 vast (15/5) + 6 gasten present'
//                                                     en 'AC2 — 6 AFWEZIGE gasten'
//   AC2.b (Onbekend = alleen niet-gast+unknown)     → 'AC2 — een gast met status "unknown"...'
//   AC2.c (Aanwezig telt ook aanwezige gasten mee)  → 'AC2 — 20 vast (15/5) + 6 gasten present'
//   AC2.d (Opkomst % uitsluitend vaste spelers)     → 'AC2 — 20 vast (15/5) + 6 gasten present'
//   AC2.e (noemer 0 => "—", nooit "0%")             → 'AC2 — uitsluitend gasten'
//   Regressie (AC5, spelerrij + markAllPresent)     → describe('Regressie...')

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { AttendanceStatus, Player } from '@/lib/types'
import TrainingAttendance from '@/components/TrainingAttendance'

// Nooit daadwerkelijk aangeroepen (geen enkele test wacht een transitie af of
// controleert de aanroep) — puur nodig zodat de import in de component
// resolvet. Zelfde precedent als gastspelers.acceptance.test.tsx:67-70.
vi.mock('@/app/actions/attendance', () => ({
  updateAttendance: vi.fn().mockResolvedValue(undefined),
  markAllPresent: vi.fn().mockResolvedValue(undefined),
}))

function makePlayer(id: string, type: 'regular' | 'guest', overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Speler ${id}`,
    position: 'Spits',
    secondary_positions: [],
    jersey_number: null,
    active: true,
    injured: false,
    type,
    rating: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderAttendance(players: Player[], statuses: Record<string, AttendanceStatus>, canEdit = true) {
  return render(
    <DictProvider dict={nl}>
      <TrainingAttendance eventId="e1" players={players} initialStatuses={statuses} canEdit={canEdit} />
    </DictProvider>,
  )
}

// Elke StatMini-kaart (Aanwezig/Afwezig/Onbekend) draagt de klasse
// `surface-card`; de Opkomst-kaart (eerste tegel) heeft die klasse bewust
// niet (eigen gradient-styling, zie TrainingAttendance.tsx). De waarde staat
// als losse tekstnode direct onder het label. Dezelfde labeltekst
// ("Afwezig"/"Aanwezig") komt ook voor als knoptekst in elke spelerrij (een
// <span> i.p.v. een <div>) — filter daarop om de juiste match te pakken.
function statCard(label: string): HTMLElement {
  const candidates = screen.getAllByText(label)
  const labelEl = candidates.find((el) => el.tagName === 'DIV' && el.closest('.surface-card'))
  if (!labelEl) throw new Error(`Stat-kaart voor "${label}" niet gevonden`)
  return labelEl.closest('.surface-card') as HTMLElement
}
function statValue(label: string): string {
  return within(statCard(label)).getByText(/^\d+$/).textContent ?? ''
}
function turnoutCard(): HTMLElement {
  return screen.getByText(nl.event.turnout).parentElement as HTMLElement
}
function turnoutValue(): string {
  return within(turnoutCard()).getByText(/^(\d+%|—)$/).textContent ?? ''
}

describe('AC2 — trainingsdetailpagina stat-cards tellen gasten volgens de weergaveregel', () => {
  it('20 vast (15 aanwezig/5 afwezig) + 6 gasten present => Aanwezig 21, Afwezig 5, Onbekend 0, Opkomst 75%, beide subregels zichtbaar', () => {
    const regulars = Array.from({ length: 20 }, (_, i) => makePlayer(`r${i + 1}`, 'regular'))
    const guests = Array.from({ length: 6 }, (_, i) => makePlayer(`g${i + 1}`, 'guest'))
    const statuses: Record<string, AttendanceStatus> = {}
    regulars.forEach((p, i) => { statuses[p.id] = i < 15 ? 'present' : 'absent' })
    guests.forEach((p) => { statuses[p.id] = 'present' })

    renderAttendance([...regulars, ...guests], statuses)

    expect(statValue(nl.event.presentStat)).toBe('21')
    expect(statValue(nl.event.absentStat)).toBe('5')
    expect(statValue(nl.event.unknownStat)).toBe('0')
    expect(turnoutValue()).toBe('75%')

    // Subregel opkomst-tegel: "15/20 vaste selectie".
    const turnoutSub = nl.event.turnoutScopeSub.replace('{present}', '15').replace('{total}', '20')
    expect(within(turnoutCard()).getByText(turnoutSub)).toBeInTheDocument()

    // Subregel aanwezig-tegel: "waarvan 6 gasten" (meervoud, gastenAanwezig=6).
    const guestSub = nl.event.presentGuestSubMany.replace('{n}', '6')
    expect(within(statCard(nl.event.presentStat)).getByText(guestSub)).toBeInTheDocument()
  })

  it('6 AFWEZIGE gasten => Afwezig toont alleen de vaste afwezigen, geen gast in Onbekend', () => {
    const regulars = [
      makePlayer('r1', 'regular'), makePlayer('r2', 'regular'), makePlayer('r3', 'regular'),
      makePlayer('r4', 'regular'), makePlayer('r5', 'regular'),
    ]
    const guests = Array.from({ length: 6 }, (_, i) => makePlayer(`g${i + 1}`, 'guest'))
    const statuses: Record<string, AttendanceStatus> = {}
    regulars.forEach((p, i) => { statuses[p.id] = i < 3 ? 'present' : 'absent' })
    guests.forEach((p) => { statuses[p.id] = 'absent' })

    renderAttendance([...regulars, ...guests], statuses)

    // 3 aanwezige vaste spelers, geen enkele aanwezige gast.
    expect(statValue(nl.event.presentStat)).toBe('3')
    expect(statValue(nl.event.absentStat)).toBe('2')
    expect(statValue(nl.event.unknownStat)).toBe('0')
    // Geen "waarvan N gasten"-subregel: gastenAanwezig is 0.
    expect(within(statCard(nl.event.presentStat)).queryByText(/waarvan/)).not.toBeInTheDocument()
  })

  it('een gast met status "unknown" verhoogt Onbekend niet', () => {
    const players = [
      makePlayer('r1', 'regular'), // status 'unknown' via ontbrekende entry
      makePlayer('g1', 'guest'),   // status 'unknown' via ontbrekende entry
    ]
    renderAttendance(players, {}) // geen enkele status ingevuld => beiden 'unknown'

    expect(statValue(nl.event.unknownStat)).toBe('1') // alleen de vaste speler
    expect(statValue(nl.event.presentStat)).toBe('0')
    expect(statValue(nl.event.absentStat)).toBe('0')
  })

  it('uitsluitend gasten => Opkomst toont "—", nooit "0%", en de subregel "vaste selectie" ontbreekt volledig', () => {
    const guests = [
      makePlayer('g1', 'guest'), makePlayer('g2', 'guest'), makePlayer('g3', 'guest'),
    ]
    const statuses: Record<string, AttendanceStatus> = { g1: 'present', g2: 'absent', g3: 'unknown' }
    renderAttendance(guests, statuses)

    expect(turnoutValue()).toBe('—')
    expect(turnoutValue()).not.toBe('0%')
    // Positieve assertie (niet alleen "geen crash"): vastAanwezig+vastAfwezig
    // is 0, dus turnoutSub moet undefined zijn — de tekst "vaste selectie"
    // mag nergens in de Opkomst-tegel staan.
    expect(within(turnoutCard()).queryByText(/vaste selectie/)).not.toBeInTheDocument()
  })

  it('bij een event waar nog geen enkele vaste speler is afgevinkt (allemaal "unknown") toont Opkomst geen subregel; na de eerste klik op een vaste speler verschijnt hij wel', () => {
    const regulars = [makePlayer('r1', 'regular'), makePlayer('r2', 'regular')]
    renderAttendance(regulars, {}) // geen enkele status ingevuld => beiden 'unknown'

    // vastAanwezig + vastAfwezig = 0 (allebei 'unknown'), dus geen subregel,
    // ook al zijn het reguliere spelers (geen gasten in dit scenario).
    expect(turnoutValue()).toBe('—')
    expect(within(turnoutCard()).queryByText(/vaste selectie/)).not.toBeInTheDocument()

    // Eerste klik op "Aanwezig" bij r1 (eerste knop in de rij, zie
    // TrainingAttendance.tsx StatusButton-volgorde: Aanwezig vóór Afwezig).
    const row = attendanceRowFor('Speler r1')
    fireEvent.click(within(row).getAllByRole('button')[0])

    // vastAanwezig+vastAfwezig is nu live 1 (volgt de statuses-state, niet
    // een per-event-vaste waarde) => de subregel "1/1 vaste selectie" verschijnt.
    const expectedSub = nl.event.turnoutScopeSub.replace('{present}', '1').replace('{total}', '1')
    expect(within(turnoutCard()).getByText(expectedSub)).toBeInTheDocument()
  })
})

// Zelfde rijzoek-helper als gastspelers.acceptance.test.tsx:355-368: precies
// twee statusknoppen per spelerrij (Aanwezig/Afwezig), aria-pressed geeft de
// actieve status weer.
function attendanceRowFor(name: string): HTMLElement {
  const nameEl = screen.getByText(name)
  const row = nameEl.parentElement?.parentElement
  if (!row || within(row).queryAllByRole('button').length !== 2) {
    throw new Error(`Aanwezigheidsrij voor "${name}" niet gevonden`)
  }
  return row
}

describe('Regressie — de spelerslijst en markAllPresent blijven ongewijzigd (AC5)', () => {
  it('de spelerrij van een afwezige gast staat er nog steeds, met beide statusknoppen', () => {
    const players = [makePlayer('g1', 'guest', { name: 'Afwezige Gast' })]
    renderAttendance(players, { g1: 'absent' })

    const row = attendanceRowFor('Afwezige Gast')
    const buttons = within(row).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(within(row).getByRole('button', { pressed: true }).textContent).toContain(nl.event.absentStat)
  })

  it('markAllPresent-knop zet lokaal alle spelers (incl. gasten) op present; daarna Afwezig 0 en Onbekend 0', () => {
    const players = [
      makePlayer('r1', 'regular'), makePlayer('r2', 'regular'),
      makePlayer('g1', 'guest'), makePlayer('g2', 'guest'),
    ]
    const statuses: Record<string, AttendanceStatus> = { r1: 'absent', r2: 'unknown', g1: 'absent', g2: 'unknown' }
    renderAttendance(players, statuses)

    // Sanity: vóór de klik staat er wél iets in Afwezig/Onbekend.
    expect(statValue(nl.event.absentStat)).not.toBe('0')

    fireEvent.click(screen.getByRole('button', { name: nl.event.markAllPresent }))

    expect(statValue(nl.event.absentStat)).toBe('0')
    expect(statValue(nl.event.unknownStat)).toBe('0')
    // Alle 4 spelers (incl. beide gasten) staan nu aanwezig.
    expect(statValue(nl.event.presentStat)).toBe('4')
  })
})
