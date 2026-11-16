import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { Player } from '@/lib/types'
import type { PlayerForm } from '@/lib/lineup-form'
import LineupBuilder from '@/components/LineupBuilder'
import { saveLineup } from '@/app/actions/attendance'
import { FORMATIONS, type LineupPosition } from '@/lib/types'
import type { VorigeOpstelling } from '@/lib/vorige-opstelling'
import BackButton from '@/components/BackButton'
import Link from 'next/link'

const routerPush = vi.fn()
const routerBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
}))

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

// ---------------------------------------------------------------------------
// De wedstrijd als één flow: overnemen, onopgeslagen-bewaking, mobiele bank.
// ---------------------------------------------------------------------------

const spelers = [
  player({ id: 'p1', name: 'Anna Bakker', position: 'Keeper', jersey_number: 1 }),
  player({ id: 'p2', name: 'Bram Claes', position: 'Spits', jersey_number: 9 }),
  player({ id: 'p3', name: 'Carla Dijk', position: 'Centrale middenvelder', jersey_number: 8 }),
]
const alleForm = { p1: form(), p2: form(), p3: form() }

// 4-3-3 uit de bron-formaties, met de opgegeven spelers op de eerste slots.
function vorigePosities(ids: (string | null)[]): LineupPosition[] {
  return FORMATIONS['4-3-3'].positions.map((p, i) => ({ ...p, player_id: ids[i] ?? null }))
}

function beschikbaar(overrides: Partial<Extract<VorigeOpstelling, { beschikbaar: true }>> = {}): VorigeOpstelling {
  return {
    beschikbaar: true,
    bronEventId: 'e0',
    bronDatum: '2026-07-19',
    formation: '4-3-3',
    positions: vorigePosities(['p1', 'p2']),
    leegGelaten: 0,
    ...overrides,
  }
}

function renderMet(extra: Partial<React.ComponentProps<typeof LineupBuilder>> = {}) {
  return render(
    <DictProvider dict={nl}>
      <Link href="/events/event-1/analysis">naar analyse</Link>
      <BackButton fallback="/events/event-1">terug</BackButton>
      <LineupBuilder eventId="event-1" players={spelers} playerForm={alleForm} {...extra} />
    </DictProvider>,
  )
}

// Slots bevatten de positielabel-tekst of de voornaam van de speler.
const slotMet = (naam: string) => screen.queryByText(naam)

