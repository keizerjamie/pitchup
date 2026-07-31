// Acceptatietests — Afdrukken trainingsplan (user story: als trainer het
// volledige trainingsplan vanaf app/events/[id]/training-plan kunnen
// afdrukken/als PDF bewaren via de browser-printdialoog, zodat het plan op
// papier mee kan naar het veld).
//
// ── AC → test-mapping ──
//   AC1  → describe('AC1 — afdrukknop naast de titel op de pagina')
//   AC2  → describe('AC2 — klik roept window.print() precies één keer aan')
//          + edge case dubbelklik in datzelfde blok
//   AC3  → describe('AC3 — cyclusweek-suggestie en periodiseringstatus niet op de afdruk')
//   AC4  → describe('AC4 — teamindeling: bediening verborgen, namen zichtbaar')
//   AC5  → describe('AC5 — aanwezigheidsoverzicht blijft, wijzig-link niet')
//   AC6  → describe('AC6 — doelstelling volledig als tekst, niet als invoerveld')
//          + edge case lange doelstelling met regelovergangen
//   AC7  → describe('AC7 — training zonder oefeningen')
//   AC8  → describe('AC8 — geen tegenstander-veld of -label op de afdruk')
//   AC9  → describe('AC9 — oefeningdetails zichtbaar, zelfde volgorde als scherm')
//   AC10 → describe('AC10 — geen nieuwe data-ophaling/route, bestaande toegang ongewijzigd')
//   AC15 → describe('AC15 — pool ("nog niet ingedeeld") leesbaar zonder dropzone-styling')
//   AC17 → describe('AC17 — lege doelstelling: hele blok weg van de afdruk')
//   AC18 → describe('AC18 — printer-icoon + label "Afdrukken", i18n in alle 5 talen')
//
// ── Aanvullende dekking na validator-bevindingen (zie onderaan dit bestand) ──
//   A1.1 → describe('A1.1 — "Afgemeld"-markering ...')            — "Afgemeld" print wél mee
//   A1.2 → describe('A1.2 — diagram- en formatieveld-breedte ...') — exact print:w-[55mm]!/[35mm]!
//   A1.3 → describe('A1.3 — editor-waarschuwingen ...')            — teamsRemoved/sizeMismatch/saveError print:hidden
//   A1.4 → AC5-blok, extra test 'de root van het aanwezigheidsblok draagt print:break-inside-avoid'
//   A2   → gefixt in AC3-blok (eerste test): assertie richt zich nu op het juiste element
//   A3   → aangevuld in AC8-blok: positieve controle dat de pagina daadwerkelijk inhoud rendert
//   B1   → describe('B1 — print-single-column ...')  — DOM-volgorde waarop de CSS print:order leunt
//   B2   → describe('B2 — BackButton is print:hidden ...')
//   B3   → describe('B3 — lg:sticky zit binnen .print-single-column ...')
//   B4   → describe('B4 — sectiekop blijft printen bij een gevulde lijst ...')
//   B5   → describe('B5 — pool-container is print:hidden wanneer leeg ...')
//   C1   → describe('C1 — print-CSS regressiebewaking (app/globals.css, @media print) ...')
//          — leest globals.css en asserteert dat de regels die de kernbug
//          (verkeerde papierstand-detectie/orde/kleur/dark-mode-lek) hebben
//          gerepareerd, daadwerkelijk in het bestand staan. B1 hierboven dekt
//          alleen de DOM-helft van dat contract (zie B1's eigen comment);
//          C1 dekt de CSS-helft die B1 niet kon zien. Bewijst NIET dat een
//          browser deze regels toepast — dat blijft AC11-14, handmatig.
//
// Edge cases (uit de story) zitten inline in het bijbehorende AC-blok:
//   - training zonder oefeningen                        → AC7
//   - oefening zonder diagram (FormationField-fallback)  → AC9 (edge case sub-test)
//   - oefening zonder teams (TeamIndelingEditor → null)  → AC4 (edge case sub-test)
//   - geen aanwezige spelers (early-return-tak)           → AC4 (edge case sub-test)
//   - lange doelstelling met regelovergangen (incl. \n)   → AC6 (edge case sub-test)
//   - dubbelklik → window.print() precies 2×              → AC2 (edge case sub-test)
//
// ── NIET in dit bestand (AC11-14) ──
// AC11 (past leesbaar op A4), AC12 (groen veld drukt mee), AC13 (dark mode →
// leesbaar op wit), AC14 (meerdere pagina's blijven leesbaar) zijn NIET
// geautomatiseerd te verifiëren: jsdom heeft geen layout-engine en past
// `@media print` niet toe (geen paginagrootte, geen kleurenrendering, geen
// paginabreuk-berekening). Dit vergt een handmatige check: open
// /events/<id>/training-plan in een echte browser, gebruik "Afdrukken als
// PDF" en controleer op papier/PDF-voorbeeld. Niet in checklist-vorm
// aanwezig in de repo — aanbevolen om er één toe te voegen bij een volgende
// wijziging aan de print-CSS (app/globals.css:324 e.v.).
//
// C1 (verderop in dit bestand) verkleint het risico op een stille regressie
// hier: die test leest globals.css en asserteert dat de CSS-regels die AC11-14
// mogelijk maken (o.a. de print-color-adjust en de dark-mode-overschrijving)
// letterlijk aanwezig zijn. C1 bewijst dus dat de regels ER ZIJN, niet dat
// de browser ze toepast — de handmatige check hierboven blijft nodig.
//
// ── Testmethode voor print-zichtbaarheid (proxy, geen echte @media print) ──
// jsdom rendert geen CSS media queries, dus we kunnen niet zien wat er
// werkelijk op papier verschijnt. In plaats daarvan toetsen we het
// klasse-contract dat de productiecode aangaat: bestaat het element, en
// draagt het (of een voorouder) de klasse 'print:hidden' (verdwijnt op
// papier) resp. 'hidden print:block' (verschijnt alleen op papier)?
// hasPrintHiddenAncestor() loopt de parentElement-keten af en checkt de
// EXACTE string 'print:hidden' — een typefout in de productiecode
// (bv. 'print:hiden') zou deze test dus terecht laten falen, niet stiekem
// groen maken. AC11-14 blijven hierdoor bewust buiten deze test.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { Player, TrainingOefeningWithData } from '@/lib/types'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import AttendanceSummary from '@/components/AttendanceSummary'
import PrintButton from '@/components/PrintButton'

