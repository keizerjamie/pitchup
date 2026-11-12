// Acceptatietests — F1 "Herhalende trainingen" — UI-flow op /events/new.
//
// Rendert het ECHTE formulier (components/NewEventForm.tsx, zoals
// app/events/new/page.tsx het rendert, mét trainingDefaults). Alleen de
// externe randen zijn gemockt: next/navigation (router.push + ?type=), de
// server actions (createEvent, createRecurringTrainings,
// getExistingTrainingDates). Tenant/filtergedrag van de actions staat in
// herhalende-trainingen.acceptance.test.ts (tabel-engine); hier staat alleen
// wat de gebruiker ziet en doet. Criteria-codes (AC1..AC21) verwijzen naar de
// goedgekeurde story f1-02-story.md.
//
// "Vandaag" is vastgezet op vrijdag 2026-11-06 (alleen Date is nep, timers
// echt, zodat de debounce van 300 ms met waitFor wordt afgewacht).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { NewTrainingDefaults, RecurringTrainingsResult } from '@/lib/recurring-trainings'

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  type: null as string | null,
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.type ? `type=${nav.type}` : ''),
  useRouter: () => ({ back: vi.fn(), push: nav.push }),
  redirect: nav.redirect,
}))
vi.mock('@/lib/team-context', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/lib/team-context')>()
  return { ...origineel, requireTeamContextOrLogin: vi.fn() }
})
vi.mock('@/app/actions/events', () => ({ createEvent: vi.fn() }))
vi.mock('@/app/actions/events-bulk', () => ({
  createRecurringTrainings: vi.fn(),
  getExistingTrainingDates: vi.fn(),
  getNewTrainingDefaults: vi.fn(),
}))

import NewEventForm from '@/components/NewEventForm'
import { createEvent } from '@/app/actions/events'
import { createRecurringTrainings, getExistingTrainingDates, getNewTrainingDefaults } from '@/app/actions/events-bulk'
import NewEventPage from '@/app/events/new/page'
import { requireTeamContextOrLogin } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN } from '@/lib/team-rechten'

const mockCreateEvent = vi.mocked(createEvent)
const mockRecurring = vi.mocked(createRecurringTrainings)
const mockExisting = vi.mocked(getExistingTrainingDates)

const r = nl.event.recurring
const LEEG: NewTrainingDefaults = { time: null, location: null, seasonEnd: null }

beforeEach(() => {
  vi.clearAllMocks()
  nav.type = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0)) // vrijdag 6 nov 2026, lokale tijd
  mockExisting.mockResolvedValue([])
  mockCreateEvent.mockResolvedValue(undefined as never)
})
afterEach(() => { vi.useRealTimers() })

function renderForm(defaults?: NewTrainingDefaults) {
  return render(
    <DictProvider dict={nl}>
      {defaults ? <NewEventForm trainingDefaults={defaults} /> : <NewEventForm />}
    </DictProvider>,
  )
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement
const toggle = () => screen.getByRole('switch', { name: r.repeatToggle })
const dayBtn = (label: string) => within(screen.getByRole('group', { name: r.weekdaysLabel })).getByRole('button', { name: label })
const submitBtn = () => document.querySelector('button[type="submit"]') as HTMLButtonElement

function setDates(start: string, until: string) {
  fireEvent.change(field('date'), { target: { value: start } })
  fireEvent.change(field('repeat_until'), { target: { value: until } })
}

// Standaardscenario: di + do, 2026-11-02 t/m 2026-11-29 = 8 trainingen.
async function vulReeks(existing: string[] = []) {
  mockExisting.mockResolvedValue(existing)
  fireEvent.click(toggle())
  fireEvent.click(dayBtn('Di'))
  fireEvent.click(dayBtn('Do'))
  setDates('2026-11-02', '2026-11-29')
  await waitFor(() => expect(mockExisting).toHaveBeenCalledWith('2026-11-02', '2026-11-29'), { timeout: 2000 })
}

// ────────────────────────────────────────────────
// AC1 / AC21 / AC2 — optie, standaard uit, bestaand gedrag
// ────────────────────────────────────────────────

describe('AC1/AC21 — optie "Herhaal wekelijks"', () => {
  it('AC1: bij type training staat de optie er, standaard uit, zonder weekdagknoppen of einddatum', () => {
    renderForm(LEEG)
    expect(toggle()).not.toBeChecked()
    expect(screen.queryByRole('group', { name: r.weekdaysLabel })).toBeNull()
    expect(field('repeat_until')).toBeNull()
    expect(field('repeat_days')).toBeNull()
  })

  it('AC1: bij type wedstrijd (?type=match) is er geen herhaaloptie; wisselen van training naar wedstrijd verbergt hem en zet herhalen uit', () => {
    nav.type = 'match'
    const { unmount } = renderForm(LEEG)
    expect(screen.queryByRole('switch', { name: r.repeatToggle })).toBeNull()
    unmount()

    nav.type = null
    renderForm(LEEG)
    fireEvent.click(toggle())
    expect(screen.getByRole('group', { name: r.weekdaysLabel })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: nl.event.match }))
    expect(screen.queryByRole('switch', { name: r.repeatToggle })).toBeNull()
    expect(field('repeat_days')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: nl.event.training }))
    expect(toggle()).not.toBeChecked()
  })
})

