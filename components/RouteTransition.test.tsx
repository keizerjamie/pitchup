import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

let pad = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pad }))

import RouteTransition, { richtingVoor, markeerInAppTerug } from '@/components/RouteTransition'

describe('richtingVoor', () => {
  it('tussen tabbladen: vervagen', () => {
    expect(richtingVoor('/', '/players')).toBe('vervaag')
    expect(richtingVoor('/events', '/settings')).toBe('vervaag')
  })

  it('dieper: vooruit, ondieper: terug (zelfde pad heen en terug)', () => {
    expect(richtingVoor('/events', '/events/e1')).toBe('vooruit')
    expect(richtingVoor('/events/e1', '/events/e1/squad')).toBe('vooruit')
    expect(richtingVoor('/events/e1/squad', '/events/e1')).toBe('terug')
    expect(richtingVoor('/players/p1', '/players')).toBe('terug')
  })

  it('gelijke diepte buiten de tabbladen: vervagen', () => {
    expect(richtingVoor('/events/e1', '/players/p1')).toBe('vervaag')
  })
})

describe('RouteTransition', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation)
  const media: Record<string, boolean> = {}

  beforeEach(() => {
    animate.mockClear()
    for (const k of Object.keys(media)) delete media[k]
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    window.matchMedia = vi.fn((q: string) => ({ matches: media[q] ?? false }) as MediaQueryList)
  })
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate
  })

  function renderOp(start: string) {
    pad = start
    const r = render(<RouteTransition><p>inhoud</p></RouteTransition>)
    return { naar: (volgende: string) => { pad = volgende; r.rerender(<RouteTransition><p>inhoud</p></RouteTransition>) } }
  }

  it('animeert niet bij de eerste weergave', () => {
    renderOp('/')
    expect(animate).not.toHaveBeenCalled()
  })

  it('vooruit: schuift van rechts in, alleen transform + opacity, zonder fill', () => {
    const { naar } = renderOp('/events')
    naar('/events/e1')
    expect(animate).toHaveBeenCalledTimes(1)
    const [frames, opties] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions]
    expect(frames[0]).toEqual({ opacity: 0, transform: 'translate3d(28px, 0, 0)' })
    expect(frames[1]).toEqual({ opacity: 1, transform: 'translate3d(0, 0, 0)' })
    expect(opties.fill).toBeUndefined()
  })

  it('terug: schuift van links in', () => {
    const { naar } = renderOp('/events/e1')
    naar('/events')
    const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]]
    expect(frames[0]).toMatchObject({ transform: 'translate3d(-28px, 0, 0)' })
  })

  it('prefers-reduced-motion: alleen vervagen, ook bij vooruit', () => {
    media['(prefers-reduced-motion: reduce)'] = true
    const { naar } = renderOp('/events')
    naar('/events/e1')
    const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]]
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('Safari in de browser: geen eigen animatie na het terug-veeggebaar (popstate)', () => {
    media['(pointer: coarse)'] = true
    const { naar } = renderOp('/events/e1')
    window.dispatchEvent(new PopStateEvent('popstate'))
    naar('/events')
    expect(animate).not.toHaveBeenCalled()
  })

  it('als beginscherm-app animeert terug via popstate wél (in-app terugknop)', () => {
    media['(pointer: coarse)'] = true
    media['(display-mode: standalone)'] = true
    const { naar } = renderOp('/events/e1')
    window.dispatchEvent(new PopStateEvent('popstate'))
    naar('/events')
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('Safari in de browser: de in-app terugknop animeert wél, ook via popstate', () => {
    media['(pointer: coarse)'] = true
    const { naar } = renderOp('/events/e1')
    markeerInAppTerug()
    window.dispatchEvent(new PopStateEvent('popstate'))
    naar('/events')
    expect(animate).toHaveBeenCalledTimes(1)
  })
})
