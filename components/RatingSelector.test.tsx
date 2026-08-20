import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import RatingSelector from '@/components/RatingSelector'

function renderSelector(defaultRating?: number | null) {
  return render(
    <DictProvider dict={nl}>
      <RatingSelector defaultRating={defaultRating} />
    </DictProvider>,
  )
}

function radios(): HTMLInputElement[] {
  return screen.getAllByRole('radio') as HTMLInputElement[]
}

describe('RatingSelector', () => {
  it('toont de beoordelingen 1 t/m 10 plus een lege optie', () => {
    renderSelector()

    expect(radios()).toHaveLength(11)
    expect(radios().map((r) => r.value)).toEqual(['1','2','3','4','5','6','7','8','9','10',''])
    expect(screen.getByText(nl.players.rating, { exact: false })).toBeTruthy()
  })

  it('kiest zonder beoordeling de lege optie, zodat aanmaken null oplevert', () => {
    renderSelector()

    const checked = radios().filter((r) => r.checked)
    expect(checked).toHaveLength(1)
    expect(checked[0].value).toBe('')
  })

  it('selecteert een bestaande beoordeling bij bewerken', () => {
    renderSelector(7)

    const checked = radios().filter((r) => r.checked)
    expect(checked).toHaveLength(1)
    expect(checked[0].value).toBe('7')
  })

  it('stuurt elke knop mee onder de veldnaam rating', () => {
    renderSelector()

    expect(radios().every((r) => r.name === 'rating')).toBe(true)
  })
})
