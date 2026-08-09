// Acceptatietests — Wedstrijdselectie-PDF, vervolgronde (user story: clublogo
// in de export-kop, thuis/uit + verzamel-/aftraptijd, "SELECTIE"-sectie met
// aantal, vorm-blok van de laatste 5 afgeronde wedstrijden, en een driedelige
// footer — zie de goedgekeurde technische brief).
//
// Testmethode: rendert MatchSquadPrintList (en voor de live-update-test ook
// MatchSquadEditor) rechtstreeks met RTL — zelfde precedent en print-proxy-
// aanpak (jsdom past geen @media print toe) als wedstrijdselectie.acceptance
// .test.tsx. De vorm-query/tenant-scoping zelf (app/events/[id]/squad/page
// .tsx) wordt niet hier herhaald — dat is gedekt door lib/match-form.test.ts
// (toMatchFormItems) en het API-contract van de backend-engineer; dit bestand
// bewijst uitsluitend de PRESENTATIE van wat de pagina doorgeeft.

import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import type { Dict } from '@/messages/nl'
import { FORMATIONS } from '@/lib/types'
import type { Player } from '@/lib/types'
import type { MatchFormItem } from '@/lib/match-form'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'
import MatchSquadEditor from '@/components/MatchSquadEditor'

vi.mock('@/app/actions/match-squad', () => ({
  toggleSquadPlayer: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/events', () => ({
  updateGatherTime: vi.fn(),
}))

import { updateGatherTime } from '@/app/actions/events'
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
    rating: 5,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const basePlayers: Player[] = [makePlayer()]

function formItem(overrides: Partial<MatchFormItem> = {}): MatchFormItem {
  return {
    id: 'm1',
    result: 'win',
    goalsFor: 2,
    goalsAgainst: 1,
    opponent: 'FC X',
    date: '2026-08-01',
    ...overrides,
  }
}

