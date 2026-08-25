// Acceptatietests — Clubkleuren (user story: als coach de primaire en
// secundaire kleur van mijn club instellen via een kleurkiezer op de
// instellingenpagina, elk los van de ander en met een reset-optie per kleur,
// en deze kleuren automatisch terugzien in de wedstrijdselectie-PDF en de
// trainingsplan-PDF).
//
// ── AC → test-mapping (nummering volgt de goedgekeurde user story) ──
//   AC1  → describe('AC1 — clubkleuren-sectie direct onder Clublogo ...')
//   AC2  → describe('AC2 — nog geen kleuren ingesteld: fallback, niet leeg ...')
//   AC3  → describe('AC3 — alleen primair opslaan ...')
//   AC4  → describe('AC4 — alleen secundair opslaan ...')
//   AC5  → describe('AC5 — beide kleuren opslaan ...')
//   AC6  → gedekt in AC3/AC4/AC5 (directe bevestiging + "blijft na herlaad")
//   AC7  → describe('AC7 — reset per kleur ...')
//   AC8  → describe('AC8 — Wedstrijdselectie-PDF ...')
//   AC9  → describe('AC9 — Trainingsplan-PDF ...')
//   AC10 → describe('AC10 — Vorm-badges blijven vast ...')
//   AC11 → describe('AC11 — Ongeldige hex ...')
//   AC14 → describe('AC14 — Onverwachte fout bij opslaan/resetten ...')
//   AC15 → describe('AC15 — Precies twee instelbare kleuren ...')
//   AC16 → impliciet gedekt door AC2 + AC8 + AC9 in dit bestand: AC2
//          ("nog geen kleuren ingesteld: kleurkiezer toont de fallback, niet
//          leeg"), AC8 ("Wedstrijdselectie-PDF gebruikt per kleur de
//          ingestelde waarde óf de fallback, nooit leeg") en AC9
//          ("Trainingsplan-PDF gebruikt per kleur de ingestelde waarde óf de
//          fallback, nooit leeg") tonen samen dat de fallbackkleur consistent
//          is op elke plek waar niets is ingesteld — geen apart eigen gedrag
//          om in een losse describe te toetsen.
//   AC17 → describe('AC17 — Reset van de ene kleur raakt de andere niet ...')
//   AC18 → describe('AC18 — kleurkiezer via hex, geen bestandsupload ...')
//   AC20 → describe('AC20 — identieke primaire/secundaire kleur toegestaan ...')
//   AC22 → zie de AC10-describe hierboven ('vorm-badges blijven altijd vast
//          groen/amber/rood, ongeacht ingestelde clubkleuren'): dat vaste
//          UI-elementen (vorm-badges) de ingestelde clubkleuren negeren, is
//          de dekking voor het bredere "kleuren gelden alleen voor de
//          aangewezen brandingplekken"-criterium — geen apart eigen gedrag,
//          geen losse describe.
//   AC23 → zie de AC8- en AC9-describes hierboven ('Wedstrijdselectie-PDF
//          gebruikt per kleur de ingestelde waarde óf de fallback, nooit
//          leeg' resp. 'Trainingsplan-PDF gebruikt per kleur de ingestelde
//          waarde óf de fallback, nooit leeg'): samen bewijzen die dat geen
//          enkele PDF-plek ooit een lege kleur toont — het overkoepelende
//          "nooit leeg, op alle PDF's"-criterium heeft geen eigen gedrag
//          naast wat AC8/AC9 al toetsen.
//
// ── NIET (opnieuw) in dit bestand ──
//   AC12 (server-validatie is bron van waarheid) en AC21 (tenant-isolatie)
//   zitten al grondig in app/actions/team-colors.test.ts (o.a. "schrijft
//   precies één settings-rij, team-gescoped" en de weigeringstests).
//   AC13 (faalpad: "Gegeven ik ben niet ingelogd of niet gekoppeld aan een
//   team, wanneer ik de clubkleuren probeer op te slaan, dan wordt de actie
//   geweigerd en wordt er niets opgeslagen.") zit in
//   app/actions/team-colors.test.ts:152-162 ('weigert zonder ingelogde
//   gebruiker en schrijft niets', saveTeamColor) en :281-291 ('weigert zonder
//   ingelogde gebruiker en raakt niets aan', resetTeamColor) — dit is
//   server-side auth-gedrag, zelfde bestand en reden als AC19/AC21 hieronder:
//   niet zinvol om opnieuw via de DOM te testen. Beide aangehaalde tests
//   dekken alleen `user === null`, niet een apart "wel ingelogd, geen team"-
//   geval — in dit datamodel bestaat die staat niet: `team_id` ís letterlijk
//   `user.id` (zie app/actions/team-colors.ts:42,72), dus "niet ingelogd" en
//   "niet gekoppeld aan een team" zijn hier hetzelfde codepad, niet twee.
//   AC19 (een ingevoerde kleur moet een geldige hex-code zijn; client-side
//   directe feedback, server-side bron van waarheid — een ongeldige waarde
//   wordt nooit opgeslagen) zit deels al gedekt: client-kant in AC11
//   hierboven (regel ~461, ongeldige hex → geen server-call) en in
//   components/ClubColorsSection.test.tsx:99-108 ("'groen' invoeren +
//   opslaan: geen server-call, clubColorErrorInvalid zichtbaar, oude waarde
//   ongewijzigd"); server-kant in app/actions/team-colors.test.ts:164-177
//   ("weigert een ongeldige kleurcode (%s) en schrijft niets", met
//   voorbeelden als 'groen', '#12345', 'rgb(0,0,0)', '##abc') — samen
//   bewijzen die dat een ongeldige hex op geen van beide lagen wordt
//   opgeslagen, geen apart eigen gedrag om hier opnieuw te toetsen.
//   Losse interacties met ClubColorsSection (opslaan/resetten/foutpaden
//   binnen één render) zitten al in components/ClubColorsSection.test.tsx —
//   dit bestand dupliceert die niet, maar bewijst wél expliciet het stuk dat
//   daar ONTBREEKT: dat de kleur ook na een echte HERLAAD (een verse render
//   van de server-pagina met de nu-bijgewerkte database-rij) blijft staan
//   (AC6/AC7), en dat de sectie op de juiste plek in de pagina staat (AC1).
//
// ── Testmethode ──
// - Interactie/faalpaden: rechtstreeks ClubColorsSection renderen (RTL),
//   met gemockte saveTeamColor/resetTeamColor — zelfde precedent als
//   components/ClubColorsSection.test.tsx.
// - "Blijft staan na herlaad" (AC6/AC7) en positionering (AC1/AC15/AC18):
//   de ECHTE server component app/settings/page.tsx wordt gerenderd met een
//   gemockte Supabase-client (precedent: afdrukken-trainingsplan.acceptance
//   .test.tsx, dat app/events/[id]/training-plan/page.tsx op dezelfde manier
//   rendert). Een "herlaad" wordt gesimuleerd door de pagina een TWEEDE keer
//   te renderen met de settings-rij die de (gemockte) save/reset zou hebben
//   achtergelaten — dat is precies wat een echte browserherlaad ook doet:
//   de server component opnieuw uitvoeren tegen de dan-actuele database.
// - PDF's (AC8/AC9/AC10): MatchSquadPrintList/MatchFormCards rechtstreeks
//   met props (precedent: wedstrijdselectie-pdf.acceptance.test.tsx) en de
//   trainingsplan-route app/events/[id]/training-plan/page.tsx rechtstreeks
//   gerenderd (precedent: afdrukken-trainingsplan.acceptance.test.tsx), plus
//   een CSS-regressiecheck van de print-club-*-regels in app/globals.css
//   (zelfde balanced-braces-parser als het C1-blok daar). jsdom past geen
//   @media print toe en heeft geen CSS-var-resolutie voor computed styles —
//   deze tests bewijzen dus het klasse-/CSS-var-/props-contract dat de
//   productiecode aangaat, niet de daadwerkelijke gerenderde kleur in een
//   browser (zelfde beperking als de bestaande print-acceptatietests).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { CLUB_COLOR_FALLBACK } from '@/lib/club-colors'
import type { Player } from '@/lib/types'
import type { MatchFormItem } from '@/lib/match-form'
import ClubColorsSection from '@/components/ClubColorsSection'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'
import MatchFormCards from '@/components/MatchFormCards'

