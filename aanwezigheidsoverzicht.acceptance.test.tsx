// Acceptatietests — aanwezigheidsoverzicht op /players (?weergave=aanwezigheid).
//
// Rendert de ECHTE app/players/page.tsx (async server component) met RTL. Gestubd
// zijn alleen de randen: @/lib/supabase/server (tabel-chain + rpc), de
// teamcontext, getAllSettings en logError. De RPC
// `aanwezigheidsoverzicht_per_speler` wordt niet met canned data beantwoord: de
// handler herberekent de aggregatie uit de in-memory attendance/events/players,
// gefilterd op p_team_id, p_start en p_end die de PAGINA doorgeeft (zelfde
// aanpak als inzichten.acceptance.test.tsx). Een verkeerd venster of een
// verkeerd team-argument laat deze tests dus vallen. De SQL zelf
// (supabase/aanwezigheidsoverzicht.sql) wordt hier niet tegen Postgres
// gedraaid.
//
// Dual-markup: scherm (`print:hidden`) en afdruk (`[data-print-only]`) staan
// allebei in de DOM, dus alle queries zijn gescoped met `within`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/team-context', () => ({
  requireTeamContextOrLogin: vi.fn().mockResolvedValue({ teamId: 'team-1', userId: 'user-1', rol: 'owner' }),
  canEdit: vi.fn().mockReturnValue(true),
}))
vi.mock('@/app/actions/settings', () => ({ getAllSettings: vi.fn() }))
vi.mock('@/lib/errors', async (orig) => ({ ...(await orig<typeof import('@/lib/errors')>()), logError: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getAllSettings } from '@/app/actions/settings'
import { requireTeamContextOrLogin, canEdit } from '@/lib/team-context'
import { logError } from '@/lib/errors'
import PlayersPage from '@/app/players/page'
import { berekenAanwezigheidPercentage } from '@/lib/inzichten'
import { formatDate } from '@/lib/utils'

type Row = Record<string, unknown>

const TEAM = 'team-1'
const OTHER = 'team-2'
// Vaste "vandaag" (lokaal): het getelde venster loopt t/m gisteren = 2026-10-14.
const NOW = new Date(2026, 9, 15, 12, 0, 0)

const SETTINGS: Record<string, string> = {
  season_start: '2026-08-01',
  season_end: '2027-06-30',
  team_name: 'FC Testers',
  team_logo_url: 'https://example.test/logo.png',
}

function player(id: string, name: string, over: Row = {}): Row {
  return { id, team_id: TEAM, name, position: 'Spits', secondary_positions: [], jersey_number: null,
    active: true, injured: false, type: 'regular', rating: null, created_at: '2024-01-01T00:00:00Z', ...over }
}
function event(id: string, date: string, type = 'training', team = TEAM): Row {
  return { id, team_id: team, date, type }
}
function att(event_id: string, player_id: string, status: string, team = TEAM): Row {
  return { event_id, player_id, team_id: team, status }
}

interface Db { players: Row[]; events: Row[]; attendance: Row[] }

function rpcOverzicht(db: Db, args: Row): Row[] {
  const { p_team_id, p_start, p_end } = args as { p_team_id: string; p_start: string; p_end: string }
  const events = new Map(db.events.map((e) => [e.id as string, e]))
  const players = new Map(db.players.map((p) => [`${p.team_id}|${p.id}`, p]))
  const per = new Map<string, { aanwezig: number; afwezig: number; geblesseerd: number }>()
  for (const a of db.attendance) {
    if (a.team_id !== p_team_id) continue
    const e = events.get(a.event_id as string)
    if (!e || e.team_id !== p_team_id || e.type === 'meting') continue
    if ((e.date as string) < p_start || (e.date as string) > p_end) continue
    const p = players.get(`${p_team_id}|${a.player_id}`)
    if (!p || !p.active || p.type !== 'regular') continue
    const cur = per.get(p.id as string) ?? { aanwezig: 0, afwezig: 0, geblesseerd: 0 }
    if (a.status === 'present') cur.aanwezig++
    else if (a.status === 'absent') cur.afwezig++
    else if (a.status === 'injured') cur.geblesseerd++
    per.set(p.id as string, cur)
  }
  return [...per.entries()].map(([id, c]) => ({ player_id: id, naam: players.get(`${p_team_id}|${id}`)!.name, ...c }))
}

const rpcSpy = vi.fn()
let rpcError: unknown = null

function setupDb(db: Db) {
  rpcSpy.mockClear()
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      expect(table).toBe('players') // de lijstquery is de enige tabelquery van de page
      let rows = db.players
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return chain }
      chain.order = () => chain
      ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: rows, error: null })
      return chain
    },
    rpc: (name: string, args: Row) => {
      rpcSpy(name, args)
      if (rpcError) return Promise.resolve({ data: null, error: rpcError })
      return Promise.resolve({ data: name === 'aanwezigheidsoverzicht_per_speler' ? rpcOverzicht(db, args) : [], error: null })
    },
  } as never)
}