function getPrintBlock(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.hidden.print\\:block')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

function renderPrintList(overrides: Partial<Parameters<typeof MatchSquadPrintList>[0]> = {}, dict: Dict = nl) {
  const players = overrides.players ?? basePlayers
  return render(
    <DictProvider dict={dict}>
      <MatchSquadPrintList
        players={players}
        opponent={'opponent' in overrides ? overrides.opponent ?? null : 'FC Rivalen'}
        dateLabel={overrides.dateLabel ?? 'zondag 9 augustus 2026'}
        teamName={'teamName' in overrides ? overrides.teamName ?? null : 'FC Voorbeeld'}
        teamLogoUrl={'teamLogoUrl' in overrides ? overrides.teamLogoUrl ?? null : null}
        homeAway={'homeAway' in overrides ? overrides.homeAway ?? null : 'home'}
        gatherTime={'gatherTime' in overrides ? overrides.gatherTime ?? null : '17:30'}
        kickoffTime={'kickoffTime' in overrides ? overrides.kickoffTime ?? null : '19:00'}
        selectedCount={overrides.selectedCount ?? players.length}
        formItems={overrides.formItems ?? []}
      />
    </DictProvider>,
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Kop: logo (alleen als aanwezig) + teamnaam + "WEDSTRIJDSELECTIE"
// ═══════════════════════════════════════════════════════════════════════
describe('Kop — logo (indien aanwezig) + teamnaam + exportTitle', () => {
  it('met teamLogoUrl: toont een <img> met die src, de teamnaam en t.matchSquad.exportTitle', () => {
    const { container } = renderPrintList({ teamLogoUrl: 'https://cdn.example.com/logo.png?v=1', teamName: 'FC Voorbeeld' })
    const block = getPrintBlock(container)
    const img = block.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('https://cdn.example.com/logo.png?v=1')
    // "FC Voorbeeld" komt ook in de footer voor (zie de aparte footer-test
    // hieronder) — getAllByText i.p.v. getByText.
    expect(within(block).getAllByText('FC Voorbeeld').length).toBeGreaterThanOrEqual(1)
    expect(within(block).getByText(nl.matchSquad.exportTitle)).toBeInTheDocument()
  })

  it('zonder teamLogoUrl: GEEN <img> en geen placeholder-icoon in de kop, teamnaam blijft staan', () => {
    const { container } = renderPrintList({ teamLogoUrl: null, teamName: 'FC Voorbeeld' })
    const block = getPrintBlock(container)
    expect(block.querySelector('img')).toBeNull()
    expect(within(block).getAllByText('FC Voorbeeld').length).toBeGreaterThanOrEqual(1)
  })

  it('zonder teamName: geen crash, exportTitle blijft staan', () => {
    const { container } = renderPrintList({ teamName: null, teamLogoUrl: null })
    const block = getPrintBlock(container)
    expect(within(block).getByText(nl.matchSquad.exportTitle)).toBeInTheDocument()
  })

  // Story-AC2 (Deel A) — hetzelfde gedeelde TeamLogo-component als de zijbalk
  // (components/TeamLogo.tsx) moet ook in de PDF-kop in een vast kader met
  // object-contain staan (nooit uitrekken/bijsnijden). clublogo.acceptance
  // .test.tsx bewijst dit alleen voor de AppShell-instantie van TeamLogo —
  // deze test bewijst het expliciet voor de PDF-export-instantie zelf.
  it('het logo in de PDF-kop gebruikt object-contain binnen een vast kader (zelfde garantie als de zijbalk)', () => {
    const { container } = renderPrintList({ teamLogoUrl: 'https://cdn.example.com/logo.png?v=1' })
    const block = getPrintBlock(container)
    const img = block.querySelector('img') as HTMLImageElement
    expect(img.className).toContain('object-contain')
    const frame = img.parentElement as HTMLElement
    expect(frame.style.width).toBe('40px')
    expect(frame.style.height).toBe('40px')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Datumregel + thuis/uit
// ═══════════════════════════════════════════════════════════════════════
describe('Datumregel — dagnaam+datum + thuis/uit-label', () => {
  it('homeAway="home" → toont t.calendar.homeLabel', () => {
    const { container } = renderPrintList({ homeAway: 'home' })
    const block = getPrintBlock(container)
    expect(within(block).getByText(nl.calendar.homeLabel, { exact: false })).toBeInTheDocument()
  })

  it('homeAway="away" → toont t.calendar.awayLabel', () => {
    const { container } = renderPrintList({ homeAway: 'away' })
    const block = getPrintBlock(container)
    expect(within(block).getByText(nl.calendar.awayLabel, { exact: false })).toBeInTheDocument()
  })

  it('homeAway=null → geen thuis/uit-label, maar de datum blijft staan', () => {
    const { container } = renderPrintList({ homeAway: null })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toContain(nl.calendar.homeLabel)
    expect(block.textContent).not.toContain(nl.calendar.awayLabel)
    expect(block.textContent).toContain('zondag 9 augustus 2026')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Verzameltijd + aftraptijd naast elkaar; ontbrekende tijd weggelaten
// ═══════════════════════════════════════════════════════════════════════
describe('Verzamel- en aftraptijd', () => {
  // BEWUSTE AANPASSING (frontend-fix, visuele opmaak): het tijden-blok toont
  // label + cijfer sinds deze ronde als twee gestapelde regels per kolom
  // (zie het ontwerp in de technische brief), niet langer als platte tekst in
  // één <p>. De onderliggende garantie — bij twee tijden staan beide labels
  // én beide tijden samen in hetzelfde tijden-blok — blijft hier intact, nu
  // gescoped op de blok-container in plaats van op één <p>-element.
  it('beide aanwezig: beide labels + tijden staan samen in hetzelfde tijden-blok', () => {
    const { container } = renderPrintList({ gatherTime: '17:30', kickoffTime: '19:00' })
    const block = getPrintBlock(container)
    const gatherLabelEl = within(block).getByText(nl.matchSquad.gatherTimeLabel)
    // De blok-container is de gemeenschappelijke voorouder van beide kolommen
    // (label+cijfer per tijd) — twee niveaus boven het label zelf (kolom → blok).
    const timesBlock = gatherLabelEl.parentElement!.parentElement as HTMLElement
    expect(timesBlock.textContent).toContain(nl.matchSquad.gatherTimeLabel)
    expect(timesBlock.textContent).toContain('17:30')
    expect(timesBlock.textContent).toContain(nl.matchSquad.kickoffTimeLabel)
    expect(timesBlock.textContent).toContain('19:00')
  })

  it('alleen verzameltijd: de aftraptijd-regel/kolom wordt stilzwijgend weggelaten (geen "onbekend")', () => {
    const { container } = renderPrintList({ gatherTime: '17:30', kickoffTime: null })
    const block = getPrintBlock(container)
    expect(block.textContent).toContain(nl.matchSquad.gatherTimeLabel)
    expect(block.textContent).toContain('17:30')
    expect(block.textContent).not.toContain(nl.matchSquad.kickoffTimeLabel)
  })

  it('alleen aftraptijd: de verzameltijd-regel wordt stilzwijgend weggelaten', () => {
    const { container } = renderPrintList({ gatherTime: null, kickoffTime: '19:00' })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toContain(nl.matchSquad.gatherTimeLabel)
    expect(block.textContent).toContain(nl.matchSquad.kickoffTimeLabel)
    expect(block.textContent).toContain('19:00')
  })

  it('beide leeg: de hele tijdregel verdwijnt (geen van beide labels)', () => {
    const { container } = renderPrintList({ gatherTime: null, kickoffTime: null })
    const block = getPrintBlock(container)
    expect(block.textContent).not.toContain(nl.matchSquad.gatherTimeLabel)
    expect(block.textContent).not.toContain(nl.matchSquad.kickoffTimeLabel)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Sectiekop "SELECTIE" + aantal + "OPGEROEPEN"
// ═══════════════════════════════════════════════════════════════════════
describe('Sectiekop SELECTIE — aantal + statisch "OPGEROEPEN"-label, geen tweede statistiek', () => {
  it('toont t.matchSquad.sectionSelection, het aantal en t.matchSquad.calledUpLabel', () => {
    const { container } = renderPrintList({ selectedCount: 7 })
    const block = getPrintBlock(container)
    expect(block.textContent).toContain(nl.matchSquad.sectionSelection)
    expect(block.textContent).toContain('7')
    expect(block.textContent).toContain(nl.matchSquad.calledUpLabel)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Vorm-blok: 0, 1-4 en 5 items — nooit verborgen
// ═══════════════════════════════════════════════════════════════════════
describe('Vorm-blok — toont zoveel kaartjes als er items zijn, blok nooit verborgen', () => {
  it('0 items: het blok (heading) blijft staan, geen kaartjes', () => {
    const { container } = renderPrintList({ formItems: [] })
    const block = getPrintBlock(container)
    expect(within(block).getByText(nl.matchSquad.formHeading)).toBeInTheDocument()
    expect(within(block).queryAllByText(nl.home.formLetterWin).length).toBe(0)
  })

  it('3 items (1-4): precies 3 kaartjes', () => {
    const { container } = renderPrintList({
      formItems: [
        formItem({ id: 'a', result: 'win' }),
        formItem({ id: 'b', result: 'draw' }),
        formItem({ id: 'c', result: 'loss' }),
      ],
    })
    const block = getPrintBlock(container)
    expect(within(block).getByText(nl.home.formLetterWin)).toBeInTheDocument()
    expect(within(block).getByText(nl.home.formLetterDraw)).toBeInTheDocument()
    expect(within(block).getByText(nl.home.formLetterLoss)).toBeInTheDocument()
  })

  it('5 items: precies 5 kaartjes', () => {
    const items = Array.from({ length: 5 }, (_, i) => formItem({ id: `m${i}`, result: 'win' }))
    const { container } = renderPrintList({ formItems: items })
    const block = getPrintBlock(container)
    expect(within(block).getAllByText(nl.home.formLetterWin).length).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Footer: exact drie elementen (teamnaam · datum · "Gegenereerd met Pitchup"),
// geen apart wedstrijddag-label
// ═══════════════════════════════════════════════════════════════════════
describe('Footer — precies drie elementen', () => {
  it('bevat teamnaam, datum en t.matchSquad.footerGenerated, in een wrapper met precies drie children', () => {
    const { container } = renderPrintList({ teamName: 'FC Voorbeeld', dateLabel: 'zondag 9 augustus 2026' })
    const block = getPrintBlock(container)
    const generatedEl = within(block).getByText(nl.matchSquad.footerGenerated)
    const footer = generatedEl.parentElement as HTMLElement
    expect(footer.children.length).toBe(3)
    expect(footer.textContent).toContain('FC Voorbeeld')
    expect(footer.textContent).toContain('zondag 9 augustus 2026')
    expect(footer.textContent).toContain(nl.matchSquad.footerGenerated)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Live-update: een gewijzigde verzameltijd beweegt het print-blok direct mee,
// vóór de (gemockte) server action is opgelost — spiegel van AC6 in
// wedstrijdselectie.acceptance.test.tsx (live selectie-update).
// ═══════════════════════════════════════════════════════════════════════
describe('Live-update — verzameltijd-wijziging beweegt het print-blok direct mee, vóór revalidatie', () => {
  it('opslaan van een nieuwe verzameltijd toont die tijd meteen in het print-blok, ook al is de (gemockte) server action nog niet opgelost', async () => {
    let resolvePromise: () => void = () => {}
    mockUpdateGatherTime.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePromise = resolve }),
    )

    const { container } = render(
      <DictProvider dict={nl}>
        <MatchSquadEditor
          eventId="e1"
          players={basePlayers}
          initialSelectedIds={['p1']}
          presentPlayerIds={['p1']}
          hasAnyActivePlayers
          opponent="FC Rivalen"
          dateLabel="zondag 9 augustus 2026"
          teamName="FC Voorbeeld"
          teamLogoUrl={null}
          homeAway="home"
          kickoffTime="19:00"
          initialGatherTime={null}
          formItems={[]}
        />
      </DictProvider>,
    )

    let block = getPrintBlock(container)
    expect(block.textContent).not.toContain(nl.matchSquad.gatherTimeLabel)

    const input = screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel) as HTMLInputElement
    fireEvent.change(input, { target: { value: '17:45' } })
    fireEvent.click(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave }))

    // Nog vóór de server action is opgelost: het print-blok toont de nieuwe
    // verzameltijd al (optimistische state, net als de selectie zelf).
    block = getPrintBlock(container)
    expect(block.textContent).toContain(nl.matchSquad.gatherTimeLabel)
    expect(block.textContent).toContain('17:45')
    expect(mockUpdateGatherTime).toHaveBeenCalledWith('e1', '17:45')

    await act(async () => {
      resolvePromise()
      await Promise.resolve()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// i18n — alle 5 talen
// ═══════════════════════════════════════════════════════════════════════
describe('i18n — nieuwe matchSquad-sleutels in alle 5 talen', () => {
  it.each([
    ['nl', nl],
    ['en', en],
    ['de', de],
    ['fr', fr],
    ['es', es],
  ] as const)('taal "%s": kop, tijden, sectiekop en footer gebruiken de eigen dictionary', (_locale, dict) => {
    const { container } = renderPrintList({ homeAway: 'home', gatherTime: '17:30', kickoffTime: '19:00', selectedCount: 2 }, dict)
    const block = getPrintBlock(container)
    expect(within(block).getByText(dict.matchSquad.exportTitle)).toBeInTheDocument()
    expect(block.textContent).toContain(dict.calendar.homeLabel)
    expect(block.textContent).toContain(dict.matchSquad.gatherTimeLabel)
    expect(block.textContent).toContain(dict.matchSquad.kickoffTimeLabel)
    expect(block.textContent).toContain(dict.matchSquad.sectionSelection)
    expect(block.textContent).toContain(dict.matchSquad.calledUpLabel)
    expect(within(block).getByText(dict.matchSquad.footerGenerated)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Deel B — Story-AC9: GEEN aanvoerder-markering, nergens in het print-blok.
// `Player` (lib/types.ts) kent geen aanvoerder-veld, dus dit is mede een
// architecturale garantie — deze test bewijst wél expliciet, herleidbaar
// naar AC9, dat de naamlijst kaal blijft (geen "(C)"/"★"/label toegevoegd),
// ook met logo/tijden/vorm-blok allemaal gevuld.
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC9 (Deel B) — geen aanvoerder-markering', () => {
  it('de spelersnaam in het print-blok is EXACT de naam, geen toegevoegd aanvoerder-teken/label', () => {
    const players: Player[] = [
      makePlayer({ id: 'p1', name: 'Anna Appel' }),
      makePlayer({ id: 'p2', name: 'Bram Bakker' }),
    ]
    const { container } = renderPrintList({
      players,
      teamLogoUrl: 'https://cdn.example.com/logo.png?v=1',
      formItems: [formItem({ id: 'm1' })],
    })
    const block = getPrintBlock(container)
    const ul = block.querySelector('ul') as HTMLElement
    const names = within(ul).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toEqual(['Anna Appel', 'Bram Bakker'])
    // Geen van de gebruikelijke aanvoerder-notaties komt ergens in het
    // print-blok voor (kop, spelerslijst, vorm-blok of footer).
    for (const marker of ['(C)', '©', '★', 'Aanvoerder', 'Captain']) {
      expect(block.textContent).not.toContain(marker)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Deel B — Story-AC11: MatchFormCards gebruikt GEEN <ul>/<li> — ook niet met
// daadwerkelijk gevulde vorm-items (de bestaande vorm-blok-tests hierboven
// controleren alleen de zichtbare tekst, niet de DOM-structuur). Er hoort
// precies ÉÉN <ul> in het hele print-blok te blijven staan: die van de
// spelerslijst.
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC11 (Deel B) — MatchFormCards rendert geen <ul>/<li>, ook niet gevuld', () => {
  it('met 4 gevulde vorm-items: nog steeds precies één <ul> in het print-blok en geen enkel <li> hoort bij het vorm-blok', () => {
    const players: Player[] = [makePlayer({ id: 'p1', name: 'Anna Appel' })]
    const items = [
      formItem({ id: 'a', result: 'win' }),
      formItem({ id: 'b', result: 'draw' }),
      formItem({ id: 'c', result: 'loss' }),
      formItem({ id: 'd', result: 'unknown', goalsFor: null, goalsAgainst: null }),
    ]
    const { container } = renderPrintList({ players, formItems: items })
    const block = getPrintBlock(container)

    // Precies één <ul> — die van de spelerslijst (1 speler = 1 <li>).
    const uls = block.querySelectorAll('ul')
    expect(uls.length).toBe(1)
    expect(uls[0].querySelectorAll('li').length).toBe(1)

    // Het vorm-blok zelf (alles na de "VORM · LAATSTE 5"-kop) bevat geen
    // enkel <li>.
    const formHeading = within(block).getByText(nl.matchSquad.formHeading)
    const formSection = formHeading.parentElement as HTMLElement
    expect(formSection.querySelectorAll('li').length).toBe(0)
    expect(formSection.querySelectorAll('ul').length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Deel B — Story-AC12: score-getallen in de vorm-kaartjes kunnen nooit per
// ongeluk een FORMATIONS-sleutel (bv. "4-3-3") vormen door aaneenschakeling.
// ═══════════════════════════════════════════════════════════════════════
describe('Story-AC12 (Deel B) — score-notatie vormt nooit een FORMATIONS-sleutel', () => {
  it('scores worden met een dubbele punt weergegeven (bv. "4:3"), nooit met een liggend streepje', () => {
    const { container } = renderPrintList({
      formItems: [formItem({ id: 'a', goalsFor: 4, goalsAgainst: 3, opponent: 'FC X' })],
    })
    const block = getPrintBlock(container)
    expect(block.textContent).toContain('4:3')
    expect(block.textContent).not.toContain('4-3')
  })

  it('geen enkele FORMATIONS-sleutel komt voor in het print-blok, ook niet met opeenvolgende scores die er qua cijfers op lijken (4-3-3, 3-5-2, 4-4-2)', () => {
    const items = [
      formItem({ id: 'a', goalsFor: 4, goalsAgainst: 3, opponent: 'FC A', date: '2026-08-01' }),
      formItem({ id: 'b', goalsFor: 3, goalsAgainst: 5, opponent: 'FC B', date: '2026-08-02' }),
      formItem({ id: 'c', goalsFor: 2, goalsAgainst: 4, opponent: 'FC C', date: '2026-08-03' }),
      formItem({ id: 'd', goalsFor: 4, goalsAgainst: 2, opponent: 'FC D', date: '2026-08-04' }),
    ]
    const { container } = renderPrintList({ formItems: items })
    const block = getPrintBlock(container)
    for (const key of Object.keys(FORMATIONS)) {
      expect(block.textContent).not.toContain(key)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Deel B — Story-AC10: de importbeperking van MatchSquadPrintList.tsx (alleen
// `Player` uit `@/lib/types`, geen opstelling-gerelateerde types) blijft
// gehandhaafd voor ALLE nieuwe content. AC3/AC4 in wedstrijdselectie
// .acceptance.test.tsx bewijzen dit al voor de GERENDERDE tekst (geen
// FORMATIONS-sleutel/positie-afkorting/groepslabel zichtbaar) — dat toetst
// niet of de bewuste importbeperking zelf nog klopt: een import die wél
// wordt toegevoegd maar toevallig nergens in tekst terechtkomt (bv. alleen
// gebruikt voor een type-annotatie) zou door AC3/AC4 niet worden gevangen.
// Deze test leest het bronbestand rechtstreeks, zelfde precedent als het
// C1-blok (CSS-regressiebewaking) in afdrukken-trainingsplan.acceptance
// .test.tsx.
// ═══════════════════════════════════════════════════════════════════════
// Haalt ALLE named imports op die uit '@/lib/types' worden geïmporteerd —
// zowel `import type { X } from '@/lib/types'` als een gewone waarde-import
// `import { X } from '@/lib/types'` (bv. FORMATIONS, dat als WAARDE wordt
// gebruikt — bijv. Object.keys(FORMATIONS) — en dus nooit als `import type`
// zou binnenkomen). Matcht GLOBAAL (niet alleen de eerste treffer), zodat een
// TWEEDE importregel uit hetzelfde pad niet gemist wordt — vóór deze fix
// gebruikte de test `source.match(...)` zonder `/g`-vlag én alleen het
// `import type`-patroon, waardoor zowel een value-import als een tweede
// importregel onopgemerkt zou blijven (validator-bevinding, Gap 1).
function extractLibTypesImports(source: string): string[] {
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@\/lib\/types'/g
  const named: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    named.push(...match[1].split(',').map((s) => s.trim()).filter(Boolean))
  }
  return named
}

// Sanity-check van de regex-fix zelf (geen wijziging aan een echt
// bronbestand): bewijst dat extractLibTypesImports() een illegale, TWEEDE
// waarde-import uit '@/lib/types' ook daadwerkelijk oppikt, ook wanneer de
// eerste regel een `import type` is — precies het scenario dat de oude,
// niet-globale `/import\s+type\s*\{...\}/`-regex zou missen.
describe('Sanity-check — extractLibTypesImports() vangt zowel type- als waarde-imports, en een tweede importregel', () => {
  it('herkent een illegale, tweede waarde-import (FORMATIONS) uit "@/lib/types", ook als de eerste regel "import type { Player }" is', () => {
    const fakeSource = [
      "import type { Player } from '@/lib/types'",
      "import { FORMATIONS } from '@/lib/types'",
      "import { useDict } from '@/lib/i18n-context'",
    ].join('\n')
    expect(extractLibTypesImports(fakeSource)).toEqual(['Player', 'FORMATIONS'])
  })

  it('herkent een illegale waarde-import zelfs zonder dat er ook een "import type"-regel aanwezig is', () => {
    const fakeSource = "import { POSITION_GROUPS } from '@/lib/types'\n"
    expect(extractLibTypesImports(fakeSource)).toEqual(['POSITION_GROUPS'])
  })
})

describe('Story-AC10 (Deel B) — importbeperking van MatchSquadPrintList.tsx blijft gehandhaafd', () => {
  const source = readFileSync(
    path.join(__dirname, 'components', 'MatchSquadPrintList.tsx'),
    'utf-8',
  )

  it('de import(en) uit "@/lib/types" bevatten uitsluitend Player (type- én waarde-imports, alle importregels)', () => {
    const named = extractLibTypesImports(source)
    expect(named).toEqual(['Player'])
  })

  it('geen enkele opstelling-gerelateerde naam (FORMATIONS/POSITION_GROUPS/LineupPosition/POSITION_ABBREVIATIONS/HomeAway) wordt uit "@/lib/types" geïmporteerd, in geen enkele importregel', () => {
    const forbidden = ['FORMATIONS', 'POSITION_GROUPS', 'LineupPosition', 'POSITION_ABBREVIATIONS', 'HomeAway']
    const named = extractLibTypesImports(source)
    for (const name of forbidden) {
      expect(named).not.toContain(name)
    }
  })
})