describe('AC2 — herhalen uit: precies één event, bestaand gedrag', () => {
  it('opslaan met herhalen uit roept createEvent (niet createRecurringTrainings) één keer aan, met de formuliervelden maar zonder herhaalvelden', async () => {
    renderForm(LEEG)
    fireEvent.change(field('date'), { target: { value: '2026-11-10' } })
    // De knop heet "Training aanmaken", niet "Maak N trainingen aan".
    expect(submitBtn()).toHaveTextContent(nl.event.createTraining)
    fireEvent.click(submitBtn())
    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalledTimes(1))
    expect(mockRecurring).not.toHaveBeenCalled()
    const fd = mockCreateEvent.mock.calls[0][0] as FormData
    expect(fd.get('type')).toBe('training')
    expect(fd.get('date')).toBe('2026-11-10')
    expect(fd.has('repeat_days')).toBe(false)
    expect(fd.has('repeat_until')).toBe(false)
    // Geen paneel met aantal: de redirect is aan createEvent (server) en blijft ongewijzigd.
    expect(screen.queryByText(r.toAgenda)).toBeNull()
  })

  it('een fout van createEvent blijft zichtbaar zoals voorheen', async () => {
    mockCreateEvent.mockRejectedValue(new Error('Datum ongeldig'))
    renderForm(LEEG)
    fireEvent.click(submitBtn())
    expect(await screen.findByText('Datum ongeldig')).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────
// AC3 — weekdagknoppen + einddatum
// ────────────────────────────────────────────────

describe('AC3 — herhalen aan: weekdagknoppen ma-zo (multiselect, aria-pressed) + einddatum', () => {
  it('toont 7 knoppen in volgorde Ma..Zo, allemaal uit, en een verplichte einddatum', () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    const groep = screen.getByRole('group', { name: r.weekdaysLabel })
    const knoppen = within(groep).getAllByRole('button')
    expect(knoppen.map((b) => b.textContent)).toEqual(['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'])
    expect(knoppen.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(field('repeat_until')).toBeRequired()
    expect(field('repeat_until').type).toBe('date')
  })

  it('meerdere dagen tegelijk selecteerbaar; opnieuw klikken zet een dag weer uit; verborgen veld repeat_days (0=zo) volgt', () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    fireEvent.click(dayBtn('Do'))
    fireEvent.click(dayBtn('Zo'))
    expect(dayBtn('Di')).toHaveAttribute('aria-pressed', 'true')
    expect(dayBtn('Do')).toHaveAttribute('aria-pressed', 'true')
    expect(dayBtn('Zo')).toHaveAttribute('aria-pressed', 'true')
    expect(dayBtn('Ma')).toHaveAttribute('aria-pressed', 'false')
    const waarden = () => field('repeat_days').value.split(',').sort()
    expect(waarden()).toEqual(['0', '2', '4'])
    fireEvent.click(dayBtn('Do'))
    expect(dayBtn('Do')).toHaveAttribute('aria-pressed', 'false')
    expect(waarden()).toEqual(['0', '2'])
  })
})

// ────────────────────────────────────────────────
// AC4 / AC5 / AC17 — teller = wat wordt aangemaakt
// ────────────────────────────────────────────────

describe('AC5/AC17 — teller vóór opslaan', () => {
  it('AC5: di+do van 2 t/m 29 nov toont "8 trainingen" in teller én op de knop, plus de dagen', async () => {
    renderForm(LEEG)
    await vulReeks()
    const teller = await screen.findByText(r.counter.replace('{n}', '8'), { exact: false })
    expect(teller).toHaveTextContent('Di + Do')
    expect(submitBtn()).toHaveTextContent(r.submit.replace('{n}', '8'))
    expect(submitBtn()).toBeEnabled()
  })

  it('AC5/AC17: een bestaande training op een datum verlaagt de teller (7) en toont "1 overgeslagen"; knop zegt 7', async () => {
    renderForm(LEEG)
    await vulReeks(['2026-11-10'])
    await waitFor(() => expect(submitBtn()).toHaveTextContent(r.submit.replace('{n}', '7')))
    expect(screen.getByText(r.counter.replace('{n}', '7'), { exact: false })).toBeInTheDocument()
    expect(screen.getByText(r.counterSkipped.replace('{n}', '1'))).toBeInTheDocument()
  })

  it('AC17: alle datums bezet → teller meldt 0 aan te maken en 8 overgeslagen; opslaan geblokkeerd', async () => {
    renderForm(LEEG)
    await vulReeks(['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26'])
    await waitFor(() => expect(screen.getByText(r.counterSkipped.replace('{n}', '8'))).toBeInTheDocument())
    expect(screen.getByText(r.counter.replace('{n}', '0'), { exact: false })).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
  })

  it('AC5/OV3: startdatum op een niet-gekozen weekdag telt vanaf de eerste gekozen weekdag erna (alleen di, start woensdag 4 nov t/m 17 nov = 2)', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-11-04', '2026-11-17')
    await screen.findByText(r.counter.replace('{n}', '2'), { exact: false })
  })

  it('AC5/edge: einddatum = startdatum op een gekozen weekdag → 1 training', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-11-03', '2026-11-03')
    await screen.findByText(r.counterOne, { exact: false })
    // Enkelvoud ook op de knop.
    expect(submitBtn()).toHaveTextContent(r.submitOne)
    expect(submitBtn()).toBeEnabled()
  })

  it('geldig plan zonder één gekozen weekdag in het bereik (alleen di, wo 4 t/m ma 9 nov) → paneel "geen gekozen weekdag", opslaan geblokkeerd', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-11-04', '2026-11-09')
    expect(await screen.findByText(r.counterNoDays)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
    expect(screen.queryByText(r.counterOne, { exact: false })).toBeNull()
  })

  it('edge: mislukte bestaande-check → melding in de teller, opslaan blijft mogelijk (de server beslist)', async () => {
    mockExisting.mockRejectedValue(new Error('db'))
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-11-03', '2026-11-17')
    expect(await screen.findByText(r.counterCheckFailed, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(submitBtn()).toBeEnabled()
  })
})

// ────────────────────────────────────────────────
// AC4 — wat naar de server gaat
// ────────────────────────────────────────────────

describe('AC4 — opslaan stuurt startdatum, tijd, locatie, notities, trainingstype, weekdagen en einddatum naar createRecurringTrainings', () => {
  it('één aanroep met de juiste FormData; createEvent wordt niet aangeroepen', async () => {
    mockRecurring.mockResolvedValue({ ok: true, created: 8, skipped: 0, attendanceFailed: false })
    renderForm({ time: '19:30', location: 'Veld 3', seasonEnd: null })
    await vulReeks()
    fireEvent.click(screen.getByRole('button', { name: nl.event.trainingstypeTeamtactisch }))
    fireEvent.change(document.querySelector('textarea[name="notes"]')!, { target: { value: 'Neem bidon mee' } })
    await waitFor(() => expect(submitBtn()).toBeEnabled())
    fireEvent.click(submitBtn())

    await waitFor(() => expect(mockRecurring).toHaveBeenCalledTimes(1))
    expect(mockCreateEvent).not.toHaveBeenCalled()
    const fd = mockRecurring.mock.calls[0][0] as FormData
    expect(fd.get('date')).toBe('2026-11-02')
    expect(fd.get('time')).toBe('19:30')
    expect(fd.get('location')).toBe('Veld 3')
    expect(fd.get('notes')).toBe('Neem bidon mee')
    expect(fd.get('trainingstype')).toBe('teamtactisch')
    expect(fd.get('repeat_days')).toBe('2,4')
    expect(fd.get('repeat_until')).toBe('2026-11-29')
  })
})

// ────────────────────────────────────────────────
// AC6 — einddatum = seizoenseinde
// ────────────────────────────────────────────────

describe('AC6/OV2 — einddatum standaard = seizoenseinde', () => {
  it('seizoenseinde 2027-06-30 → einddatum voorgevuld, zichtbaar en aanpasbaar', () => {
    renderForm({ time: null, location: null, seasonEnd: '2027-06-30' })
    fireEvent.click(toggle())
    expect(field('repeat_until').value).toBe('2027-06-30')
    fireEvent.change(field('repeat_until'), { target: { value: '2027-03-01' } })
    expect(field('repeat_until').value).toBe('2027-03-01')
  })

  it('geen seizoenseinde → einddatum leeg, verplicht, met hint', () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    expect(field('repeat_until').value).toBe('')
    expect(field('repeat_until')).toBeRequired()
    expect(screen.getByText(r.endDateRequiredHint)).toBeInTheDocument()
  })

  it('seizoenseinde ligt vóór de startdatum (verleden) → einddatum leeg (brief V4)', () => {
    renderForm({ time: null, location: null, seasonEnd: '2026-06-30' })
    fireEvent.click(toggle())
    expect(field('repeat_until').value).toBe('')
    // Eigen hint: "seizoenseinde is al voorbij", niet de "geen seizoenseinde"-hint.
    expect(screen.getByText(r.endDateSeasonOverHint)).toBeInTheDocument()
    expect(screen.queryByText(r.endDateRequiredHint)).toBeNull()
  })

  it('geen seizoenseinde toont de gewone hint en niet de "seizoenseinde voorbij"-hint', () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    expect(screen.getByText(r.endDateRequiredHint)).toBeInTheDocument()
    expect(screen.queryByText(r.endDateSeasonOverHint)).toBeNull()
  })

  it('geldig seizoenseinde in de toekomst toont geen hint', () => {
    renderForm({ time: null, location: null, seasonEnd: '2027-06-30' })
    fireEvent.click(toggle())
    expect(screen.queryByText(r.endDateSeasonOverHint)).toBeNull()
    expect(screen.queryByText(r.endDateRequiredHint)).toBeNull()
  })

  it('seizoenseinde = vandaag/startdatum → wél voorgevuld (grens van V4 "seizoenseinde >= startdatum")', () => {
    renderForm({ time: null, location: null, seasonEnd: '2026-11-06' })
    fireEvent.click(toggle())
    expect(field('repeat_until').value).toBe('2026-11-06')
  })

  it('seizoenseinde vóór de GEKOZEN startdatum (startdatum later aangepast) → melding einddatum vóór startdatum, opslaan geblokkeerd', async () => {
    renderForm({ time: null, location: null, seasonEnd: '2026-11-20' })
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    fireEvent.change(field('date'), { target: { value: '2026-12-01' } })
    expect(await screen.findByText(r.errors.end_before_start)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
  })
})

// ────────────────────────────────────────────────
// AC7 — voorgevulde tijd en locatie; "Sportpark de Meent" weg
// ────────────────────────────────────────────────

describe('AC7/OV1 — tijd en locatie voorgevuld, overschrijfbaar; placeholder', () => {
  it('bij training zijn tijd en locatie voorgevuld uit de defaults en overschrijfbaar', () => {
    renderForm({ time: '19:30', location: 'Veld 3', seasonEnd: null })
    expect(field('time').value).toBe('19:30')
    expect(field('location').value).toBe('Veld 3')
    fireEvent.change(field('time'), { target: { value: '18:00' } })
    fireEvent.change(field('location'), { target: { value: 'Kunstgras' } })
    expect(field('time').value).toBe('18:00')
    expect(field('location').value).toBe('Kunstgras')
  })

  it('zonder defaults zijn tijd en locatie leeg', () => {
    renderForm(LEEG)
    expect(field('time').value).toBe('')
    expect(field('location').value).toBe('')
  })

  it('bij type wedstrijd (?type=match) blijven tijd en locatie leeg, ook als er trainingsdefaults zijn', () => {
    nav.type = 'match'
    renderForm({ time: '19:30', location: 'Veld 3', seasonEnd: null })
    expect(field('time').value).toBe('')
    expect(field('location').value).toBe('')
  })

  it('de locatie-placeholder is nl.event.locationPlaceholder en noemt "Sportpark de Meent" niet meer — in alle 5 talen', () => {
    renderForm(LEEG)
    expect(field('location').placeholder).toBe(nl.event.locationPlaceholder)
    for (const dict of [nl, en, de, fr, es]) {
      expect(dict.event.locationPlaceholder).toBeTruthy()
      expect(dict.event.locationPlaceholder).not.toMatch(/Meent/i)
    }
  })
})

// ────────────────────────────────────────────────
// AC10-AC13 — inline validatie in de UI
// ────────────────────────────────────────────────

describe('AC10-AC13 — faalpaden in de UI: melding, niets verstuurd', () => {
  it('AC10: herhalen aan zonder weekdag → melding "Kies minimaal één weekdag", knop uitgeschakeld, geen aanroep', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    setDates('2026-11-02', '2026-11-29')
    expect(await screen.findByText(r.errors.no_weekdays)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
    fireEvent.click(submitBtn())
    expect(mockRecurring).not.toHaveBeenCalled()
  })

  it('AC11: einddatum vóór startdatum → melding, knop uitgeschakeld, geen aanroep', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-11-10', '2026-11-02')
    expect(await screen.findByText(r.errors.end_before_start)).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
    fireEvent.click(submitBtn())
    expect(mockRecurring).not.toHaveBeenCalled()
  })

  it('AC13: reeks van 801 dagen → melding met maximum 800, knop uitgeschakeld, geen aanroep', async () => {
    renderForm(LEEG)
    fireEvent.click(toggle())
    fireEvent.click(dayBtn('Di'))
    setDates('2026-01-01', '2028-03-11')
    expect(await screen.findByText(r.errors.too_long.replace('{max}', '800'))).toBeInTheDocument()
    expect(submitBtn()).toBeDisabled()
    fireEvent.click(submitBtn())
    expect(mockRecurring).not.toHaveBeenCalled()
  })

  it('AC12: een serverweigering (locatie te lang) toont de vertaalde melding en de ingevulde velden blijven staan', async () => {
    mockRecurring.mockResolvedValue({ ok: false, error: 'location_too_long' })
    renderForm({ time: '19:30', location: 'Veld 3', seasonEnd: null })
    await vulReeks()
    fireEvent.change(field('location'), { target: { value: 'x'.repeat(201) } })
    fireEvent.click(submitBtn())
    expect(await screen.findByText(r.errors.location_too_long)).toBeInTheDocument()
    expect(field('location').value).toBe('x'.repeat(201))
    expect(field('date').value).toBe('2026-11-02')
    expect(field('repeat_until').value).toBe('2026-11-29')
    expect(dayBtn('Di')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(r.toAgenda)).toBeNull()
  })

  it('AC12: elke serverfoutcode heeft een eigen vertaalde melding (geen ruwe code in beeld)', async () => {
    const codes = ['invalid_date', 'invalid_time', 'invalid_trainingstype', 'location_too_long', 'notes_too_long', 'no_weekdays', 'invalid_end_date', 'end_before_start', 'too_long'] as const
    for (const code of codes) {
      vi.clearAllMocks()
      mockExisting.mockResolvedValue([])
      mockRecurring.mockResolvedValue({ ok: false, error: code })
      const { unmount } = renderForm(LEEG)
      await vulReeks()
      fireEvent.click(submitBtn())
      const verwacht = r.errors[code].replace('{max}', '800')
      expect(await screen.findByText(verwacht)).toBeInTheDocument()
      expect(screen.queryByText(code)).toBeNull()
      unmount()
    }
  })
})

