import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { nl } from '@/messages/nl'
import { maandLabel, splitsThuisUit, type MaandOpkomst, type MaandTrend, type WedstrijdUitslagRij } from '@/lib/inzichten'
import KpiStrip from './KpiStrip'

const i = nl.insights
const rij = (o: Partial<WedstrijdUitslagRij>): WedstrijdUitslagRij => ({
  event_id: 'e', datum: '2026-09-01', home_away: 'home', goals_for: 1, goals_against: 0, formatie: null, ...o,
})
const GEEN_FOUT = { maandOpkomst: false, aanwezigheid: false, teamRating: false, uitslagen: false }
const VOLGORDE = ['opkomst', 'aanwezigheid', 'rating', 'doelsaldo', 'punten', 'cleansheets']
const PERIODE = 'Heel seizoen'

const opkomst: MaandTrend = { maand: '2026-09', percentage: 82, delta: 3, vorigePercentage: 79 }
const maanden: MaandOpkomst[] = [
  { maand: '2026-07', percentage: 70, aanwezig: 7, afwezig: 3 },
  { maand: '2026-08', percentage: 79, aanwezig: 79, afwezig: 21 },
  { maand: '2026-09', percentage: 82, aanwezig: 82, afwezig: 18 },
]

function toon(o: Partial<React.ComponentProps<typeof KpiStrip>> = {}) {
  return render(
    <KpiStrip
      opkomst={opkomst}
      maanden={maanden}
      aanwezigheidPercentage={88}
      rating={{ gemiddelde: 7.4, delta: 0.2, aantal: 12 }}
      resultaat={splitsThuisUit([
        rij({ goals_for: 3, goals_against: 0 }),
        rij({ goals_for: 1, goals_against: 1, home_away: 'away' }),
        rij({ goals_for: 0, goals_against: 2 }),
      ]).totaal}
      uitslagenAfgekapt={false}
      periodeLabel={PERIODE}
      fout={GEEN_FOUT}
      t={nl}
      {...o}
    />,
  )
}
const tegel = (container: HTMLElement, id: string) => container.querySelector(`[data-kpi="${id}"]`) as HTMLElement

describe('KpiStrip', () => {
  it('toont zes tegels in vaste volgorde in een raster met drie kolommen op desktop', () => {
    const { container } = toon()
    expect([...container.querySelectorAll('[data-kpi]')].map((e) => e.getAttribute('data-kpi'))).toEqual(VOLGORDE)
    const strook = container.querySelector('[data-conclusielaag="kpi"]') as HTMLElement
    expect(strook.className).toContain('lg:grid-cols-3')
    expect(strook.className).toContain('grid-cols-2')
  })

  it('geeft elke tegel een vensterlabel: laatste maand voor opkomst, de periode voor de rest', () => {
    const { container } = toon()
    expect(within(tegel(container, 'opkomst')).getByText(i.kpiVensterLaatsteMaand.replace('{maand}', maandLabel('2026-09', nl.browserLocale)))).toBeInTheDocument()
    for (const id of VOLGORDE.slice(1)) expect(within(tegel(container, id)).getByText(PERIODE)).toBeInTheDocument()
  })

  it('opkomst zonder data: vensterlabel zonder maand', () => {
    const { container } = toon({ opkomst: null, maanden: [] })
    expect(within(tegel(container, 'opkomst')).getByText(i.kpiVensterLaatsteMaandLeeg)).toBeInTheDocument()
  })

  it('houdt het DOM-contract: label is kind van de kopregel, het vensterlabel is zijn zuster', () => {
    const { container } = toon()
    const t = tegel(container, 'doelsaldo')
    const label = within(t).getByText(i.kpiDoelsaldoLabel)
    const kopregel = label.parentElement as HTMLElement
    expect(kopregel.parentElement).toBe(t)
    expect(kopregel.nextElementSibling?.textContent).toBe(PERIODE)
    expect(label.textContent).toBe(i.kpiDoelsaldoLabel)
  })

  it('toont doelsaldo, punten per wedstrijd en clean sheets uit het resultaat', () => {
    const { container } = toon()
    expect(within(tegel(container, 'doelsaldo')).getByText('+1')).toBeInTheDocument()
    expect(within(tegel(container, 'punten')).getByText('1.33')).toBeInTheDocument()
    expect(within(tegel(container, 'punten')).getByText(i.kpiPuntenDetail.replace('{punten}', '4').replace('{n}', '3'))).toBeInTheDocument()
    expect(within(tegel(container, 'cleansheets')).getByText('1')).toBeInTheDocument()
    expect(within(tegel(container, 'cleansheets')).getByText(i.kpiCleanSheetsDetail.replace('{n}', '3'))).toBeInTheDocument()
  })

  it('de nieuwe tegels zijn neutraal: rail en geen sparkline', () => {
    const { container } = toon()
    for (const id of ['punten', 'cleansheets']) {
      const rail = tegel(container, id).querySelector('div.absolute') as HTMLElement
      expect(rail.style.background).toBe('var(--faint)')
      expect(tegel(container, id).querySelector('svg')).toBeNull()
    }
  })

  it('zonder wedstrijden: "—" met kpiGeenData, punten null geeft ook "—"', () => {
    const { container } = toon({ resultaat: splitsThuisUit([]).totaal })
    for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
      const t = tegel(container, id)
      expect(within(t).getByText('—')).toBeInTheDocument()
      expect(within(t).getByText(i.kpiGeenData)).toBeInTheDocument()
    }
  })

  it.each([
    ['maandOpkomst', 'opkomst'],
    ['aanwezigheid', 'aanwezigheid'],
    ['teamRating', 'rating'],
  ] as const)('bronfout %s: alleen die tegel toont bronFout, zonder "—" of 0', (vlag, id) => {
    const { container } = toon({ fout: { ...GEEN_FOUT, [vlag]: true } })
    const t = tegel(container, id)
    expect(within(t).getByText(i.bronFout)).toBeInTheDocument()
    expect(t.textContent).not.toContain('—')
    expect(t.textContent).not.toMatch(/\b0\b/)
    expect(t.querySelector('svg')).toBeNull()
    expect(screen.getAllByText(i.bronFout)).toHaveLength(1)
  })

  it('bronfout uitslagen: de drie uitslagtegels tonen bronFout en geen cijfer', () => {
    const { container } = toon({ fout: { ...GEEN_FOUT, uitslagen: true } })
    for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
      const t = tegel(container, id)
      expect(within(t).getByText(i.bronFout)).toBeInTheDocument()
      expect(t.querySelector('.font-display')).toBeNull()
    }
    expect(screen.getAllByText(i.bronFout)).toHaveLength(3)
  })

  it('afgekapt: de drie uitslagtegels tonen afgekapt, de andere niet', () => {
    const { container } = toon({ uitslagenAfgekapt: true })
    for (const id of ['doelsaldo', 'punten', 'cleansheets']) {
      const t = tegel(container, id)
      expect(within(t).getByText(i.afgekapt)).toBeInTheDocument()
      expect(t.querySelector('.font-display')).toBeNull()
    }
    expect(screen.getAllByText(i.afgekapt)).toHaveLength(3)
    expect(within(tegel(container, 'opkomst')).queryByText(i.afgekapt)).toBeNull()
  })

  it('fout gaat voor afgekapt', () => {
    toon({ uitslagenAfgekapt: true, fout: { ...GEEN_FOUT, uitslagen: true } })
    expect(screen.queryByText(i.afgekapt)).toBeNull()
    expect(screen.getAllByText(i.bronFout)).toHaveLength(3)
  })
})
