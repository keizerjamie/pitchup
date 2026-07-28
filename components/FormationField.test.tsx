import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FormationField from '@/components/FormationField'
import { formationsForSize } from '@/lib/types'

describe('FormationField', () => {
  it('rendert evenveel markers als er posities zijn', () => {
    const positions = formationsForSize(7).find((f) => f.key === '2-3-1')!.positions
    render(<FormationField positions={positions} />)
    expect(screen.getAllByTestId('formation-marker')).toHaveLength(positions.length)
  })

  it('rendert geen markers voor een lege positielijst', () => {
    render(<FormationField positions={[]} />)
    expect(screen.queryAllByTestId('formation-marker')).toHaveLength(0)
    expect(screen.getByTestId('formation-field')).toBeInTheDocument()
  })

  it('toont het label wanneer meegegeven', () => {
    render(<FormationField positions={[]} label="7 · 2-3-1" />)
    expect(screen.getByText('7 · 2-3-1')).toBeInTheDocument()
  })

  it('toont geen labelparagraaf zonder label-prop', () => {
    const { container } = render(<FormationField positions={[]} />)
    expect(container.querySelector('p')).toBeNull()
  })
})