// ── Mocks: server actions (zelfde patroon als components/TrainingPlanEditor.test.tsx:8-16) ──
vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn().mockResolvedValue(undefined),
  removeOefeningFromTraining: vi.fn().mockResolvedValue(undefined),
  updateKoppeling: vi.fn().mockResolvedValue(undefined),
  reorderKoppelingen: vi.fn().mockResolvedValue(undefined),
  saveSpelerindeling: vi.fn().mockResolvedValue(undefined),
  addOefeningToTraining: vi.fn().mockResolvedValue(undefined),
  createAndAddOefening: vi.fn().mockResolvedValue(undefined),
}))

// ── Mocks voor het echt renderen van de server-route zelf (nodig voor AC1,
// AC2-in-page-context, AC7-page-niveau, AC8, AC10). Next.js App Router
// server components zijn gewone async functies die JSX teruggeven — die
// kunnen we direct aanroepen en met RTL renderen, zolang de omgeving
// (next/headers, next/navigation, de Supabase-client) gestubd is. Er is
// geen bestaande conventie in dit repo om dat te doen (de andere
// *.acceptance.test.tsx-bestanden testen op component-niveau), maar AC1 gaat
// expliciet over de layout van de PAGINA ("naast de titel/kop") — dat is
// alleen van buitenaf te bewijzen door de echte route te renderen.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('__notFound__')
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import * as trainingPlanActions from '@/app/actions/training-plan'
import TrainingPlanPage from '@/app/events/[id]/training-plan/page'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Print-proxy helper (zie kopcomment) ──
function hasPrintHiddenAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains('print:hidden')) return true
    node = node.parentElement
  }
  return false
}

// ── CSS-regressiehelpers voor C1 (zie dat blok verderop) ──
// __dirname is het pad van DIT testbestand (projectroot), ongeacht vanuit
// welke working directory `vitest`/`npm test` wordt aangeroepen — dus geen
// afhankelijkheid van process.cwd().
const GLOBALS_CSS_PATH = path.resolve(__dirname, 'app', 'globals.css')

// Zoekt vanaf `fromIndex` de eerste `{` en telt vervolgens accolades tot ze
// weer in balans zijn, zodat geneste regels (bv. `@page { ... }` binnen
// `@media print { ... }`) correct worden meegenomen. Regex alleen zou hier
// stuklopen op geneste `{ }`.
function extractBalancedBlock(source: string, fromIndex: number): string {
  const openIndex = source.indexOf('{', fromIndex)
  if (openIndex === -1) {
    throw new Error(`Geen openende { gevonden vanaf index ${fromIndex}`)
  }
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

// Zoekt een CSS-regel op basis van een selector-regex en geeft de
// (ongenormaliseerde) inhoud van dat blok terug.
function findRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css)
  if (!match) throw new Error(`Selector niet gevonden in CSS-blok: ${selectorPattern}`)
  return extractBalancedBlock(css, match.index)
}

// Normaliseert whitespace zodat de assertie ongevoelig is voor herformattering
// (extra spaties/newlines, andere volgorde van properties binnen dezelfde
// regel wordt NIET genegeerd — property-volgorde blijft zoals geschreven,
// maar dat is bewust: we matchen op individuele property:waarde-paren, niet
// op de hele string, dus onschuldige regelherschikking breekt niets).
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ── Fixtures ──
function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Piet Peters',
    position: 'Spits',
    secondary_positions: [],
    jersey_number: 9,
    active: true,
    injured: false,
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const players3: Player[] = [
  makePlayer({ id: 'p1', name: 'Piet Peters', jersey_number: 1 }),
  makePlayer({ id: 'p2', name: 'Jan Jansen', jersey_number: 2 }),
  makePlayer({ id: 'p3', name: 'Kees Klaassen', jersey_number: 3 }),
]

function makeKoppeling(overrides: Partial<TrainingOefeningWithData> = {}): TrainingOefeningWithData {
  return {
    id: 'k1',
    team_id: 'team1',
    event_id: 'e1',
    oefening_id: 'o1',
    volgorde: 0,
    stap_override: null,
    genest_in: null,
    spelerindeling: [],
    created_at: '2024-01-01T00:00:00Z',
    oefeningen: {
      id: 'o1',
      team_id: 'team1',
      naam: 'Positiespel 4v4',
      beschrijving: 'Balbezit behouden in kleine ruimte',
      categorie: 'positiespel',
      duur_min: 12,
      breedte_m: 20,
      lengte_m: 30,
      orientatie: 'vrij',
      veldzone: null,
      teams: [{ grootte: 2, formatie: null }, { grootte: 2, formatie: null }],
      aantal_neutralen: 0,
      diagram: null,
      created_at: '2024-01-01T00:00:00Z',
    },
    ...overrides,
  }
}

function renderPlan(props: Partial<Parameters<typeof TrainingPlanEditor>[0]> = {}) {
  // Let op: initialDoelstelling mag expliciet `null` zijn (AC17 test dat
  // juist) — dus geen `??` gebruiken (die zou `null` ook naar de default
  // laten terugvallen). `'initialDoelstelling' in props` onderscheidt "niet
  // meegegeven" van "bewust null meegegeven".
  const initialDoelstelling = 'initialDoelstelling' in props ? props.initialDoelstelling ?? null : 'Druk zetten hoog op het veld'
  return render(
    <DictProvider dict={nl}>
      <TrainingPlanEditor
        eventId="e1"
        initialDoelstelling={initialDoelstelling as string | null}
        initialOefeningen={props.initialOefeningen ?? [makeKoppeling()]}
        library={props.library ?? []}
        currentSteps={props.currentSteps ?? {}}
        hasNulmeting={props.hasNulmeting ?? false}
        suggestion={props.suggestion ?? null}
        players={props.players ?? players3}
        presentPlayerIds={props.presentPlayerIds ?? ['p1', 'p2', 'p3']}
      />
    </DictProvider>,
  )
}

// ── Supabase-mock helper, alleen voor de page-niveau tests (AC1/AC2/AC7/AC8/AC10) ──
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

const baseEvent = {
  id: 'e1',
  team_id: 'team-1',
  type: 'training',
  date: '2026-07-29',
  doelstelling: null as string | null,
}