describe('LineupBuilder — vorige opstelling overnemen', () => {
  beforeEach(() => vi.mocked(saveLineup).mockClear())

  it('toont geen overnemen-knop zonder vorigeOpstelling-prop', () => {
    renderMet()
    expect(screen.queryByRole('button', { name: nl.lineup.vorigeOvernemen })).not.toBeInTheDocument()
  })

  it('toont geen overnemen-knop zonder wedstrijd-recht (canEdit=false)', () => {
    renderMet({ canEdit: false, vorigeOpstelling: beschikbaar() })
    expect(screen.queryByRole('button', { name: nl.lineup.vorigeOvernemen })).not.toBeInTheDocument()
  })

  it('toont de bronwedstrijd (datum) onder de knop', () => {
    renderMet({ vorigeOpstelling: beschikbaar() })
    expect(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen })).toBeEnabled()
    expect(screen.getByText(/^Van /)).toBeInTheDocument()
  })

  it('op een leeg veld: direct overnemen, zonder bevestigingsblad en zonder saveLineup', () => {
    renderMet({ vorigeOpstelling: beschikbaar() })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(slotMet('Anna')).toBeInTheDocument()
    expect(slotMet('Bram')).toBeInTheDocument()
    expect(saveLineup).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.overgenomenMelding)
  })

  it('neemt ook de formatie over', () => {
    renderMet({
      vorigeOpstelling: beschikbaar({
        formation: '4-4-2',
        positions: FORMATIONS['4-4-2'].positions.map((p, i) => ({ ...p, player_id: i === 0 ? 'p1' : null })),
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.getByRole('button', { name: /4-4-2/ })).toBeInTheDocument()
  })

  it('meldt het aantal leeg gelaten slots (enkelvoud en meervoud)', () => {
    const { unmount } = renderMet({ vorigeOpstelling: beschikbaar({ leegGelaten: 1 }) })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.overgenomenLeegOne)
    unmount()
    renderMet({ vorigeOpstelling: beschikbaar({ leegGelaten: 3 }) })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.overgenomenLeegMany.replace('{n}', '3'))
  })

  it('op een gevuld veld: eerst een bevestigingsblad; annuleren laat het veld gelijk', () => {
    renderMet({ vorigeOpstelling: beschikbaar({ positions: vorigePosities(['p3']) }) })
    // Veld vullen via auto-opstelling.
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    const voor = document.querySelector('.relative[style*="padding-top"]')?.textContent
    expect(voor).toContain('Anna')
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.getByRole('dialog', { name: nl.lineup.vervangenVraag })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: nl.common.cancel }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('.relative[style*="padding-top"]')?.textContent).toBe(voor)
    expect(screen.queryByText(nl.lineup.overgenomenMelding)).not.toBeInTheDocument()
  })

  it('bevestigen vervangt de opstelling, nog steeds zonder saveLineup', () => {
    renderMet({ vorigeOpstelling: beschikbaar({ positions: vorigePosities(['p2']) }) })
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vervangenBevestig }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.overgenomenMelding)
    expect(saveLineup).not.toHaveBeenCalled()
  })

  it.each([
    ['geen', nl.lineup.vorigeGeen],
    ['onleesbaar', nl.lineup.vorigeOnleesbaar],
    ['fout', nl.lineup.vorigeFout],
  ] as const)('reden %s: knop uitgeschakeld met uitleg', (reden, tekst) => {
    renderMet({ vorigeOpstelling: { beschikbaar: false, reden } })
    expect(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen })).toBeDisabled()
    expect(screen.getByText(tekst)).toBeInTheDocument()
  })

  it('een volgende wijziging wist de overgenomen-melding', () => {
    renderMet({ vorigeOpstelling: beschikbaar() })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    expect(screen.getByRole('status')).toHaveTextContent(nl.lineup.overgenomenMelding)
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('LineupBuilder — onopgeslagen-bewaking', () => {
  beforeEach(() => {
    routerPush.mockClear()
    routerBack.mockClear()
    vi.mocked(saveLineup).mockClear()
  })
  // jsdom "navigeert" niet echt; vang gewone link-klikken af zodat een niet
  // onderschepte klik geen "not implemented"-ruis geeft.
  const vang = (e: MouseEvent) => e.preventDefault()
  beforeEach(() => document.addEventListener('click', vang))
  afterEach(() => document.removeEventListener('click', vang))

  it('geen blad bij een link-klik zolang er niets gewijzigd is', () => {
    renderMet()
    fireEvent.click(screen.getByText('naar analyse'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('na een wijziging onderschept een link-klik met het verlaten-blad', () => {
    renderMet()
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByText('naar analyse'))
    const blad = screen.getByRole('dialog', { name: nl.lineup.verlatenTitel })
    expect(blad).toHaveTextContent(nl.lineup.verlatenTekst)
    expect(screen.getByRole('button', { name: nl.lineup.blijven })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.lineup.tochVerlaten })).toBeInTheDocument()
  })

  it('Blijven sluit het blad zonder te navigeren; Toch verlaten navigeert naar het doel', () => {
    renderMet()
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByText('naar analyse'))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.blijven }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('naar analyse'))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.tochVerlaten }))
    expect(routerPush).toHaveBeenCalledWith('/events/event-1/analysis')
  })

  it('de terugpijl in de paginakop wordt ook bewaakt: Toch verlaten gaat pas dan terug', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
    renderMet()
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(screen.getByRole('dialog', { name: nl.lineup.verlatenTitel })).toBeInTheDocument()
    expect(routerBack).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.tochVerlaten }))
    expect(routerBack).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('de terugpijl is niet bewaakt zolang er niets gewijzigd is', () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
    renderMet()
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(routerBack).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('na een geslaagde save is de bewaking weer uit', async () => {
    renderMet()
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await screen.findByText(nl.lineup.saved)
    fireEvent.click(screen.getByText('naar analyse'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('na een mislukte save blijft de bewaking aan', async () => {
    vi.mocked(saveLineup).mockRejectedValueOnce(new Error('boom'))
    renderMet()
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.save }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByText('naar analyse'))
    expect(screen.getByRole('dialog', { name: nl.lineup.verlatenTitel })).toBeInTheDocument()
  })

  it('overnemen telt als wijziging: link-klik geeft het blad, ook zonder aanraken van het veld', () => {
    renderMet({ vorigeOpstelling: beschikbaar() })
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.vorigeOvernemen }))
    fireEvent.click(screen.getByText('naar analyse'))
    expect(screen.getByRole('dialog', { name: nl.lineup.verlatenTitel })).toBeInTheDocument()
  })

  it('zet beforeunload alleen bij niet-opgeslagen wijzigingen', () => {
    renderMet()
    const schoon = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(schoon)
    expect(schoon.defaultPrevented).toBe(false)
    fireEvent.click(screen.getByText(nl.lineup.autoLineup))
    const vuil = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(vuil)
    expect(vuil.defaultPrevented).toBe(true)
  })

  it('zonder wedstrijd-recht is er niets om te verliezen: geen bewaking', () => {
    renderMet({ canEdit: false })
    fireEvent.click(screen.getByText('naar analyse'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('LineupBuilder — bank op mobiel', () => {
  const metOpstelling = () => renderMet({ initialPositions: vorigePosities(['p1']) })

  it('toont de knop "Bank (n)" met het aantal beschikbare spelers, alleen op mobiel (sm:hidden)', () => {
    metOpstelling()
    const knop = screen.getByRole('button', { name: nl.lineup.bankKnop.replace('{n}', '2') })
    expect(knop.className).toContain('sm:hidden')
    expect(knop.className).toContain('hit-slop')
  })

  it('de inline bank onder het veld is op mobiel verborgen (max-sm:hidden)', () => {
    metOpstelling()
    const kop = screen.getByRole('heading', { name: `${nl.lineup.bench} (2)` })
    expect(kop.parentElement?.className).toContain('max-sm:hidden')
  })

  it('opent een onderblad met rugnummer, naam en positie-afkorting; sluiten kan', () => {
    metOpstelling()
    fireEvent.click(screen.getByRole('button', { name: nl.lineup.bankKnop.replace('{n}', '2') }))
    const blad = screen.getByRole('dialog', { name: `${nl.lineup.bench} (2)` })
    expect(blad).toHaveTextContent('Bram Claes')
    expect(blad).toHaveTextContent('ST')
    expect(blad).toHaveTextContent('Carla Dijk')
    expect(blad).toHaveTextContent('CM')
    expect(blad).toHaveTextContent('9')
    expect(blad).not.toHaveTextContent('Anna Bakker')
    fireEvent.click(screen.getByRole('button', { name: nl.common.close }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('toont geen bankknop zolang niemand is opgesteld', () => {
    renderMet()
    expect(screen.queryByRole('button', { name: /^Bank \(/ })).not.toBeInTheDocument()
  })

  it('toont geen bankknop als iedereen is opgesteld', () => {
    renderMet({ players: [spelers[0]], initialPositions: vorigePosities(['p1']) })
    expect(screen.queryByRole('button', { name: /^Bank \(/ })).not.toBeInTheDocument()
  })
})
