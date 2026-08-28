// Acceptatietests — Formatie-catalogus per oefening-team (user story:
// automatisch gegenereerde formatie-catalogus met single-select per team,
// plus een keeper-schakelaar per team).
//
// AC6 — HERZIEN (bevestigd, geaccepteerd gedrag, geen bug — zie AC5/AC6-blok
// hieronder voor de volledige toelichting): "Elke andere categorie dan
// `partijen_groot` → middenveld of aanval mag 0 zijn. Verdediging is, als gevolg
// van de tie-break-regel bij botsende labels (lib/formaties.ts, `beterDan`), in
// de praktijk nooit 0 — dit is bevestigd, geaccepteerd gedrag, geen bug."
// De oorspronkelijke, bredere AC6-tekst ("elke linie mag 0 zijn, ook
// verdediging") is met terugwerkende kracht gecorrigeerd naar deze herziene
// tekst; `lib/formaties.ts` blijft ongewijzigd.
//
// Dit bestand vervangt het verwijderde oefening-meerdere-formaties.acceptance.test.tsx
// (testte de VERKEERDE feature — multi-select — die door deze story is teruggedraaid).
// Dekt AC1-AC23 uit de goedgekeurde story, van buitenaf:
//   - UI-flow via OefeningEditor (React Testing Library), zoals een trainer de
//     editor gebruikt.
//   - Het publieke server-action-contract (createOefening/updateOefening), met
//     UITSLUITEND de Supabase-client (@/lib/supabase/server) gemockt — validatie
//     (lib/oefening.ts, lib/formaties.ts, lib/authz.ts) draait ongewijzigd.
//
// Bewust GEEN herhaling van de wiskunde/generator-eigenschappen die al
// exhaustief unit-getest zijn in lib/formaties.test.ts (bv. "elke compositie
// telt op tot N en blijft binnen V<=5/M<=5/A<=3", "labels zijn uniek", sortering,
// caching). Hier wordt getoetst dat de UI en de server-actions die (bewezen
// correcte) catalogus ook daadwerkelijk correct GEBRUIKEN — dat is het
// van-buitenaf-gedrag dat de story belooft.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import type { OefeningInput } from '@/lib/oefening'
import { validateOefening } from '@/lib/oefening'
import type { Oefening, OefeningCategorie } from '@/lib/types'
import { FORMATIONS, formationsForSize, OEFENING_CATEGORIES } from '@/lib/types'
import { formatiesVoorTeam, VALID_TEAM_SIZES } from '@/lib/formaties'
import OefeningEditor from '@/components/OefeningEditor'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createOefening, updateOefening } from '@/app/actions/oefening-library'