// ────────────────────────────────────────────────
// AC15 — serverfout
// ────────────────────────────────────────────────

describe('AC15 — serverfout: geen ruwe fout naar de gebruiker', () => {
  it('een gegooide fout met interne details toont alleen de generieke vertaalde melding; invoer blijft', async () => {
    mockRecurring.mockRejectedValue(new Error('duplicate key violates constraint "events_pkey" op tabel geheim'))
    renderForm(LEEG)
    await vulReeks()
    fireEvent.click(submitBtn())
    expect(await screen.findByText(r.errors.generic)).toBeInTheDocument()
    expect(screen.queryByText(/events_pkey|geheim|duplicate/)).toBeNull()
    expect(field('repeat_until').value).toBe('2026-11-29')
    // Na een fout is opnieuw proberen mogelijk.
    await waitFor(() => expect(submitBtn()).toBeEnabled())
  })

  it('"Geen toegang"/"Niet ingelogd" van de server komen ook niet letterlijk in beeld', async () => {
    mockRecurring.mockRejectedValue(new Error('Geen toegang'))
    renderForm(LEEG)
    await vulReeks()
    fireEvent.click(submitBtn())
    expect(await screen.findByText(r.errors.generic)).toBeInTheDocument()
    expect(screen.queryByText('Geen toegang')).toBeNull()
  })
})