// ── Mocks (module-scope, gelden voor het hele bestand) ──
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => { throw new Error('__notFound__') }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/team-colors', () => ({
  saveTeamColor: vi.fn(),
  resetTeamColor: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { saveTeamColor, resetTeamColor } from '@/app/actions/team-colors'
import SettingsPage from '@/app/settings/page'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'

const mockSave = saveTeamColor as unknown as ReturnType<typeof vi.fn>
const mockReset = resetTeamColor as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockResolvedValue({ error: null, value: '#a1b2c3' })
  mockReset.mockResolvedValue({ error: null })
})

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════
function getHexInput(label: string): HTMLInputElement {
  return screen.getByLabelText(`${label} — ${nl.settings.clubColorHexLabel}`) as HTMLInputElement
}

function getSaveButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: nl.settings.clubColorSave })
}

function getResetButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: nl.settings.clubColorReset })
}

function renderClubColors(initialPrimary: string | null = null, initialSecondary: string | null = null) {
  return render(
    <DictProvider dict={nl}>
      <ClubColorsSection initialPrimary={initialPrimary} initialSecondary={initialSecondary} />
    </DictProvider>,
  )
}

// ── Settings-pagina: gemockte Supabase-client die alleen de settings-tabel
// hoeft te leveren (getAllSettings doet précies die ene query). ──
function settingsSupabaseClient(rows: { key: string; value: string }[]) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows })
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
    from: () => chain,
  }
}

async function renderSettingsPage(rows: { key: string; value: string }[] = []) {
  vi.mocked(createClient).mockResolvedValue(
    settingsSupabaseClient(rows) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await SettingsPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// ── Trainingsplan-route: zelfde tableChain-precedent als
// afdrukken-trainingsplan.acceptance.test.tsx, met 'settings' toegevoegd. ──
type TableResult = { data?: unknown; error?: unknown }

function tableChain(result: TableResult) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'eq']) {
    c[m] = () => c
  }
  c.single = () => Promise.resolve(result)
  ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
  return c
}

