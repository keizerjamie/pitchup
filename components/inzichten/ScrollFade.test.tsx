import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import ScrollFade from './ScrollFade'

type Maten = { scrollWidth: number; clientWidth: number; scrollLeft: number }

function zetMaten(el: HTMLElement, maten: Maten) {
  for (const [k, v] of Object.entries(maten)) {
    Object.defineProperty(el, k, { configurable: true, writable: true, value: v })
  }
}

describe('ScrollFade', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderMetMaten(maten: Maten, props: Partial<React.ComponentProps<typeof ScrollFade>> = {}) {
    const utils = render(
      <ScrollFade {...props}>
        <div>inhoud</div>
      </ScrollFade>,
    )
    const scroller = utils.container.querySelector('.overflow-x-auto') as HTMLElement
    zetMaten(scroller, maten)
    // nieuwe meting via een scrollgebeurtenis
    act(() => {
      fireEvent.scroll(scroller)
    })
    return { ...utils, scroller }
  }

  it('toont bij mount geen randen', () => {
    const { container } = render(
      <ScrollFade>
        <div>inhoud</div>
      </ScrollFade>,
    )
    expect(container.querySelector('[data-scroll-rand]')).toBeNull()
  })

  it('toont aan het begin alleen de eindrand', () => {
    const { container } = renderMetMaten({ scrollWidth: 800, clientWidth: 300, scrollLeft: 0 })
    expect(container.querySelector('[data-scroll-rand="eind"]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-rand="start"]')).toBeNull()
  })

  it('toont in het midden beide randen', () => {
    const { container } = renderMetMaten({ scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    expect(container.querySelector('[data-scroll-rand="eind"]')).not.toBeNull()
    expect(container.querySelector('[data-scroll-rand="start"]')).not.toBeNull()
  })

  it('toont aan het einde alleen de startrand', () => {
    const { container } = renderMetMaten({ scrollWidth: 800, clientWidth: 300, scrollLeft: 500 })
    expect(container.querySelector('[data-scroll-rand="eind"]')).toBeNull()
    expect(container.querySelector('[data-scroll-rand="start"]')).not.toBeNull()
  })

  it('toont geen rand als alles past', () => {
    const { container } = renderMetMaten({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })
    expect(container.querySelector('[data-scroll-rand]')).toBeNull()
  })

  it('crasht niet zonder ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    expect(() =>
      render(
        <ScrollFade>
          <div>inhoud</div>
        </ScrollFade>,
      ),
    ).not.toThrow()
  })

  it('zet role en aria-label op de scroller', () => {
    const { scroller } = renderMetMaten(
      { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 },
      { role: 'img', ariaLabel: 'Samenvatting' },
    )
    expect(scroller.getAttribute('role')).toBe('img')
    expect(scroller.getAttribute('aria-label')).toBe('Samenvatting')
  })

  it('maakt randen pointer-events-none en zonder aria-hidden', () => {
    const { container } = renderMetMaten({ scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    const randen = container.querySelectorAll('[data-scroll-rand]')
    expect(randen).toHaveLength(2)
    randen.forEach((r) => {
      expect(r.className).toContain('pointer-events-none')
      expect(r.getAttribute('aria-hidden')).toBeNull()
    })
  })

  it('past wrapperClassName toe op de wrapper', () => {
    const { container } = render(
      <ScrollFade wrapperClassName="flex-1 min-w-0">
        <div>x</div>
      </ScrollFade>,
    )
    expect((container.firstElementChild as HTMLElement).className).toContain('flex-1 min-w-0')
  })

  it('schuift de startrand op naast de vaste startkolom', () => {
    const utils = render(
      <ScrollFade vasteStartkolom>
        <table>
          <thead>
            <tr>
              <th className="sticky left-0">Week</th>
            </tr>
          </thead>
        </table>
      </ScrollFade>,
    )
    const scroller = utils.container.querySelector('.overflow-x-auto') as HTMLElement
    const th = scroller.querySelector('th.sticky') as HTMLElement
    th.getBoundingClientRect = () => ({ width: 64 }) as DOMRect
    zetMaten(scroller, { scrollWidth: 800, clientWidth: 300, scrollLeft: 100 })
    act(() => {
      fireEvent.scroll(scroller)
    })
    const start = utils.container.querySelector('[data-scroll-rand="start"]') as HTMLElement
    expect(start.style.left).toBe('64px')
  })
})
