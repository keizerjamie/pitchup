import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { AttendanceStatus, Player } from '@/lib/types'
import MatchSquadEditor from '@/components/MatchSquadEditor'

vi.mock('@/app/actions/match-squad', () => ({
  toggleSquadPlayer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/actions/events', () => ({
  updateGatherTime: vi.fn().mockResolvedValue(undefined),
}))

import { toggleSquadPlayer } from '@/app/actions/match-squad'
import { updateGatherTime } from '@/app/actions/events'
const mockToggle = toggleSquadPlayer as unknown as ReturnType<typeof vi.fn>
const mockUpdateGatherTime = updateGatherTime as unknown as ReturnType<typeof vi.fn>

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
  makePlayer({ id: 'p1', name: 'Piet Peters' }),
  makePlayer({ id: 'p2', name: 'Jan Jansen' }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen' }),
]

// presentPlayerIds is alleen fixture-invoer: de editor leidt aanwezigheid af uit statusPerSpeler.
function renderEditor(overrides: Partial<Parameters<typeof MatchSquadEditor>[0]> & { presentPlayerIds?: string[] } = {}) {
  return render(
    <DictProvider dict={nl}>
      <MatchSquadEditor
        eventId="e1"
        players={overrides.players ?? players}
        initialSelectedIds={overrides.initialSelectedIds ?? []}
        // Fixture-afleiding: wie in overrides.presentPlayerIds staat is aanwezig, de rest
        // afwezig (de editor leest sinds de wedstrijdflow statusPerSpeler).
        statusPerSpeler={overrides.statusPerSpeler ?? Object.fromEntries(
          (overrides.players ?? players).map((p) => [p.id, (overrides.presentPlayerIds ?? []).includes(p.id) ? 'present' : 'absent']),
        )}
        recenteMinuten={'recenteMinuten' in overrides ? overrides.recenteMinuten ?? null : { wedstrijden: [], perSpeler: {} }}
        hasAnyActivePlayers={overrides.hasAnyActivePlayers ?? true}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        eventDate="2026-08-09"
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
        teamName={'teamName' in overrides ? overrides.teamName ?? null : null}
        teamLogoUrl={'teamLogoUrl' in overrides ? overrides.teamLogoUrl ?? null : null}
        homeAway={'homeAway' in overrides ? overrides.homeAway ?? null : null}
        kickoffTime={'kickoffTime' in overrides ? overrides.kickoffTime ?? null : null}
        location={'location' in overrides ? overrides.location ?? null : null}
        initialGatherTime={'initialGatherTime' in overrides ? overrides.initialGatherTime ?? null : null}
        formItems={overrides.formItems ?? []}
        primaryColor={overrides.primaryColor ?? '#004f3b'}
        secondaryColor={overrides.secondaryColor ?? '#009966'}
        canEdit={overrides.canEdit ?? true}
      />
    </DictProvider>,
  )
}

function stubPrint() {
  const printSpy = vi.fn()
  Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true })
  return printSpy
}

// Export op de computer (sinds 2026-10-29): de knop opent synchroon een nieuw
// tabblad en haalt daarna de server-PDF op. Hier alleen het startsignaal; de
// PDF-flow zelf staat in delen-als-pdf.acceptance.test.tsx (AC14).
function stubExport() {
  const open = vi.fn(() => null)
  Object.defineProperty(window, 'open', { value: open, writable: true, configurable: true })
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  return open
}

