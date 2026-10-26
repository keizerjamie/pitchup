/**
 * Acceptatietests "UX-details" — fase 1: text-balance (TB) en hit slop (HS).
 *
 * Bron: technische brief §2-TB, §2-HS en §5 (03-brief-goedgekeurd.md).
 * jsdom rekent geen CSS-layout uit: de CSS-regels worden als tekst gecontroleerd
 * en de tikvlakken als klassen. De daadwerkelijke 44px-uitkomst per plek staat
 * in de oplevering (handmatige rekensom), niet in deze test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = __dirname
const lees = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

describe('TB — globals.css', () => {
  const css = lees('app/globals.css')

  it('.page-title balanceert de regelverdeling en behoudt overflow-wrap', () => {
    const blok = css.match(/\.page-title\s*\{[^}]*\}/)?.[0] ?? ''
    expect(blok).toContain('text-wrap: balance')
    expect(blok).toContain('overflow-wrap: anywhere')
  })

  it('definieert de .hit-slop::after-utility met gap-variabelen en 44px-doel', () => {
    const blok = css.match(/\.hit-slop::after\s*\{[^}]*\}/)?.[0] ?? ''
    expect(blok).toContain("content: ''")
    expect(blok).toContain('position: absolute')
    expect(blok).toContain('--hit-slop-gap-y, 88px')
    expect(blok).toContain('--hit-slop-gap, 88px')
    expect(blok).toContain('44px')
    // `position` hoort bij de knop (klasse `relative`), niet bij .hit-slop zelf.
    expect(css).not.toMatch(/\.hit-slop\s*\{/)
  })

  it('heeft de --z-toast-token tussen fab (80) en modal (90)', () => {
    expect(css).toMatch(/--z-toast:\s*85;/)
  })
})

describe('TB — losse h1-koppen', () => {
  const balanced = [
    'app/login/page.tsx',
    'app/register/page.tsx',
    'app/forgot-password/page.tsx',
    'app/reset-password/page.tsx',
    'app/invite/[token]/page.tsx',
    'app/invite/[token]/register/InviteRegisterForm.tsx',
    'components/EmptyTeamState.tsx',
  ]
  it.each(balanced)('%s: h1 heeft text-balance', (rel) => {
    const h1 = lees(rel).match(/<h1\s+className="([^"]*)"/)?.[1] ?? ''
    expect(h1).toContain('text-balance')
  })

  it.each(['components/CalendarView.tsx', 'app/events/[id]/training-plan/page.tsx'])(
    '%s: bewust uitgesloten, h1 zonder text-balance',
    (rel) => {
      const h1s = [...lees(rel).matchAll(/<h1[^>]*className="([^"]*)"/g)].map((m) => m[1])
      expect(h1s.length).toBeGreaterThan(0)
      for (const k of h1s) expect(k).not.toContain('text-balance')
    },
  )
})

describe('HS — knoppen met hit-slop', () => {
  // [bestand, fragment van de knop-className] — elk fragment moet in dezelfde
  // className-string als `relative hit-slop` staan.
  const knoppen: Array<[string, string]> = [
    ['components/ui/Button.tsx', 'h-9 px-3.5 text-[13px]'],
    ['components/ui/Button.tsx', 'w-9 h-9'],
    ['components/TrainingPlanEditor.tsx', 'w-8 h-8 rounded-lg flex items-center justify-center transition-colors'],
    ['components/TrainingPlanEditor.tsx', 'w-8 h-8 rounded-lg hover:bg-panel-red'],
    ['components/TrainingPlanEditor.tsx', 'w-6 h-5 flex'],
    ['components/NulmetingManager.tsx', 'w-8 h-8 rounded-lg hover:bg-panel-red'],
    ['components/NulmetingManager.tsx', 'w-9 h-9 rounded-lg bg-surface-sunken'],
    ['components/MatchAnalysisEditor.tsx', 'w-9 h-9 rounded-lg flex'],
    ['components/MatchAnalysisEditor.tsx', 'w-8 h-8 rounded-lg flex'],
    ['components/TegendoelpuntenSectie.tsx', 'w-8 h-8 rounded-lg flex'],
    ['components/TrainingAttendance.tsx', 'h-9 px-3 rounded-lg'],
    ['components/TrainingAttendance.tsx', 'h-9 rounded-[10px]'],
    ['components/dashboard/TodoList.tsx', 'w-9 h-9 rounded-full'],
    ['components/OefeningEditor.tsx', 'w-9 h-9 rounded-lg hover:bg-panel-red'],
    ['components/MetingEditor.tsx', 'w-8 h-8 rounded-lg bg-surface-sunken'],
    ['components/BezettingStepper.tsx', 'w-9 h-9 rounded-lg border'],
    ['components/MatchSquadEditor.tsx', 'w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors'],
    ['components/CalendarView.tsx', 'w-9 h-9 rounded-full'],
    ['components/CalendarView.tsx', 'h-9 px-3 rounded-full'],
    ['components/ThemeToggle.tsx', 'w-8 h-8 rounded-lg'],
    ['components/dashboard/JoinedBanner.tsx', 'w-7 h-7 rounded-lg'],
  ]
  it.each(knoppen)('%s (%s) heeft relative hit-slop', (rel, fragment) => {
    const src = lees(rel)
    const regels = src.split('\n').filter((r) => r.includes(fragment))
    expect(regels.length).toBeGreaterThan(0)
    for (const r of regels) {
      expect(r).toContain('relative hit-slop')
    }
  })

  it('zet gap-variabelen op de directe flex-ouders die een buur-knop hebben', () => {
    expect(lees('components/TrainingPlanEditor.tsx')).toContain('[--hit-slop-gap:4px]')
    expect(lees('components/TrainingPlanEditor.tsx')).toContain('[--hit-slop-gap-y:0px]')
    for (const rel of [
      'components/NulmetingManager.tsx',
      'components/MatchAnalysisEditor.tsx',
      'components/TrainingAttendance.tsx',
      'components/MetingEditor.tsx',
      'components/BezettingStepper.tsx',
    ]) {
      expect(lees(rel)).toContain('[--hit-slop-gap:8px]')
    }
    expect(lees('components/CalendarView.tsx')).toContain('[--hit-slop-gap:6px]')
  })

  it('geeft de sheet-sluitknop hit-slop in BottomSheet en laat de vier oude knoppen niet meer los staan (fase 3)', () => {
    const sheet = lees('components/ui/BottomSheet.tsx')
    expect(sheet).toContain('relative hit-slop w-8 h-8 rounded-full')
    for (const rel of [
      'components/NulmetingManager.tsx',
      'components/OefeningEditor.tsx',
      'components/CyclusWeekCorrectie.tsx',
      'components/OefeningPicker.tsx',
    ]) {
      const src = lees(rel)
      expect(src).toContain('BottomSheet')
      expect(src).not.toMatch(/w-8 h-8 rounded-full/)
    }
  })

  it('laat MatchSquadEditor-readonly (een span) ongemoeid', () => {
    const readonly = lees('components/MatchSquadEditor.tsx')
      .split('\n')
      .filter((r) => r.includes('w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"'))
    expect(readonly.length).toBe(1)
    expect(readonly[0]).not.toContain('hit-slop')
  })
})