async function renderPage(query: Record<string, string> = {}) {
  const el = await PlayersPage({ searchParams: Promise.resolve(query) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function schermBlok(container: HTMLElement): HTMLElement {
  return container.querySelector('.print\\:hidden') as HTMLElement
}
function printBlok(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-print-only]')
}
function bodyRijen(tabel: HTMLElement): string[][] {
  return within(tabel).getAllByRole('row').slice(1).map((r) =>
    Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent?.trim() ?? ''))
}

const BASIS: Db = {
  players: [
    player('p1', 'Anna'), player('p2', 'Bram'), player('p3', 'Cor'),
    player('g1', 'Gast Gerrit', { type: 'guest' }),
    player('i1', 'Inactief Ivo', { active: false }),
  ],
  events: [
    event('e1', '2026-09-01'), event('e2', '2026-09-08', 'match'), event('e3', '2026-09-15', 'training'),
    event('em', '2026-09-20', 'meting'), event('eToekomst', '2026-10-20'), event('eVandaag', '2026-10-15'),
  ],
  attendance: [
    att('e1', 'p1', 'present'), att('e2', 'p1', 'present'), att('e3', 'p1', 'absent'),
    att('e1', 'p2', 'present'), att('e2', 'p2', 'injured'), att('e3', 'p2', 'injured'),
    att('em', 'p1', 'absent'),             // meting telt niet
    att('eToekomst', 'p1', 'absent'),      // toekomst telt niet
    att('eVandaag', 'p1', 'absent'),       // vandaag telt niet (t/m gisteren)
    att('e1', 'g1', 'present'), att('e1', 'i1', 'present'),
  ],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  rpcError = null
  vi.mocked(getAllSettings).mockResolvedValue({ ...SETTINGS })
  vi.mocked(logError).mockClear()
})
afterEach(() => { vi.useRealTimers() })

describe('lijstweergave (standaard)', () => {
  it('toont de bestaande spelerslijst, doet geen RPC- en geen settings-aanroep en markeert Lijst als actief', async () => {
    setupDb(BASIS)
    await renderPage()
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(getAllSettings).not.toHaveBeenCalled()
    expect(screen.getByText('Anna')).toBeInTheDocument()
    const groep = screen.getByRole('group', { name: nl.players.weergaveLabel })
    expect(within(groep).getByRole('link', { name: nl.players.weergaveLijst })).toHaveAttribute('aria-current', 'page')
    expect(within(groep).getByRole('link', { name: nl.players.weergaveAanwezigheid })).toHaveAttribute('href', '/players?weergave=aanwezigheid')
  })

  it('een onbekende weergave valt terug op de lijst', async () => {
    setupDb(BASIS)
    await renderPage({ weergave: 'onzin' })
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Anna')).toBeInTheDocument()
  })
})

