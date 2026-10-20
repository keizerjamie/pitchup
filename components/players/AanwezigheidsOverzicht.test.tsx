import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import AanwezigheidsOverzicht, { overzichtHref } from '@/components/players/AanwezigheidsOverzicht'
import AanwezigheidsOverzichtPrint from '@/components/players/AanwezigheidsOverzichtPrint'
import type { OverzichtRij } from '@/lib/aanwezigheidsoverzicht'

const RIJEN: OverzichtRij[] = [
  { playerId: 'a', naam: 'Anna', aanwezig: 8, afwezig: 2, geblesseerd: 2, pctIncl: 67, pctZonder: 80 },
  { playerId: 'b', naam: 'Bram', aanwezig: 0, afwezig: 0, geblesseerd: 3, pctIncl: 0, pctZonder: null },
]

function renderScherm(staat: Parameters<typeof AanwezigheidsOverzicht>[0]['staat']) {
  return render(<DictProvider dict={nl}><AanwezigheidsOverzicht staat={staat} t={nl} /></DictProvider>)
}

describe('overzichtHref', () => {
  it('laat de parameter weg voor het seizoen', () => {
    expect(overzichtHref('seizoen')).toBe('/players?weergave=aanwezigheid')
    expect(overzichtHref('4w')).toBe('/players?weergave=aanwezigheid&periode=4w')
  })
})

describe('AanwezigheidsOverzicht (scherm)', () => {
  it('datastaat: tabel met caption, kolomkoppen met volledige namen en percentages, "—" voor null', () => {
    renderScherm({ soort: 'data', periode: 'seizoen', rijen: RIJEN })
    const tabel = screen.getByRole('table', { name: nl.players.overzichtSubtitle })
    expect(within(tabel).getByRole('columnheader', { name: nl.players.overzichtKolomPctInclLang })).toBeInTheDocument()
    expect(within(tabel).getByRole('columnheader', { name: nl.players.overzichtKolomGeblesseerdLang })).toBeInTheDocument()
    const bram = within(tabel).getByRole('rowheader', { name: 'Bram' }).closest('tr') as HTMLElement
    expect(within(bram).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0', '0', '3', '0%', '—'])
    expect(screen.getByText(nl.players.overzichtUitleg)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
  })

  it('geenSeizoen: lege staat met link naar instellingen, geen printknop', () => {
    renderScherm({ soort: 'geenSeizoen' })
    expect(screen.getByText(nl.insights.noSeason)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.insights.goToSettings })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('fout: toont de vaste melding als alert en houdt de periodekiezer bruikbaar', () => {
    renderScherm({ soort: 'fout', periode: '8w' })
    expect(screen.getByRole('alert')).toHaveTextContent(nl.players.overzichtFout)
    expect(screen.getByRole('link', { name: nl.insights.periode4w })).toHaveAttribute('href', '/players?weergave=aanwezigheid&periode=4w')
    expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
  })

  it('leeg bij kortere periode: lege staat mét periodekiezer; bij seizoen zonder kiezer', () => {
    const { unmount } = renderScherm({ soort: 'leeg', periode: '4w' })
    expect(screen.getByText(nl.players.overzichtLeegTitel)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: nl.insights.periodeLabel })).toBeInTheDocument()
    unmount()
    renderScherm({ soort: 'leeg', periode: 'seizoen' })
    expect(screen.queryByRole('group', { name: nl.insights.periodeLabel })).not.toBeInTheDocument()
  })
})

describe('AanwezigheidsOverzichtPrint', () => {
  function renderPrint(over: Partial<Parameters<typeof AanwezigheidsOverzichtPrint>[0]> = {}) {
    return render(
      <AanwezigheidsOverzichtPrint
        t={nl}
        rijen={RIJEN}
        teamName="FC Testers"
        teamLogoUrl={null}
        venster={{ start: '2026-08-01', end: '2026-10-14' }}
        periodeLabel={nl.insights.periodeSeizoen}
        generatedOn="15 okt 2026"
        primaryColor="#112233"
        secondaryColor="#445566"
        {...over}
      />,
    )
  }

  it('is print-only (hidden print:block, data-print-only) met de clubkleuren als CSS-variabelen', () => {
    const { container } = renderPrint()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('hidden')
    expect(root.className).toContain('print:block')
    expect(root).toHaveAttribute('data-print-only')
    expect(root.style.getPropertyValue('--club-primary')).toBe('#112233')
    expect(root.style.getPropertyValue('--club-secondary')).toBe('#445566')
  })

  it('toont volledige kolomnamen in thead en de rijen in tbody; zonder logo geen img met alt', () => {
    const { container } = renderPrint()
    const tabel = container.querySelector('table.overzicht-tabel') as HTMLElement
    expect(tabel.querySelector('thead')).not.toBeNull()
    expect(within(tabel).getByText(nl.players.overzichtKolomPctZonderLang)).toBeInTheDocument()
    expect(within(tabel).getByText('Anna')).toBeInTheDocument()
    expect(within(tabel).getAllByText('—')).toHaveLength(1)
    expect(container.querySelector('img[alt="FC Testers"]')).toBeNull()
  })

  it('toont het logo met teamnaam als alt wanneer er een logo is', () => {
    renderPrint({ teamLogoUrl: 'https://example.test/l.png' })
    expect(screen.getByAltText('FC Testers')).toHaveAttribute('src', 'https://example.test/l.png')
  })

  it('parset de periodedatums lokaal (geen UTC-verschuiving)', () => {
    renderPrint()
    const label = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(nl.browserLocale, { day: 'numeric', month: 'short', year: 'numeric' })
    expect(screen.getByText(`${label('2026-08-01')} – ${label('2026-10-14')} · ${nl.insights.periodeSeizoen}`)).toBeInTheDocument()
  })
})
