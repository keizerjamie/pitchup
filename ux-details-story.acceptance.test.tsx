/**
 * Acceptatietest "5 UX-details" — verifieert de GOEDGEKEURDE STORY
 * (ff-ux-details/02-story-goedgekeurd.md), niet de bouwer-implementatie.
 *
 * Elk criterium (OU1–8, UT1–12, SW1–11, HS1–7, TB1–7, ALG1–4) staat hieronder
 * in een test of describe waarvan de naam met het criterium-id begint, zodat de
 * koppeling grep-baar is (`grep "OU3" ux-details-story.acceptance.test.tsx`).
 *
 * Methode: de ECHTE componenten worden gerenderd (React Testing Library); alleen
 * de server actions zijn vervangen door mocks. De serverkant van "Ongedaan maken"
 * (UT2/UT7/ALG3) draait de ECHTE actions tegen een kleine nep-Supabase die elke
 * schrijfactie registreert.
 *
 * Antwoorden van Jamie die criteria veranderden (V1–V11, V-A…V-G) zijn leidend:
 *   - UT8 (toast overleeft doorverwijzing) VERVALT: event/speler vallen buiten undo.
 *   - V-D: dirty-waarschuwing ook bij achtergrondtik (scrim), niet bij de sluitknop.
 *   - V-B: andermans oefening uit training houdt de inline bevestiging (geen undo).
 *   - V-E: swipe alleen < 640px én touch/pen.
 *
 * Niet in jsdom te bewijzen (zie rapport, NIET vals afgevinkt):
 *   SW11 (echte iPhone), HS1/HS2 (echte tikvlakmeting/pixelgelijkheid), HS3
 *   (overflow-clipping = layout), TB2/TB3 (regelafbreking, Safari < 17.5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ───────────────────────────────────────────────────────────────
// Mocks: alle server actions, behalve in het serverblok (importActual).
// ───────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const maak = () =>
    new Proxy({} as Record<string, unknown>, {
      get(t, k) {
        if (typeof k !== 'string' || k === 'then' || k === '__esModule') return Reflect.get(t, k)
        if (!(k in t)) t[k] = vi.fn()
        return t[k]
      },
      has: () => true,
    })
  return { maak, refresh: vi.fn() }
})
vi.mock('@/app/actions/todos', () => h.maak())
vi.mock('@/app/actions/attendance', () => h.maak())
vi.mock('@/app/actions/match-analysis', () => h.maak())
vi.mock('@/app/actions/periodisering', () => h.maak())
vi.mock('@/app/actions/training-plan', () => h.maak())
vi.mock('@/app/actions/oefening-library', () => h.maak())
vi.mock('@/app/actions/events', () => h.maak())
vi.mock('@/app/actions/team-members', () => h.maak())
vi.mock('@/app/actions/team-logo', () => h.maak())
vi.mock('@/app/actions/match-squad', () => h.maak())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: h.refresh }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import * as todosActies from '@/app/actions/todos'
import * as attendanceActies from '@/app/actions/attendance'
import * as matchActies from '@/app/actions/match-analysis'
import * as periodActies from '@/app/actions/periodisering'
import * as planActies from '@/app/actions/training-plan'
import * as bibActies from '@/app/actions/oefening-library'
import * as ledenActies from '@/app/actions/team-members'
import * as logoActies from '@/app/actions/team-logo'
import { createClient } from '@/lib/supabase/server'

import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import { ToastProvider, TOAST_DUUR_MS, TOAST_EXIT_MS } from '@/components/ui/Toast'
import BottomSheet from '@/components/ui/BottomSheet'
import Button, { IconButton, buttonClasses } from '@/components/ui/Button'
import OverflowMenu from '@/components/ui/OverflowMenu'
import PageHeader from '@/components/ui/PageHeader'
import TodoList, { type TodoItem } from '@/components/dashboard/TodoList'
import TrainingAttendance from '@/components/TrainingAttendance'
import PlayerAbsenceList from '@/components/PlayerAbsenceList'
import MatchAnalysisEditor from '@/components/MatchAnalysisEditor'
import NulmetingManager from '@/components/NulmetingManager'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import OefeningLibrary, { type OefeningWithUsage } from '@/components/OefeningLibrary'
import OefeningEditor from '@/components/OefeningEditor'
import OefeningPicker from '@/components/OefeningPicker'
import CyclusWeekCorrectie from '@/components/CyclusWeekCorrectie'
import KopieerVorigeTraining from '@/components/KopieerVorigeTraining'
import RechtenToggles from '@/components/settings/RechtenToggles'
import TeamLogoSection from '@/components/TeamLogoSection'
import { GEEN_RECHTEN } from '@/lib/team-rechten'
import {
  moetSluiten,
  SHEET_SLUIT_MS,
  SHEET_TERUG_MS,
} from '@/lib/sheet-gebaar'
import { concretiseerBezetting } from '@/lib/oefening-bezetting'
import type { AttendanceStatus, FootballEvent, MatchEvent, Oefening, Player, CategorieMeting } from '@/lib/types'
import type { TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import type { HerstelWedstrijdMoment, HerstelMeting, HerstelAfmeldperiode, HerstelKoppeling } from '@/lib/herstel'
import { formatDate } from '@/lib/utils'

const root = __dirname
const lees = (rel: string) => readFileSync(path.join(root, rel), 'utf8')
const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// ───────────────────────────────────────────────────────────────
// Gedeelde helpers
// ───────────────────────────────────────────────────────────────
let telefoon = true
let reduced = false
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') ? telefoon : query.includes('reduce') ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const klik = (el: Element) => act(async () => { fireEvent.click(el) })

/** Een promise die je handmatig oplost/afwijst (om "onderweg" te simuleren). */
function uitgesteld<T = unknown>() {
  let resolve!: (v?: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res as (v?: T) => void; reject = rej })
  return { promise, resolve, reject }
}