// De toggle-actie loopt via een React 19 async-transition (startTransition
// met een promise): isPending blijft true totdat die promise settelt. Klikken
// wrappen we daarom in act(async) zodat de microtask vóór de volgende
// assertie/klik is afgehandeld (anders blijft de knop van de VORIGE klik nog
// even disabled en gaat een opvolgende klik verloren).
async function clickToggle(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

// Zelfde reden als clickToggle hierboven: saveGatherTime loopt via een async
// transition (startGatherTransition), dus wrappen in act(async) zodat de
// microtask (resolve/reject van updateGatherTime) is afgehandeld vóór de
// volgende assertie.
async function typeAndSaveGatherTime(value: string) {
  const input = screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel)
  fireEvent.change(input, { target: { value } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toggle', () => {
  it('zet aria-pressed om en roept de gemockte server action aan met de nieuwe waarde', async () => {
    renderEditor()
    const btn = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', true)

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', false)
  })

  it('de teller loopt mee met de selectie', async () => {
    renderEditor()
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '1'))).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Jan Jansen`)
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '2'))).toBeInTheDocument()
  })
})

describe('mislukte save', () => {
  it('rolt de optimistische state terug en toont een foutmelding als de server action wordt afgewezen', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderEditor()
    const btn = screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Piet Peters` })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)

    // Rollback: de speler staat weer op niet-geselecteerd, teller weer op 0.
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(nl.matchSquad.selectedCount.replace('{n}', '0'))).toBeInTheDocument()
    // Foutmelding zichtbaar, geen rauwe servertekst.
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()
    expect(screen.queryByText('Niet ingelogd')).not.toBeInTheDocument()
  })

  it('een volgende, geslaagde toggle wist de eerdere foutmelding', async () => {
    mockToggle.mockRejectedValueOnce(new Error('Niet ingelogd'))
    renderEditor()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(screen.getByText(nl.matchSquad.saveError)).toBeInTheDocument()

    await clickToggle(`${nl.matchSquad.toggleLabel}: Jan Jansen`)
    expect(screen.queryByText(nl.matchSquad.saveError)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: Jan Jansen` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('verzameltijd - mislukte save', () => {
  it('rolt de verzameltijd terug naar de laatst bevestigde waarde en toont de i18n-foutmelding zonder rauwe servertekst', async () => {
    mockUpdateGatherTime.mockRejectedValueOnce(new Error('Netwerkfout 500'))
    renderEditor({ initialGatherTime: '18:00:00' })
    const input = screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel)
    expect(input).toHaveValue('18:00')

    await typeAndSaveGatherTime('19:30')
    expect(mockUpdateGatherTime).toHaveBeenCalledWith('e1', '19:30')

    // Rollback: terug naar de laatst bevestigde waarde (initialGatherTime),
    // niet naar leeg en niet naar de mislukte nieuwe waarde '19:30'.
    expect(input).toHaveValue('18:00')
    expect(input).not.toHaveValue('19:30')
    expect(input).not.toHaveValue('')

    // Foutmelding zichtbaar via de eigen i18n-string, geen rauwe servertekst.
    expect(screen.getByText(nl.matchSquad.gatherTimeSaveError)).toBeInTheDocument()
    expect(screen.queryByText('Netwerkfout 500')).not.toBeInTheDocument()
  })

  it('een volgende, geslaagde wijziging wist de eerdere foutmelding', async () => {
    mockUpdateGatherTime.mockRejectedValueOnce(new Error('Netwerkfout 500'))
    renderEditor({ initialGatherTime: '18:00:00' })

    await typeAndSaveGatherTime('19:30')
    expect(screen.getByText(nl.matchSquad.gatherTimeSaveError)).toBeInTheDocument()

    // Deze tweede save slaagt (default-mock resolved), dus de fout hoort te
    // verdwijnen en de nieuwe waarde te blijven staan.
    await typeAndSaveGatherTime('20:15')
    expect(screen.queryByText(nl.matchSquad.gatherTimeSaveError)).not.toBeInTheDocument()
    expect(screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel)).toHaveValue('20:15')
  })

  it('normaliseert een teruggerolde "HH:MM:SS"-waarde naar "HH:MM" in het invoerveld (GatherTimeField-resync na rollback)', async () => {
    // initialGatherTime komt hier ruw uit de database (met seconden) binnen,
    // exact zoals lastConfirmedGatherRef die bij mount vastlegt. Na een
    // mislukte save rolt MatchSquadEditor terug naar deze ruwe waarde, en
    // GatherTimeField moet die zelf normaliseren (GatherTimeField.tsx:37-40) —
    // dit is de enige test die dat pad end-to-end doorloopt.
    mockUpdateGatherTime.mockRejectedValueOnce(new Error('Netwerkfout 500'))
    renderEditor({ initialGatherTime: '18:00:00' })
    const input = screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel)

    await typeAndSaveGatherTime('19:30')

    // Het veld toont "HH:MM", nooit de ruwe "HH:MM:SS" die lastConfirmedGatherRef
    // intern bewaart.
    expect(input).toHaveValue('18:00')
    expect(input).not.toHaveValue('18:00:00')
  })
})

describe('exportknop', () => {
  it('is disabled bij 0 geselecteerd, en een klik roept window.print() niet aan', () => {
    const printSpy = stubPrint()
    renderEditor()
    const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(printButton).toBeDisabled()
    fireEvent.click(printButton)
    expect(printSpy).not.toHaveBeenCalled()
    expect(screen.getByText(nl.matchSquad.emptyExportHint)).toBeInTheDocument()
  })

  it('wordt bruikbaar zodra er minstens 1 speler geselecteerd is', async () => {
    const printSpy = stubPrint()
    const open = stubExport()
    try {
      renderEditor()
      await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
      const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })
      expect(printButton).not.toBeDisabled()
      fireEvent.click(printButton)
      expect(open).toHaveBeenCalledTimes(1)
      expect(printSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(screen.queryByText(nl.matchSquad.emptyExportHint)).not.toBeInTheDocument()
  })
})

describe('lege staat', () => {
  it('players: [] en hasAnyActivePlayers: false toont de kaart-met-link-naar-/players/new, geen crash', () => {
    expect(() => renderEditor({ players: [], hasAnyActivePlayers: false })).not.toThrow()
    expect(screen.getByText(nl.matchSquad.emptyTeam)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.add })).toHaveAttribute('href', '/players/new')
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('players: [] en hasAnyActivePlayers: true toont de "meld eerst aanwezigheid"-copy, niet de "voeg speler toe"-copy', () => {
    expect(() => renderEditor({ players: [], hasAnyActivePlayers: true })).not.toThrow()
    expect(screen.getByText(nl.matchSquad.emptyNoAttendance)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.matchSquad.emptyNoAttendanceLink })).toHaveAttribute('href', '/events/e1')
    expect(screen.queryByText(nl.matchSquad.emptyTeam)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: nl.players.add })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })
})

// Rij-element van een speler: de ouder van de toggle (naam, regel 2, minuten en
// toggle zitten samen in één rij).
function rijVan(naam: string): HTMLElement {
  return screen.getByRole('button', { name: `${nl.matchSquad.toggleLabel}: ${naam}` }).parentElement as HTMLElement
}

function status(...paren: [string, AttendanceStatus][]): Record<string, AttendanceStatus> {
  return Object.fromEntries(paren)
}

describe('groepen (de wedstrijd als één flow)', () => {
  const groepSpelers = [
    makePlayer({ id: 'a1', name: 'Anna Aanwezig' }),
    makePlayer({ id: 'g1', name: 'Gerrit Geenreactie' }),
    makePlayer({ id: 'x1', name: 'Xander Afwezig' }),
    makePlayer({ id: 'b1', name: 'Bas Blessure', injured: true }),
    makePlayer({ id: 'i1', name: 'Ina Inactief', active: false }),
  ]
  const groepStatus = status(['a1', 'present'], ['g1', 'unknown'], ['x1', 'absent'], ['b1', 'injured'], ['i1', 'present'])

  it('toont Aanwezig, Nog geen reactie en Afwezig of geblesseerd in deze volgorde met aantallen', () => {
    renderEditor({ players: groepSpelers, statusPerSpeler: groepStatus })
    const koppen = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(koppen).toEqual([
      nl.matchSquad.groepAanwezig.replace('{n}', '1'),
      nl.matchSquad.groepGeenReactie.replace('{n}', '1'),
    ])
    // De afwezig-groep is een <details> met een <summary> als kop.
    expect(screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '3'))).toBeInTheDocument()
  })

  it('laat de groep Nog geen reactie weg als die leeg is, en de afwezig-groep ook', () => {
    renderEditor({ players: [groepSpelers[0]], statusPerSpeler: status(['a1', 'present']) })
    expect(screen.queryByText(/Nog geen reactie/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Afwezig of geblesseerd/)).not.toBeInTheDocument()
  })

  it('zonder aanwezigen blijft de groep Aanwezig staan met de lege regel en een link naar de aanwezigheid', () => {
    renderEditor({ players: [groepSpelers[1]], statusPerSpeler: status(['g1', 'unknown']) })
    expect(screen.getByText(nl.matchSquad.groepAanwezig.replace('{n}', '0'))).toBeInTheDocument()
    expect(screen.getByText(nl.matchSquad.geenAanwezigen)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.matchSquad.emptyNoAttendanceLink })).toHaveAttribute('href', '/events/e1')
  })

  it('houdt de afwezig-groep standaard dicht', () => {
    const { container } = renderEditor({ players: groepSpelers, statusPerSpeler: groepStatus })
    expect(container.querySelector('details')).not.toHaveAttribute('open')
  })

  it('opent de afwezig-groep automatisch met een geselecteerde speler erin, en klapt niet dicht bij deselecteren', async () => {
    const { container } = renderEditor({ players: groepSpelers, statusPerSpeler: groepStatus, initialSelectedIds: ['x1'] })
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details).toHaveAttribute('open')
    await clickToggle(`${nl.matchSquad.toggleLabel}: Xander Afwezig`)
    expect(mockToggle).toHaveBeenCalledWith('e1', 'x1', false)
    expect(container.querySelector('details')).toHaveAttribute('open')
  })

  it('laat een speler in elke groep selecteren (de toggle werkt ook bij Nog geen reactie)', async () => {
    renderEditor({ players: groepSpelers, statusPerSpeler: groepStatus })
    await clickToggle(`${nl.matchSquad.toggleLabel}: Gerrit Geenreactie`)
    expect(mockToggle).toHaveBeenCalledWith('e1', 'g1', true)
  })
})

describe('rij-informatie', () => {
  it('toont positie-afkorting en statuslabel op regel 2', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters', position: 'Spits' })],
      statusPerSpeler: status(['p1', 'present']),
    })
    expect(within(rijVan('Piet Peters')).getByText(`ST · ${nl.event.presentStat}`)).toBeInTheDocument()
  })

  it('toont de statuslabels voor geen reactie, afwezig en geblesseerd', () => {
    renderEditor({
      players: [
        makePlayer({ id: 'p1', name: 'Een Speler' }),
        makePlayer({ id: 'p2', name: 'Twee Speler' }),
        makePlayer({ id: 'p3', name: 'Drie Speler' }),
      ],
      statusPerSpeler: status(['p1', 'unknown'], ['p2', 'absent'], ['p3', 'injured']),
      initialSelectedIds: ['p2', 'p3'],
    })
    expect(within(rijVan('Een Speler')).getByText(new RegExp(nl.matchSquad.geenReactieLabel))).toBeInTheDocument()
    expect(within(rijVan('Twee Speler')).getByText(new RegExp(nl.event.absentStat))).toBeInTheDocument()
    expect(within(rijVan('Drie Speler')).getByText(new RegExp(nl.event.injuredStat))).toBeInTheDocument()
  })

  it('toont "–" als de positie onbekend is', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters', position: 'Onbekende positie' as Player['position'] })],
      statusPerSpeler: status(['p1', 'present']),
    })
    expect(within(rijVan('Piet Peters')).getByText(`– · ${nl.event.presentStat}`)).toBeInTheDocument()
  })

  it('toont een blessure-chip bij players.injured, náást het statuslabel', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters', injured: true })],
      statusPerSpeler: status(['p1', 'present']),
    })
    const rij = rijVan('Piet Peters')
    expect(within(rij).getByText(nl.players.injuredBadge)).toBeInTheDocument()
    expect(within(rij).getByText(`ST · ${nl.event.presentStat}`)).toBeInTheDocument()
  })

  it('toont zonder blessure geen chip', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters' })],
      statusPerSpeler: status(['p1', 'present']),
    })
    expect(within(rijVan('Piet Peters')).queryByText(nl.players.injuredBadge)).not.toBeInTheDocument()
  })

  it('een inactieve speler toont het inactief-label i.p.v. de eventstatus (nooit beide)', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Oud Gediende', active: false })],
      initialSelectedIds: ['p1'],
      statusPerSpeler: status(['p1', 'present']),
    })
    const rij = rijVan('Oud Gediende')
    expect(within(rij).getByText(`ST · ${nl.players.inactiveLabel}`)).toBeInTheDocument()
    expect(within(rij).queryByText(new RegExp(nl.event.presentStat))).not.toBeInTheDocument()
  })

  it('een gast toont altijd het Gast-label, naast het statuslabel', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Gast Speler', type: 'guest' })],
      statusPerSpeler: status(['p1', 'present']),
    })
    const rij = rijVan('Gast Speler')
    expect(within(rij).getByText(`(${nl.players.guestBadge})`)).toBeInTheDocument()
    expect(within(rij).getByText(`ST · ${nl.event.presentStat}`)).toBeInTheDocument()
  })

  it('een reguliere speler toont geen Gast-label', () => {
    renderEditor({ players: [makePlayer({ id: 'p1', name: 'Reguliere Speler' })], statusPerSpeler: status(['p1', 'present']) })
    expect(within(rijVan('Reguliere Speler')).queryByText(`(${nl.players.guestBadge})`)).not.toBeInTheDocument()
  })

  it('een ontbrekende status telt als geen reactie', () => {
    renderEditor({ players: [makePlayer({ id: 'p1', name: 'Piet Peters' })], statusPerSpeler: {} })
    expect(screen.getByText(nl.matchSquad.groepGeenReactie.replace('{n}', '1'))).toBeInTheDocument()
  })
})

describe('speelminuten van de laatste wedstrijden', () => {
  const minuten = {
    wedstrijden: [
      { id: 'w3', date: '2026-08-02' },
      { id: 'w2', date: '2026-07-26' },
      { id: 'w1', date: '2026-07-19' },
    ],
    perSpeler: { p1: [90, null, 0], p2: [null, null, null] },
  }
  const twee = [makePlayer({ id: 'p1', name: 'Piet Peters' }), makePlayer({ id: 'p2', name: 'Jan Jansen' })]
  const aanwezig = status(['p1', 'present'], ['p2', 'present'])

  it('toont de minutenkop met drie datums en per speler de waarde, "–" bij geen rij en 0 als 0', () => {
    renderEditor({ players: twee, statusPerSpeler: aanwezig, recenteMinuten: minuten })
    expect(screen.getByText(nl.matchSquad.minutenKop)).toBeInTheDocument()
    // Kolomkoppen: datums, dag/maand zonder jaar, opgemaakt in UTC.
    const datum = (iso: string) => new Intl.DateTimeFormat(nl.browserLocale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${iso}T00:00:00Z`))
    for (const d of ['2026-08-02', '2026-07-26', '2026-07-19']) expect(screen.getByText(datum(d))).toBeInTheDocument()
    const rij1 = rijVan('Piet Peters')
    expect(within(rij1).getByText('90')).toBeInTheDocument()
    expect(within(rij1).getByText('0')).toBeInTheDocument()
    expect(within(rij1).getAllByText('–')).toHaveLength(1)
    expect(within(rijVan('Jan Jansen')).getAllByText('–')).toHaveLength(3)
  })

  it('geeft elke cel een schermlezer-tekst met de datum en de minuten', () => {
    renderEditor({ players: twee, statusPerSpeler: aanwezig, recenteMinuten: minuten })
    const datum = new Intl.DateTimeFormat(nl.browserLocale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .format(new Date('2026-08-02T00:00:00Z'))
    expect(within(rijVan('Piet Peters')).getByText(nl.matchSquad.minutenSr.replace('{minuten}', '90').replace('{datum}', datum))).toBeInTheDocument()
    expect(within(rijVan('Jan Jansen')).getByText(nl.matchSquad.minutenGeenSr.replace('{datum}', datum))).toBeInTheDocument()
  })

  it('toont geen kolommen en geen kop zonder eerdere wedstrijden', () => {
    renderEditor({ players: twee, statusPerSpeler: aanwezig, recenteMinuten: { wedstrijden: [], perSpeler: {} } })
    expect(screen.queryByText(nl.matchSquad.minutenKop)).not.toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.minutenFout)).not.toBeInTheDocument()
    expect(within(rijVan('Piet Peters')).queryByText('–')).not.toBeInTheDocument()
  })

  it('toont bij null geen kolommen maar wel de foutregel, en de selectie werkt nog', async () => {
    renderEditor({ players: twee, statusPerSpeler: aanwezig, recenteMinuten: null })
    expect(screen.getByText(nl.matchSquad.minutenFout)).toBeInTheDocument()
    expect(screen.queryByText(nl.matchSquad.minutenKop)).not.toBeInTheDocument()
    await clickToggle(`${nl.matchSquad.toggleLabel}: Piet Peters`)
    expect(mockToggle).toHaveBeenCalledWith('e1', 'p1', true)
  })
})

