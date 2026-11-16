import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Begroeting from '@/components/dashboard/Begroeting'

const labels = { morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond' }

afterEach(() => {
  vi.useRealTimers()
})

function toon(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
  return render(<Begroeting labels={labels} />).container
}

describe('Begroeting (Amsterdams uur)', () => {
  it('23:30Z is 00:30 in Amsterdam (winter) → Goedemorgen', () => {
    expect(toon('2026-11-16T23:30:00Z').querySelector('span')?.textContent).toBe('Goedemorgen')
  })

  it('11:30Z is 12:30 in Amsterdam → Goedemiddag', () => {
    expect(toon('2026-11-16T11:30:00Z').querySelector('span')?.textContent).toBe('Goedemiddag')
  })

  it('17:00Z is 18:00 in Amsterdam → Goedenavond', () => {
    expect(toon('2026-11-16T17:00:00Z').querySelector('span')?.textContent).toBe('Goedenavond')
  })

  it('rendert geen script en geen nonce, ook niet op de server', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'))
    const { container } = render(<Begroeting labels={labels} />)
    expect(container.querySelector('script')).toBeNull()
    const html = renderToString(<Begroeting labels={labels} />)
    expect(html).not.toContain('<script')
    expect(html).toContain('Goedemiddag')
  })

  it('geen hydratiewaarschuwing bij renderen', () => {
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {})
    toon('2026-11-16T12:00:00Z')
    expect(fout).not.toHaveBeenCalled()
    fout.mockRestore()
  })
})