function maakSpeler(id: string, naam = `Speler ${id}`, extra: Partial<Player> = {}): Player {
  return {
    id, name: naam, position: 'Spits', secondary_positions: [], jersey_number: null,
    active: true, injured: false, type: 'regular', rating: null, created_at: '2024-01-01T00:00:00Z', ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  telefoon = true
  reduced = false
  stubMatchMedia()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
// OU — Optimistic updates
// ═══════════════════════════════════════════════════════════════════════
const ALLE_TAKEN = { squad: true, lineup: true, analysis: true, training_plan: true }
function todoItem(o: Partial<TodoItem> = {}): TodoItem {
  return {
    eventId: 'e1', taskType: 'squad', opponent: 'FC Test', deadline: '2099-01-01',
    eventDate: '2099-01-02', auto: false, manual: false, ...o,
  }
}
function renderTodo(items: TodoItem[], canEditTask = ALLE_TAKEN) {
  return render(
    <DictProvider dict={nl}>
      <TodoList items={items} canEditTask={canEditTask} />
    </DictProvider>,
  )
}
const todoKnop = (naam: string) => screen.getByRole('button', { name: naam })

function renderAanwezigheid(
  spelers: Player[],
  statussen: Record<string, AttendanceStatus>,
  canEdit = true,
) {
  return render(
    <DictProvider dict={nl}>
      <TrainingAttendance eventId="e1" players={spelers} initialStatuses={statussen} canEdit={canEdit} />
    </DictProvider>,
  )
}
function rijVan(naam: string): HTMLElement {
  return screen.getByText(naam).closest('div.flex.items-center.gap-3') as HTMLElement
}
function statWaarde(label: string): string {
  const el = screen.getAllByText(label).find((e) => e.tagName === 'DIV' && e.closest('.surface-card'))!
  return within(el.closest('.surface-card') as HTMLElement).getByText(/^\d+$/).textContent ?? ''
}

function maakGebeurtenis(o: Partial<FootballEvent & { status: AttendanceStatus }> = {}) {
  return {
    id: 'e1', type: 'training', date: '2026-08-15', time: '19:00:00', location: null, match_type: null,
    opponent: null, home_away: null, gather_time: null, notes: null, doelstelling: null,
    goals_for: null, goals_against: null, created_at: '2026-08-01T00:00:00Z', status: 'unknown',
    ...o,
  } as FootballEvent & { status: AttendanceStatus }
}
function renderAfmeldlijst(events: ReturnType<typeof maakGebeurtenis>[], periods: { id: string; player_id: string; from_date: string; to_date: string }[] = []) {
  const ui = (id: string) => (
    <DictProvider dict={nl}>
      <ToastProvider teamId={id}>
        <PlayerAbsenceList playerId="p1" events={events} periods={periods} defaultStatus="unknown" canEdit />
      </ToastProvider>
    </DictProvider>
  )
  const r = render(ui('team-1'))
  return { ...r, wissel: (id: string) => r.rerender(ui(id)) }
}

describe('OU1 — to-do-vinkje toont meteen de nieuwe stand en blijft staan', () => {
  it('OU1: stand is direct bijgewerkt terwijl de server nog bezig is, en blijft na bevestiging', async () => {
    const d = uitgesteld()
    mock(todosActies.markTaskDone).mockReturnValueOnce(d.promise)
    renderTodo([todoItem()])
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    await klik(todoKnop(nl.todo.taskSquad))
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true') // server nog niet klaar
    expect(todosActies.markTaskDone).toHaveBeenCalledWith('e1', 'squad')
    await act(async () => { d.resolve() })
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('OU1: heropenen (afvinken ongedaan maken) toont ook direct de nieuwe stand', async () => {
    const d = uitgesteld()
    mock(todosActies.reopenTask).mockReturnValueOnce(d.promise)
    renderTodo([todoItem({ manual: true })])
    await klik(todoKnop(nl.todo.taskSquad))
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    expect(todosActies.reopenTask).toHaveBeenCalledWith('e1', 'squad')
    await act(async () => { d.resolve() })
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('OU2 — aanwezigheidsstatus per speler en "alles aanwezig" tonen meteen de nieuwe status', () => {
  it('OU2: spelerstatus (TrainingAttendance) is direct zichtbaar, ook in de tellers', async () => {
    const d = uitgesteld()
    mock(attendanceActies.updateAttendance).mockReturnValueOnce(d.promise)
    renderAanwezigheid([maakSpeler('a', 'Anna')], { a: 'unknown' })
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'true')
    expect(statWaarde(nl.event.presentStat)).toBe('1')
    expect(attendanceActies.updateAttendance).toHaveBeenCalledWith('e1', 'a', 'present')
    await act(async () => { d.resolve() })
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'true')
  })

  it('OU2: "alles aanwezig" zet direct iedereen op aanwezig; een geblesseerde blijft geblesseerd (zoals de server)', async () => {
    const d = uitgesteld()
    mock(attendanceActies.markAllPresent).mockReturnValueOnce(d.promise)
    renderAanwezigheid([maakSpeler('a', 'Anna'), maakSpeler('b', 'Bob'), maakSpeler('c', 'Cor')], { a: 'injured', b: 'absent', c: 'unknown' })
    await klik(screen.getByRole('button', { name: nl.event.markAllPresent }))
    expect(statWaarde(nl.event.presentStat)).toBe('2')
    expect(statWaarde(nl.event.injuredStat)).toBe('1')
    expect(attendanceActies.markAllPresent).toHaveBeenCalledWith('e1')
    await act(async () => { d.resolve() })
    expect(statWaarde(nl.event.presentStat)).toBe('2')
  })

  it('OU2: spelerdetail (PlayerAbsenceList.setStatus) toont de nieuwe status direct', async () => {
    const d = uitgesteld()
    mock(attendanceActies.updateAttendance).mockReturnValueOnce(d.promise)
    renderAfmeldlijst([maakGebeurtenis({ status: 'unknown' })])
    await klik(screen.getByRole('button', { name: nl.players.absent }))
    expect(screen.getByRole('button', { name: nl.players.absent }).className).toContain('bg-danger')
    expect(attendanceActies.updateAttendance).toHaveBeenCalledWith('e1', 'p1', 'absent')
    await act(async () => { d.resolve() })
    expect(screen.getByRole('button', { name: nl.players.absent }).className).toContain('bg-danger')
  })
})

describe('OU3 — bij weigering/fout terug naar de laatst bevestigde stand, met eigen foutmelding in gebruikerstaal', () => {
  it('OU3 (TodoList): rollback + t.todo.saveError; de rauwe servermelding verschijnt nooit', async () => {
    mock(todosActies.markTaskDone).mockRejectedValueOnce(new Error('new row violates row-level security policy for table "x"'))
    renderTodo([todoItem()])
    await klik(todoKnop(nl.todo.taskSquad))
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.todo.saveError)
    expect(document.body.textContent).not.toContain('row-level security')
  })

  it('OU3 (TrainingAttendance): rij terug naar bevestigde status + t.event.attendanceSaveError', async () => {
    mock(attendanceActies.updateAttendance).mockRejectedValueOnce(new Error('Geen toegang'))
    renderAanwezigheid([maakSpeler('a', 'Anna')], { a: 'absent' })
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.absentStat })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.event.attendanceSaveError)
    expect(screen.queryByText('Geen toegang')).not.toBeInTheDocument()
  })

  it('OU3 (TrainingAttendance, bulk): mislukte "alles aanwezig" zet alle rijen terug', async () => {
    mock(attendanceActies.markAllPresent).mockRejectedValueOnce(new Error('kapot'))
    renderAanwezigheid([maakSpeler('a'), maakSpeler('b')], { a: 'absent', b: 'unknown' })
    await klik(screen.getByRole('button', { name: nl.event.markAllPresent }))
    expect(statWaarde(nl.event.presentStat)).toBe('0')
    expect(statWaarde(nl.event.absentStat)).toBe('1')
    expect(statWaarde(nl.event.unknownStat)).toBe('1')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.event.attendanceSaveError)
  })

  it('OU3 (PlayerAbsenceList.setStatus): terug naar bevestigde status + eigen melding, geen ruwe serverstring', async () => {
    mock(attendanceActies.updateAttendance).mockRejectedValueOnce(new Error('Geen toegang'))
    renderAfmeldlijst([maakGebeurtenis({ status: 'present' })])
    await klik(screen.getByRole('button', { name: nl.players.absent }))
    expect(screen.getByRole('button', { name: nl.players.present }).className).toContain('bg-primary')
    expect(screen.getByRole('button', { name: nl.players.absent }).className).not.toContain('bg-danger')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.event.attendanceSaveError)
    expect(screen.queryByText('Geen toegang')).not.toBeInTheDocument()
  })

  it('OU3: rollback gaat naar de laatst BEVESTIGDE stand, niet naar de beginstand', async () => {
    // tik 1 (present) slaagt, tik 2 (absent) mislukt -> terug naar present, niet naar unknown.
    mock(attendanceActies.updateAttendance).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'))
    renderAanwezigheid([maakSpeler('a', 'Anna')], { a: 'unknown' })
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.absentStat }))
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('OU4 — nieuwe foutmeldingen bestaan in alle 5 talen', () => {
  const talen = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('OU4: %s heeft todo.saveError, event.attendanceSaveError, undo.restoreError, undo.deleteError', (_naam, dict) => {
    for (const tekst of [dict.todo.saveError, dict.event.attendanceSaveError, dict.undo.restoreError, dict.undo.deleteError]) {
      expect(typeof tekst).toBe('string')
      expect(tekst.trim().length).toBeGreaterThan(10)
    }
  })
  it('OU4: de vier vreemde talen zijn echt vertaald (niet de NL-tekst gekopieerd)', () => {
    for (const dict of [en, de, fr, es]) {
      expect(dict.todo.saveError).not.toBe(nl.todo.saveError)
      expect(dict.event.attendanceSaveError).not.toBe(nl.event.attendanceSaveError)
      expect(dict.undo.restoreError).not.toBe(nl.undo.restoreError)
      expect(dict.undo.deleteError).not.toBe(nl.undo.deleteError)
    }
  })
})

describe('OU5 — twee verschillende rijen kort na elkaar: de tweede tik wordt niet geblokkeerd', () => {
  it('OU5 (TrainingAttendance): rij B is klikbaar en gaat direct naar de server terwijl rij A nog onderweg is', async () => {
    const a = uitgesteld()
    mock(attendanceActies.updateAttendance).mockReturnValueOnce(a.promise)
    renderAanwezigheid([maakSpeler('a', 'Anna'), maakSpeler('b', 'Bob')], {})
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    const knopB = within(rijVan('Bob')).getByRole('button', { name: nl.event.absentStat })
    expect(knopB).not.toBeDisabled()
    await klik(knopB)
    expect(attendanceActies.updateAttendance).toHaveBeenCalledTimes(2) // B wachtte niet op A
    expect(attendanceActies.updateAttendance).toHaveBeenLastCalledWith('e1', 'b', 'absent')
    expect(knopB).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { a.resolve() })
  })

  it('OU5 (TodoList): tweede vinkje niet geblokkeerd door het eerste', async () => {
    const a = uitgesteld()
    mock(todosActies.markTaskDone).mockReturnValueOnce(a.promise)
    renderTodo([todoItem(), todoItem({ taskType: 'lineup' })])
    await klik(todoKnop(nl.todo.taskSquad))
    expect(todoKnop(nl.todo.taskLineup)).not.toBeDisabled()
    await klik(todoKnop(nl.todo.taskLineup))
    expect(todosActies.markTaskDone).toHaveBeenCalledTimes(2)
    await act(async () => { a.resolve() })
  })

  it('OU5: een mislukte rij laat een andere rij ongemoeid', async () => {
    mock(attendanceActies.updateAttendance).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined)
    renderAanwezigheid([maakSpeler('a', 'Anna'), maakSpeler('b', 'Bob')], {})
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    await klik(within(rijVan('Bob')).getByRole('button', { name: nl.event.presentStat }))
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'false')
    expect(within(rijVan('Bob')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('OU6 — twee snelle tikken op dezelfde rij: laatste tik wint en komt overeen met de server', () => {
  it('OU6: twee calls in volgorde; weergave eindigt op de laatste tik', async () => {
    const calls: Array<ReturnType<typeof uitgesteld>> = []
    mock(attendanceActies.updateAttendance).mockImplementation(() => {
      const d = uitgesteld()
      calls.push(d)
      return d.promise
    })
    renderAanwezigheid([maakSpeler('a', 'Anna')], {})
    const rij = () => rijVan('Anna')
    await klik(within(rij()).getByRole('button', { name: nl.event.presentStat }))
    await klik(within(rij()).getByRole('button', { name: nl.event.absentStat }))
    // Weergave volgt meteen de LAATSTE tik, ook voordat de server iets bevestigd heeft.
    expect(within(rij()).getByRole('button', { name: nl.event.absentStat })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { calls[0].resolve() })
    await act(async () => { calls[1]?.resolve() })
    expect(mock(attendanceActies.updateAttendance).mock.calls.map((c) => c[2])).toEqual(['present', 'absent'])
    expect(within(rij()).getByRole('button', { name: nl.event.absentStat })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rij()).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'false')
  })

  it('OU6: mislukt de laatste tik, dan toont de weergave de laatst bevestigde server-stand (eerste tik)', async () => {
    const eerste = uitgesteld()
    const tweede = uitgesteld()
    mock(attendanceActies.updateAttendance).mockReturnValueOnce(eerste.promise).mockReturnValueOnce(tweede.promise)
    renderAanwezigheid([maakSpeler('a', 'Anna')], {})
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat }))
    await klik(within(rijVan('Anna')).getByRole('button', { name: nl.event.absentStat }))
    await act(async () => { eerste.resolve() })
    await act(async () => { tweede.reject(new Error('x')) })
    expect(within(rijVan('Anna')).getByRole('button', { name: nl.event.presentStat })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.event.attendanceSaveError)
  })

  it('OU6 (TodoList): twee snelle tikken op dezelfde taak eindigen op de laatste tik', async () => {
    const calls: Array<ReturnType<typeof uitgesteld>> = []
    const nieuw = () => { const d = uitgesteld(); calls.push(d); return d.promise }
    mock(todosActies.markTaskDone).mockImplementation(nieuw)
    mock(todosActies.reopenTask).mockImplementation(nieuw)
    renderTodo([todoItem()])
    await klik(todoKnop(nl.todo.taskSquad)) // af
    await klik(todoKnop(nl.todo.taskSquad)) // weer open
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { calls[0].resolve() })
    await act(async () => { calls[1]?.resolve() })
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    expect(todosActies.markTaskDone).toHaveBeenCalledTimes(1)
    expect(todosActies.reopenTask).toHaveBeenCalledTimes(1)
  })
})

describe('OU7 — rechten blijven server-side; zonder bewerkrecht ziet de gebruiker via rollback de oorspronkelijke stand', () => {
  it('OU7: de server weigert ("Geen toegang") -> vinkje springt terug, geen ruwe melding', async () => {
    mock(todosActies.markTaskDone).mockRejectedValueOnce(new Error('Geen toegang'))
    renderTodo([todoItem()])
    await klik(todoKnop(nl.todo.taskSquad))
    expect(todoKnop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Geen toegang')).not.toBeInTheDocument()
  })

  it('OU7: de UI-rechtcheck is alleen een gemak: zonder canEdit is het vinkje uit en wordt de server niet aangeroepen', async () => {
    renderTodo([todoItem({ taskType: 'training_plan' })], { ...ALLE_TAKEN, training_plan: false })
    expect(todoKnop(nl.todo.taskTraining)).toBeDisabled()
    await klik(todoKnop(nl.todo.taskTraining))
    expect(todosActies.markTaskDone).not.toHaveBeenCalled()
  })

  it('OU7: TrainingAttendance zonder canEdit toont geen statusknoppen', () => {
    renderAanwezigheid([maakSpeler('a', 'Anna')], { a: 'present' }, false)
    expect(screen.queryByRole('button', { name: nl.event.presentStat })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.event.markAllPresent })).not.toBeInTheDocument()
  })
})

describe('OU8 — bestaande rollbacks blijven werken', () => {
  it('OU8 (RechtenToggles): mislukte opslag zet de schakelaar terug en toont de eigen melding', async () => {
    mock(ledenActies.updateMemberRights).mockRejectedValueOnce(new Error('rauw'))
    render(
      <DictProvider dict={nl}>
        <RechtenToggles userId="u1" initialRechten={GEEN_RECHTEN} />
      </DictProvider>,
    )
    const schakelaar = screen.getByRole('switch', { name: nl.staf.onderdeel.spelers })
    await klik(schakelaar)
    expect(screen.getByRole('switch', { name: nl.staf.onderdeel.spelers })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(nl.staf.saveFailed)).toBeInTheDocument()
    expect(screen.queryByText('rauw')).not.toBeInTheDocument()
  })

  it('OU8 (PlayerAbsenceList-periodes): statusknoppen blijven uit zolang een periode-afmelding loopt', async () => {
    const d = uitgesteld<{ periodId: string; affected: number }>()
    mock(attendanceActies.markAbsentForPeriod).mockReturnValueOnce(d.promise)
    renderAfmeldlijst([maakGebeurtenis({ date: '2026-09-05' })])
    const [van, tot] = [nl.players.periodFrom, nl.players.periodTo].map(
      (l) => screen.getByText(l).parentElement?.querySelector('input') as HTMLInputElement,
    )
    fireEvent.change(van, { target: { value: '2026-09-01' } })
    fireEvent.change(tot, { target: { value: '2026-09-10' } })
    await klik(screen.getByRole('button', { name: nl.players.periodButton }))
    expect(screen.getByRole('button', { name: nl.players.present })).toBeDisabled()
    await act(async () => { d.resolve({ periodId: 'p', affected: 1 }) })
  })
  // MatchSquadEditor-rollback (lastConfirmedRef): ongewijzigde bestaande suite
  // components/MatchSquadEditor.test.tsx draait mee in `npm test` (zie rapport).
})