async function renderPage(opts: {
  user?: { id: string } | null
  event?: Record<string, unknown> | null
  players?: unknown[]
  attendance?: unknown[]
  oefeningenKoppelingen?: unknown[]
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables: Record<string, TableResult> = {
    events: { data: opts.event === undefined ? baseEvent : opts.event },
    players: { data: opts.players ?? [] },
    attendance: { data: opts.attendance ?? [] },
    training_oefeningen: { data: opts.oefeningenKoppelingen ?? [] },
    oefeningen: { data: [] },
  }
  vi.mocked(createClient).mockResolvedValue({
    from: (t: string) => tableChain(tables[t] ?? { data: [] }),
    auth: { getUser: async () => ({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>)

  const el = await TrainingPlanPage({ params: Promise.resolve({ id: 'e1' }) })
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function stubPrint() {
  const printSpy = vi.fn()
  Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true })
  return printSpy
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — bovenaan de pagina, naast de titel/kop, staat een afdrukknop
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — afdrukknop naast de titel op de pagina', () => {
  it('rendert de "Afdrukken"-knop als sibling van de titel-kop, bovenaan de echte route', async () => {
    await renderPage()
    const heading = screen.getByRole('heading', { name: nl.event.trainingPlan })
    const printButton = screen.getByRole('button', { name: nl.trainingPlan.print })

    // Zelfde ouder-rij (page.tsx: <div className="flex items-center gap-3">
    // <BackButton/><div><h1/></div><PrintButton/></div>) — de knop is dus een
    // "buur" van de titel-wrapper, niet ergens los onderaan de pagina.
    const headerRow = heading.closest('div')?.parentElement
    expect(headerRow).not.toBeNull()
    expect(headerRow?.contains(printButton)).toBe(true)
    // De knop staat ná de titel-wrapper binnen die rij (visueel "naast").
    expect(heading.compareDocumentPosition(printButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — klik roept window.print() precies één keer aan; geen navigatie/reload
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — klik roept window.print() precies één keer aan', () => {
  it('roept window.print() exact 1× aan, geen navigatie (locatie blijft ongewijzigd)', async () => {
    const printSpy = stubPrint()
    await renderPage()
    const before = window.location.href
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe(before)
    // Geen enkele server action (data-mutatie / paginaherlading via server)
    // werd door de klik getriggerd — het is puur window.print().
    for (const fn of Object.values(trainingPlanActions)) {
      expect(fn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    }
  })

  it('edge case: dubbelklik roept window.print() precies 2× aan (bewust geen eigen guard)', () => {
    const printSpy = stubPrint()
    render(
      <DictProvider dict={nl}>
        <PrintButton />
      </DictProvider>,
    )
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(printSpy).toHaveBeenCalledTimes(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — cyclusweek-suggestie + periodiseringstatus (incl. "toevoegen") niet
// op de afdruk, wél ongewijzigd zichtbaar op het scherm
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — cyclusweek-suggestie en periodiseringstatus niet op de afdruk', () => {
  it('cyclusweek-suggestieblok (incl. "Voeg toe"-knop) draagt print:hidden en blijft op scherm zichtbaar', () => {
    renderPlan({
      suggestion: { week: 2, items: [{ key: 'warming_up', step: 3 }] },
    })
    const title = screen.getByText(nl.periodization.suggestTitle)
    // Geen onzichtbaarheid op het scherm: het element zelf draagt geen 'hidden'
    // (los van 'print:hidden', dat alleen op papier werkt).
    // A2-fix: title.closest('div') levert de binnenste flex-rij op
    // (TrainingPlanEditor.tsx:161), niet het blok dat print:hidden draagt
    // (:160) — vandaar de extra .parentElement. Zonder die stap kon deze
    // assertie de regressie die hij claimt te bewaken niet vangen (:161
    // draagt in geen enkel scenario een 'hidden'-klasse).
    expect(title.closest('div')?.parentElement?.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(hasPrintHiddenAncestor(title)).toBe(true)

    const addButton = screen.getByText(`+ ${nl.periodization.suggestAdd}`)
    expect(hasPrintHiddenAncestor(addButton)).toBe(true)
  })

  it('periodiseringstatusblok draagt print:hidden en blijft op scherm zichtbaar', () => {
    renderPlan({ hasNulmeting: true, currentSteps: { partijen_groot: 4 } })
    // De tekst is verdeeld over twee child-tekstnodes binnen dezelfde <p>
    // ("Huidige periodiseringstatus" + " " + "voor deze training") — matchen
    // op het element via zijn samengevoegde textContent.
    const status = screen.getByText(
      (_content, el) => el?.textContent === `${nl.periodization.currentSteps} ${nl.periodization.forTraining}`,
    )
    expect(hasPrintHiddenAncestor(status)).toBe(true)
    expect(status.closest('div')?.className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('nulmeting-ontbreekt-blok (incl. "Nulmeting instellen"-link) draagt print:hidden', () => {
    renderPlan({ hasNulmeting: false })
    const hint = screen.getByText(nl.trainingPlan.nulmetingNeeded)
    expect(hasPrintHiddenAncestor(hint)).toBe(true)
    const link = screen.getByText(nl.trainingPlan.nulmetingLink)
    expect(hasPrintHiddenAncestor(link)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — teamindeling: interactieve bediening verborgen op de afdruk, namen
// (team + toegewezen spelers) blijven zichtbaar
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — teamindeling: bediening verborgen, namen zichtbaar', () => {
  function renderWithTeams() {
    const koppeling = makeKoppeling({
      spelerindeling: [['p1'], ['p2']],
    })
    return renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
  }

  it('"Automatisch indelen"-knop is print:hidden', () => {
    renderWithTeams()
    const btn = screen.getByRole('button', { name: nl.teamIndeling.autoAssign })
    expect(hasPrintHiddenAncestor(btn)).toBe(true)
  })

  it('sleep-hint is print:hidden', () => {
    renderWithTeams()
    const hint = screen.getByText(nl.teamIndeling.dragHint)
    expect(hasPrintHiddenAncestor(hint)).toBe(true)
  })

  it('"×"-verwijderknop per speler is print:hidden', () => {
    renderWithTeams()
    const removeBtn = screen.getByRole('button', { name: `${nl.teamIndeling.remove}: Piet` })
    expect(hasPrintHiddenAncestor(removeBtn)).toBe(true)
  })

  it('"Verplaats naar"-knop (verschijnt na selectie) is print:hidden', () => {
    renderWithTeams()
    // Selecteer de pool-speler (p3, nog niet ingedeeld) om de "Verplaats
    // naar Team 1"-knop te laten verschijnen.
    fireEvent.click(screen.getByRole('button', { name: /Kees/ }))
    const moveBtn = screen.getByText(nl.teamIndeling.moveTo.replace('{team}', 'Team 1'))
    expect(hasPrintHiddenAncestor(moveBtn)).toBe(true)
  })

  it('pool-dropzone verliest zijn dropzone-styling op de afdruk (print:border-0 print:p-0)', () => {
    renderWithTeams()
    const pool = screen.getByTestId('teamindeling-pool')
    expect(pool.className).toContain('print:border-0')
    expect(pool.className).toContain('print:p-0')
  })

  it('sleep-/selectie-affordance van een chip is genormaliseerd op de afdruk (print:ring-0 print:shadow-none)', () => {
    renderWithTeams()
    const chip = screen.getByRole('button', { name: 'Piet' }).closest('span')
    expect(chip?.className).toContain('print:ring-0')
    expect(chip?.className).toContain('print:shadow-none')
  })

  it('teamnamen blijven zichtbaar op de afdruk (geen print:hidden)', () => {
    renderWithTeams()
    const team0 = screen.getByTestId('teamindeling-team-0')
    const label = within(team0).getByText(/Team 1/)
    expect(hasPrintHiddenAncestor(label)).toBe(false)
  })

  it('toegewezen spelernamen blijven zichtbaar op de afdruk (geen print:hidden)', () => {
    renderWithTeams()
    const team0 = screen.getByTestId('teamindeling-team-0')
    const nameBtn = within(team0).getByRole('button', { name: 'Piet' })
    expect(hasPrintHiddenAncestor(nameBtn)).toBe(false)
  })

  it('edge case: oefening zonder teams (teams: []) — TeamIndelingEditor rendert niets, geen crash', () => {
    const koppeling = makeKoppeling({ oefeningen: { ...makeKoppeling().oefeningen, teams: [] } })
    expect(() => renderPlan({ initialOefeningen: [koppeling] })).not.toThrow()
    expect(screen.queryByTestId('teamindeling-pool')).not.toBeInTheDocument()
    expect(screen.queryByText(nl.teamIndeling.heading)).not.toBeInTheDocument()
  })

  it('edge case: geen aanwezige spelers — early-return-tak toont "geen aanwezige spelers", geen crash', () => {
    expect(() => renderWithTeamsNoPresence()).not.toThrow()
    expect(screen.getByText(nl.teamIndeling.noPresentPlayers)).toBeInTheDocument()

    function renderWithTeamsNoPresence() {
      const koppeling = makeKoppeling({ spelerindeling: [] })
      return renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: [] })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — AttendanceSummary blijft op de afdruk, "wijzig aanwezigheid"-link niet
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — aanwezigheidsoverzicht blijft, wijzig-link niet', () => {
  function renderSummary() {
    return render(
      <AttendanceSummary
        present={[makePlayer({ id: 'p1', name: 'Piet Peters' })]}
        absent={[makePlayer({ id: 'p2', name: 'Jan Jansen' })]}
        eventId="e1"
        t={nl}
      />,
    )
  }

  it('het aanwezigheidsblok zelf is niet print:hidden', () => {
    renderSummary()
    const heading = screen.getByRole('heading', { name: nl.event.attendance })
    expect(hasPrintHiddenAncestor(heading)).toBe(false)
  })

  it('de "wijzig aanwezigheid"-link is print:hidden', () => {
    renderSummary()
    const link = screen.getByRole('link', { name: new RegExp(nl.event.editAttendance) })
    expect(hasPrintHiddenAncestor(link)).toBe(true)
  })

  // A1 (gap 4): de bestaande tests hierboven controleren alleen de afwezigheid
  // van 'print:hidden'. Dat dekt niet het expliciete eigenaarsbesluit dat de
  // root van het blok altijd 'print:break-inside-avoid' draagt
  // (AttendanceSummary.tsx:30), zodat het blok niet halverwege over een
  // paginabreuk valt.
  it('de root van het aanwezigheidsblok draagt print:break-inside-avoid (AttendanceSummary.tsx:30)', () => {
    const { container } = renderSummary()
    const root = container.querySelector('.glass-card')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('print:break-inside-avoid')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6 — doelstelling volledig als tekst op de afdruk, niet als invoerveld
// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — doelstelling volledig als tekst, niet als invoerveld', () => {
  it('de textarea (rows=2, bewerkbaar) is print:hidden', () => {
    renderPlan({ initialDoelstelling: 'Druk zetten hoog op het veld' })
    const textarea = screen.getByPlaceholderText(nl.trainingPlan.objectivePlaceholder) as HTMLTextAreaElement
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea.rows).toBe(2)
    expect(hasPrintHiddenAncestor(textarea)).toBe(true)
  })

  it('de print-tekstweergave toont de volledige doelstelling, niet begrensd tot 2 regels', () => {
    renderPlan({ initialDoelstelling: 'Druk zetten hoog op het veld' })
    const printText = screen.getByTestId('doelstelling-print')
    expect(printText.textContent).toBe('Druk zetten hoog op het veld')
    // 'hidden print:block': op scherm verborgen (dubbele weergave voorkomen),
    // op papier zichtbaar — en zonder line-clamp/rows-begrenzing.
    expect(printText.className).toContain('hidden')
    expect(printText.className).toContain('print:block')
    expect(printText.className).not.toMatch(/line-clamp-(?!none)/)
  })

  it('edge case: lange doelstelling met regelovergangen komt volledig (incl. \\n) door op de afdruk', () => {
    const longText = 'Regel 1: druk hoog zetten\nRegel 2: compact blok\nRegel 3: snel omschakelen na balverlies'
    renderPlan({ initialDoelstelling: longText })
    const printText = screen.getByTestId('doelstelling-print')
    expect(printText.textContent).toBe(longText)
    expect(printText.className).toContain('whitespace-pre-wrap')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 — training zonder gekoppelde oefeningen
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — training zonder oefeningen', () => {
  it('component-niveau: de oefeningen-sectie (incl. toevoegen-knoppen + lege-staat-illustratie) is volledig print:hidden', () => {
    renderPlan({ initialOefeningen: [] })
    const section = screen.getByTestId('exercises-section')
    expect(section.className).toContain('print:hidden')
    // De "oefening toevoegen"-knoppen en de lege-staat-illustratie zitten
    // allemaal ín deze sectie — print:hidden op de sectie zelf sluit ze dus
    // allemaal uit van de afdruk.
    expect(within(section).getByText(nl.trainingPlan.noExercises)).toBeInTheDocument()
    expect(within(section).getAllByText(nl.trainingPlan.addExercise).length).toBeGreaterThan(0)
  })

  it('page-niveau: de afdruk toont wél de kop en het aanwezigheidsoverzicht', async () => {
    await renderPage({
      players: [{ ...makePlayer({ id: 'p1', name: 'Piet Peters' }) }],
      attendance: [{ player_id: 'p1', status: 'present' }],
      oefeningenKoppelingen: [],
    })
    const heading = screen.getByRole('heading', { name: nl.event.trainingPlan })
    expect(hasPrintHiddenAncestor(heading)).toBe(false)
    const attendanceHeading = screen.getByRole('heading', { name: nl.event.attendance })
    expect(hasPrintHiddenAncestor(attendanceHeading)).toBe(false)
    expect(screen.getByTestId('exercises-section').className).toContain('print:hidden')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — geen tegenstander-veld of -label op de afdruk
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — geen tegenstander-veld of -label op de afdruk', () => {
  it('de trainingsplan-pagina toont nergens een tegenstander-/opponent-veld of -label', async () => {
    await renderPage({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters' })],
      attendance: [{ player_id: 'p1', status: 'present' }],
      oefeningenKoppelingen: [makeKoppeling()],
    })
    // A3: positieve controle — zonder deze regel zouden de onderstaande
    // negatieve asserties ook slagen bij een lege of kapotte pagina, wat op
    // zichzelf niets bewijst. Dit toont aan dat de pagina daadwerkelijk
    // inhoud rendert vóórdat we vaststellen dat een tegenstander-veld
    // daarin ontbreekt.
    expect(screen.getByText('Positiespel 4v4')).toBeInTheDocument()
    expect(screen.queryByText(/tegenstander/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/opponent/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-testid*="opponent"], [data-testid*="tegenstander"]')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — oefeningdetails zichtbaar op de afdruk, zelfde volgorde als scherm
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — oefeningdetails zichtbaar, zelfde volgorde als scherm', () => {
  it('naam, beschrijving, duur, afmetingen, categorie-badge en stap-badge zijn niet print:hidden', () => {
    renderPlan({
      initialOefeningen: [makeKoppeling()],
      currentSteps: { positiespel: 4 },
    })
    const naam = screen.getByText('Positiespel 4v4')
    const beschrijving = screen.getByText('Balbezit behouden in kleine ruimte')
    const categorieBadge = screen.getByText(nl.periodization.categories.positiespel)
    const stapBadge = screen.getByText(`${nl.trainingPlan.stepBadge} 4/99`)
    const duur = screen.getByText('12 min')
    const afmeting = screen.getByText('20×30m')

    for (const el of [naam, beschrijving, categorieBadge, stapBadge, duur, afmeting]) {
      expect(hasPrintHiddenAncestor(el)).toBe(false)
    }

    // Zelfde DOM-volgorde als op het scherm (jsdom herschikt CSS-order niet —
    // deze DOM-volgorde IS dus de scherm-volgorde, en aangezien print geen
    // eigen kopie van deze content rendert (alleen zichtbaarheid toggelt via
    // print:hidden), is dit ook de afdruk-volgorde).
    const order = [naam, beschrijving, categorieBadge, stapBadge, duur, afmeting]
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('edge case: oefening zonder diagram rendert de FormationField-fallback', () => {
    const koppeling = makeKoppeling({
      oefeningen: {
        ...makeKoppeling().oefeningen,
        diagram: null,
        teams: [{ grootte: 4, formatie: null }],
      },
    })
    renderPlan({ initialOefeningen: [koppeling] })
    expect(screen.getAllByTestId('formation-field').length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — geen nieuwe data-ophaling/route; bestaande toegangscontroles
// blijven ongewijzigd gelden; geen apart faalpad voor het afdrukken zelf
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — geen nieuwe data-ophaling/route, bestaande toegang ongewijzigd', () => {
  it('niet-ingelogde gebruiker wordt nog altijd via de bestaande redirect naar /login gestuurd', async () => {
    await expect(renderPage({ user: null })).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('ontbrekende of verkeerd-type training geeft nog altijd de bestaande notFound() — geen apart printpad', async () => {
    await expect(renderPage({ event: null })).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    await expect(renderPage({ event: { ...baseEvent, type: 'wedstrijd' } })).rejects.toThrow('__notFound__')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('de afdrukknop zelf triggert geen enkele server action (geen eigen data-ophaling)', async () => {
    stubPrint()
    await renderPage({ oefeningenKoppelingen: [makeKoppeling()] })
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    for (const fn of Object.values(trainingPlanActions)) {
      expect(fn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — pool ("nog niet ingedeeld") leesbaar op de afdruk, zonder
// dropzone-/interactiestyling
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — pool ("nog niet ingedeeld") leesbaar zonder dropzone-styling', () => {
  it('de pool-lijst en het label blijven zichtbaar, met genormaliseerde (niet-interactieve) styling', () => {
    const koppeling = makeKoppeling({ spelerindeling: [['p1'], []] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })

    const pool = screen.getByTestId('teamindeling-pool')
    expect(hasPrintHiddenAncestor(pool)).toBe(false)
    expect(within(pool).getByText(nl.teamIndeling.poolLabel)).toBeInTheDocument()

    // Nog-niet-ingedeelde spelers (p2, p3) staan leesbaar in de pool.
    const janChip = within(pool).getByRole('button', { name: /Jan/ })
    const keesChip = within(pool).getByRole('button', { name: /Kees/ })
    expect(hasPrintHiddenAncestor(janChip)).toBe(false)
    expect(hasPrintHiddenAncestor(keesChip)).toBe(false)

    // Dropzone-/interactiestyling genormaliseerd, geen borders/padding-hover-
    // affordance en geen ring/shadow-selectiestyling op de afdruk.
    expect(pool.className).toContain('print:border-0')
    expect(pool.className).toContain('print:p-0')
    expect(janChip.className).toContain('print:ring-0')
    expect(janChip.className).toContain('print:shadow-none')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 — lege doelstelling: hele blok verdwijnt volledig van de afdruk
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — lege doelstelling: hele blok weg van de afdruk', () => {
  it('doelstelling-block draagt print:hidden wanneer de doelstelling leeg is', () => {
    renderPlan({ initialDoelstelling: null })
    const block = screen.getByTestId('doelstelling-block')
    expect(block.className).toContain('print:hidden')
  })

  it('doelstelling-block draagt print:hidden ook bij een doelstelling die alleen whitespace is', () => {
    renderPlan({ initialDoelstelling: '   ' })
    const block = screen.getByTestId('doelstelling-block')
    expect(block.className).toContain('print:hidden')
  })

  it('een niet-lege doelstelling laat het blok NIET print:hidden zijn (contrast-check)', () => {
    renderPlan({ initialDoelstelling: 'Positiespel oefenen' })
    const block = screen.getByTestId('doelstelling-block')
    expect(block.className).not.toContain('print:hidden')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC18 — printer-icoon + label "Afdrukken"; i18n in alle 5 talen
// ═══════════════════════════════════════════════════════════════════════
describe('AC18 — printer-icoon + label "Afdrukken", i18n in alle 5 talen', () => {
  it('toont een SVG-icoon náást het tekstlabel', () => {
    render(
      <DictProvider dict={nl}>
        <PrintButton />
      </DictProvider>,
    )
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it.each([
    ['nl', nl, 'Afdrukken'],
    ['en', en, 'Print'],
    ['de', de, 'Drucken'],
    ['fr', fr, 'Imprimer'],
    ['es', es, 'Imprimir'],
  ])('label is de i18n-string "%s" → "%s"', (_locale, dict, expected) => {
    expect(dict.trainingPlan.print).toBe(expected)
    render(
      <DictProvider dict={dict}>
        <PrintButton />
      </DictProvider>,
    )
    expect(screen.getByRole('button', { name: expected })).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Aanvullende dekking na validator-bevindingen (A1–A3, B1–B5)
// ═══════════════════════════════════════════════════════════════════════
// De validator vond dat vier expliciete eigenaarsbesluiten géén enkele
// assertie hadden (A1), dat de AC3-assertie op het verkeerde element keek
// (A2, hierboven al gefixt) en dat de AC8-test weinig bewees (A3, hierboven
// al aangevuld). Daarnaast repareerde de frontend-engineer vijf bevindingen
// (B1–B5) die hier alsnog gedekt worden.

// ── A1 (gap 1): "Afgemeld"-markering per speler moet WÉL meeprinten ──
describe('A1.1 — "Afgemeld"-markering per speler print wél mee (TeamIndelingEditor.tsx:402-404)', () => {
  it('een ingedeelde-maar-afwezige speler toont "Afgemeld" zonder print:hidden-voorouder', () => {
    // p1 is ingedeeld in team 0, maar staat niet in presentPlayerIds → absent.
    const koppeling = makeKoppeling({ spelerindeling: [['p1'], []] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p2', 'p3'] })
    const warning = screen.getByText(nl.teamIndeling.absentWarning)
    expect(hasPrintHiddenAncestor(warning)).toBe(false)
  })
})

// ── A1 (gap 2): diagram 55mm / formatieveld 35mm, exacte klassenstrings ──
describe('A1.2 — diagram- en formatieveld-breedte op de afdruk (TrainingPlanEditor.tsx:314,324)', () => {
  it('DiagramView krijgt exact de klasse print:w-[55mm]! mee', () => {
    const koppeling = makeKoppeling({
      oefeningen: { ...makeKoppeling().oefeningen, diagram: { markers: [], materiaal: [], lijnen: [] } },
    })
    renderPlan({ initialOefeningen: [koppeling] })
    const diagram = screen.getByTestId('diagram-view')
    expect(diagram.parentElement?.className).toContain('print:w-[55mm]!')
  })

  it('FormationField (fallback zonder diagram) krijgt exact de klasse print:w-[35mm]! mee', () => {
    const koppeling = makeKoppeling({
      oefeningen: { ...makeKoppeling().oefeningen, diagram: null, teams: [{ grootte: 4, formatie: null }] },
    })
    renderPlan({ initialOefeningen: [koppeling] })
    const field = screen.getByTestId('formation-field')
    expect(field.parentElement?.className).toContain('print:w-[35mm]!')
  })
})

// ── A1 (gap 3): editor-waarschuwingen mogen niet printen ──
describe('A1.3 — editor-waarschuwingen (teams verwijderd / sizeMismatch / saveError) zijn print:hidden', () => {
  it('"teams verwijderd"-waarschuwing (hoofdrender-tak, TeamIndelingEditor.tsx:310) is print:hidden', () => {
    // teams.length = 2 (default), 3e sub-array valt buiten teamCount → dropped.
    const koppeling = makeKoppeling({ spelerindeling: [['p1'], ['p2'], ['p3']] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
    const warning = screen.getByText(nl.teamIndeling.teamsRemovedWarning.replace('{n}', '1'))
    expect(hasPrintHiddenAncestor(warning)).toBe(true)
  })

  it('"teams verwijderd"-waarschuwing (early-return-tak, TeamIndelingEditor.tsx:283) is print:hidden', () => {
    // presentPlayers.length === 0 én assignedIds.size === 0 → early-return-tak.
    const koppeling = makeKoppeling({ spelerindeling: [[], [], ['p1']] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: [] })
    const warning = screen.getByText(nl.teamIndeling.teamsRemovedWarning.replace('{n}', '1'))
    expect(hasPrintHiddenAncestor(warning)).toBe(true)
  })

  it('sizeMismatch-waarschuwing (TeamIndelingEditor.tsx:359) is print:hidden', () => {
    // team 0 heeft grootte 2 (default), 3 toegewezen spelers → mismatch.
    const koppeling = makeKoppeling({ spelerindeling: [['p1', 'p2', 'p3'], []] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
    const warning = screen.getByText(nl.teamIndeling.sizeWarning.replace('{n}', '2'))
    expect(hasPrintHiddenAncestor(warning)).toBe(true)
  })

  it('saveError-waarschuwing (TeamIndelingEditor.tsx:316) is print:hidden', async () => {
    vi.mocked(trainingPlanActions.saveSpelerindeling).mockRejectedValueOnce(new Error('boom'))
    const koppeling = makeKoppeling({ spelerindeling: [['p1'], []] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
    fireEvent.click(screen.getByRole('button', { name: nl.teamIndeling.autoAssign }))
    const warning = await screen.findByText(nl.teamIndeling.saveError)
    expect(hasPrintHiddenAncestor(warning)).toBe(true)
  })
})

// ── B1: printvolgorde/één kolom — DOM-volgorde onderbouwt de CSS print:order-omkering ──
describe('B1 — print-single-column: DOM-structuur waarop de CSS print:order-omkering leunt (globals.css:361-389)', () => {
  it('de container draagt print-single-column, en de DOM-volgorde is aanwezigheid vóór trainingsplan', async () => {
    await renderPage({
      players: [makePlayer({ id: 'p1', name: 'Piet Peters' })],
      attendance: [{ player_id: 'p1', status: 'present' }],
      oefeningenKoppelingen: [makeKoppeling()],
    })
    const attendanceHeading = screen.getByRole('heading', { name: nl.event.attendance })
    const exercisesHeading = screen.getByText(nl.trainingPlan.exercisesHeading)

    const container = document.querySelector('.print-single-column')
    expect(container).not.toBeNull()
    expect(container?.children.length).toBe(2)
    const [first, last] = Array.from(container!.children)

    // De CSS (globals.css:399-410) neemt aan dat het EERSTE kind het
    // aanwezigheidsoverzicht is (order:2 → onderaan op papier) en het LAATSTE
    // kind het trainingsplan (order:1 → bovenaan op papier). B1 test alleen
    // de DOM-HELFT van dat contract: klopt de DOM-volgorde hier niet (meer),
    // dan keert de CSS straks de verkeerde helft om. De CSS-omkering zelf —
    // het deel dat de bug daadwerkelijk repareerde (display:flex/order i.p.v.
    // het niet-matchende lg:grid) — wordt bewaakt door C1 verderop in dit
    // bestand, dat globals.css leest en die regels rechtstreeks asserteert.
    // Het daadwerkelijke printresultaat (na de CSS-omkering, in een echte
    // browser) blijft AC11/AC14-terrein en dus handmatig te verifiëren.
    expect(first.contains(attendanceHeading)).toBe(true)
    expect(first.contains(exercisesHeading)).toBe(false)
    expect(last.contains(exercisesHeading)).toBe(true)
    expect(last.contains(attendanceHeading)).toBe(false)
  })
})

// ── B2: BackButton is print:hidden ──
describe('B2 — BackButton is print:hidden (app/events/[id]/training-plan/page.tsx:94)', () => {
  it('de terug-knop draagt print:hidden', async () => {
    await renderPage()
    const backButton = screen.getByRole('button', { name: nl.nav.back })
    expect(hasPrintHiddenAncestor(backButton)).toBe(true)
  })
})

// ── B3: lg:sticky wordt binnen print-single-column gereset (structuurcontract) ──
describe('B3 — lg:sticky zit binnen .print-single-column, zodat de reset-regel kan matchen (globals.css:383-389)', () => {
  it('het element met lg:sticky lg:top-10 (AttendanceSummary) zit binnen de .print-single-column-container', async () => {
    // jsdom past geen externe CSS toe — dit bewijst niet dat position:static
    // daadwerkelijk wordt toegepast, alleen dat de selector
    // ".print-single-column .lg\\:sticky" een bestaand element in de DOM kan
    // raken (de klassen-/structuurvoorwaarde voor de regel).
    await renderPage()
    const container = document.querySelector('.print-single-column')
    expect(container).not.toBeNull()
    const sticky = container!.querySelector('.lg\\:sticky')
    expect(sticky).not.toBeNull()
    expect(sticky?.className).toContain('lg:sticky')
    expect(sticky?.className).toContain('lg:top-10')
  })
})

// ── B4: sectiekop "Oefeningen" print:hidden alleen wanneer de hele sectie leeg is ──
describe('B4 — sectiekop blijft printen bij een gevulde lijst; verdwijnt mee bij een lege lijst (TrainingPlanEditor.tsx:221-230)', () => {
  it('gevulde lijst: de kop print wél mee, alleen de "+ Oefening toevoegen"-knop naast de kop is print:hidden', () => {
    renderPlan({ initialOefeningen: [makeKoppeling()] })
    const heading = screen.getByText(nl.trainingPlan.exercisesHeading)
    expect(hasPrintHiddenAncestor(heading)).toBe(false)

    const headerRow = heading.parentElement
    expect(headerRow).not.toBeNull()
    const addButton = within(headerRow as HTMLElement).getByRole('button', { name: nl.trainingPlan.addExercise })
    expect(hasPrintHiddenAncestor(addButton)).toBe(true)
  })

  it('lege lijst: de hele sectie inclusief de kop is print:hidden (AC7 blijft werken)', () => {
    renderPlan({ initialOefeningen: [] })
    const heading = screen.getByText(nl.trainingPlan.exercisesHeading)
    expect(hasPrintHiddenAncestor(heading)).toBe(true)
  })
})

// ── B5: pool-container zelf print:hidden wanneer leeg (TeamIndelingEditor.tsx:426-432) ──
describe('B5 — pool-container is print:hidden wanneer leeg; blijft zichtbaar wanneer gevuld (AC15 blijft werken)', () => {
  it('lege pool (alle aanwezige spelers ingedeeld): de pool-container zelf draagt print:hidden', () => {
    const koppeling = makeKoppeling({ spelerindeling: [['p1', 'p2'], ['p3']] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
    const pool = screen.getByTestId('teamindeling-pool')
    expect(pool.className).toContain('print:hidden')
  })

  it('gevulde pool: de pool-container zelf draagt géén print:hidden (contrast-check)', () => {
    const koppeling = makeKoppeling({ spelerindeling: [['p1'], []] })
    renderPlan({ initialOefeningen: [koppeling], presentPlayerIds: ['p1', 'p2', 'p3'] })
    const pool = screen.getByTestId('teamindeling-pool')
    expect(pool.className).not.toContain('print:hidden')
  })
})

// ── C1: print-CSS regressiebewaking — de daadwerkelijke bugfix stond volledig
// in app/globals.css (@media print) en werd door geen enkele test gelezen.
// Wie de CSS-regels weghaalt kreeg vóór dit blok 54 groene tests en exact
// dezelfde bug terug. Deze tests lezen het CSS-bronbestand met readFileSync
// en asserteren dat de regels die de bug repareerden er letterlijk staan.
//
// Wat deze tests WEL bewijzen: dat de reparerende selectors/eigenschappen
// aanwezig zijn in globals.css, met de juiste waarden en (waar functioneel
// relevant) in de juiste onderlinge bestandsvolgorde.
// Wat deze tests NIET bewijzen: dat een browser deze CSS ook daadwerkelijk
// toepast/rendert. jsdom voert geen CSS uit; er is geen layout- of
// paint-engine in deze testrun. Of het resultaat op papier/in een PDF-
// voorbeeld klopt (AC11-14) blijft daarom handmatig te verifiëren — zie de
// kopcomment bovenaan dit bestand.
//
// Robuustheid: de assertions matchen op genormaliseerde whitespace binnen
// het eigen regelblok van elke selector (accolade-balancering, geen platte
// regex over het hele bestand), zodat herformattering (extra spaties, een
// gewijzigd comment, andere regelbreedte) de test niet breekt — maar het
// weghalen van een regel, het omdraaien van een waarde (bv. order: 1 ↔ 2),
// of het verwijderen van de bestandsvolgorde-afhankelijkheid wél.
describe('C1 — print-CSS regressiebewaking (app/globals.css, @media print)', () => {
  const cssSource = readFileSync(GLOBALS_CSS_PATH, 'utf-8')
  const mediaPrintIndex = cssSource.indexOf('@media print')

  it('C1.1 — het @media print-blok bestaat in globals.css', () => {
    expect(mediaPrintIndex).toBeGreaterThan(-1)
  })

  // De overige C1-tests hebben allemaal een geldig @media print-blok nodig.
  // Als C1.1 al faalt, falen deze net zo hard (extractBalancedBlock gooit),
  // wat correct is: er valt dan sowieso niets zinnigs te bewaken.
  const mediaPrintBlock = extractBalancedBlock(cssSource, mediaPrintIndex)

  it('C1.2 — .print-single-column forceert display:flex + flex-direction:column (de kern van de fix — het oude gedrag leunde op het lg:-grid-breakpoint, dat bij staand A4 ~703px niet matcht)', () => {
    const block = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-single-column\s*\{/))
    expect(block).toMatch(/display:\s*flex\s*!important/)
    expect(block).toMatch(/flex-direction:\s*column\s*!important/)
  })

  it('C1.3 — de order-omkering staat er: DOM-eerste kind (aanwezigheid) krijgt order 2, DOM-laatste kind (trainingsplan) krijgt order 1, zodat het trainingsplan boven het aanwezigheidsoverzicht print (AC5)', () => {
    const firstChildBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /\.print-single-column\s*>\s*\*:first-child\s*\{/)
    )
    const lastChildBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /\.print-single-column\s*>\s*\*:last-child\s*\{/)
    )
    expect(firstChildBlock).toMatch(/order:\s*2\s*!important/)
    expect(lastChildBlock).toMatch(/order:\s*1\s*!important/)
  })

  it('C1.4 — align-items:stretch en een expliciete gap voorkomen dat lg:items-start/lg:gap-8 doorlekken; de margin-reset op de children voorkomt dubbele/verkeerd geplaatste ruimte na de order-omkering', () => {
    const containerBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.print-single-column\s*\{/))
    expect(containerBlock).toMatch(/align-items:\s*stretch\s*!important/)
    expect(containerBlock).toMatch(/gap:\s*[0-9.]+[a-z%]*\s*!important/)

    const childResetBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /\.print-single-column\s*>\s*\*\s*\{/)
    )
    expect(childResetBlock).toMatch(/margin-block-start:\s*0\s*!important/)
    expect(childResetBlock).toMatch(/margin-block-end:\s*0\s*!important/)
  })

  it('C1.5 — print-color-adjust:exact staat er (zonder deze regel drukt het groene veld/de badge wit af, browsers printen CSS-achtergronden standaard niet)', () => {
    const normalized = normalizeWhitespace(mediaPrintBlock)
    expect(normalized).toMatch(/-webkit-print-color-adjust:\s*exact/)
    expect(normalized).toMatch(/(?<!-webkit-)print-color-adjust:\s*exact/)
  })

  it("C1.6 — licht-tokens overschrijven dark mode op papier, EN dat overschrijvingsblok staat ná de :root[data-theme='dark']-declaratie eerder in het bestand (specificiteit-afhankelijkheid — verplaatsen breekt AC13 stilzwijgend)", () => {
    const darkThemeIndex = cssSource.indexOf(":root[data-theme='dark']")
    expect(darkThemeIndex).toBeGreaterThan(-1)
    expect(mediaPrintIndex).toBeGreaterThan(darkThemeIndex)

    const lightOverrideBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /:root,\s*:root\[data-theme=['"]dark['"]\]\s*\{/)
    )
    expect(lightOverrideBlock).toMatch(/--surface:\s*#ffffff/)
    expect(lightOverrideBlock).toMatch(/--bg:\s*#ffffff/)
  })

  it('C1.7 — @page dwingt A4 af', () => {
    const pageBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /@page\s*\{/))
    expect(pageBlock).toMatch(/size:\s*A4/)
  })

  it('C1.8 — app-chrome (sidebar en alles met .fixed: mobiele header, bottom-nav, FAB) wordt verborgen op de afdruk', () => {
    const chromeBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /\.anchor-sidebar\s*,\s*\.fixed\s*\{/)
    )
    expect(chromeBlock).toMatch(/display:\s*none\s*!important/)
  })

  it('C1.9 — de linkermarge van .app-main wordt gereset (die marge compenseert normaal de vaste sidebar, die op papier al verborgen is)', () => {
    const appMainBlock = normalizeWhitespace(findRuleBlock(mediaPrintBlock, /\.app-main\s*\{/))
    expect(appMainBlock).toMatch(/margin-left:\s*0\s*!important/)
  })

  it('C1.10 — .lg\\:sticky wordt teruggezet naar position:static, gescopeerd binnen .print-single-column (position:sticky is zinloos in paged media zodra de layout één kolom is)', () => {
    const stickyBlock = normalizeWhitespace(
      findRuleBlock(mediaPrintBlock, /\.print-single-column\s+\.lg\\:sticky\s*\{/)
    )
    expect(stickyBlock).toMatch(/position:\s*static\s*!important/)
  })
})
