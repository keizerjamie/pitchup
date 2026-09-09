import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ChevronIcon from '@/components/icons/ChevronIcon'

describe('ChevronIcon', () => {
  it('rendert een svg, geen icoonfont-tekst', () => {
    const { container } = render(<ChevronIcon />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  it('open=false: geen rotate-180-klasse', () => {
    const { container } = render(<ChevronIcon open={false} />)
    expect(container.querySelector('svg')).not.toHaveClass('rotate-180')
  })

  it('open=true: rotate-180-klasse aanwezig', () => {
    const { container } = render(<ChevronIcon open />)
    expect(container.querySelector('svg')).toHaveClass('rotate-180')
  })

  it('gebruikt transition-transform, nooit transition-all', () => {
    const { container } = render(<ChevronIcon />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('transition-transform')
    expect(svg?.getAttribute('class')).not.toMatch(/transition-all/)
  })

  it('geeft de meegegeven className door', () => {
    const { container } = render(<ChevronIcon className="w-5 h-5 text-muted" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('w-5', 'h-5', 'text-muted')
  })
})