// ═══════════════════════════════════════════════════════════════════════
// UT — Undo-toasts (V1 optie c, V2-scope, V6: 5 s, kruisje, vervangen)
// ═══════════════════════════════════════════════════════════════════════
const MID = '0a000000-0000-4000-8000-0000000000a1'
const NUL_HERSTEL: HerstelMeting = {
  soort: 'nulmeting', teamId: 'team-1', id: MID, categorie: 'partijen_groot',
  datum: '2026-05-01', stap: 5, notes: 'fris', createdAt: '2026-05-01T08:00:00Z',
}
const MEETING: CategorieMeting = {
  id: MID, team_id: 'team-1', categorie: 'partijen_groot', datum: '2026-05-01', stap: 5, notes: 'fris',
  created_at: '2026-05-01T08:00:00Z',
}
const geschiedenisLabel = nl.periodization.historyForCategory.replace('{n}', '1')

function renderNulmeting(teamId = 'team-1') {
  const ui = (id: string) => (
    <DictProvider dict={nl}>
      <ToastProvider teamId={id}>
        <NulmetingManager metingen={[MEETING]} peildatumExclusief="2026-10-01" />
      </ToastProvider>
    </DictProvider>
  )
  const r = render(ui(teamId))
  return { ...r, wissel: (id: string) => r.rerender(ui(id)) }
}
function openGeschiedenis() {
  fireEvent.click(screen.getByText(geschiedenisLabel).closest('button')!)
}
const nulVerwijderKnop = () => screen.queryByLabelText(nl.periodization.deleteNulmeting)

const WM_SNAPSHOT: HerstelWedstrijdMoment = {
  soort: 'wedstrijdmoment', teamId: 'team-1', id: 'm1', eventId: 'e1', playerId: 'p1',
  kind: 'goal', minute: 12, createdAt: '2026-09-01T10:00:00Z',
}
const WEDSTRIJD_EVENTS: MatchEvent[] = [
  { id: 'm1', event_id: 'e1', player_id: 'p1', kind: 'goal', minute: 12, created_at: '2026-09-01T10:00:00Z' },
  { id: 'm2', event_id: 'e1', player_id: 'p2', kind: 'yellow', minute: 30, created_at: '2026-09-01T10:10:00Z' },
]
function renderWedstrijd(teamId = 'team-1') {
  const ui = (id: string) => (
    <DictProvider dict={nl}>
      <ToastProvider teamId={id}>
        <MatchAnalysisEditor
          eventId="e1"
          presentPlayers={[maakSpeler('p1', 'Piet Peters'), maakSpeler('p2', 'Jan Jansen')]}
          teamName="Pitchup" opponent="Ajax" homeAway="home"
          initialGoalsFor={1} initialGoalsAgainst={0} initialRatings={[]}
          initialEvents={WEDSTRIJD_EVENTS}
        />
      </ToastProvider>
    </DictProvider>
  )
  const r = render(ui(teamId))
  return { ...r, wissel: (id: string) => r.rerender(ui(id)) }
}
const soortLabel = (label: string) => screen.queryByText(label, { selector: 'span.text-faint' })
const wedstrijdVerwijder = () => screen.getAllByRole('button', { name: nl.analysis.delete })

const PERIODE = { id: 'period-1', player_id: 'p1', from_date: '2026-08-10', to_date: '2026-08-20' }
const AFMELD_HERSTEL: HerstelAfmeldperiode = {
  soort: 'afmeldperiode', teamId: 'team-1', id: 'period-1', playerId: 'p1', fromDate: '2026-08-10',
  toDate: '2026-08-20', createdAt: '2026-08-01T00:00:00Z', naarStandaardEventIds: ['e1'], alleenHerkomstEventIds: [],
}
function revokeNaam() {
  const range = `${formatDate(PERIODE.from_date, nl.browserLocale)} – ${formatDate(PERIODE.to_date, nl.browserLocale)}`
  return nl.players.periodRevokeAria.replace('{range}', range)
}
const revokeKnop = () => screen.queryByRole('button', { name: revokeNaam() })

function maakOefening(o: Partial<Oefening> = {}): Oefening {
  return {
    id: 'oX', team_id: 'team-1', naam: 'Rondo', beschrijving: null, categorie: 'partijen_klein',
    duur_min: null, breedte_m: null, lengte_m: null, orientatie: 'vrij', veldzone: null, teams: [],
    aantal_neutralen: 0, diagram: null, created_at: '2024-01-01T00:00:00Z', ...o,
  } as Oefening
}
function maakKoppeling(id: string, volgorde: number, oef: Partial<Oefening> = {}): TrainingOefeningMetBezetting {
  const oefening = maakOefening(oef)
  const k = {
    id, team_id: 'team-1', event_id: 'e1', oefening_id: oefening.id, volgorde, stap_override: null,
    genest_in: null, spelerindeling: [], parallel_groep_id: null, parallel_spelers: [],
    created_at: `2024-01-0${volgorde + 1}T00:00:00Z`, oefeningen: oefening,
  }
  return { ...k, bezetting: concretiseerBezetting(oefening, null) } as unknown as TrainingOefeningMetBezetting
}
const KOPPELING_HERSTEL: HerstelKoppeling = {
  soort: 'koppeling', teamId: 'team-1', id: 'k2', eventId: 'e1', oefeningId: 'oX', volgorde: 1,
  duurMin: 12, stapOverride: 3, genestIn: null, spelerindeling: [], aantallenOverride: null,
  parallelGroepId: null, parallelSpelers: [], createdAt: '2024-01-02T00:00:00Z',
  partner: null, kinderenGenestIds: [], volgordeIds: ['k1', 'k2'],
}
function renderPlan(koppelingen: TrainingOefeningMetBezetting[], teamId = 'team-1') {
  const ui = (id: string) => (
    <DictProvider dict={nl}>
      <ToastProvider teamId={id}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={koppelingen} library={[]}
          currentSteps={{}} hasNulmeting={false} suggestion={null}
          players={[maakSpeler('s1', 'Spelertje')]} presentPlayerIds={['s1']} startTijd={null}
          kopieerOpties={[]} initialTrainingstype="vct" userId="team-1"
        />
      </ToastProvider>
    </DictProvider>
  )
  const r = render(ui(teamId))
  return { ...r, wissel: (id: string) => r.rerender(ui(id)) }
}
const badges = (c: HTMLElement) => Array.from(c.querySelectorAll('span.print-club-bg-primary')).map((e) => e.textContent)
const ontkoppelKnoppen = () => screen.getAllByLabelText(nl.trainingPlan.unlink)

/**
 * Elke undo-aanroeper als scenario: hoe verwijder je, hoe zie je dat het item
 * er is, wat is de delete-/herstel-mock. Zo wordt UT1–UT6 voor alle vier
 * V2-onderdelen met dezelfde assertie getoetst.
 */
interface UndoScenario {
  naam: string
  render: () => { wissel?: (id: string) => void; container: HTMLElement }
  verwijder: () => Promise<void> | void
  aanwezig: () => boolean
  aantal: () => number
  deleteMock: () => ReturnType<typeof vi.fn>
  herstelMock: () => ReturnType<typeof vi.fn>
  snapshot: unknown
  /** Foutmelding bij mislukte delete verschijnt als role=alert (true) of als inline tekst (false). */
  deleteFoutTekst: string
}

const scenarios: UndoScenario[] = [
  {
    naam: 'nulmeting',
    render: () => { const r = renderNulmeting(); openGeschiedenis(); return r },
    verwijder: () => klik(nulVerwijderKnop()!),
    aanwezig: () => nulVerwijderKnop() !== null,
    aantal: () => screen.queryAllByLabelText(nl.periodization.deleteNulmeting).length,
    deleteMock: () => mock(periodActies.deleteCategorieMeting),
    herstelMock: () => mock(periodActies.herstelCategorieMeting),
    snapshot: NUL_HERSTEL,
    deleteFoutTekst: nl.oefeningen.genericError,
  },
  {
    naam: 'doelpunt/kaart',
    render: () => renderWedstrijd(),
    verwijder: () => klik(wedstrijdVerwijder()[0]),
    aanwezig: () => soortLabel(nl.analysis.kinds.goal) !== null,
    aantal: () => screen.queryAllByText(nl.analysis.kinds.goal, { selector: 'span.text-faint' }).length,
    deleteMock: () => mock(matchActies.deleteMatchEvent),
    herstelMock: () => mock(matchActies.herstelWedstrijdMoment),
    snapshot: WM_SNAPSHOT,
    deleteFoutTekst: nl.undo.deleteError,
  },
  {
    naam: 'afmeldperiode',
    render: () => renderAfmeldlijst([maakGebeurtenis({ status: 'absent' })], [PERIODE]),
    verwijder: () => klik(revokeKnop()!),
    aanwezig: () => revokeKnop() !== null,
    aantal: () => screen.queryAllByRole('button', { name: revokeNaam() }).length,
    deleteMock: () => mock(attendanceActies.revokeAbsencePeriod),
    herstelMock: () => mock(attendanceActies.herstelAfmeldperiode),
    snapshot: AFMELD_HERSTEL,
    deleteFoutTekst: nl.players.periodRevokeError,
  },
  {
    naam: 'oefening uit training',
    render: () => renderPlan([maakKoppeling('k1', 0), maakKoppeling('k2', 1)]),
    verwijder: () => klik(ontkoppelKnoppen()[1]),
    aanwezig: () => ontkoppelKnoppen().length === 2,
    aantal: () => ontkoppelKnoppen().length,
    deleteMock: () => mock(planActies.removeOefeningFromTraining),
    herstelMock: () => mock(planActies.herstelKoppeling),
    snapshot: KOPPELING_HERSTEL,
    deleteFoutTekst: nl.undo.deleteError,
  },
]

function zetDeleteSucces(s: UndoScenario) {
  if (s.naam === 'afmeldperiode') s.deleteMock().mockResolvedValue({ restored: 1, herstel: s.snapshot })
  else s.deleteMock().mockResolvedValue(s.snapshot)
  s.herstelMock().mockResolvedValue(undefined)
}