// ── Gedeelde Supabase-mock, zelfde patroon als de bestaande action-/acceptatietests. ──
type TableResult = { data?: unknown; error?: unknown; count?: number }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  const calls = {
    insert: [] as { table: string; payload: Record<string, unknown> }[],
    update: [] as { table: string; payload: Record<string, unknown> }[],
  }
  function chain(table: string) {
    const result = tables[table] ?? { data: [], error: null }
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'gt', 'lt', 'gte', 'lte', 'in', 'order', 'limit', 'neq', 'eq']) {
      c[m] = () => c
    }
    c.insert = (payload: Record<string, unknown>) => { calls.insert.push({ table, payload }); return c }
    c.update = (payload: Record<string, unknown>) => { calls.update.push({ table, payload }); return c }
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }
  const supabase = {
    from: (t: string) => chain(t),
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

function makeOefening(overrides: Partial<Oefening> = {}): Oefening {
  return {
    id: 'o1',
    team_id: 'team-1',
    naam: 'Rondo',
    beschrijving: null,
    categorie: 'partijen_klein',
    duur_min: null,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderEditor(overrides: Partial<Parameters<typeof OefeningEditor>[0]> = {}) {
  const onSubmit = vi.fn<(input: OefeningInput) => Promise<void>>().mockResolvedValue(undefined)
  const onCancel = vi.fn()
  render(
    <DictProvider dict={nl}>
      <OefeningEditor onCancel={onCancel} onSubmit={onSubmit} {...overrides} />
    </DictProvider>,
  )
  return { onSubmit, onCancel }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════
// AC1 — Catalogus-generatie: grootte 3-10 + categorie → gegenereerde lijst
// (geen curated lijst meer).
// ════════════════════════════════════════════════════════════════════════
describe('AC1 — editor toont de gegenereerde catalogus, niet de oude curated lijst', () => {
  it('grootte 7 + partijen_groot toont 9 gegenereerde opties, tegenover slechts 2 in de oude curated lijst', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const labels = within(group).getAllByRole('button').map((b) => b.textContent)

    const gegenereerd = formatiesVoorTeam({ grootte: 7, keeperInGrootte: true }, 'partijen_groot').map((f) => f.label)
    expect(labels).toEqual(gegenereerd)
    expect(labels.length).toBe(9)
    // Bewijs dat het niet meer de oude curated lijst is: die had voor een 7-tal
    // maar 2 opties ('2-3-1' en '3-2-1').
    expect(formationsForSize(7).map((f) => f.label)).toEqual(['2-3-1', '3-2-1'])
    expect(labels.length).toBeGreaterThan(formationsForSize(7).length)
  })

  it('werkt over het hele bereik 3-10 (elke grootte levert exact de gegenereerde opties van de generator)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    const sizeSelect = screen.getAllByLabelText(nl.oefeningen.teamSize)[0]

    for (const grootte of [3, 5, 8, 10]) {
      fireEvent.change(sizeSelect, { target: { value: String(grootte) } })
      const group = screen.getByRole('group', { name: nl.oefeningen.formation })
      const labels = within(group).getAllByRole('button').map((b) => b.textContent)
      const gegenereerd = formatiesVoorTeam({ grootte, keeperInGrootte: true }, 'partijen_klein').map((f) => f.label)
      expect(labels, `grootte ${grootte}`).toEqual(gegenereerd)
      expect(gegenereerd.length, `grootte ${grootte}`).toBeGreaterThan(0)
    }
    // De onderliggende V<=5/M<=5/A<=3/som=N-eigenschappen van elke optie zijn al
    // exhaustief unit-getest in lib/formaties.test.ts ("genereerFormaties — constraints").
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC2/AC3/AC16 — Single-select: precies 1 item, vervangen i.p.v. toevoegen,
// nogmaals aanklikken maakt leeg, geen "alles selecteren".
// ════════════════════════════════════════════════════════════════════════
describe('AC2/AC3 — single-select gedrag', () => {
  it('AC2: één formatie aanklikken selecteert exact die ene (formaties = [key])', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel' } })

    fireEvent.click(screen.getByRole('button', { name: '3-1-2' }))
    expect(screen.getByRole('button', { name: '3-1-2' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 7, formaties: ['3-1-2'], keeperInGrootte: true }])
  })

  it('AC3: een andere formatie aanklikken vervangt de vorige (nooit >1 tegelijk actief)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })

    fireEvent.click(within(group).getByRole('button', { name: '3-1-2' }))
    fireEvent.click(within(group).getByRole('button', { name: '4-1-1' }))
    expect(within(group).getByRole('button', { name: '3-1-2' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: '4-1-1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  it('AC3: de actieve chip nogmaals aanklikken maakt de selectie leeg (formaties = [])', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Positiespel' } })

    fireEvent.click(screen.getByRole('button', { name: '4-1-1' }))
    fireEvent.click(screen.getByRole('button', { name: '4-1-1' }))
    expect(screen.getByRole('button', { name: '4-1-1' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 7, formaties: [], keeperInGrootte: true }])
  })

  it('AC3: er is geen "alles selecteren"-knop en geen multi-toggle meer', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    expect(screen.queryByText('Alles selecteren')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /alles/i })).not.toBeInTheDocument()
  })
})

describe('AC16 — `formaties` bevat nooit meer dan 1 item, ook niet tijdens meerdere kliks', () => {
  it('meerdere chips na elkaar aanklikken: op elk moment hooguit 1 actief', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '7' } })
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const buttons = within(group).getAllByRole('button')

    const pressedCount = () => within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').length
    for (const b of buttons) {
      fireEvent.click(b)
      expect(pressedCount()).toBeLessThanOrEqual(1)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC4 — Teamgrootte 11: bestaande curated lijst blijft ongewijzigd; generator
// niet gebruikt; keeper-schakelaar niet zichtbaar.
// ════════════════════════════════════════════════════════════════════════
describe('AC4 — grootte 11 blijft de bestaande, categorie-onafhankelijke curated lijst gebruiken', () => {
  it('toont exact formationsForSize(11) en negeert categoriewissel; geen keeper-schakelaar', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '11' } })

    // Het criterium is "exact de gecureerde FORMATIONS-lijst, niet de
    // generator". Dat stond hier als letterlijke vijftal; die lijst is
    // inmiddels naar 15 formaties gegroeid en zou bij elke uitbreiding rotten
    // zonder dat het criterium verandert. Nu relationeel vastgelegd, met een
    // spotcheck die de generator per definitie niet kan halen: die produceert
    // uitsluitend "V-M-A"-keys (lib/formaties.ts, formatieKey), dus een
    // variantnaam met een achtervoegsel bewijst dat de curated lijst wint.
    const verwacht = formationsForSize(11).map((f) => f.label)
    expect(verwacht).toEqual(
      Object.values(FORMATIONS).map((f) => f.label).sort((a, b) => a.localeCompare(b, 'nl')),
    )
    expect(verwacht).toContain('4-3-3 (controleur)')

    let group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(verwacht)
    expect(screen.queryByRole('group', { name: nl.oefeningen.keeperLabel })).not.toBeInTheDocument()

    // Categorie wisselen verandert bij een 11-tal niets — de generator (die wél
    // categorie-afhankelijk is) wordt hier niet gebruikt.
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(verwacht)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC5/AC6 — Linie-nul-regel: partijen_groot eist V>=1,M>=1,A>=1; elke andere
// categorie staat een lege linie toe VOOR MIDDENVELD OF AANVAL.
//
// AC6 HERZIEN (bevestigd door de product-eigenaar op 2026-08-06, GEEN bug,
// lib/formaties.ts blijft ongewijzigd): de oorspronkelijke tekst "elke linie
// mag 0 zijn, ook verdediging" was te breed. In de praktijk komt een
// gegenereerde formatie met 0 verdedigers nooit voor: de tie-break in
// lib/formaties.ts (`beterDan`) laat bij een botsend label altijd de meeste
// verdedigers winnen, en omdat MAX_VERDEDIGERS (5) nooit kleiner is dan
// MAX_MIDDENVELDERS (5) of MAX_AANVALLERS (3), heeft elke v=0-kandidaat altijd
// een v>0-alternatief met hetzelfde label dat de tie-break wint. Dit is
// bevestigd, bewust gedrag — geen toevallige afwezigheid maar een structureel
// gevolg van de tie-break-regel die de product-eigenaar wil behouden. De
// herziene AC6-tekst luidt daarom: "Elke andere categorie dan `partijen_groot`
// → middenveld of aanval mag 0 zijn. Verdediging is, als gevolg van de
// tie-break-regel bij botsende labels, in de praktijk nooit 0 — dit is
// bevestigd, geaccepteerd gedrag, geen bug."
// ════════════════════════════════════════════════════════════════════════
describe('AC5/AC6 — categorie-afhankelijke linie-nul-regel (AC6 herzien)', () => {
  it('AC5: partijen_groot biedt GEEN formatie met een lege linie aan; partijen_klein wel (concreet: label "1-4", aanval=0)', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })

    // Standaardcategorie is partijen_groot.
    let group = screen.getByRole('group', { name: nl.oefeningen.formation })
    let labels = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(labels).not.toContain('1-4')
    // Elke aangeboden optie heeft alle drie de linies gevuld (3 segmenten).
    expect(labels.every((l) => (l ?? '').split('-').length === 3)).toBe(true)

    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    group = screen.getByRole('group', { name: nl.oefeningen.formation })
    labels = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('1-4')
  })

  it('AC6a: middenveld mag 0 zijn buiten partijen_groot — concreet aanwezig: "4-1" (key 4-0-1, m=0) bij grootte 6/overig/inclusief keeper', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })

    // De chip-groep toont exact formatiesVoorTeam(...) (zie AC1) — dit is dus
    // ook wat de gebruiker daadwerkelijk te zien/kiezen krijgt.
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(screen.getByRole('button', { name: '4-1' })).toBeInTheDocument()
    const zonderMiddenvelder = formatiesVoorTeam({ grootte: 6, keeperInGrootte: true }, 'overig')
      .filter((f) => Number(f.key.split('-')[1]) === 0)
    expect(zonderMiddenvelder.map((f) => f.key)).toContain('4-0-1')
    expect(within(group).getByRole('button', { name: '4-1' })).toHaveTextContent('4-1')
  })

  it('AC6b: aanval mag 0 zijn buiten partijen_groot — concreet aanwezig: "1-4" (key 1-4-0, a=0) bij grootte 6/overig/inclusief keeper', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).getByRole('button', { name: '1-4' })).toBeInTheDocument()
    const zonderAanvaller = formatiesVoorTeam({ grootte: 6, keeperInGrootte: true }, 'overig')
      .filter((f) => Number(f.key.split('-')[2]) === 0)
    expect(zonderAanvaller.map((f) => f.key)).toContain('1-4-0')
  })

  it('AC6c: verdediging is structureel NOOIT 0 — bevestigd gedrag, gecontroleerd over alle groottes (excl. het curated 11-tal, dat de generator niet gebruikt), beide keeper-standen en alle categorieën', () => {
    // Grootte 11 gebruikt de bestaande gecureerde lijst (formationsForSize), niet
    // de generator met de tie-break-regel (zie AC4) — buiten scope van deze regel.
    const generatorGroottes = VALID_TEAM_SIZES.filter((g) => g !== 11)
    expect(generatorGroottes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    const vNulGevallen: string[] = []
    for (const grootte of generatorGroottes) {
      for (const keeperInGrootte of [true, false]) {
        for (const categorie of OEFENING_CATEGORIES) {
          for (const f of formatiesVoorTeam({ grootte, keeperInGrootte }, categorie)) {
            const v = Number(f.key.split('-')[0])
            if (v === 0) vNulGevallen.push(`grootte=${grootte} keeper=${keeperInGrootte} categorie=${categorie} key=${f.key}`)
          }
        }
      }
    }
    // Dit is geen "toevallig geen edge case gevonden" maar de expliciete,
    // bewuste vastlegging: er bestaat GEEN combinatie binnen het geldige bereik
    // die een formatie met 0 verdedigers oplevert.
    expect(vNulGevallen, `verwacht 0 gevallen met v=0, gevonden: ${vNulGevallen.join('; ')}`).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC7/AC8/AC9/AC12 — Keeper-schakelaar per team + keeper-marker-regel.
// ════════════════════════════════════════════════════════════════════════
describe('AC7/AC8/AC9/AC12 — keeper-schakelaar per team, en marker-totaal is altijd exact `grootte`', () => {
  it('inclusief keeper: N=grootte-1 veldspelers + losse K-marker; exclusief: N=grootte veldspelers, geen K; teams onafhankelijk', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    const sizeSelects = screen.getAllByLabelText(nl.oefeningen.teamSize)
    fireEvent.change(sizeSelects[0], { target: { value: '6' } })
    fireEvent.change(sizeSelects[1], { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })

    // Team A: default inclusief keeper → catalogus voor N=5 veldspelers.
    let formationGroups = screen.getAllByRole('group', { name: nl.oefeningen.formation })
    fireEvent.click(within(formationGroups[0]).getByRole('button', { name: '3-2' }))

    let fields = screen.getAllByTestId('formation-field')
    expect(fields).toHaveLength(1)
    let markersA = within(fields[0]).getAllByTestId('formation-marker')
    // AC12: totaal = grootte (6), ongeacht keeper-stand.
    expect(markersA).toHaveLength(6)
    // AC7: N veldspelers = grootte - 1 = 5, plus 1 aparte K-marker.
    expect(markersA.filter((m) => m.textContent === 'K')).toHaveLength(1)
    expect(markersA.filter((m) => m.textContent === '')).toHaveLength(5)

    // Team B: naar exclusief keeper → catalogus voor N=6 veldspelers.
    const keeperGroups = screen.getAllByRole('group', { name: nl.oefeningen.keeperLabel })
    fireEvent.click(within(keeperGroups[1]).getByRole('button', { name: nl.oefeningen.keeperExcluded }))
    formationGroups = screen.getAllByRole('group', { name: nl.oefeningen.formation })
    fireEvent.click(within(formationGroups[1]).getByRole('button', { name: '2-2-2' }))

    fields = screen.getAllByTestId('formation-field')
    expect(fields).toHaveLength(2)
    const markersB = within(fields[1]).getAllByTestId('formation-marker')
    // AC12: totaal blijft grootte (6).
    expect(markersB).toHaveLength(6)
    // AC8: exclusief keeper → GEEN K-marker, N = grootte = 6 veldspelers.
    expect(markersB.filter((m) => m.textContent === 'K')).toHaveLength(0)
    expect(markersB.filter((m) => m.textContent === '')).toHaveLength(6)

    // AC9: team A is door de wijziging aan team B niet geraakt.
    expect(within(keeperGroups[0]).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')
    markersA = within(screen.getAllByTestId('formation-field')[0]).getAllByTestId('formation-marker')
    expect(markersA).toHaveLength(6)
    expect(markersA.filter((m) => m.textContent === 'K')).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC10/AC18 — Selectie wordt automatisch (stilzwijgend) leeggemaakt wanneer
// keeper-schakelaar of categorie wijzigt en de eerdere keuze niet meer past.
// ════════════════════════════════════════════════════════════════════════
describe('AC10/AC18 — keeper-schakelaar of categorie wijzigen na een keuze maakt een niet-passende selectie stil leeg', () => {
  it('AC10: keeper-schakelaar wisselen regenereert de catalogus en maakt een niet-passende keuze leeg', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })

    fireEvent.click(screen.getByRole('button', { name: '3-2' }))
    expect(screen.getByRole('button', { name: '3-2' })).toHaveAttribute('aria-pressed', 'true')

    // '3-2' (key 3-0-2) bestaat alleen in de inclusief-keeper-catalogus (N=5),
    // niet in de exclusief-keeper-catalogus (N=6) van grootte 6.
    expect(formatiesVoorTeam({ grootte: 6, keeperInGrootte: false }, 'partijen_klein').some((f) => f.key === '3-0-2')).toBe(false)

    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    fireEvent.click(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded }))

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).queryByRole('button', { name: '3-2' })).not.toBeInTheDocument()
    within(group).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
    // Geen foutmelding — de leegmaak gebeurt stilzwijgend, niet als weigering.
    expect(screen.queryByText(nl.oefeningen.genericError)).not.toBeInTheDocument()
  })

  it('AC18: categoriewissel maakt een selectie leeg die niet meer bij de nieuwe categorie past', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'overig' } })
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })

    fireEvent.click(screen.getByRole('button', { name: '1-4' }))
    expect(screen.getByRole('button', { name: '1-4' })).toHaveAttribute('aria-pressed', 'true')

    // partijen_groot staat geen lege linie toe — '1-4' bestaat daar niet.
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_groot' } })
    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    expect(within(group).queryByRole('button', { name: '1-4' })).not.toBeInTheDocument()
    within(group).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'false'))
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC11 — Default voor bestaande, al opgeslagen teams zonder keeperInGrootte:
// "inclusief keeper".
// ════════════════════════════════════════════════════════════════════════
describe('AC11 — bestaande teams zonder keeperInGrootte-veld tonen "Inclusief keeper" als default', () => {
  it('team zonder keeperInGrootte in de opgeslagen data → schakelaar staat op inclusief', () => {
    const existing = makeOefening({
      categorie: 'partijen_klein',
      teams: [{ grootte: 7, formaties: [] }],
    })
    render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={existing} onCancel={vi.fn()} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    const keeperGroup = screen.getByRole('group', { name: nl.oefeningen.keeperLabel })
    expect(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperIncluded })).toHaveAttribute('aria-pressed', 'true')
    expect(within(keeperGroup).getByRole('button', { name: nl.oefeningen.keeperExcluded })).toHaveAttribute('aria-pressed', 'false')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC13/AC14 — Labelvorming (lege linies weggelaten) + label-uniciteit.
// ════════════════════════════════════════════════════════════════════════
describe('AC13/AC14 — labelvorming en label-uniciteit', () => {
  it('een botsend label ("0V+2M+3A" en "2V+0M+3A", beide "2-3") verschijnt precies één keer, zonder leidende nul', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo' } })

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const labels = within(group).getAllByRole('button').map((b) => b.textContent)
    // AC13: geen enkel label bevat een leidende/losse nul zoals "0-2-3".
    expect(labels.every((l) => (l ?? '').split('-').every((deel) => Number(deel) > 0))).toBe(true)
    // AC14: het botsende label "2-3" staat precies één keer in de lijst.
    expect(within(group).getAllByRole('button', { name: '2-3' })).toHaveLength(1)
  })

  it('bewijst dat de opgeslagen key bij het botsende label "2-3" de tie-break-winnaar is (2-0-3)', async () => {
    const { onSubmit } = renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    fireEvent.change(screen.getByLabelText(`${nl.trainingPlan.exerciseName} *`), { target: { value: 'Rondo' } })

    fireEvent.click(screen.getByRole('button', { name: '2-3' }))
    fireEvent.click(screen.getByText(nl.trainingPlan.save))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 6, formaties: ['2-0-3'], keeperInGrootte: true }])
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC15 — Tactiekdiagram toont geen V/M/A-tekstlabel; de keeper (K) blijft wel
// apart gelabeld, alleen als hij getekend wordt.
// ════════════════════════════════════════════════════════════════════════
describe('AC15 — geen V/M/A-tekstlabel op de posities, alleen de keeper (indien getekend) blijft gelabeld', () => {
  it('elke veldspelermarker heeft een lege position_label; alleen de K-marker (indien aanwezig) heeft tekst', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(nl.trainingPlan.category), { target: { value: 'partijen_klein' } })
    fireEvent.click(screen.getByRole('button', { name: '2-2-1' }))

    const field = screen.getByTestId('formation-field')
    const markers = within(field).getAllByTestId('formation-marker')
    const teksten = markers.map((m) => m.textContent)
    expect(teksten.filter((t) => t !== '' && t !== 'K')).toEqual([])
    expect(teksten.filter((t) => t === 'K')).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC17 — Dual-read: bestaande productie-oefening met een team met 2
// formatie-items (oude multi-select) → getoond zonder crash/dataverlies; het
// alfabetisch-eerste item blijft leidend.
// ════════════════════════════════════════════════════════════════════════
describe('AC17 — legacy team met 2 formatie-items (oude multi-select-data) wordt zonder crash getoond', () => {
  it('render crasht niet, en het diagram gebruikt het alfabetisch-eerste item ("2-3", key 2-0-3) als leidend', () => {
    const existing = makeOefening({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2', '2-0-3'], keeperInGrootte: true }],
    })
    render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={existing} onCancel={vi.fn()} onSubmit={vi.fn().mockResolvedValue(undefined)} />
      </DictProvider>,
    )
    // Geen crash (render is hier al geslaagd). Het diagram toont het
    // alfabetisch-eerste catalogus-item dat in de selectie voorkomt: "2-3".
    expect(screen.getByText('6 · 2-3')).toBeInTheDocument()
    const field = screen.getByTestId('formation-field')
    const markers = within(field).getAllByTestId('formation-marker')
    expect(markers).toHaveLength(6)
    expect(markers.filter((m) => m.textContent === 'K')).toHaveLength(1)
  })

  // Regressietest voor een validator-bug: `teamsToRows` filterde legacy
  // multi-select-data (bv. `formaties: ['3-0-2', '2-0-3']`) alleen op
  // geldigheid, niet op aantal. Beide items bleven dus als "geselecteerd"
  // in de lokale state staan (2 chips op aria-pressed="true"), en bij
  // ongewijzigd opslaan stuurde de editor beide items door — de server
  // weigerde terecht met de AC22-melding, waardoor een trainer die alleen
  // bv. de naam wilde wijzigen eerst gedwongen werd zelf een formatie-chip
  // aan te klikken. Nu wordt de legacy-selectie bij het inladen al
  // teruggebracht tot het alfabetisch-eerste item (zelfde principe als
  // basisFormatieDef), dus is er precies 1 chip geselecteerd en lukt
  // ongewijzigd opslaan gewoon.
  it('legacy team met 2 formatie-items: precies 1 chip is geselecteerd, en ongewijzigd opslaan slaagt', async () => {
    const existing = makeOefening({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2', '2-0-3'], keeperInGrootte: true }],
    })
    const onSubmit = vi.fn().mockImplementation(async (input: OefeningInput) => validateOefening(input))
    render(
      <DictProvider dict={nl}>
        <OefeningEditor initial={existing} onCancel={vi.fn()} onSubmit={onSubmit} />
      </DictProvider>,
    )

    const group = screen.getByRole('group', { name: nl.oefeningen.formation })
    const pressed = within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toHaveTextContent('2-3')

    fireEvent.click(screen.getByText(nl.trainingPlan.save))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].teams).toEqual([{ grootte: 6, formaties: ['2-0-3'], keeperInGrootte: true }])
    expect(screen.queryByText('Maximaal één formatie per team')).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC19 — Lege catalogus (partijen_groot + grootte 3 + inclusief keeper):
// disabled/lege-staat, geen crash, geen onzichtbaar veld.
// ════════════════════════════════════════════════════════════════════════
describe('AC19 — lege catalogus toont een disabled-status, geen crash en geen onzichtbaar veld', () => {
  it('partijen_groot + grootte 3 + inclusief keeper: geen chip-groep, wel een zichtbare disabled-status', () => {
    renderEditor()
    fireEvent.click(screen.getByText(nl.oefeningen.addTeam))
    fireEvent.change(screen.getAllByLabelText(nl.oefeningen.teamSize)[0], { target: { value: '3' } })
    // Standaardcategorie is al partijen_groot; catalogus is hier leeg (N=2, min V/M/A=1 onhaalbaar).
    expect(formatiesVoorTeam({ grootte: 3, keeperInGrootte: true }, 'partijen_groot')).toHaveLength(0)

    expect(screen.queryByRole('group', { name: nl.oefeningen.formation })).not.toBeInTheDocument()
    const status = screen.getByTestId('geen-formaties-0')
    expect(status).toHaveTextContent(nl.oefeningen.noFormationsAvailable)
    expect(status).toHaveAttribute('aria-disabled', 'true')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC20 — Teamgrootte buiten 1-11 geweigerd (1, 2 en 10 zijn geldig; 0 en 12 nooit).
// ════════════════════════════════════════════════════════════════════════
describe('AC20 — teamgrootte moet binnen 1-11 vallen', () => {
  it('grootte 0 en grootte 12 worden geweigerd met "Ongeldige teamgrootte"', async () => {
    for (const grootte of [0, 12]) {
      use(makeSupabase())
      await expect(createOefening(baseInput({ teams: [{ grootte, formaties: [] }] })))
        .rejects.toThrow('Ongeldige teamgrootte')
    }
  })

  it('grootte 1 en grootte 2 zijn geldig (kleine oefenvormen als 1v1/2v2)', async () => {
    for (const grootte of [1, 2]) {
      const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
      use(m)
      await expect(createOefening(baseInput({ teams: [{ grootte, formaties: [] }] })))
        .resolves.toEqual({ id: 'x' })
      expect(m.calls.insert[0].payload.teams).toEqual([
        { grootte, formaties: [], keeperInGrootte: true },
      ])
    }
  })

  it('grootte 10 is nu wél geldig', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(m)
    await expect(createOefening(baseInput({ teams: [{ grootte: 10, formaties: ['4-4-1'] }] })))
      .resolves.toEqual({ id: 'x' })
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC21 — Formatie-key die niet in de catalogus van de HUIDIGE grootte/
// categorie/keeper-instelling voorkomt → geweigerd (categorie-afhankelijk).
// ════════════════════════════════════════════════════════════════════════
describe('AC21 — een formatie-key die niet bij de huidige categorie hoort wordt geweigerd', () => {
  it('"3-0-2" is geldig bij partijen_klein maar wordt voor hetzelfde grootte-6-team geweigerd bij partijen_groot', async () => {
    const ok = makeSupabase({ tables: { oefeningen: { data: { id: 'x' }, error: null } } })
    use(ok)
    await expect(createOefening(baseInput({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2'] }],
    }))).resolves.toEqual({ id: 'x' })

    use(makeSupabase())
    await expect(createOefening(baseInput({
      categorie: 'partijen_groot',
      teams: [{ grootte: 6, formaties: ['3-0-2'] }],
    }))).rejects.toThrow('Formatie past niet bij teamgrootte')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC22 — Save met >1 item in `formaties` geweigerd met exacte melding.
// ════════════════════════════════════════════════════════════════════════
describe('AC22 — save met meer dan 1 formatie-item per team wordt geweigerd', () => {
  it('geeft exact "Maximaal één formatie per team"', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({
      categorie: 'partijen_klein',
      teams: [{ grootte: 6, formaties: ['3-0-2', '2-0-3'] }],
    }))).rejects.toThrow('Maximaal één formatie per team')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC23 — Oefening zonder geldige categorie geweigerd (bestaand gedrag).
// ════════════════════════════════════════════════════════════════════════
describe('AC23 — oefening zonder geldige categorie wordt geweigerd', () => {
  it('onbekende categorie geeft "Ongeldige categorie"', async () => {
    use(makeSupabase())
    await expect(createOefening(baseInput({ categorie: 'onzin' as OefeningCategorie })))
      .rejects.toThrow('Ongeldige categorie')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Tenant-isolatie (ongewijzigd) — assertOwnOefening.
// ════════════════════════════════════════════════════════════════════════
describe('Tenant-isolatie — assertOwnOefening blijft gelden voor deze feature', () => {
  it('updateOefening op andermans oefening-id → "Oefening niet gevonden", geen update uitgevoerd', async () => {
    const m = makeSupabase({ tables: { oefeningen: { data: null } } })
    use(m)
    await expect(updateOefening('andermans-id', baseInput({
      teams: [{ grootte: 6, formaties: ['2-0-3'] }],
    }))).rejects.toThrow('Oefening niet gevonden')
    expect(m.calls.update).toHaveLength(0)
  })
})