const baseTrainingEvent = {
  id: 'e1', team_id: 'team-1', type: 'training', date: '2026-08-11', doelstelling: null as string | null,
}

async function renderTrainingPlanPage(opts: {
  players?: unknown[]
  attendance?: unknown[]
  oefeningenKoppelingen?: unknown[]
  settings?: { key: string; value: string }[]
} = {}) {
  const tables: Record<string, TableResult> = {
    events: { data: baseTrainingEvent },
    players: { data: opts.players ?? [] },
    attendance: { data: opts.attendance ?? [] },
    settings: { data: opts.settings ?? [] },
    training_oefeningen: { data: opts.oefeningenKoppelingen ?? [] },
    oefeningen: { data: [] },
  }
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => tableChain(tables[t] ?? { data: [] }),
    auth: { getUser: async () => ({ data: { user: { id: 'team-1' } } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>)

  const el = await TrainingPlanPage({ params: Promise.resolve({ id: 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// ── Fixtures voor de PDF-tests ──
function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [],
    jersey_number: 9, active: true, injured: false, type: 'regular', rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function formItem(overrides: Partial<MatchFormItem> = {}): MatchFormItem {
  return {
    id: 'm1', result: 'win', goalsFor: 2, goalsAgainst: 1, opponent: 'FC X', date: '2026-08-01',
    homeAway: null,
    ...overrides,
  }
}

function getPrintBlock(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.hidden.print\\:block')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

function renderPrintList(overrides: Partial<Parameters<typeof MatchSquadPrintList>[0]> = {}) {
  const players = overrides.players ?? [makePlayer()]
  return render(
    <DictProvider dict={nl}>
      <MatchSquadPrintList
        players={players}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
        teamName={'teamName' in overrides ? overrides.teamName ?? null : 'FC Voorbeeld'}
        teamLogoUrl={'teamLogoUrl' in overrides ? overrides.teamLogoUrl ?? null : null}
        homeAway={'homeAway' in overrides ? overrides.homeAway ?? null : 'home'}
        gatherTime={'gatherTime' in overrides ? overrides.gatherTime ?? null : '17:30'}
        kickoffTime={'kickoffTime' in overrides ? overrides.kickoffTime ?? null : '19:00'}
        location={'location' in overrides ? overrides.location ?? null : null}
        selectedCount={overrides.selectedCount ?? players.length}
        formItems={overrides.formItems ?? []}
        primaryColor={overrides.primaryColor ?? CLUB_COLOR_FALLBACK.primary}
        secondaryColor={overrides.secondaryColor ?? CLUB_COLOR_FALLBACK.secondary}
      />
    </DictProvider>,
  )
}

const GLOBALS_CSS_PATH = path.resolve(__dirname, 'app', 'globals.css')

function extractBalancedBlock(source: string, fromIndex: number): string {
  const openIndex = source.indexOf('{', fromIndex)
  if (openIndex === -1) throw new Error(`Geen openende { gevonden vanaf index ${fromIndex}`)
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  throw new Error(`Geen sluitende } gevonden voor blok vanaf index ${fromIndex}`)
}

function findRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error(`Selector niet gevonden in CSS-blok: ${selectorPattern}`)
  return extractBalancedBlock(css, match.index)
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — clubkleuren-sectie direct onder Clublogo op de instellingenpagina
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — clubkleuren-sectie direct onder Clublogo op de instellingenpagina', () => {
  it('de "Clubkleuren"-kaart staat DOM-technisch direct ná de "Clublogo"-kaart en vóór de "Aanwezigheid"-kaart', async () => {
    await renderSettingsPage([])
    const logoHeading = screen.getByText(nl.settings.logoSection)
    const colorsHeading = screen.getByText(nl.settings.clubColorsSection)
    const attendanceHeading = screen.getByText(nl.settings.attendanceSection)

    const logoCard = logoHeading.closest('.surface-card') as HTMLElement
    const colorsCard = colorsHeading.closest('.surface-card') as HTMLElement
    const attendanceCard = attendanceHeading.closest('.surface-card') as HTMLElement
    expect(logoCard).not.toBeNull()
    expect(colorsCard).not.toBeNull()
    expect(attendanceCard).not.toBeNull()

    // Logo vóór kleuren, kleuren vóór aanwezigheid — in die exacte volgorde.
    expect(logoCard.compareDocumentPosition(colorsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(colorsCard.compareDocumentPosition(attendanceCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // "Direct onder": geen andere sectiekaart tussen logo en kleuren.
    expect(logoCard.nextElementSibling).toBe(colorsCard)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — nog geen kleuren ingesteld: fallback getoond, niet leeg/"eigen keuze"
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — nog geen kleuren ingesteld: kleurkiezer toont de fallback, niet leeg', () => {
  it('lege database-instellingen → de instellingenpagina geeft null door en ClubColorsSection toont de vaste fallbackkleuren + "standaardkleur"-label voor beide', async () => {
    await renderSettingsPage([])
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    expect(primaryInput.value).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(secondaryInput.value).toBe(CLUB_COLOR_FALLBACK.secondary)
    expect(primaryInput.value).not.toBe('')
    expect(secondaryInput.value).not.toBe('')
    expect(within(screen.getByText(nl.settings.clubColorsSection).closest('.surface-card') as HTMLElement)
      .getAllByText(nl.settings.clubColorDefaultLabel).length).toBe(2)
    // Geen resetknop: er is niets ingesteld om terug te zetten.
    expect(getResetButtons().length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — alleen primaire kleur invullen en opslaan → alleen primair
// opgeslagen, secundair blijft fallback, ook na herlaad (AC6)
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — alleen primair opslaan → alleen primair opgeslagen, secundair blijft fallback, ook ná een echte herlaad', () => {
  it('direct na opslaan: primair bevestigd, secundair blijft ongewijzigd op fallback', async () => {
    await renderSettingsPage([])
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).toHaveBeenCalledWith('primary', '#a1b2c3')
    expect(mockSave).not.toHaveBeenCalledWith('secondary', expect.anything())
    expect(primaryInput.value).toBe('#a1b2c3')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe(CLUB_COLOR_FALLBACK.secondary)
  })

  it('na een ECHTE herlaad (verse render van app/settings/page.tsx met de nu-bijgewerkte database-rij): primair blijft #a1b2c3, secundair blijft fallback', async () => {
    // Simuleert wat saveTeamColor('primary', ...) in de database zou hebben
    // achtergelaten — geen enkele React-state wordt hergebruikt tussen deze
    // render en de vorige, dit is een volledig nieuwe mount.
    await renderSettingsPage([{ key: 'team_color_primary', value: '#a1b2c3' }])
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#a1b2c3')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe(CLUB_COLOR_FALLBACK.secondary)
    // Alleen de primaire rij toont een resetknop.
    expect(getResetButtons().length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — alleen secundaire kleur invullen en opslaan → gespiegeld
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — alleen secundair opslaan → alleen secundair opgeslagen, primair blijft fallback, ook ná herlaad', () => {
  it('direct na opslaan: secundair bevestigd, primair blijft ongewijzigd op fallback', async () => {
    mockSave.mockResolvedValueOnce({ error: null, value: '#4d4dff' })
    await renderSettingsPage([])
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    fireEvent.change(secondaryInput, { target: { value: '#4d4dff' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[1])
    })
    expect(mockSave).toHaveBeenCalledWith('secondary', '#4d4dff')
    expect(mockSave).not.toHaveBeenCalledWith('primary', expect.anything())
    expect(secondaryInput.value).toBe('#4d4dff')
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe(CLUB_COLOR_FALLBACK.primary)
  })

  it('na een echte herlaad: secundair blijft #4d4dff, primair blijft fallback', async () => {
    await renderSettingsPage([{ key: 'team_color_secondary', value: '#4d4dff' }])
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#4d4dff')
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(getResetButtons().length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — beide invullen en opslaan → beide opgeslagen (en blijven na herlaad)
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — beide kleuren invullen en opslaan → beide opgeslagen, ook ná herlaad', () => {
  it('direct na opslaan van beide: beide bevestigd', async () => {
    mockSave
      .mockResolvedValueOnce({ error: null, value: '#a1b2c3' })
      .mockResolvedValueOnce({ error: null, value: '#4d4dff' })
    await renderSettingsPage([])
    fireEvent.change(getHexInput(nl.settings.clubColorPrimaryLabel), { target: { value: '#a1b2c3' } })
    await act(async () => { fireEvent.click(getSaveButtons()[0]) })
    fireEvent.change(getHexInput(nl.settings.clubColorSecondaryLabel), { target: { value: '#4d4dff' } })
    await act(async () => { fireEvent.click(getSaveButtons()[1]) })

    expect(mockSave).toHaveBeenCalledWith('primary', '#a1b2c3')
    expect(mockSave).toHaveBeenCalledWith('secondary', '#4d4dff')
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#a1b2c3')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#4d4dff')
    expect(getResetButtons().length).toBe(2)
  })

  it('na een echte herlaad: beide kleuren blijven staan', async () => {
    await renderSettingsPage([
      { key: 'team_color_primary', value: '#a1b2c3' },
      { key: 'team_color_secondary', value: '#4d4dff' },
    ])
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#a1b2c3')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#4d4dff')
    expect(getResetButtons().length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 / AC17 — reset per kleur, blijft na herlaad, andere kleur ongewijzigd
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — reset per kleur → terug naar fallback, blijft zo ná herlaad', () => {
  it('reset primair: direct terug op fallback, secundair blijft ongewijzigd (AC17)', async () => {
    await renderSettingsPage([
      { key: 'team_color_primary', value: '#111111' },
      { key: 'team_color_secondary', value: '#222222' },
    ])
    expect(getResetButtons().length).toBe(2)
    await act(async () => { fireEvent.click(getResetButtons()[0]) })
    expect(mockReset).toHaveBeenCalledWith('primary')
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe(CLUB_COLOR_FALLBACK.primary)
    // AC17: de andere kleur (secundair) is door deze reset niet geraakt.
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#222222')
    expect(getResetButtons().length).toBe(1)
  })

  it('reset secundair: direct terug op fallback, primair blijft ongewijzigd (AC17, mirror)', async () => {
    await renderSettingsPage([
      { key: 'team_color_primary', value: '#111111' },
      { key: 'team_color_secondary', value: '#222222' },
    ])
    await act(async () => { fireEvent.click(getResetButtons()[1]) })
    expect(mockReset).toHaveBeenCalledWith('secondary')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe(CLUB_COLOR_FALLBACK.secondary)
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#111111')
    expect(getResetButtons().length).toBe(1)
  })

  it('na een echte herlaad (database-rij voor primair daadwerkelijk verwijderd): primair blijft fallback, secundair blijft #222222 ongewijzigd', async () => {
    // Simuleert het resultaat van resetTeamColor('primary'): de rij is weg.
    await renderSettingsPage([{ key: 'team_color_secondary', value: '#222222' }])
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(screen.getAllByText(nl.settings.clubColorDefaultLabel).length).toBe(1)
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#222222')
    expect(getResetButtons().length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — ongeldige hex: wijziging afgewezen, oude waarde blijft, foutmelding,
// GEEN server-call
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — ongeldige hex → afgewezen, geen server-call, begrijpelijke foutmelding, oude waarde blijft', () => {
  it('onvolledige hex-code ("#12") → geen server-call, foutmelding, veld blijft zichtbaar ongeldig', async () => {
    renderClubColors('#111111', null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#12' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(screen.getByText(nl.settings.clubColorErrorInvalid)).toBeInTheDocument()
  })

  it('niet-hex teken ("#12345g") → geen server-call, foutmelding', async () => {
    renderClubColors(null, '#111111')
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    fireEvent.change(secondaryInput, { target: { value: '#12345g' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[1])
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(screen.getByText(nl.settings.clubColorErrorInvalid)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — onverwachte fout bij opslaan/resetten: generieke foutmelding, oude
// waarde blijft, geen halve staat
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — onverwachte fout bij resetten → generieke foutmelding, oude waarde blijft (geen halve staat)', () => {
  it('resetTeamColor gooit een fout → generieke i18n-melding, de kleur blijft de oude ingestelde waarde (niet stiekem toch fallback)', async () => {
    mockReset.mockRejectedValueOnce(new Error('boom'))
    renderClubColors('#111111', null)
    await act(async () => {
      fireEvent.click(getResetButtons()[0])
    })
    expect(screen.getByText(nl.settings.clubColorErrorGeneric)).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    // Geen halve staat: de waarde is NIET teruggevallen op de fallback en de
    // resetknop is niet verdwenen — de reset is dus niet stilzwijgend
    // "half" toegepast.
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#111111')
    expect(getResetButtons().length).toBe(1)
  })

  // K1: de {error}-variant (server-actie retourneert netjes een foutmelding,
  // in plaats van te throwen) was voor save al gedekt in
  // components/ClubColorsSection.test.tsx en voor de actie zelf in
  // app/actions/team-colors.test.ts:310-326, maar voor de UI-kant van
  // rèset ontbrak deze — components/ClubColorsSection.tsx:75-78 toont die
  // melding via een apart codepad dan de catch-blok/throw-variant hierboven.
  it('resetTeamColor geeft {error} terug (geen throw) → melding zichtbaar, de kleur blijft de oude ingestelde waarde (geen halve/inconsistente staat)', async () => {
    mockReset.mockResolvedValueOnce({ error: 'Onbekende kleurinstelling.' })
    renderClubColors('#111111', '#222222')
    await act(async () => {
      fireEvent.click(getResetButtons()[0])
    })
    expect(mockReset).toHaveBeenCalledWith('primary')
    expect(screen.getByText('Onbekende kleurinstelling.')).toBeInTheDocument()
    // Geen halve staat: primair bleef op de oude waarde staan (niet
    // stiekem toch fallback), en de resetknop voor primair is er nog —
    // secundair (niet bij deze reset betrokken) bleef ook ongewijzigd.
    expect(getHexInput(nl.settings.clubColorPrimaryLabel).value).toBe('#111111')
    expect(getHexInput(nl.settings.clubColorSecondaryLabel).value).toBe('#222222')
    expect(getResetButtons().length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — precies twee instelbare kleuren, los van elkaar instelbaar
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — precies twee instelbare kleuren op de instellingenpagina, elk met eigen bediening', () => {
  it('de Clubkleuren-kaart bevat exact 2 hex-tekstvelden, 2 colorpickers en 2 opslaan-knoppen — geen derde kleur', async () => {
    await renderSettingsPage([])
    const card = screen.getByText(nl.settings.clubColorsSection).closest('.surface-card') as HTMLElement
    expect(within(card).getAllByRole('textbox').length).toBe(2)
    expect(card.querySelectorAll('input[type="color"]').length).toBe(2)
    expect(within(card).getAllByRole('button', { name: nl.settings.clubColorSave }).length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 — kleurkiezer (hex), geen bestandsupload, geen kleurextractie
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — kleurkiezer via hex-invoer, geen bestandsupload/kleurextractie', () => {
  it('de Clubkleuren-kaart bevat geen enkel input[type="file"] en geen upload-gerelateerde tekst', async () => {
    await renderSettingsPage([])
    const card = screen.getByText(nl.settings.clubColorsSection).closest('.surface-card') as HTMLElement
    expect(card.querySelector('input[type="file"]')).toBeNull()
    expect(card.textContent).not.toMatch(/upload|bestand/i)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC20 — identieke primaire/secundaire kleur toegestaan, geen waarschuwing
// ═══════════════════════════════════════════════════════════════════════
describe('AC20 — identieke primaire en secundaire kleur toegestaan, geen waarschuwing, en beide printcomponenten renderen zonder crash', () => {
  it('beide kleuren op dezelfde hex opslaan → geen waarschuwingstekst in de DOM', async () => {
    mockSave
      .mockResolvedValueOnce({ error: null, value: '#a1b2c3' })
      .mockResolvedValueOnce({ error: null, value: '#a1b2c3' })
    renderClubColors(null, null)
    fireEvent.change(getHexInput(nl.settings.clubColorPrimaryLabel), { target: { value: '#a1b2c3' } })
    await act(async () => { fireEvent.click(getSaveButtons()[0]) })
    fireEvent.change(getHexInput(nl.settings.clubColorSecondaryLabel), { target: { value: '#a1b2c3' } })
    await act(async () => { fireEvent.click(getSaveButtons()[1]) })
    expect(document.body.textContent).not.toMatch(/zelfde|gelijk|identiek|contrast|waarschuwing/i)
  })

  it('MatchSquadPrintList met identieke primaire en secundaire kleur crasht niet en past beide kleuren toe', () => {
    const { container } = renderPrintList({ primaryColor: '#a1b2c3', secondaryColor: '#a1b2c3' })
    const block = getPrintBlock(container)
    expect(block.getAttribute('style')).toContain('--club-primary: #a1b2c3')
    expect(block.getAttribute('style')).toContain('--club-secondary: #a1b2c3')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — Wedstrijdselectie-PDF gebruikt per kleur de ingestelde waarde óf de
// fallback (nooit leeg), onafhankelijk van clublogo, onafhankelijk van
// onopgeslagen conceptwaarden
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — Wedstrijdselectie-PDF gebruikt per kleur de ingestelde waarde óf de fallback, nooit leeg', () => {
  it('geen kleuren ingesteld (fallback-props, zoals resolveClubColors() teruggeeft bij lege settings) → CSS-vars staan op de vaste fallback, nooit leeg', () => {
    const { container } = renderPrintList({ primaryColor: CLUB_COLOR_FALLBACK.primary, secondaryColor: CLUB_COLOR_FALLBACK.secondary })
    const block = getPrintBlock(container)
    const style = block.getAttribute('style') ?? ''
    expect(style).toContain(`--club-primary: ${CLUB_COLOR_FALLBACK.primary}`)
    expect(style).toContain(`--club-secondary: ${CLUB_COLOR_FALLBACK.secondary}`)
  })

  it('alleen primair ingesteld (secundair op fallback, zoals resolveClubColors() dat combineert) → beide CSS-vars gezet, secundair is de fallback', () => {
    const { container } = renderPrintList({ primaryColor: '#a1b2c3', secondaryColor: CLUB_COLOR_FALLBACK.secondary })
    const block = getPrintBlock(container)
    const style = block.getAttribute('style') ?? ''
    expect(style).toContain('--club-primary: #a1b2c3')
    expect(style).toContain(`--club-secondary: ${CLUB_COLOR_FALLBACK.secondary}`)
  })

  it('beide ingesteld → beide CSS-vars gezet op de eigen waarde, en de kop-rand gebruikt de primaire kleur via var(--club-primary, fallback)', () => {
    const { container } = renderPrintList({ primaryColor: '#a1b2c3', secondaryColor: '#4d4dff', teamName: 'FC Voorbeeld' })
    const block = getPrintBlock(container)
    const style = block.getAttribute('style') ?? ''
    expect(style).toContain('--club-primary: #a1b2c3')
    expect(style).toContain('--club-secondary: #4d4dff')
    const kop = block.querySelector('.border-b-4') as HTMLElement
    expect(kop.style.borderColor).toBe('var(--club-primary, #004f3b)')
    // Clean-document-herontwerp 2026-08-24: de titel draagt de gewaarborgde
    // accent-tekstklasse (kleur via --club-accent-text), nooit een inline
    // clubkleur — een lichte clubkleur als tekst was onleesbaar. De
    // secundaire kleur bereikt de PDF via het tweede segment van de
    // clubbalk (.print-poster-accent, CSS op de --club-secondary-var).
    const title = within(block).getByText(nl.matchSquad.exportTitle)
    expect(title.style.color).toBe('')
    expect(title.className).toContain('print-accent-text')
    expect(block.querySelector('.print-poster-accent')).not.toBeNull()
  })

  it('team zonder clublogo maar met ingestelde clubkleuren: logo ontbreekt, kleuren worden alsnog toegepast (onafhankelijk van elkaar)', () => {
    const { container } = renderPrintList({ teamLogoUrl: null, primaryColor: '#a1b2c3', secondaryColor: '#4d4dff', teamName: 'FC Voorbeeld' })
    const block = getPrintBlock(container)
    expect(block.querySelector('.border-b-4')?.querySelector('img')).toBeNull()
    expect(block.getAttribute('style')).toContain('--club-primary: #a1b2c3')
  })

  it('edge case: een onopgeslagen conceptwaarde in de kleurkiezer kan de PDF nooit bereiken — MatchSquadPrintList/MatchSquadEditor importeren ClubColorsSection niet en hebben geen enkele afhankelijkheid van de team-colors-actions; de PDF krijgt kleuren uitsluitend als kale string-props', () => {
    const printListSource = readFileSync(path.join(__dirname, 'components', 'MatchSquadPrintList.tsx'), 'utf-8')
    const editorSource = readFileSync(path.join(__dirname, 'components', 'MatchSquadEditor.tsx'), 'utf-8')
    const squadPageSource = readFileSync(path.join(__dirname, 'app', 'events', '[id]', 'squad', 'page.tsx'), 'utf-8')
    for (const source of [printListSource, editorSource]) {
      expect(source).not.toMatch(/ClubColorsSection/)
      expect(source).not.toMatch(/team-colors/)
    }
    // De pagina die de PDF-props levert, resolved uitsluitend serverzijdig
    // vanuit de DB-settings (resolveClubColors), niet vanuit enige
    // client-state/draft.
    expect(squadPageSource).toMatch(/resolveClubColors\(settingsMap\)/)
    expect(squadPageSource).toMatch(/primaryColor=\{clubColors\.primary\}/)
    expect(squadPageSource).toMatch(/secondaryColor=\{clubColors\.secondary\}/)
  })

  // K4: MatchSquadPrintList.tsx en MatchFormCards.tsx mogen lib/club-colors
  // niet top-level importeren (zie edge-case hierboven) en herhalen de
  // fallback-hex daarom als losse letterlijke string in elke
  // `var(--club-primary, ...)`/`var(--club-secondary, ...)`-aanroep. Deze
  // test koppelt die letterlijke strings expliciet aan CLUB_COLOR_FALLBACK —
  // zelfde precedent als de globals.css-regressietest verderop in dit
  // bestand — zodat een toekomstige wijziging van CLUB_COLOR_FALLBACK die
  // niet overal is doorgevoerd hier meteen faalt, in plaats van pas zichtbaar
  // te worden als een still-op-het-oog-kloppende maar afwijkende hex in de
  // PDF.
  it('regressie: elke var(--club-primary, ...)/var(--club-secondary, ...) in MatchSquadPrintList.tsx en MatchFormCards.tsx gebruikt letterlijk CLUB_COLOR_FALLBACK.primary/.secondary als fallback', () => {
    const printListSource = readFileSync(path.join(__dirname, 'components', 'MatchSquadPrintList.tsx'), 'utf-8')
    const formCardsSource = readFileSync(path.join(__dirname, 'components', 'MatchFormCards.tsx'), 'utf-8')

    for (const [name, source] of [
      ['MatchSquadPrintList.tsx', printListSource],
      ['MatchFormCards.tsx', formCardsSource],
    ] as const) {
      const primaryFallbacks = [...source.matchAll(/var\(--club-primary,\s*([^)]+)\)/g)].map((m) => m[1].trim())
      const secondaryFallbacks = [...source.matchAll(/var\(--club-secondary,\s*([^)]+)\)/g)].map((m) => m[1].trim())

      // Er moet minstens één van elk zijn — anders bewijst deze test niets.
      expect(primaryFallbacks.length, `${name}: geen enkele var(--club-primary, ...) gevonden`).toBeGreaterThan(0)

      for (const fallback of primaryFallbacks) {
        expect(fallback, `${name}: fallback "${fallback}" wijkt af van CLUB_COLOR_FALLBACK.primary`).toBe(CLUB_COLOR_FALLBACK.primary)
      }
      for (const fallback of secondaryFallbacks) {
        expect(fallback, `${name}: fallback "${fallback}" wijkt af van CLUB_COLOR_FALLBACK.secondary`).toBe(CLUB_COLOR_FALLBACK.secondary)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — Trainingsplan-PDF: zelfde regime (ingestelde waarde óf fallback,
// nooit leeg), toegepast via de echte route
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — Trainingsplan-PDF gebruikt per kleur de ingestelde waarde óf de fallback, nooit leeg', () => {
  it('geen settings-rijen → de page-root CSS-vars staan op de vaste fallback (resolveClubColors bij lege settings), nooit leeg', async () => {
    const { container } = await renderTrainingPlanPage({ settings: [] })
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--club-primary')).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(root.style.getPropertyValue('--club-secondary')).toBe(CLUB_COLOR_FALLBACK.secondary)
  })

  it('beide kleuren ingesteld → de page-root CSS-vars staan op de ingestelde waarden', async () => {
    const { container } = await renderTrainingPlanPage({
      settings: [
        { key: 'team_color_primary', value: '#a1b2c3' },
        { key: 'team_color_secondary', value: '#4d4dff' },
      ],
    })
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--club-primary')).toBe('#a1b2c3')
    expect(root.style.getPropertyValue('--club-secondary')).toBe('#4d4dff')
  })

  it('AttendanceSummary print-only kopregels dragen de print-accent-text-klasse en de page-root zet de gewaarborgde --club-accent-text-var (verstrakking 2026-08-24)', async () => {
    const { container } = await renderTrainingPlanPage({
      settings: [{ key: 'team_color_primary', value: '#a1b2c3' }],
      players: [{ id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [], jersey_number: 9, active: true, injured: false, rating: 5, created_at: '2024-01-01T00:00:00Z' }],
      attendance: [{ player_id: 'p1', status: 'present' }],
    })
    const printHeading = screen.getByText(
      (_c, el) => el?.tagName === 'P' && el.textContent === `${nl.event.attendance} (1/1)`,
    )
    expect(printHeading.className).toContain('print-accent-text')
    // #a1b2c3 haalt op wit geen 3:1 — de gewaarborgde accentvar valt dan
    // terug op de vaste donkere tint (lib/club-colors.ts:READABLE_INK_DARK),
    // terwijl --club-primary zelf de ingestelde kleur houdt.
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--club-primary')).toBe('#a1b2c3')
    expect(root.style.getPropertyValue('--club-accent-text')).toBe('#0a2e2a')
  })

  // C1-achtige CSS-regressiebewaking (zelfde balanced-braces-parser als het
  // C1-blok in afdrukken-trainingsplan.acceptance.test.tsx): bewijst dat de
  // print-club-*-regels daadwerkelijk in het @media print-blok staan en
  // dezelfde fallback-hex gebruiken als CLUB_COLOR_FALLBACK — dus nooit een
  // lege kleur op de afdruk, zelfs niet zonder de CSS-var (buiten deze route
  // gerenderd zonder page-root-context zou --club-primary anders undefined
  // zijn).
  it('app/globals.css (@media print): .print-club-primary/.print-club-secondary/.print-club-border/.print-club-bg-primary bestaan en vallen terug op de CLUB_COLOR_FALLBACK-hex', () => {
    const cssSource = readFileSync(GLOBALS_CSS_PATH, 'utf-8')
    const mediaPrintIndex = cssSource.indexOf('@media print')
    expect(mediaPrintIndex).toBeGreaterThan(-1)
    const mediaPrintBlock = extractBalancedBlock(cssSource, mediaPrintIndex)

    const primaryBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-club-primary\s*\{/))
    expect(primaryBlock).toMatch(new RegExp(`color:\\s*var\\(--club-primary,\\s*${CLUB_COLOR_FALLBACK.primary}\\)\\s*!important`))

    const secondaryBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-club-secondary\s*\{/))
    expect(secondaryBlock).toMatch(new RegExp(`color:\\s*var\\(--club-secondary,\\s*${CLUB_COLOR_FALLBACK.secondary}\\)\\s*!important`))

    const borderBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-club-border\s*\{/))
    expect(borderBlock).toMatch(new RegExp(`border-color:\\s*var\\(--club-primary,\\s*${CLUB_COLOR_FALLBACK.primary}\\)\\s*!important`))

    const bgBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-club-bg-primary\s*\{/))
    expect(bgBlock).toMatch(new RegExp(`background:\\s*var\\(--club-primary,\\s*${CLUB_COLOR_FALLBACK.primary}\\)\\s*!important`))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — vorm-badges (win/gelijk/verlies) blijven altijd vast
// groen/amber/rood, ongeacht ingestelde clubkleuren
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — vorm-badges blijven altijd vast groen/amber/rood, ongeacht ingestelde clubkleuren', () => {
  function renderFormCardsWithClubColors(items: MatchFormItem[]) {
    return render(
      <DictProvider dict={nl}>
        <div style={{ '--club-primary': '#a1b2c3', '--club-secondary': '#4d4dff' } as React.CSSProperties}>
          <MatchFormCards items={items} />
        </div>
      </DictProvider>,
    )
  }

  it('win-badge blijft het vaste groen (#16a34a), niet de ingestelde clubkleur', () => {
    const { container } = renderFormCardsWithClubColors([formItem({ id: 'a', result: 'win' })])
    const badge = within(container).getByText(nl.home.formLetterWin)
    expect((badge as HTMLElement).style.background).toBe('rgb(22, 163, 74)')
    expect((badge as HTMLElement).style.background).not.toContain('var(--club')
  })

  it('gelijk-badge blijft de vaste amber-outline (var(--chip-amber-fg), geen clubkleur)', () => {
    const { container } = renderFormCardsWithClubColors([formItem({ id: 'a', result: 'draw' })])
    const badge = within(container).getByText(nl.home.formLetterDraw)
    expect((badge as HTMLElement).style.color).toBe('var(--chip-amber-fg)')
    expect((badge as HTMLElement).style.background).not.toContain('var(--club')
  })

  it('verlies-badge blijft het vaste rood (var(--chip-red-fg) op #fee2e2), geen clubkleur', () => {
    const { container } = renderFormCardsWithClubColors([formItem({ id: 'a', result: 'loss' })])
    const badge = within(container).getByText(nl.home.formLetterLoss)
    expect((badge as HTMLElement).style.color).toBe('var(--chip-red-fg)')
    expect((badge as HTMLElement).style.background).toBe('rgb(254, 226, 226)')
  })

  it('bronbestand-check: FORM_STYLE in MatchFormCards.tsx bevat geen enkele verwijzing naar --club-primary/--club-secondary', () => {
    const source = readFileSync(path.join(__dirname, 'components', 'MatchFormCards.tsx'), 'utf-8')
    const formStyleMatch = /const FORM_STYLE[^=]*=\s*\{[\s\S]*?\n\}/.exec(source)
    expect(formStyleMatch).not.toBeNull()
    const formStyleBlock = formStyleMatch![0]
    expect(formStyleBlock).not.toMatch(/--club-primary/)
    expect(formStyleBlock).not.toMatch(/--club-secondary/)
  })
})