describe.each(scenarios)('UT (undo) — $naam', (s) => {
  beforeEach(() => {
    vi.useFakeTimers()
    zetDeleteSucces(s)
  })

  it('UT1: geen bevestigingsvraag; item direct weg (nog vóór de server antwoordt); daarna melding "Verwijderd" + knop "Ongedaan maken"', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const d = uitgesteld<unknown>()
    s.deleteMock().mockReset().mockReturnValueOnce(d.promise)
    s.render()
    const voor = s.aantal()
    expect(s.aanwezig()).toBe(true)
    await s.verwijder()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(s.aantal()).toBeLessThan(voor) // direct uit beeld, server nog bezig
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => { d.resolve(s.naam === 'afmeldperiode' ? { restored: 1, herstel: s.snapshot } : s.snapshot) })
    expect(screen.getByRole('status')).toHaveTextContent(nl.undo.deleted)
    expect(screen.getByRole('button', { name: nl.undo.action })).toBeInTheDocument()
  })

  it('UT2: "Ongedaan maken" binnen de toastduur roept herstel aan met de door de server gegeven snapshot; item weer zichtbaar', async () => {
    s.render()
    const voor = s.aantal()
    await s.verwijder()
    await flush()
    await tick(2000) // binnen 5 s
    await klik(screen.getByRole('button', { name: nl.undo.action }))
    await flush()
    expect(s.herstelMock()).toHaveBeenCalledTimes(1)
    expect(s.herstelMock()).toHaveBeenCalledWith(s.snapshot)
    expect(s.aantal()).toBe(voor)
    expect(s.aanwezig()).toBe(true)
    await tick(TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('UT3: niets doen -> toast verdwijnt na 5 s en verwijderen is definitief (geen herstel, item blijft weg)', async () => {
    s.render()
    await s.verwijder()
    await flush()
    await tick(TOAST_DUUR_MS - 100)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await tick(100 + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(s.herstelMock()).not.toHaveBeenCalled()
    expect(s.aanwezig()).toBe(false)
  })

  it('UT4: herstel mislukt -> item blijft weg, eigen foutmelding (geen ruwe fout), geen "Ongedaan maken"-knop meer', async () => {
    s.herstelMock().mockReset().mockRejectedValueOnce(new Error('Herstel niet mogelijk: db-detail'))
    s.render()
    await s.verwijder()
    await flush()
    await klik(screen.getByRole('button', { name: nl.undo.action }))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(nl.undo.restoreError)
    expect(document.body.textContent).not.toContain('db-detail')
    expect(screen.queryByRole('button', { name: nl.undo.action })).not.toBeInTheDocument()
    expect(s.aanwezig()).toBe(false)
  })

  it('UT5: verwijderen mislukt -> item komt terug, foutmelding in gebruikerstaal, GEEN "Verwijderd"-toast', async () => {
    s.deleteMock().mockReset().mockRejectedValueOnce(new Error('connection refused 10.0.0.1'))
    s.render()
    const voor = s.aantal()
    await s.verwijder()
    await flush()
    expect(s.aantal()).toBe(voor)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(s.deleteFoutTekst)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('connection refused')
  })

  it('UT6: dubbel tikken op "Ongedaan maken" geeft één herstel en geen duplicaat', async () => {
    const d = uitgesteld()
    s.herstelMock().mockReset().mockReturnValueOnce(d.promise)
    s.render()
    const voor = s.aantal()
    await s.verwijder()
    await flush()
    const knop = screen.getByRole('button', { name: nl.undo.action })
    await klik(knop)
    await klik(knop)
    expect(s.herstelMock()).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve() })
    await flush()
    expect(s.aantal()).toBe(voor)
  })

  it('UT7: teamwissel wist de toast -> in het andere team is niets meer te herstellen', async () => {
    const r = s.render()
    await s.verwijder()
    await flush()
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => r.wissel?.('team-2'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: nl.undo.action })).not.toBeInTheDocument()
    expect(s.herstelMock()).not.toHaveBeenCalled()
  })

  it('UT9: toast heeft role=status/aria-live, "Ongedaan maken" is een echte knop; timer pauzeert bij focus', async () => {
    s.render()
    await s.verwijder()
    await flush()
    const toast = screen.getByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
    const knop = screen.getByRole('button', { name: nl.undo.action })
    expect(knop.tagName).toBe('BUTTON')
    act(() => knop.focus())
    await tick(TOAST_DUUR_MS * 3)
    expect(screen.getByRole('status')).toBeInTheDocument() // gepauzeerd zolang focus binnen de toast is
    act(() => knop.blur())
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('UT-V6: een nieuwe toast vervangt de vorige (nooit twee tegelijk) en het kruisje sluit', async () => {
    s.render()
    await s.verwijder()
    await flush()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    await klik(screen.getByRole('button', { name: nl.common.close }))
    await tick(TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('UT1/UT2 — nulmeting: inhoud van wat terugkomt', () => {
  beforeEach(() => vi.useFakeTimers())
  it('UT2: de teruggezette meting bevat dezelfde id, datum, stap en notitie als het origineel', async () => {
    mock(periodActies.deleteCategorieMeting).mockResolvedValue(NUL_HERSTEL)
    mock(periodActies.herstelCategorieMeting).mockResolvedValue(undefined)
    renderNulmeting()
    openGeschiedenis()
    await klik(nulVerwijderKnop()!)
    await flush()
    await klik(screen.getByRole('button', { name: nl.undo.action }))
    await flush()
    const snap = mock(periodActies.herstelCategorieMeting).mock.calls[0][0] as HerstelMeting
    expect(snap).toMatchObject({ id: MEETING.id, categorie: MEETING.categorie, datum: MEETING.datum, stap: MEETING.stap, notes: MEETING.notes, createdAt: MEETING.created_at })
    expect(periodActies.deleteCategorieMeting).toHaveBeenCalledWith(MID)
  })
})

describe('UT-V-B — oefening uit training bij andermans oefening', () => {
  beforeEach(() => vi.useFakeTimers())
  it('V-B: andermans oefening houdt de inline bevestiging en geeft geen undo-toast', async () => {
    mock(planActies.removeOefeningFromTraining).mockResolvedValue(KOPPELING_HERSTEL)
    const { container } = renderPlan([maakKoppeling('k1', 0), maakKoppeling('k2', 1, { team_id: 'ander-team-lid' })])
    await klik(ontkoppelKnoppen()[1])
    expect(badges(container)).toEqual(['1', '2']) // nog niet weg: wacht op bevestiging
    expect(planActies.removeOefeningFromTraining).not.toHaveBeenCalled()
    await klik(screen.getByText(nl.trainingPlan.confirmYes))
    await flush()
    expect(badges(container)).toEqual(['1'])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('UT8 — vervallen (V6: event/speler vallen buiten undo)', () => {
  it('UT8: vervallen — event en speler houden hun bevestigingsvraag (zie UT11), er is dus geen doorverwijzing met toast', () => {
    expect(lees('app/events/[id]/page.tsx')).not.toMatch(/useToast|herstel(Event|Speler)/)
    expect(lees('app/players/[id]/edit/page.tsx')).not.toMatch(/useToast|herstel(Event|Speler)/)
  })
})

describe('UT9 — toegankelijkheid en plaatsing van de toast', () => {
  beforeEach(() => vi.useFakeTimers())

  it('UT9: tikvlakken van "Ongedaan maken" en het kruisje zijn >= 44pt (h-11 / w-11 h-11)', async () => {
    mock(periodActies.deleteCategorieMeting).mockResolvedValue(NUL_HERSTEL)
    renderNulmeting()
    openGeschiedenis()
    await klik(nulVerwijderKnop()!)
    await flush()
    expect(screen.getByRole('button', { name: nl.undo.action }).className).toContain('h-11')
    const kruis = screen.getByRole('button', { name: nl.common.close })
    expect(kruis.className).toContain('w-11')
    expect(kruis.className).toContain('h-11')
  })

  it('UT9: bedekt de onderbalk en de FAB niet: de toast zit boven de FAB-bovenrand (88px + 56px) en onder modal-z', async () => {
    mock(periodActies.deleteCategorieMeting).mockResolvedValue(NUL_HERSTEL)
    renderNulmeting()
    openGeschiedenis()
    await klik(nulVerwijderKnop()!)
    await flush()
    const viewport = screen.getByTestId('toast-viewport')
    const bottom = Number(/safe-area-inset-bottom,0px\)\+(\d+)px/.exec(viewport.className)?.[1])
    const fab = lees('components/GlobalFab.tsx')
    const fabBottom = Number(/const fabStyle[\s\S]*?\+ (\d+)px\)'/.exec(fab)?.[1])
    const fabHoogte = 56 // fabClass: w-14 h-14
    expect(fab).toContain('w-14 h-14')
    expect(bottom).toBeGreaterThanOrEqual(fabBottom + fabHoogte)
    expect(viewport.className).toContain('z-[var(--z-toast)]')
    const css = lees('app/globals.css')
    const z = (n: string) => Number(new RegExp(`--z-${n}:\\s*(\\d+)`).exec(css)?.[1])
    expect(z('toast')).toBeGreaterThan(z('fab'))
    expect(z('toast')).toBeGreaterThan(z('nav'))
    expect(z('toast')).toBeLessThan(z('modal')) // V-G: onder een open onderblad
  })
})

describe('UT10 — reduced motion', () => {
  beforeEach(() => vi.useFakeTimers())
  it('UT10: met reduced motion beweegt de toast niet (geen translate), alleen opacity', async () => {
    reduced = true
    stubMatchMedia()
    mock(periodActies.deleteCategorieMeting).mockResolvedValue(NUL_HERSTEL)
    renderNulmeting()
    openGeschiedenis()
    await klik(nulVerwijderKnop()!)
    await flush()
    const toast = screen.getByRole('status')
    expect(toast.style.transform).toBe('none')
    expect(toast.style.transition).toContain('opacity')
    expect(toast.style.transition).not.toContain('transform')
  })
})

describe('UT11 — confirm op OverflowMenuItem blijft opt-in; deletes buiten undo houden hun bevestiging', () => {
  it('UT11: OverflowMenuItem zonder `confirm` voert direct uit, mét `confirm` pas na window.confirm', async () => {
    const zonder = vi.fn().mockResolvedValue(undefined)
    const met = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <DictProvider dict={nl}>
        <OverflowMenu items={[
          { label: 'Direct', action: zonder },
          { label: 'Met vraag', danger: true, confirm: 'Zeker?', action: met },
        ]} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    await klik(screen.getByRole('menuitem', { name: 'Direct' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(zonder).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    await klik(screen.getByRole('menuitem', { name: 'Met vraag' }))
    expect(confirmSpy).toHaveBeenCalledWith('Zeker?')
    expect(met).not.toHaveBeenCalled()
  })

  it('UT11: teamlogo verwijderen vraagt nog steeds om bevestiging (V2: buiten undo)', async () => {
    mock(logoActies.deleteTeamLogo).mockResolvedValue({ error: null })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <DictProvider dict={nl}>
        <TeamLogoSection initialLogoUrl="https://example.com/logo.png?v=1" />
      </DictProvider>,
    )
    await klik(screen.getByRole('button', { name: nl.settings.logoRemove }))
    expect(confirmSpy).toHaveBeenCalledWith(nl.settings.logoRemoveConfirm)
    expect(logoActies.deleteTeamLogo).not.toHaveBeenCalled()
  })

  // Event, speler, staflid, schema opnieuw en team/account: server components of
  // grote pagina's die hier niet zinvol te renderen zijn. Statische controle dat
  // de bevestiging er nog staat en dat er geen undo-koppeling is bijgekomen.
  it.each([
    'app/events/[id]/page.tsx',
    'app/players/[id]/edit/page.tsx',
    'components/settings/StafMemberRow.tsx',
    'components/TrainingScheduleForm.tsx',
    'components/settings/TeamsSection.tsx',
    'components/DeleteAccountSection.tsx',
  ])('UT11: %s houdt zijn bevestiging en kent geen undo-toast', (rel) => {
    const src = lees(rel)
    expect(src).toMatch(/confirm/)
    expect(src).not.toMatch(/useToast|from '@\/lib\/herstel'/)
  })
})

describe('UT12 — oefening met N>=1 koppelingen: het waarschuwingspaneel blijft (V3)', () => {
  const lib = (o: Partial<OefeningWithUsage> = {}): OefeningWithUsage => ({ ...(maakOefening({ id: 'o1', duur_min: 10 }) as OefeningWithUsage), koppelingCount: 0, ...o })
  function renderBib(o: OefeningWithUsage) {
    render(
      <DictProvider dict={nl}>
        <ToastProvider teamId="team-1">
          <OefeningLibrary oefeningen={[o]} />
        </ToastProvider>
      </DictProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: nl.oefeningen.deleteAria }))
  }
  it('UT12: N=3 toont de waarschuwing met aantal; geen delete en geen undo-toast vóór bevestiging', () => {
    renderBib(lib({ koppelingCount: 3 }))
    expect(screen.getByText(nl.oefeningen.deleteConfirmUsage.replace('{n}', '3'))).toBeInTheDocument()
    expect(bibActies.deleteOefening).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('UT12: na bevestigen wordt verwijderd zonder undo-toast (oefening verwijderen valt buiten undo)', async () => {
    renderBib(lib({ id: 'o1', koppelingCount: 1 }))
    await klik(screen.getByText(nl.oefeningen.deleteButton))
    expect(bibActies.deleteOefening).toHaveBeenCalledWith('o1')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

// ───────────────────────────────────────────────────────────────
// UT — serverkant: echte actions tegen een registrerende nep-Supabase
// ───────────────────────────────────────────────────────────────
type Rij = Record<string, unknown>
const TEAM = '11111111-1111-4111-8111-111111111111'
const ANDER_TEAM = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const METING_ID = '0a000000-0000-4000-8000-0000000000a1'

function nepSupabase(opties: { rol: 'owner' | 'assistent'; tabellen?: Record<string, Rij[]>; insertFout?: { code: string; message: string } }) {
  const tabellen: Record<string, Rij[]> = {
    team_members: [{ team_id: TEAM, user_id: USER, rol: opties.rol }],
    settings: [],
    ...(opties.tabellen ?? {}),
  }
  const schrijfacties: { tabel: string; actie: string; payload: unknown }[] = []
  const leesTabellen: string[] = []
  const from = (naam: string) => {
    const filters: ((r: Rij) => boolean)[] = []
    let insertPayload: Rij | null = null
    const rijen = () => (tabellen[naam] ?? []).filter((r) => filters.every((f) => f(r)))
    const klaar = () => {
      if (insertPayload) {
        if (opties.insertFout) return { data: null, error: opties.insertFout }
        tabellen[naam] = [...(tabellen[naam] ?? []), insertPayload]
        return { data: null, error: null }
      }
      leesTabellen.push(naam)
      return { data: rijen(), error: null }
    }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain }
    chain.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return chain }
    chain.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return chain }
    chain.order = () => chain
    chain.limit = () => chain
    chain.insert = (p: Rij) => { insertPayload = p; schrijfacties.push({ tabel: naam, actie: 'insert', payload: p }); return chain }
    chain.update = (p: Rij) => { schrijfacties.push({ tabel: naam, actie: 'update', payload: p }); return chain }
    chain.delete = () => { schrijfacties.push({ tabel: naam, actie: 'delete', payload: null }); return chain }
    chain.maybeSingle = () => {
      leesTabellen.push(naam)
      return Promise.resolve({ data: rijen()[0] ?? null, error: null })
    }
    chain.single = chain.maybeSingle
    ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res(klaar())
    return chain
  }
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>)
  return { tabellen, schrijfacties, leesTabellen }
}

const echtPeriod = () => vi.importActual<typeof import('@/app/actions/periodisering')>('@/app/actions/periodisering')
const echtMatch = () => vi.importActual<typeof import('@/app/actions/match-analysis')>('@/app/actions/match-analysis')
const echtAttendance = () => vi.importActual<typeof import('@/app/actions/attendance')>('@/app/actions/attendance')
const echtPlan = () => vi.importActual<typeof import('@/app/actions/training-plan')>('@/app/actions/training-plan')

const metingSnapshot = (o: Partial<HerstelMeting> = {}): HerstelMeting => ({
  soort: 'nulmeting', teamId: TEAM, id: METING_ID, categorie: 'partijen_groot', datum: '2026-05-01',
  stap: 5, notes: 'fris', createdAt: '2026-05-01T08:00:00+00:00', ...o,
})

describe('UT2/UT7/ALG3 — serverkant van herstel (echte actions, nep-Supabase)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('UT2: herstel schrijft dezelfde id, datum, stap, notitie en created_at terug, met het team van de sessie', async () => {
    const db = nepSupabase({ rol: 'owner', tabellen: { categorie_metingen: [] } })
    await (await echtPeriod()).herstelCategorieMeting(metingSnapshot())
    const inserts = db.schrijfacties.filter((w) => w.tabel === 'categorie_metingen' && w.actie === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toMatchObject({
      id: METING_ID, team_id: TEAM, categorie: 'partijen_groot', datum: '2026-05-01', stap: 5, notes: 'fris',
      created_at: '2026-05-01T08:00:00+00:00',
    })
  })

  it('UT7/ALG3: een snapshot van een ander team wordt geweigerd en er wordt niets geschreven (alle vier herstel-actions)', async () => {
    const db = nepSupabase({ rol: 'owner' })
    const forged = { teamId: ANDER_TEAM }
    await expect((await echtPeriod()).herstelCategorieMeting(metingSnapshot(forged))).rejects.toThrow('Herstel niet mogelijk')
    await expect((await echtMatch()).herstelWedstrijdMoment({ ...WM_SNAPSHOT, ...forged, id: METING_ID, eventId: METING_ID, playerId: METING_ID })).rejects.toThrow('Herstel niet mogelijk')
    await expect((await echtAttendance()).herstelAfmeldperiode({ ...AFMELD_HERSTEL, ...forged, id: METING_ID, playerId: METING_ID, naarStandaardEventIds: [], alleenHerkomstEventIds: [] })).rejects.toThrow('Herstel niet mogelijk')
    await expect((await echtPlan()).herstelKoppeling({ ...KOPPELING_HERSTEL, ...forged, id: METING_ID, eventId: METING_ID, oefeningId: METING_ID, volgordeIds: [] })).rejects.toThrow('Herstel niet mogelijk')
    expect(db.schrijfacties).toEqual([])
  })

  it('ALG3: een niet-UUID id wordt geweigerd voordat er een query op de data-tabel loopt', async () => {
    const db = nepSupabase({ rol: 'owner' })
    await expect((await echtPeriod()).herstelCategorieMeting(metingSnapshot({ id: "x'; drop table--" }))).rejects.toThrow('Herstel niet mogelijk')
    expect(db.schrijfacties).toEqual([])
    expect(db.leesTabellen).not.toContain('categorie_metingen')
  })

  it('OU7/UT-rechten: een assistent zonder periodisering-recht krijgt "Geen toegang" en schrijft niets', async () => {
    const db = nepSupabase({ rol: 'assistent' })
    await expect((await echtPeriod()).herstelCategorieMeting(metingSnapshot())).rejects.toThrow('Geen toegang')
    expect(db.schrijfacties).toEqual([])
  })

  it('UT6: dubbel herstel (rij bestaat al) schrijft niet opnieuw', async () => {
    const db = nepSupabase({ rol: 'owner', tabellen: { categorie_metingen: [{ id: METING_ID, team_id: TEAM, categorie: 'partijen_groot', datum: '2026-05-01' }] } })
    await (await echtPeriod()).herstelCategorieMeting(metingSnapshot())
    expect(db.schrijfacties.filter((w) => w.actie === 'insert')).toEqual([])
  })

  it('UT4/"geen ruwe errors naar de client": een database-fout bij herstel lekt geen interne details', async () => {
    nepSupabase({ rol: 'owner', tabellen: { categorie_metingen: [] }, insertFout: { code: 'XX000', message: 'secret-db-detail host=10.1.2.3' } })
    const fout = await (await echtPeriod()).herstelCategorieMeting(metingSnapshot()).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).not.toContain('secret-db-detail')
    expect((fout as Error).message).not.toContain('10.1.2.3')
  })

  it('ALG3: de verwijder-/herstel-actions nemen geen team- of gebruikers-id als eigen parameter aan', async () => {
    expect((await echtPeriod()).deleteCategorieMeting.length).toBe(1) // (id)
    expect((await echtMatch()).deleteMatchEvent.length).toBe(2) // (id, eventId)
    expect((await echtAttendance()).revokeAbsencePeriod.length).toBe(1)
    expect((await echtPlan()).removeOefeningFromTraining.length).toBe(2)
    expect((await echtPeriod()).herstelCategorieMeting.length).toBe(1)
    expect((await echtMatch()).herstelWedstrijdMoment.length).toBe(1)
    expect((await echtAttendance()).herstelAfmeldperiode.length).toBe(1)
    expect((await echtPlan()).herstelKoppeling.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SW — Swipe-to-dismiss
// ═══════════════════════════════════════════════════════════════════════
let nu = 0
function pointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', init: { x?: number; y?: number; id?: number; pointerType?: string } = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(ev, {
    clientX: init.x ?? 0, clientY: init.y ?? 0, pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? 'touch', button: 0, isPrimary: true,
  })
  fireEvent(el, ev)
}
/** Veeg op `el` naar y=`dy`. `stapMs` bepaalt de snelheid (groot = langzaam = geen flick). */
function veeg(el: Element, dy: number, o: { x?: number; stapMs?: number; pointerType?: string; id?: number; loslaten?: boolean } = {}) {
  const stap = o.stapMs ?? 1000
  pointer(el, 'pointerdown', { x: 0, y: 0, pointerType: o.pointerType, id: o.id })
  nu += stap
  pointer(el, 'pointermove', { x: o.x ?? 0, y: dy, pointerType: o.pointerType, id: o.id })
  nu += stap
  if (o.loslaten !== false) pointer(el, 'pointerup', { x: o.x ?? 0, y: dy, pointerType: o.pointerType, id: o.id })
}
function dialoog(hoogte = 600) {
  const d = screen.getByRole('dialog')
  d.getBoundingClientRect = () => ({ height: hoogte, width: 400, top: 0, left: 0, right: 400, bottom: hoogte, x: 0, y: 0, toJSON() {} }) as DOMRect
  return d
}
const kop = () => screen.getByTestId('bottom-sheet-kop')

function renderLosseSheet(props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const onClose = vi.fn()
  const r = render(
    <DictProvider dict={nl}>
      <BottomSheet onClose={onClose} titel="Titel" sluitLabel="Sluit" {...props}>
        <div data-testid="inhoud" style={{ height: 2000 }}>veel inhoud</div>
      </BottomSheet>
    </DictProvider>,
  )
  const sheet = dialoog()
  const scrim = r.container.querySelector('.anim-scrim') as HTMLElement
  return { onClose, sheet, scrim, ...r }
}

describe('SW — gedeelde BottomSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    nu = 0
    vi.spyOn(performance, 'now').mockImplementation(() => nu)
  })

  it('SW1: slepen op de kop voorbij de drempel en loslaten sluit het blad', () => {
    const { onClose } = renderLosseSheet()
    veeg(kop(), 150)
    expect(onClose).not.toHaveBeenCalled() // eerst de sluitanimatie
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 20) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('SW2: het blad volgt de vinger tijdens het slepen (en de scrim dooft mee)', () => {
    const { sheet, scrim } = renderLosseSheet()
    veeg(kop(), 60, { loslaten: false })
    expect(sheet.style.transform).toBe('translateY(60px)')
    expect(Number(scrim.style.opacity)).toBeCloseTo(1 - 60 / 600, 5)
  })

  it('SW2: loslaten vóór de drempel veert terug en sluit niet', () => {
    const { onClose, sheet } = renderLosseSheet()
    veeg(kop(), 60)
    expect(sheet.style.transform).toBe('translateY(0px)')
    act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 50) })
    expect(sheet.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('SW3: drempel is vastgelegd en testbaar — 119px sluit niet, 120px wel (hoogte 600, langzaam)', () => {
    expect(moetSluiten({ dy: 119, vy: 0, hoogte: 600 })).toBe(false)
    expect(moetSluiten({ dy: 120, vy: 0, hoogte: 600 })).toBe(true)
    expect(moetSluiten({ dy: 59, vy: 0, hoogte: 200 })).toBe(false) // 30% van 200 = 60
    expect(moetSluiten({ dy: 60, vy: 0, hoogte: 200 })).toBe(true)
    expect(moetSluiten({ dy: 24, vy: 0.5, hoogte: 600 })).toBe(true) // flick
    expect(moetSluiten({ dy: 23, vy: 0.9, hoogte: 600 })).toBe(false) // te kort voor flick
    expect(moetSluiten({ dy: 300, vy: -0.2, hoogte: 600 })).toBe(false) // omhoog aan het eind
  })

  it('SW3: dezelfde drempel via de echte gebaar-keten (DOM): 119px blijft, 120px sluit', () => {
    const a = renderLosseSheet()
    veeg(kop(), 119)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(a.onClose).not.toHaveBeenCalled()
    a.unmount()
    const b = renderLosseSheet()
    veeg(kop(), 120)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(b.onClose).toHaveBeenCalledTimes(1)
  })

  it('SW4: gebaren in de scrollbare inhoud scrollen alleen — het blad volgt niet en sluit niet', () => {
    const { onClose, sheet } = renderLosseSheet()
    veeg(screen.getByTestId('inhoud'), 400)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(sheet.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('SW4: een horizontale veeg op de kop sluit niet en beweegt het blad niet', () => {
    const { onClose, sheet } = renderLosseSheet()
    veeg(kop(), 20, { x: 200 })
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(sheet.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('SW4: een tweede vinger tijdens het gebaar wordt genegeerd', () => {
    const { sheet } = renderLosseSheet()
    pointer(kop(), 'pointerdown', { id: 1, y: 0 })
    nu += 1000
    pointer(kop(), 'pointermove', { id: 1, y: 40 })
    pointer(kop(), 'pointerdown', { id: 2, y: 0 })
    nu += 1000
    pointer(kop(), 'pointermove', { id: 2, y: 400 })
    expect(sheet.style.transform).toBe('translateY(40px)')
  })

  it('SW5: sluitknop en achtergrondtik blijven werken; een tik zonder beweging op de kop sluit niets', () => {
    const a = renderLosseSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Sluit' }))
    expect(a.onClose).toHaveBeenCalledTimes(1)
    a.unmount()
    const b = renderLosseSheet()
    fireEvent.click(b.scrim)
    expect(b.onClose).toHaveBeenCalledTimes(1)
    b.unmount()
    const c = renderLosseSheet()
    pointer(kop(), 'pointerdown'); pointer(kop(), 'pointerup')
    expect(c.onClose).not.toHaveBeenCalled()
  })

  it('SW6/V-D: formuliersheet met invoer — veeg voorbij drempel veert terug en vraagt dan om bevestiging; nee blijft, ja sluit', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { onClose } = renderLosseSheet({ dirty: true })
    veeg(kop(), 200)
    expect(confirmSpy).not.toHaveBeenCalled() // eerst terugveren, dan pas vragen
    act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 20) })
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(onClose).not.toHaveBeenCalled() // nee -> blijft open
    veeg(kop(), 200)
    act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 20) })
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(onClose).toHaveBeenCalledTimes(1) // ja -> sluit
  })

  it('SW6/V-D: dirty + achtergrondtik vraagt ook; de sluitknop sluit zonder vraag; niet-dirty sluit zonder vraag', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const a = renderLosseSheet({ dirty: true })
    fireEvent.click(a.scrim)
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    expect(a.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sluit' }))
    expect(a.onClose).toHaveBeenCalledTimes(1)
    a.unmount()
    confirmSpy.mockClear()
    const b = renderLosseSheet({ dirty: false })
    fireEvent.click(b.scrim)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(b.onClose).toHaveBeenCalledTimes(1)
  })

  it('SW7: reduced motion — volgen blijft, sluiten is een opacity-fade zonder translate, terugveren is direct', () => {
    reduced = true
    stubMatchMedia()
    const a = renderLosseSheet()
    veeg(kop(), 150)
    expect(a.sheet.style.transform).not.toContain('100%')
    expect(a.sheet.style.transition).toContain('opacity')
    expect(a.sheet.style.transition).not.toContain('transform')
    act(() => { vi.advanceTimersByTime(150 + 20) })
    expect(a.onClose).toHaveBeenCalledTimes(1)
    a.unmount()
    const b = renderLosseSheet()
    veeg(kop(), 50)
    expect(b.sheet.style.transform).toBe('')
    expect(b.sheet.style.transition).toBe('none')
  })

  it('SW8: desktop/tablet (>= 640px) en muis — geen swipe-gedrag', () => {
    telefoon = false
    stubMatchMedia()
    const a = renderLosseSheet()
    veeg(kop(), 300)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(a.sheet.style.transform).toBe('')
    expect(a.onClose).not.toHaveBeenCalled()
    a.unmount()
    telefoon = true
    stubMatchMedia()
    const b = renderLosseSheet()
    veeg(kop(), 300, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(b.onClose).not.toHaveBeenCalled()
  })

  it('SW8: de greep is alleen op mobiel zichtbaar (sm:hidden)', () => {
    renderLosseSheet()
    const greep = kop().querySelector('[aria-hidden="true"]') as HTMLElement
    expect(greep.className).toContain('sm:hidden')
  })

  it('SW9: nooit een transform op een ouder — alleen het blad zelf beweegt', () => {
    const { container, sheet } = renderLosseSheet()
    veeg(kop(), 80, { loslaten: false })
    expect(sheet.style.transform).toBe('translateY(80px)')
    let el: HTMLElement | null = sheet.parentElement
    while (el && el !== document.body.parentElement) {
      expect(el.style.transform).toBe('')
      el = el.parentElement
    }
    expect((container.firstChild as HTMLElement).style.transform).toBe('')
  })

  it('ALG4/SW: alleen transform en opacity bewegen (sluiten), en de globale animatieregel laat het blad bewust toe', () => {
    const { sheet, scrim } = renderLosseSheet()
    veeg(kop(), 150)
    expect(sheet.style.transition).toMatch(/^transform /)
    expect(scrim.style.transition).toMatch(/^opacity /)
    expect(sheet.className).toContain('anim-sheet') // uitgezonderd in `*:not(.anim-sheet)` -> animation/transition none
    expect(scrim.className).toContain('anim-scrim')
    expect(lees('app/globals.css')).toMatch(/\*:not\(\.motion-ok\):not\(\.anim-scrim\):not\(\.anim-sheet\)/)
  })
})

describe('SW1 — alle vijf de bladen sluiten met een veeg op de kop (echte componenten)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    nu = 0
    vi.spyOn(performance, 'now').mockImplementation(() => nu)
  })
  const sluit = () => { dialoog(); veeg(kop(), 200); act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) }) }

  it('SW1: NulmetingManager', () => {
    render(<DictProvider dict={nl}><NulmetingManager metingen={[]} peildatumExclusief="2026-10-01" /></DictProvider>)
    fireEvent.click(screen.getAllByText(nl.periodization.measureCta)[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    sluit()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('SW1: CyclusWeekCorrectie', () => {
    render(<DictProvider dict={nl}><CyclusWeekCorrectie huidigeWeek={2} heeftCorrectie={false} /></DictProvider>)
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    sluit()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('SW1: KopieerVorigeTraining', () => {
    render(<DictProvider dict={nl}><KopieerVorigeTraining eventId="e1" opties={[{ id: 'b1', date: '2026-10-01', aantal: 3 }]} /></DictProvider>)
    fireEvent.click(screen.getByText(nl.trainingPlan.copyPrevious))
    sluit()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('SW1: OefeningEditor (onCancel wordt aangeroepen)', () => {
    const onCancel = vi.fn()
    render(<DictProvider dict={nl}><OefeningEditor onCancel={onCancel} onSubmit={vi.fn()} /></DictProvider>)
    sluit()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
  it('SW1: OefeningPicker (onClose wordt aangeroepen)', () => {
    const onClose = vi.fn()
    render(<DictProvider dict={nl}><OefeningPicker eventId="e1" library={[]} onClose={onClose} aanwezigAantal={0} /></DictProvider>)
    sluit()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('SW6: formuliersheets (OefeningEditor) waarschuwen bij een veeg als er iets is ingevuld; een schoon formulier sluit zonder vraag', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onCancel = vi.fn()
    render(<DictProvider dict={nl}><OefeningEditor onCancel={onCancel} onSubmit={vi.fn()} /></DictProvider>)
    fireEvent.change(document.getElementById('oefening-naam')!, { target: { value: 'Nieuwe naam' } })
    dialoog(); veeg(kop(), 200)
    act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 20) })
    expect(confirmSpy).toHaveBeenCalledWith(nl.sheet.discardConfirm)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('SW6: picker en kopieer-blad (geen formulier) sluiten zonder waarschuwing', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<DictProvider dict={nl}><KopieerVorigeTraining eventId="e1" opties={[{ id: 'b1', date: '2026-10-01', aantal: 3 }]} /></DictProvider>)
    fireEvent.click(screen.getByText(nl.trainingPlan.copyPrevious))
    dialoog(); veeg(kop(), 200)
    act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 50) })
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('SW10/SW11', () => {
  it('SW10: bestaande sheet-tests blijven groen — bewezen door de volledige suite (zie rapport); hier alleen de klassen waar ze op leunen', () => {
    const { container, sheet, scrim } = renderLosseSheet({ wrapperClassName: 'print:hidden' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet.className).toContain('anim-sheet')
    expect(scrim.className).toContain('backdrop-blur-sm')
    expect((container.firstChild as HTMLElement).className).toContain('print:hidden')
  })
  // SW11 (echte iPhone in de beginscherm-app, Jamie V10): bewust GEEN test hier;
  // zie rapport "niet netjes te dekken".
})

// ═══════════════════════════════════════════════════════════════════════
// HS — Hit slop
// ═══════════════════════════════════════════════════════════════════════
const css = lees('app/globals.css')

/** Rekent de CSS-formule van `.hit-slop::after` na voor één as. */
function slopUitbreiding(prop: 'top' | 'bottom' | 'left' | 'right', knopPx: number, gapPx: number): number {
  const blok = /\.hit-slop::after\s*\{([^}]*)\}/.exec(css)![1]
  const expr = new RegExp(`${prop}:\\s*([^;]+);`).exec(blok)![1].trim()
  const horizontaal = prop === 'left' || prop === 'right'
  const js = expr
    .replace(new RegExp(`var\\(--hit-slop-gap${horizontaal ? '' : '-y'},\\s*88px\\)`), `${gapPx}px`)
    .replace(/100%/g, `${knopPx}px`)
    .replace(/calc\(/g, '(')
    .replace(/(\d+(?:\.\d+)?)px/g, '$1')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/\bmin\(/g, 'Math.min(')
  return -new Function(`return ${js}`)() as number // negatieve inset = uitbreiding
}
const effectief = (knop: number, gap: number) => knop + slopUitbreiding('left', knop, gap) + slopUitbreiding('right', knop, gap)

describe('HS — hit slop', () => {
  it('HS1: (formule) een kleine knop groeit naar 44pt waar ruimte is; zichtbare grootte blijft (::after, geen eigen layout)', () => {
    expect(effectief(36, 88)).toBe(44) // alleenstaand: w-9 -> 44
    expect(effectief(32, 88)).toBe(44)
    expect(effectief(44, 88)).toBe(44) // al groot genoeg: geen uitbreiding
    const blok = /\.hit-slop::after\s*\{([^}]*)\}/.exec(css)![1]
    expect(blok).toContain('position: absolute')
    expect(blok).toContain("content: ''")
    expect(css).not.toMatch(/\.hit-slop\s*\{[^}]*(width|height|padding|margin)/) // raakt de zichtbare knop niet
  })

  it('HS4: (formule) bij kleine tussenruimtes overlappen tikvlakken van buren nooit — elk krijgt hooguit de helft van de gap', () => {
    for (const [knop, gap] of [[32, 4], [36, 8], [32, 8], [36, 6], [28, 0], [20, 0]] as const) {
      const uit = slopUitbreiding('left', knop, gap)
      expect(uit).toBeLessThanOrEqual(gap / 2 + 1e-9)
      expect(uit + slopUitbreiding('right', knop, gap)).toBeLessThanOrEqual(gap + 1e-9) // twee buren samen <= gap
    }
    expect(effectief(32, 4)).toBe(36) // benoemd in de brief
    expect(effectief(24, 0)).toBe(24) // gestapelde pijltjes: geen verticale overlap
  })

  it('HS6: Button sm en IconButton sm dragen relative hit-slop; md/lg niet', () => {
    expect(buttonClasses({ size: 'sm' })).toContain('relative hit-slop')
    expect(buttonClasses({ size: 'md' })).not.toContain('hit-slop')
    render(<><Button size="sm">klein</Button><IconButton size="sm" aria-label="ik">x</IconButton><IconButton aria-label="groot">y</IconButton></>)
    expect(screen.getByRole('button', { name: 'klein' }).className).toContain('hit-slop')
    expect(screen.getByRole('button', { name: 'ik' }).className).toContain('hit-slop')
    expect(screen.getByRole('button', { name: 'groot' }).className).not.toContain('hit-slop')
  })

  it('HS6: gerenderde knoppen — TodoList-vinkje, aanwezigheidsknoppen (+ bulkknop) en sheet-sluitknop dragen hit-slop; buren hebben een gap-variabele', () => {
    renderTodo([todoItem()])
    expect(todoKnop(nl.todo.taskSquad).className).toContain('relative hit-slop')
    cleanup()
    renderAanwezigheid([maakSpeler('a', 'Anna')], {})
    const knoppen = within(rijVan('Anna')).getAllByRole('button')
    expect(knoppen.length).toBe(3)
    for (const k of knoppen) expect(k.className).toContain('relative hit-slop')
    expect(knoppen[0].parentElement!.className).toContain('[--hit-slop-gap:8px]') // buurknoppen op 8px
    expect(screen.getByRole('button', { name: nl.event.markAllPresent }).className).toContain('hit-slop')
    cleanup()
    renderLosseSheet()
    expect(screen.getByRole('button', { name: 'Sluit' }).className).toContain('relative hit-slop')
  })

  it('HS5: geen conflict met kaart-open (OefeningLibrary): de kaart-open-knop heeft geen hit-slop en de ⋯-knop in de kaart blijft apart klikbaar', () => {
    const bib = lees('components/OefeningLibrary.tsx')
    const regels = bib.split('\n').filter((r) => r.includes('kaart-open'))
    expect(regels.length).toBeGreaterThan(0)
    for (const r of regels) expect(r).not.toContain('hit-slop')
  })

  // HS1/HS2 (echte tikvlakmeting >= 44x44pt, pixelgelijke layout) en HS3
  // (overflow-hidden-ouders knippen het tikvlak niet af) zijn layoutgedrag:
  // bewust GEEN test hier (geen vals-groen); zie rapport "niet netjes te dekken".
})

describe('HS7 — bestaande klasse-asserties', () => {
  it('HS7: de bewust aangepaste assertie in ui.test.tsx (buttonClasses sm) bestaat en de rest van de suite is groen (zie rapport)', () => {
    expect(lees('components/ui/ui.test.tsx')).toContain('hit-slop')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// TB — Balanced headlines
// ═══════════════════════════════════════════════════════════════════════
describe('TB — text-wrap: balance', () => {
  it('TB1: PageHeader rendert zijn titel in een .page-title-h1 en .page-title balanceert', () => {
    render(<DictProvider dict={nl}><PageHeader title="Een hele lange paginatitel die over twee regels loopt" /></DictProvider>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.className).toContain('page-title')
    const blok = /\.page-title\s*\{[^}]*\}/.exec(css)![0]
    expect(blok).toContain('text-wrap: balance')
  })

  it('TB2: een kop op één regel blijft identiek — de enige wijziging is een declaratie die bij één regel geen effect heeft; geen extra stijl op .page-title', () => {
    const blok = /\.page-title\s*\{[^}]*\}/.exec(css)![0]
    const declaraties = blok.split(';').map((d) => d.trim()).filter(Boolean)
    expect(blok).toContain('font-size: 1.625rem')
    expect(blok).toContain('line-height: 1.15')
    expect(blok).not.toMatch(/max-width|width:|padding|margin/) // geen layout-effect
    expect(declaraties.length).toBeGreaterThan(5)
  })

  it('TB3: zonder ondersteuning (Safari < 17.5) is `text-wrap` een gewone declaratie die de browser negeert — geen @supports/JS-afhankelijkheid', () => {
    const idx = css.indexOf('text-wrap: balance')
    const voor = css.slice(Math.max(0, idx - 400), idx)
    expect(voor).not.toMatch(/@supports/)
  })

  it('TB4: overflow-wrap: anywhere blijft op .page-title staan', () => {
    expect(/\.page-title\s*\{[^}]*\}/.exec(css)![0]).toContain('overflow-wrap: anywhere')
  })

  it('TB5: de printkop van het trainingsplan blijft ongewijzigd (geen text-balance)', () => {
    const src = lees('app/events/[id]/training-plan/page.tsx')
    const h1s = [...src.matchAll(/<h1[^>]*className="([^"]*)"/g)].map((m) => m[1])
    expect(h1s.length).toBeGreaterThan(0)
    for (const k of h1s) expect(k).not.toContain('text-balance')
  })

  it.each([
    'app/login/page.tsx',
    'app/register/page.tsx',
    'app/forgot-password/page.tsx',
    'app/reset-password/page.tsx',
    'app/invite/[token]/page.tsx',
    'app/invite/[token]/register/InviteRegisterForm.tsx',
    'components/EmptyTeamState.tsx',
  ])('TB6: losse h1 in %s is gebalanceerd', (rel) => {
    const h1 = /<h1\s+className="([^"]*)"/.exec(lees(rel))?.[1] ?? ''
    expect(h1).toContain('text-balance')
  })

  it('TB6: CalendarView-kop is uitgesloten (V9)', () => {
    const h1s = [...lees('components/CalendarView.tsx').matchAll(/<h1[^>]*className="([^"]*)"/g)].map((m) => m[1])
    expect(h1s.length).toBeGreaterThan(0)
    for (const k of h1s) expect(k).not.toContain('text-balance')
  })

  it('TB7: PlayerProfileHeader heeft zijn eigen balans (ongewijzigd) en gebruikt .page-title niet extra', () => {
    const src = lees('components/players/PlayerProfileHeader.tsx')
    expect(/<h1[^>]*className="([^"]*)"/.exec(src)?.[1] ?? '').toContain('text-balance')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ALG — overkoepelend
// ═══════════════════════════════════════════════════════════════════════
describe('ALG2 — nieuwe teksten in 5 talen (exact volgens de goedgekeurde brief §4.5)', () => {
  const verwacht = {
    nl: { deleted: 'Verwijderd', action: 'Ongedaan maken', discard: 'Je wijzigingen gaan verloren. Toch sluiten?' },
    en: { deleted: 'Deleted', action: 'Undo', discard: 'Your changes will be lost. Close anyway?' },
    de: { deleted: 'Gelöscht', action: 'Rückgängig', discard: 'Deine Änderungen gehen verloren. Trotzdem schließen?' },
    fr: { deleted: 'Supprimé', action: 'Annuler', discard: 'Vos modifications seront perdues. Fermer quand même ?' },
    es: { deleted: 'Eliminado', action: 'Deshacer', discard: 'Se perderán tus cambios. ¿Cerrar de todos modos?' },
  } as const
  const talen = { nl, en, de, fr, es }
  it.each(Object.entries(talen))('ALG2: %s — undo.deleted, undo.action, sheet.discardConfirm', (taal, dict) => {
    const v = verwacht[taal as keyof typeof verwacht]
    expect(dict.undo.deleted).toBe(v.deleted)
    expect(dict.undo.action).toBe(v.action)
    expect(dict.sheet.discardConfirm).toBe(v.discard)
  })
})

describe('ALG4 — beweging respecteert de globale animatieregel en reduced motion; alleen transform/opacity', () => {
  beforeEach(() => vi.useFakeTimers())
  it('ALG4: de toast draagt motion-ok (uitgezonderd van de globale "alles uit"-regel) en animeert alleen transform en opacity', async () => {
    mock(periodActies.deleteCategorieMeting).mockResolvedValue(NUL_HERSTEL)
    renderNulmeting()
    openGeschiedenis()
    await klik(nulVerwijderKnop()!)
    await flush()
    const toast = screen.getByRole('status')
    expect(toast.className).toContain('motion-ok')
    const eigenschappen = toast.style.transition.split(',').map((d) => d.trim().split(' ')[0])
    for (const e of eigenschappen) expect(['transform', 'opacity']).toContain(e)
  })
})

describe('ALG1 — typecheck/lint/testsuite', () => {
  it('ALG1: wordt buiten deze test bewezen met `npm run typecheck`, `npm run lint` en `npm test` (zie rapport)', () => {
    expect(JSON.parse(lees('package.json')).scripts).toMatchObject({ typecheck: 'tsc --noEmit', lint: 'eslint', test: 'vitest run' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Her-verificatie na fixronde 1
// ═══════════════════════════════════════════════════════════════════════

describe('UT3 (na muis/focus) — een eerdere toast mag de timer van de volgende niet blokkeren', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mock(matchActies.deleteMatchEvent).mockResolvedValue(WM_SNAPSHOT)
    mock(matchActies.herstelWedstrijdMoment).mockResolvedValue(undefined)
  })

  it('UT3: muis staat op toast 1, klik op ✕ zonder pointerleave -> toast 2 (volgende verwijdering) verdwijnt na 5 s', async () => {
    renderWedstrijd()
    await klik(wedstrijdVerwijder()[0])
    await flush()
    fireEvent.pointerEnter(screen.getByTestId('toast-kaart'))
    await klik(screen.getByRole('button', { name: nl.common.close }))
    await tick(TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await klik(wedstrijdVerwijder()[0])
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent(nl.undo.deleted)
    await tick(TOAST_DUUR_MS - 200)
    expect(screen.getByRole('status')).toBeInTheDocument() // nog niet weg
    await tick(200 + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('UT3: muis staat op toast 1 en een nieuwe toast vervangt hem zonder pointerleave -> toast 2 verdwijnt na 5 s', async () => {
    renderWedstrijd()
    await klik(wedstrijdVerwijder()[0])
    await flush()
    fireEvent.pointerEnter(screen.getByTestId('toast-kaart'))
    await klik(wedstrijdVerwijder()[0]) // tweede item verwijderen -> nieuwe toast vervangt de eerste
    await flush()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('UT3/UT9: focus op toast 1, sluiten met ✕ zonder blur -> toast 2 verdwijnt na 5 s', async () => {
    renderWedstrijd()
    await klik(wedstrijdVerwijder()[0])
    await flush()
    const sluitKnop = screen.getByRole('button', { name: nl.common.close })
    act(() => sluitKnop.focus())
    await klik(sluitKnop)
    await tick(TOAST_EXIT_MS + 50)
    await klik(wedstrijdVerwijder()[0])
    await flush()
    expect(screen.getByRole('status')).toBeInTheDocument()
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('UT9 (regressie): hover pauzeert nog steeds de aftelling, en pointerleave hervat hem', async () => {
    renderWedstrijd()
    await klik(wedstrijdVerwijder()[0])
    await flush()
    const kaart = screen.getByTestId('toast-kaart')
    fireEvent.pointerEnter(kaart)
    await tick(TOAST_DUUR_MS * 3)
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.pointerLeave(kaart)
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 50)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('UT5/UT-V-B — "oefening uit training": koppeling op de server al weg', () => {
  beforeEach(() => vi.useFakeTimers())

  it('UT5: verwijderen faalt met "Koppeling niet gevonden" -> kaart terug + foutmelding, geen toast, pagina ververst (router.refresh)', async () => {
    mock(planActies.removeOefeningFromTraining).mockRejectedValueOnce(new Error('Koppeling niet gevonden'))
    renderPlan([maakKoppeling('k1', 0), maakKoppeling('k2', 1)])
    await klik(ontkoppelKnoppen()[1])
    await flush()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(nl.undo.deleteError)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Koppeling niet gevonden')
  })

  it('UT5: na de refresh levert de server een lijst zonder de verdwenen koppeling -> die kaart blijft niet als rest staan', async () => {
    mock(planActies.removeOefeningFromTraining).mockRejectedValueOnce(new Error('Koppeling niet gevonden'))
    const ui = (kk: TrainingOefeningMetBezetting[]) => (
      <DictProvider dict={nl}>
        <ToastProvider teamId="team-1">
          <TrainingPlanEditor
            eventId="e1" initialDoelstelling={null} initialOefeningen={kk} library={[]}
            currentSteps={{}} hasNulmeting={false} suggestion={null}
            players={[maakSpeler('s1', 'Spelertje')]} presentPlayerIds={['s1']} startTijd={null}
            kopieerOpties={[]} initialTrainingstype="vct" userId="team-1"
          />
        </ToastProvider>
      </DictProvider>
    )
    const k1 = maakKoppeling('k1', 0)
    const k2 = maakKoppeling('k2', 1)
    const r = render(ui([k1, k2]))
    await klik(ontkoppelKnoppen()[1])
    await flush()
    expect(h.refresh).toHaveBeenCalled()
    expect(ontkoppelKnoppen()).toHaveLength(2) // kaart tijdelijk terug (zonder revalidatie zou dit zo blijven)
    // Serverstand na router.refresh(): k2 bestaat niet meer.
    await act(async () => { r.rerender(ui([k1])) })
    expect(ontkoppelKnoppen()).toHaveLength(1)
  })

  it('UT1 (regressie): bij een geslaagde verwijdering wordt NIET ververst', async () => {
    mock(planActies.removeOefeningFromTraining).mockResolvedValue(KOPPELING_HERSTEL)
    renderPlan([maakKoppeling('k1', 0), maakKoppeling('k2', 1)])
    await klik(ontkoppelKnoppen()[1])
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent(nl.undo.deleted)
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('UT2/UT4 — herstelKoppeling compenseert: bij een fout ná de insert is de koppeling écht niet terug', () => {
  const K1 = 'c1000000-0000-4000-8000-000000000001'
  const K2 = 'c2000000-0000-4000-8000-000000000002' // de hersteld te worden koppeling
  const KIND = 'c3000000-0000-4000-8000-000000000003'
  const EV = 'e1000000-0000-4000-8000-0000000000e1'
  const OEF = 'a1000000-0000-4000-8000-0000000000a1'

  type FoutHaak = (w: { tabel: string; actie: 'insert' | 'update' | 'delete'; payload: Rij | null }) => { code?: string; message: string } | null

  /** Stateful nep-Supabase: insert/update/delete muteren echt; fouten per schrijfactie injecteerbaar. */
  function planDb(faal: FoutHaak) {
    const tabellen: Record<string, Rij[]> = {
      team_members: [{ team_id: TEAM, user_id: USER, rol: 'owner' }],
      settings: [],
      events: [{ id: EV, team_id: TEAM, type: 'training' }],
      players: [],
      oefeningen: [{ id: OEF, team_id: USER, categorie: 'partijen_klein', teams: [], aantal_neutralen: 0, aantal_neutralen_max: null }],
      training_oefeningen: [
        { id: K1, team_id: TEAM, event_id: EV, volgorde: 0, genest_in: null, parallel_groep_id: null, created_at: '2024-01-01T00:00:00Z' },
        { id: KIND, team_id: TEAM, event_id: EV, volgorde: 5, genest_in: null, parallel_groep_id: null, created_at: '2024-01-03T00:00:00Z' },
      ],
    }
    const log: { tabel: string; actie: string; payload: Rij | null; filters: Record<string, unknown> }[] = []
    const from = (naam: string) => {
      const filters: ((r: Rij) => boolean)[] = []
      const gezien: Record<string, unknown> = {}
      let actie: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: Rij | null = null
      const uitvoeren = () => {
        const rijen = () => (tabellen[naam] ?? []).filter((r) => filters.every((f) => f(r)))
        if (actie === 'select') return { data: rijen().sort((a, b) => Number(a.volgorde ?? 0) - Number(b.volgorde ?? 0)), error: null }
        const fout = faal({ tabel: naam, actie, payload })
        log.push({ tabel: naam, actie, payload, filters: { ...gezien } })
        if (fout) return { data: null, error: fout }
        if (actie === 'insert') tabellen[naam] = [...(tabellen[naam] ?? []), { ...payload! }]
        if (actie === 'update') for (const r of rijen()) Object.assign(r, payload)
        if (actie === 'delete') {
          const weg = new Set(rijen())
          tabellen[naam] = (tabellen[naam] ?? []).filter((r) => !weg.has(r))
          // FK genest_in ... ON DELETE SET NULL (supabase/training-plan.sql)
          if (naam === 'training_oefeningen') {
            const wegIds = new Set([...weg].map((r) => r.id))
            for (const r of tabellen[naam]) if (wegIds.has(r.genest_in)) r.genest_in = null
          }
        }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (c: string, v: unknown) => { gezien[c] = v; filters.push((r) => r[c] === v); return chain }
      chain.in = (c: string, vs: unknown[]) => { gezien[c] = vs; filters.push((r) => vs.includes(r[c])); return chain }
      chain.is = (c: string, v: unknown) => { gezien[c] = v; filters.push((r) => (r[c] ?? null) === v); return chain }
      chain.order = () => chain
      chain.limit = () => chain
      chain.insert = (p: Rij) => { actie = 'insert'; payload = p; return chain }
      chain.update = (p: Rij) => { actie = 'update'; payload = p; return chain }
      chain.delete = () => { actie = 'delete'; return chain }
      chain.maybeSingle = () => Promise.resolve({ data: (uitvoeren().data as Rij[] | null)?.[0] ?? null, error: null })
      chain.single = chain.maybeSingle
      ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res(uitvoeren())
      return chain
    }
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
      from,
    } as unknown as Awaited<ReturnType<typeof createClient>>)
    return { tabellen, log }
  }

  const snapshot = (o: Partial<HerstelKoppeling> = {}): HerstelKoppeling => ({
    ...KOPPELING_HERSTEL, teamId: TEAM, id: K2, eventId: EV, oefeningId: OEF, volgorde: 1,
    duurMin: 10, stapOverride: null, kinderenGenestIds: [KIND], volgordeIds: [K1, K2, KIND], partner: null,
    createdAt: '2024-01-02T00:00:00Z', ...o,
  })
  const ids = (db: { tabellen: Record<string, Rij[]> }) => db.tabellen.training_oefeningen.map((r) => r.id)

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('UT2 (referentie): zonder fouten staat de koppeling na herstel terug, kind weer genest en volgorde aaneengesloten', async () => {
    const db = planDb(() => null)
    await (await echtPlan()).herstelKoppeling(snapshot())
    expect(ids(db)).toContain(K2)
    expect(db.tabellen.training_oefeningen.find((r) => r.id === KIND)).toMatchObject({ genest_in: K2 })
    const volgordes = db.tabellen.training_oefeningen.map((r) => r.volgorde as number).sort()
    expect(volgordes).toEqual([0, 1, 2])
  })

  it('UT4: nesten van het kind faalt na de insert -> herstel gooit een generieke fout, de koppeling is NIET terug en het kind is niet half genest', async () => {
    const db = planDb((w) =>
      w.tabel === 'training_oefeningen' && w.actie === 'update' && w.payload && 'genest_in' in w.payload && w.payload.genest_in === K2
        ? { code: 'XX000', message: 'secret-db-detail host=10.1.2.3' }
        : null,
    )
    const fout = await (await echtPlan()).herstelKoppeling(snapshot()).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).not.toContain('secret-db-detail')
    expect((fout as Error).message).not.toContain('10.1.2.3')
    expect(ids(db)).not.toContain(K2)
    expect(ids(db).sort()).toEqual([K1, KIND].sort())
    expect(db.tabellen.training_oefeningen.find((r) => r.id === KIND)).toMatchObject({ genest_in: null })
    // De compensatie-delete is tenant- en event-gescoped.
    const del = db.log.find((w) => w.actie === 'delete')
    expect(del?.filters).toMatchObject({ id: K2, event_id: EV, team_id: TEAM })
  })

  it('UT4: normaliseren van de volgorde faalt na de insert -> fout naar de client, de koppeling is NIET terug', async () => {
    let eerste = true
    const db = planDb((w) => {
      // Alleen de eerste volgorde-update (de normalisatie ná de insert) faalt.
      if (w.tabel === 'training_oefeningen' && w.actie === 'update' && w.payload && 'volgorde' in w.payload && eerste) {
        eerste = false
        return { code: 'XX000', message: 'secret-db-detail' }
      }
      return null
    })
    const fout = await (await echtPlan()).herstelKoppeling(snapshot()).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).not.toContain('secret-db-detail')
    expect(ids(db)).not.toContain(K2)
    expect(db.tabellen.training_oefeningen.find((r) => r.id === KIND)).toMatchObject({ genest_in: null })
  })

  it('UT4: de insert zelf faalt -> fout naar de client, er wordt niets verwijderd en de koppeling is niet terug', async () => {
    const db = planDb((w) => (w.actie === 'insert' ? { code: 'XX000', message: 'secret-db-detail' } : null))
    const fout = await (await echtPlan()).herstelKoppeling(snapshot()).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    expect((fout as Error).message).not.toContain('secret-db-detail')
    expect(ids(db).sort()).toEqual([K1, KIND].sort())
    expect(db.log.filter((w) => w.actie === 'delete')).toEqual([])
  })

  it('ALG3/UT4: de compensatie is tenant- en event-gescoped — een rij met dezelfde id in een ander team en een partner-rij van een ander team blijven ongemoeid', async () => {
    const PARTNER = 'c4000000-0000-4000-8000-000000000004'
    const GROEP = 'c5000000-0000-4000-8000-000000000005'
    const db = planDb((w) =>
      w.tabel === 'training_oefeningen' && w.actie === 'update' && w.payload && w.payload.genest_in === K2
        ? { code: 'XX000', message: 'boem' }
        : null,
    )
    const rij = (o: Rij): Rij => ({ volgorde: 9, genest_in: null, parallel_groep_id: null, parallel_spelers: [], created_at: '2024-01-05T00:00:00Z', ...o })
    db.tabellen.training_oefeningen.push(
      rij({ id: PARTNER, team_id: TEAM, event_id: EV, volgorde: 3 }),
      // Zelfde id, ander team (gedeeld event-id). (Zelfde team + ander event kan niet: koppelingBestaat zou dan 'al hersteld' melden.)
      rij({ id: K2, team_id: ANDER_TEAM, event_id: EV }),
      // Partner-id van een ander team, met een herkenbare indeling:
      rij({ id: PARTNER, team_id: ANDER_TEAM, event_id: EV, parallel_spelers: ['sentinel'] }),
    )
    const fout = await (await echtPlan()).herstelKoppeling(
      snapshot({ parallelGroepId: GROEP, partner: { id: PARTNER, parallelSpelers: [] } as unknown as HerstelKoppeling['partner'] }),
    ).catch((e: Error) => e)
    expect(fout).toBeInstanceOf(Error)
    const rijen = db.tabellen.training_oefeningen
    // Eigen koppeling in eigen team+event is weg ...
    expect(rijen.filter((r) => r.id === K2 && r.team_id === TEAM && r.event_id === EV)).toHaveLength(0)
    // ... maar de gelijknamige rij van het andere team is er nog.
    expect(rijen.filter((r) => r.id === K2 && r.team_id === ANDER_TEAM)).toHaveLength(1)
    // Partner van het eigen team is weer los; die van het andere team is onaangeroerd.
    expect(rijen.find((r) => r.id === PARTNER && r.team_id === TEAM)).toMatchObject({ parallel_groep_id: null, parallel_spelers: [] })
    expect(rijen.find((r) => r.id === PARTNER && r.team_id === ANDER_TEAM)).toMatchObject({ parallel_groep_id: null, parallel_spelers: ['sentinel'] })
    // Elke compensatie-schrijfactie draagt team_id en event_id als filter.
    const schrijf = db.log.filter((w) => w.actie !== 'insert' && !(w.payload && 'volgorde' in w.payload && !('parallel_groep_id' in w.payload)))
    expect(schrijf.length).toBeGreaterThan(0)
    for (const w of schrijf) expect(w.filters).toMatchObject({ team_id: TEAM, event_id: EV })
  })

  it('UT6: dubbel herstel (koppeling bestaat al) schrijft niets en gooit niet', async () => {
    const db = planDb(() => null)
    await (await echtPlan()).herstelKoppeling(snapshot())
    const voor = db.log.length
    await expect((await echtPlan()).herstelKoppeling(snapshot())).resolves.toBeUndefined()
    expect(db.log.length).toBe(voor)
  })
})