// ────────────────────────────────────────────────
// AC8 / AC17 / AC18 — bevestiging na aanmaken
// ────────────────────────────────────────────────

describe('AC8/AC17/AC18 — bevestigingspaneel', () => {
  async function opslaanMet(result: RecurringTrainingsResult) {
    mockRecurring.mockResolvedValue(result)
    renderForm(LEEG)
    await vulReeks()
    fireEvent.click(submitBtn())
  }

  it('AC8: toont aantal aangemaakt, geen redirect naar één event, en een knop "Naar de agenda" → /events', async () => {
    await opslaanMet({ ok: true, created: 8, skipped: 0, attendanceFailed: false })
    expect(await screen.findByText(r.createdCount.replace('{n}', '8'))).toBeInTheDocument()
    expect(screen.queryByText(r.attendanceWarning)).toBeNull()
    expect(nav.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: r.toAgenda }))
    expect(nav.push).toHaveBeenCalledWith('/events')
  })

  it('AC8: bij precies 1 aangemaakte training staat het enkelvoud in het paneel', async () => {
    await opslaanMet({ ok: true, created: 1, skipped: 0, attendanceFailed: false })
    expect(await screen.findByText(r.createdCountOne)).toBeInTheDocument()
    expect(screen.queryByText(r.createdCount.replace('{n}', '1'))).toBeNull()
  })

  it('AC8/AC17: toont aantal aangemaakt én overgeslagen', async () => {
    await opslaanMet({ ok: true, created: 7, skipped: 1, attendanceFailed: false })
    expect(await screen.findByText(r.createdCount.replace('{n}', '7'))).toBeInTheDocument()
    expect(screen.getByText(r.skippedCount.replace('{n}', '1'))).toBeInTheDocument()
  })

  it('AC17: alles al bezet (created 0, skipped > 0) → expliciete melding "alle datums hadden al een training"', async () => {
    await opslaanMet({ ok: true, created: 0, skipped: 8, attendanceFailed: false })
    expect(await screen.findByText(r.allExisting)).toBeInTheDocument()
    expect(screen.queryByText(r.createdCount.replace('{n}', '0'))).toBeNull()
  })

  it('AC18: aanwezigheid mislukt → trainingen gemeld als aangemaakt én een blijvende waarschuwing; geen automatische navigatie', async () => {
    await opslaanMet({ ok: true, created: 8, skipped: 0, attendanceFailed: true })
    expect(await screen.findByText(r.createdCount.replace('{n}', '8'))).toBeInTheDocument()
    expect(screen.getByText(r.attendanceWarning)).toBeInTheDocument()
    // Blijft staan (geen timer die hem wegneemt, geen redirect).
    await new Promise((res) => setTimeout(res, 400))
    expect(screen.getByText(r.attendanceWarning)).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────
// AC16 — dubbele klik
// ────────────────────────────────────────────────

describe('AC16 — snel meerdere keren klikken', () => {
  it('twee snelle submits geven één aanroep; de knop is tijdens de aanvraag uitgeschakeld en toont de laadtekst', async () => {
    let finish!: (v: RecurringTrainingsResult) => void
    mockRecurring.mockReturnValue(new Promise<RecurringTrainingsResult>((res) => { finish = res }))
    renderForm(LEEG)
    await vulReeks()
    const form = document.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form) // synchroon erachteraan, vóór een rerender
    fireEvent.click(submitBtn())
    await waitFor(() => expect(submitBtn()).toBeDisabled())
    expect(submitBtn()).toHaveTextContent(nl.event.creating)
    expect(mockRecurring).toHaveBeenCalledTimes(1)

    finish({ ok: true, created: 8, skipped: 0, attendanceFailed: false })
    expect(await screen.findByText(r.createdCount.replace('{n}', '8'))).toBeInTheDocument()
    expect(mockRecurring).toHaveBeenCalledTimes(1)
  })
})

// ────────────────────────────────────────────────
// AC14 / AC21 — pagina zonder agenda-recht
// ────────────────────────────────────────────────

describe('AC14/AC21 — /events/new zonder agenda-recht', () => {
  const ctx = (rol: 'owner' | 'assistent', rechten: typeof ALLE_RECHTEN) =>
    ({ userId: 'u', teamId: 't', rol, rechten, teams: [] }) as unknown as Awaited<ReturnType<typeof requireTeamContextOrLogin>>

  it('een assistent zonder agenda-recht wordt naar /events gestuurd; er worden geen defaults opgehaald en geen formulier (dus geen herhaaloptie) gerenderd', async () => {
    vi.mocked(requireTeamContextOrLogin).mockResolvedValue(ctx('assistent', { ...GEEN_RECHTEN, agenda: false }))
    await expect(NewEventPage()).rejects.toThrow('__redirect__:/events')
    expect(nav.redirect).toHaveBeenCalledWith('/events')
    expect(vi.mocked(getNewTrainingDefaults)).not.toHaveBeenCalled()
  })

  it('met agenda-recht rendert de pagina het formulier met de opgehaalde defaults; een mislukte defaults-aanroep laat het formulier gewoon leeg openen', async () => {
    vi.mocked(requireTeamContextOrLogin).mockResolvedValue(ctx('assistent', { ...GEEN_RECHTEN, agenda: true }))
    vi.mocked(getNewTrainingDefaults).mockResolvedValue({ time: '19:30', location: 'Veld 3', seasonEnd: '2027-06-30' })
    const { unmount } = render(<DictProvider dict={nl}>{await NewEventPage()}</DictProvider>)
    expect(field('time').value).toBe('19:30')
    expect(field('location').value).toBe('Veld 3')
    fireEvent.click(toggle())
    expect(field('repeat_until').value).toBe('2027-06-30')
    unmount()

    vi.mocked(getNewTrainingDefaults).mockRejectedValue(new Error('db'))
    render(<DictProvider dict={nl}>{await NewEventPage()}</DictProvider>)
    expect(field('time').value).toBe('')
    expect(toggle()).not.toBeChecked()
  })
})