describe('printblok blijft onaangeroerd (AC20)', () => {
  it('bevat geen positie-afkorting, status, blessure-chip of minuten', () => {
    const { container } = renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters', position: 'Spits', injured: true })],
      initialSelectedIds: ['p1'],
      statusPerSpeler: status(['p1', 'present']),
      recenteMinuten: { wedstrijden: [{ id: 'w1', date: '2026-07-19' }], perSpeler: { p1: [77] } },
    })
    const print = container.querySelector('.print-poster') as HTMLElement
    expect(print).toBeTruthy()
    expect(within(print).getByText('Piet Peters')).toBeInTheDocument()
    expect(within(print).queryByText(/ST\b/)).not.toBeInTheDocument()
    expect(within(print).queryByText(nl.event.presentStat)).not.toBeInTheDocument()
    expect(within(print).queryByText(nl.players.injuredBadge)).not.toBeInTheDocument()
    expect(within(print).queryByText('77')).not.toBeInTheDocument()
    // Het schermdeel heeft ze wel, en staat in een print:hidden-blok.
    const scherm = screen.getByText(nl.matchSquad.groepAanwezig.replace('{n}', '1')).closest('.print\\:hidden')
    expect(scherm).toBeTruthy()
    expect(print.closest('.print\\:hidden')).toBeNull()
  })
})

describe('inactieve speler en gast (labels op regel 2)', () => {
  it('een geselecteerde inactieve speler blijft zichtbaar, in de afwezig-groep en met het inactief-label', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Oud Gediende', active: false })],
      initialSelectedIds: ['p1'],
      statusPerSpeler: status(['p1', 'unknown']),
    })
    expect(screen.getByText(nl.matchSquad.groepAfwezig.replace('{n}', '1'))).toBeInTheDocument()
    expect(within(rijVan('Oud Gediende')).getByText(new RegExp(nl.players.inactiveLabel))).toBeInTheDocument()
  })

  it('een inactieve gast toont BEIDE labels: Gast én inactief', () => {
    renderEditor({
      players: [makePlayer({ id: 'p1', name: 'Inactieve Gast', type: 'guest', active: false })],
      initialSelectedIds: ['p1'],
      statusPerSpeler: status(['p1', 'absent']),
    })
    const rij = rijVan('Inactieve Gast')
    expect(within(rij).getByText(`(${nl.players.guestBadge})`)).toBeInTheDocument()
    expect(within(rij).getByText(new RegExp(nl.players.inactiveLabel))).toBeInTheDocument()
  })
})