describe('aanwezigheidsweergave — data', () => {
  it('toont alle actieve reguliere spelers (ook zonder registraties), geen gasten of inactieven, alfabetisch, met training + wedstrijd en zonder meting/toekomst/vandaag', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const tabel = within(schermBlok(container)).getByRole('table')
    expect(bodyRijen(tabel)).toEqual([
      ['Anna', '2', '1', '0', '67%', '67%'],
      ['Bram', '1', '0', '2', '33%', '100%'],
      ['Cor', '0', '0', '0', '—', '—'],
    ])
    expect(screen.queryByText('Gast Gerrit')).not.toBeInTheDocument()
    expect(screen.queryByText('Inactief Ivo')).not.toBeInTheDocument()
  })

  it('vraagt de RPC met het eigen team en een venster t/m gisteren', async () => {
    setupDb(BASIS)
    await renderPage({ weergave: 'aanwezigheid' })
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('aanwezigheidsoverzicht_per_speler', {
      p_team_id: TEAM, p_start: '2026-08-01', p_end: '2026-10-14',
    })
  })

  it.each([
    ['4w', '2026-09-18'],
    ['8w', '2026-08-21'],
    ['onzin', '2026-08-01'], // ongeldig -> hele seizoen
    ['seizoen', '2026-08-01'],
  ])('periode %s gebruikt start %s', async (periode, start) => {
    setupDb(BASIS)
    await renderPage({ weergave: 'aanwezigheid', periode })
    expect(rpcSpy).toHaveBeenCalledWith('aanwezigheidsoverzicht_per_speler', {
      p_team_id: TEAM, p_start: start, p_end: '2026-10-14',
    })
  })

  it('4w: alleen events binnen de periode tellen mee', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid', periode: '4w' })
    // Binnen 18 sep t/m 14 okt zijn er geen geteld events -> lege staat MET periodekiezer
    expect(within(schermBlok(container)).getByText(nl.players.overzichtLeegTitel)).toBeInTheDocument()
    expect(within(schermBlok(container)).getByRole('group', { name: nl.insights.periodeLabel })).toBeInTheDocument()
  })

  it('periodelinks blijven op /players?weergave=aanwezigheid', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const groep = within(schermBlok(container)).getByRole('group', { name: nl.insights.periodeLabel })
    expect(within(groep).getByRole('link', { name: nl.insights.periodeSeizoen })).toHaveAttribute('href', '/players?weergave=aanwezigheid')
    expect(within(groep).getByRole('link', { name: nl.insights.periode4w })).toHaveAttribute('href', '/players?weergave=aanwezigheid&periode=4w')
    expect(within(groep).getByRole('link', { name: nl.insights.periode8w })).toHaveAttribute('href', '/players?weergave=aanwezigheid&periode=8w')
  })

  it('de rijen en getallen in het printblok zijn gelijk aan die op het scherm', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const scherm = bodyRijen(within(schermBlok(container)).getByRole('table'))
    const print = bodyRijen(within(printBlok(container) as HTMLElement).getByRole('table', { hidden: true }))
    expect(print).toEqual(scherm)
  })

  it('de printkop bevat teamnaam, logo, getelde periode en gegenereerd-op-datum', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const print = within(printBlok(container) as HTMLElement)
    expect(print.getAllByText('FC Testers').length).toBeGreaterThan(0)
    expect(print.getByAltText('FC Testers')).toHaveAttribute('src', 'https://example.test/logo.png')
    const venster = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(nl.browserLocale, { day: 'numeric', month: 'short', year: 'numeric' })
    expect(print.getByText(`${venster('2026-08-01')} – ${venster('2026-10-14')} · ${nl.insights.periodeSeizoen}`)).toBeInTheDocument()
    expect(print.getByText(formatDate('2026-10-15', nl.browserLocale))).toBeInTheDocument()
    expect(print.getByText(nl.players.overzichtPrintTitel)).toBeInTheDocument()
  })

  it('het printblok bevat geen element van het seizoensrapport (alleen overzichtstabel)', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const blok = printBlok(container) as HTMLElement
    expect(blok.querySelector('.rapport-kpis')).toBeNull()
    expect(blok.querySelectorAll('table')).toHaveLength(1)
    expect(blok.querySelector('table.overzicht-tabel thead')).not.toBeNull()
  })

  it('het schermdeel is print:hidden en toont een printknop; de schakelaar markeert Aanwezigheid', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const scherm = within(schermBlok(container))
    expect(scherm.getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
    expect(scherm.getByRole('link', { name: nl.players.weergaveAanwezigheid })).toHaveAttribute('aria-current', 'page')
    expect(scherm.getByText(nl.players.overzichtUitleg)).toBeInTheDocument()
  })

  it('% incl. is gelijk aan het percentage dat /inzichten voor dezelfde data berekent (afwezig = absent + injured)', async () => {
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const rijen = bodyRijen(within(schermBlok(container)).getByRole('table'))
    // Bram: P=1, absent=0, injured=2 -> inzichten-afwezig 2
    expect(rijen[1][4]).toBe(`${berekenAanwezigheidPercentage(1, 0 + 2)}%`)
    expect(rijen[0][4]).toBe(`${berekenAanwezigheidPercentage(2, 1)}%`)
  })

  it('tenant: een id-botsing met een ander team verandert de cijfers niet', async () => {
    setupDb({
      players: [...BASIS.players, player('p1', 'Anna Elders', { team_id: OTHER })],
      events: [...BASIS.events, event('x1', '2026-09-02', 'training', OTHER)],
      attendance: [...BASIS.attendance, att('x1', 'p1', 'absent', OTHER), att('x1', 'p1', 'present', OTHER)],
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const rijen = bodyRijen(within(schermBlok(container)).getByRole('table'))
    expect(rijen[0]).toEqual(['Anna', '2', '1', '0', '67%', '67%'])
    expect(screen.queryByText('Anna Elders')).not.toBeInTheDocument()
  })

  it('35 spelers met lange namen worden volledig gerenderd, niet afgekapt', async () => {
    const lang = Array.from({ length: 35 }, (_, i) => player(`l${i}`, `Maximiliaan Alexander van der Heijden-Oosterhuis ${String(i).padStart(2, '0')}`))
    setupDb({
      players: lang,
      events: [event('e1', '2026-09-01')],
      attendance: lang.map((p) => att('e1', p.id as string, 'present')),
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const tabel = within(schermBlok(container)).getByRole('table')
    expect(bodyRijen(tabel)).toHaveLength(35)
    expect(within(tabel).getByText('Maximiliaan Alexander van der Heijden-Oosterhuis 34')).toBeInTheDocument()
    expect(within(tabel).getByText('Maximiliaan Alexander van der Heijden-Oosterhuis 34').className).not.toContain('truncate')
    expect(bodyRijen(within(printBlok(container) as HTMLElement).getByRole('table', { hidden: true }))).toHaveLength(35)
  })
})

describe('aanwezigheidsweergave — lege en foutstaten', () => {
  it('geen seizoen: lege staat met link naar /settings en geen RPC-aanroep', async () => {
    vi.mocked(getAllSettings).mockResolvedValue({ team_name: 'FC Testers' })
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.insights.goToSettings })).toHaveAttribute('href', '/settings')
    expect(printBlok(container)).toBeNull()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('RPC-fout: veilige melding, logError aangeroepen, geen ruwe fouttekst, schakelaar naar Lijst werkt', async () => {
    rpcError = { message: 'PGRST202 function not found secret-detail', code: 'PGRST202' }
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(screen.getByRole('alert')).toHaveTextContent(nl.players.overzichtFout)
    expect(logError).toHaveBeenCalledWith('players.aanwezigheidsoverzicht', rpcError)
    expect(container.textContent).not.toContain('PGRST202')
    expect(container.textContent).not.toContain('secret-detail')
    expect(printBlok(container)).toBeNull()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.players.weergaveLijst })).toHaveAttribute('href', '/players')
  })

  it('geen spelers: lege staat, geen printknop en geen printblok', async () => {
    setupDb({ players: [], events: [], attendance: [] })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(screen.getByText(nl.players.overzichtLeegTitel)).toBeInTheDocument()
    expect(printBlok(container)).toBeNull()
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('alleen 0-registraties (alleen unknown): lege staat zonder periodekiezer bij het hele seizoen', async () => {
    setupDb({
      players: [player('p1', 'Anna')],
      events: [event('e1', '2026-09-01')],
      attendance: [att('e1', 'p1', 'unknown')],
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(screen.getByText(nl.players.overzichtLeegTitel)).toBeInTheDocument()
    expect(printBlok(container)).toBeNull()
    expect(screen.queryByRole('group', { name: nl.insights.periodeLabel })).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Aanvullingen van de test-verifier (review tegen AC5–AC7, AC10, AC20, AC22,
// besluiten 14 en 15). Zelfde engine en dezelfde echte page als hierboven.
// ═══════════════════════════════════════════════════════════════════════
describe('aanvullingen — formules op acceptatieniveau', () => {
  // Het voorbeeld uit de story (AC6): P=8, A=2, B=2 -> % incl. 67, % zonder 80.
  it('AC5/AC6: 8 aanwezig, 2 afwezig, 2 geblesseerd -> 67% incl. blessures en 80% zonder', async () => {
    const events = Array.from({ length: 12 }, (_, i) => event(`e${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`))
    const status = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present',
      'absent', 'absent', 'injured', 'injured']
    setupDb({
      players: [player('p1', 'Anna')],
      events,
      attendance: events.map((e, i) => att(e.id as string, 'p1', status[i])),
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(bodyRijen(within(schermBlok(container)).getByRole('table'))).toEqual([['Anna', '8', '2', '2', '67%', '80%']])
    expect(bodyRijen(within(printBlok(container) as HTMLElement).getByRole('table', { hidden: true }))).toEqual([['Anna', '8', '2', '2', '67%', '80%']])
  })

  it('AC22: 0 aanwezig, 0 afwezig, 2 geblesseerd -> % incl. 0% en % zonder "—" (nooit 0%)', async () => {
    setupDb({
      players: [player('p1', 'Anna'), player('p2', 'Bram')],
      events: [event('e1', '2026-09-01'), event('e2', '2026-09-08')],
      attendance: [att('e1', 'p1', 'injured'), att('e2', 'p1', 'injured'), att('e1', 'p2', 'present')],
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(bodyRijen(within(schermBlok(container)).getByRole('table'))).toEqual([
      ['Anna', '0', '0', '2', '0%', '—'],
      ['Bram', '1', '0', '0', '100%', '100%'],
    ])
  })

  it('AC7: status unknown telt nergens mee (niet in de tellingen, niet in de noemer)', async () => {
    setupDb({
      players: [player('p1', 'Anna')],
      events: [event('e1', '2026-09-01'), event('e2', '2026-09-08'), event('e3', '2026-09-15')],
      attendance: [att('e1', 'p1', 'present'), att('e2', 'p1', 'unknown'), att('e3', 'p1', 'unknown')],
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    expect(bodyRijen(within(schermBlok(container)).getByRole('table'))).toEqual([['Anna', '1', '0', '0', '100%', '100%']])
  })
})

describe('aanvullingen — afdruk, privacy en rechten', () => {
  it('AC10: het printblok draagt de clubkleuren (primair en secundair) uit de instellingen', async () => {
    vi.mocked(getAllSettings).mockResolvedValue({ ...SETTINGS, team_color_primary: '#112233', team_color_secondary: '#aabbcc' })
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    const blok = printBlok(container) as HTMLElement
    const wrapper = (blok.closest('[style*="--club-primary"]') ?? blok) as HTMLElement
    expect(wrapper.style.getPropertyValue('--club-primary')).toBe('#112233')
    expect(wrapper.style.getPropertyValue('--club-secondary')).toBe('#aabbcc')
  })

  it('besluit 14: scherm en afdruk tonen alleen naam, tellingen en percentages (geen positie, rugnummer of rating)', async () => {
    setupDb({
      players: [player('p1', 'Anna', { position: 'Spits', jersey_number: 77, rating: 9, phone: '0612345678' })],
      events: [event('e1', '2026-09-01')],
      attendance: [att('e1', 'p1', 'present')],
    })
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    for (const verboden of ['Spits', '77', '0612345678']) {
      expect(within(schermBlok(container)).queryByText(verboden)).not.toBeInTheDocument()
      expect(within(printBlok(container) as HTMLElement).queryByText(verboden)).not.toBeInTheDocument()
    }
    const rij = bodyRijen(within(schermBlok(container)).getByRole('table'))[0]
    expect(rij).toHaveLength(6)
  })

  it('besluit 15: ook een teamlid zonder bewerkrechten (assistent) ziet het overzicht en de printknop', async () => {
    vi.mocked(requireTeamContextOrLogin).mockResolvedValueOnce({ teamId: TEAM, userId: 'user-2', rol: 'assistent' } as never)
    vi.mocked(canEdit).mockReturnValue(false)
    setupDb(BASIS)
    const { container } = await renderPage({ weergave: 'aanwezigheid' })
    vi.mocked(canEdit).mockReturnValue(true)
    expect(bodyRijen(within(schermBlok(container)).getByRole('table'))).toHaveLength(3)
    expect(within(schermBlok(container)).getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
  })

  it('AC20: zonder seizoen blijft de gewone spelerslijst bereikbaar via de schakelaar (Lijst-link naar /players)', async () => {
    vi.mocked(getAllSettings).mockResolvedValue({ team_name: 'FC Testers' })
    setupDb(BASIS)
    await renderPage({ weergave: 'aanwezigheid' })
    expect(screen.getByRole('link', { name: nl.players.weergaveLijst })).toHaveAttribute('href', '/players')
  })
})
