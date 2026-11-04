import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Begroeting from '@/components/dashboard/Begroeting'
import { begroetingVoorUur } from '@/lib/begroeting'

const labels = { morning: 'Goedemorgen', afternoon: 'Goedemiddag', evening: 'Goedenavond' }

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Begroeting', () => {
  it('toont op de client de begroeting van het uur van het apparaat', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 4, 0, 30)) // lokaal 00:30
    const { container } = render(<Begroeting labels={labels} />)
    expect(container.querySelector('span')?.textContent).toBe('Goedemorgen')
  })

  it('draagt de nonce op het script en heeft suppressHydrationWarning-gedrag (geen waarschuwing)', () => {
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<Begroeting labels={labels} nonce="abc123" />)
    expect(container.querySelector('script')?.getAttribute('nonce')).toBe('abc123')
    expect(fout).not.toHaveBeenCalled()
    fout.mockRestore()
  })

  it('zonder nonce geen nonce-attribuut (nooit een leeg attribuut)', () => {
    const { container } = render(<Begroeting labels={labels} />)
    expect(container.querySelector('script')?.hasAttribute('nonce')).toBe(false)
  })

  it('op de client is het script inert (type text/plain)', () => {
    const { container } = render(<Begroeting labels={labels} />)
    expect(container.querySelector('script')?.getAttribute('type')).toBe('text/plain')
  })

  it('server-HTML: het script staat direct na de span met hetzelfde id, met nonce en text/javascript', () => {
    // jsdom heeft een window; verberg die zodat de component de serverstand rendert.
    const win = globalThis.window
    // @ts-expect-error serverstand nabootsen
    delete globalThis.window
    let html = ''
    try {
      html = renderToString(<Begroeting labels={labels} nonce="n0nce" />)
    } finally {
      globalThis.window = win
    }
    const m = html.match(/<span id="([^"]+)"[^>]*>[^<]*<\/span><script nonce="n0nce" type="text\/javascript">/)
    expect(m).not.toBeNull()
    expect(html).toContain(JSON.stringify(m![1]))
  })

  it('het script zet de span op de begroeting van het uur van het apparaat (uitgevoerd op jsdom)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 4, 0, 30))
    const { container } = render(<Begroeting labels={labels} />)
    const span = container.querySelector('span') as HTMLElement
    const script = container.querySelector('script')!.textContent!
    span.textContent = 'Goedenavond' // wat de server (UTC) kon renderen
    vi.setSystemTime(new Date(2026, 10, 4, 14, 0))
    new Function(script)()
    expect(span.textContent).toBe(labels[begroetingVoorUur(14)])
    expect(span.textContent).toBe('Goedemiddag')
    vi.setSystemTime(new Date(2026, 10, 4, 19, 0))
    new Function(script)()
    expect(span.textContent).toBe('Goedenavond')
  })
})
