import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import BottomSheet from '@/components/ui/BottomSheet'
import { SHEET_SLUIT_MS, SHEET_TERUG_MS } from '@/lib/sheet-gebaar'

// jsdom kent geen PointerEvent: bouw een generiek Event met de velden die
// React's synthetic-event-laag leest (precedent: DiagramEditor.test.tsx).
function pointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { x?: number; y?: number; id?: number; pointerType?: string },
) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(ev, {
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? 'touch',
    button: 0,
    isPrimary: true,
  })
  fireEvent(el, ev)
}

let telefoon = true
let reduced = false
let nu = 0

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') ? telefoon : query.includes('reduce') ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function renderSheet(props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const onClose = vi.fn()
  const utils = render(
    <DictProvider dict={nl}>
      <BottomSheet onClose={onClose} titel="Titel" sluitLabel="Sluit het" {...props}>
        <p>inhoud</p>
      </BottomSheet>
    </DictProvider>,
  )
  const sheet = screen.getByRole('dialog')
  sheet.getBoundingClientRect = () => ({ height: 600, width: 400, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect
  const kop = screen.getByTestId('bottom-sheet-kop')
  const scrim = utils.container.querySelector('.anim-scrim') as HTMLElement
  return { onClose, sheet, kop, scrim, ...utils }
}

// Veeg op de kop; elke stap kost 16ms zodat de snelheid deterministisch is.
function veeg(kop: Element, naar: { x?: number; y: number }, opts: { id?: number; pointerType?: string; stapMs?: number } = {}) {
  const stap = opts.stapMs ?? 16
  pointer(kop, 'pointerdown', { x: 0, y: 0, id: opts.id, pointerType: opts.pointerType })
  nu += stap
  pointer(kop, 'pointermove', { x: naar.x ?? 0, y: naar.y, id: opts.id, pointerType: opts.pointerType })
  nu += stap
}

describe('BottomSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    telefoon = true
    reduced = false
    nu = 0
    stubMatchMedia()
    vi.spyOn(performance, 'now').mockImplementation(() => nu)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('markup', () => {
    it('rendert dialoog met titel, inhoud, ondertitel en voet', () => {
      renderSheet({ ondertitel: 'Hint', voet: <button>Opslaan</button> })
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', screen.getByRole('heading', { name: 'Titel' }).id)
      expect(screen.getByText('inhoud')).toBeInTheDocument()
      expect(screen.getByText('Hint')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Opslaan' })).toBeInTheDocument()
    })

    it('behoudt de klassen waar andere tests op leunen', () => {
      const { scrim, sheet, container } = renderSheet({ wrapperClassName: 'print:hidden', className: 'flex flex-col', breedte: 'md' })
      expect(scrim.className).toContain('backdrop-blur-sm')
      expect(scrim.className).toContain('anim-scrim')
      expect(sheet.className).toContain('anim-sheet')
      expect(sheet.className).toContain('max-w-md')
      expect(sheet.className).toContain('flex flex-col')
      expect((container.firstChild as HTMLElement).className).toContain('print:hidden')
    })

    it('toont de sluitknop met sluitLabel en hit-slop; sluit direct', () => {
      const { onClose } = renderSheet()
      const knop = screen.getByRole('button', { name: 'Sluit het' })
      expect(knop.className).toContain('relative hit-slop')
      fireEvent.click(knop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('verbergt de sluitknop met toonSluitknop={false}', () => {
      renderSheet({ toonSluitknop: false })
      expect(screen.queryByRole('button', { name: 'Sluit het' })).toBeNull()
    })
  })

  describe('scrim en dirty', () => {
    it('sluit bij scrimtik zonder wijzigingen, zonder confirm', () => {
      const confirm = vi.spyOn(window, 'confirm')
      const { onClose, scrim } = renderSheet()
      fireEvent.click(scrim)
      expect(confirm).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('dirty + scrimtik: confirm(false) houdt het blad open', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { onClose, scrim } = renderSheet({ dirty: true })
      fireEvent.click(scrim)
      expect(confirm).toHaveBeenCalledWith(nl.sheet.discardConfirm)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('dirty + scrimtik: confirm(true) sluit', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { onClose, scrim } = renderSheet({ dirty: true })
      fireEvent.click(scrim)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('dirty: de sluitknop sluit zonder waarschuwing', () => {
      const confirm = vi.spyOn(window, 'confirm')
      const { onClose } = renderSheet({ dirty: true })
      fireEvent.click(screen.getByRole('button', { name: 'Sluit het' }))
      expect(confirm).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('swipe-to-dismiss', () => {
    it('volgt de vinger en scrim-opacity tijdens het slepen', () => {
      const { kop, sheet, scrim } = renderSheet()
      veeg(kop, { y: 150 })
      expect(sheet.style.transform).toBe('translateY(150px)')
      expect(sheet.style.animation).toBe('none')
      expect(scrim.style.animation).toBe('none')
      expect(parseFloat(scrim.style.opacity)).toBeCloseTo(0.75)
    })

    it('sluit voorbij de drempel: onClose pas na SHEET_SLUIT_MS + 20', () => {
      const { kop, sheet, scrim, onClose } = renderSheet()
      veeg(kop, { y: 200 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 200 })
      expect(sheet.style.transform).toBe('translateY(100%)')
      expect(sheet.style.transition).toContain(`${SHEET_SLUIT_MS}ms`)
      expect(scrim.style.opacity).toBe('0')
      act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 19) })
      expect(onClose).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('sluit niet onder de drempel: veert terug naar 0 en ruimt op', () => {
      const { kop, sheet, scrim, onClose } = renderSheet()
      veeg(kop, { y: 60 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 60 })
      expect(sheet.style.transform).toBe('translateY(0px)')
      expect(scrim.style.opacity).toBe('1')
      act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 50) })
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet.style.transform).toBe('')
      expect(scrim.style.opacity).toBe('')
    })

    it('een snelle flick onder de afstandsdrempel sluit wel', () => {
      const { kop, onClose } = renderSheet()
      veeg(kop, { y: 40 }, { stapMs: 20 })
      pointer(kop, 'pointerup', { y: 40 })
      act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 20) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('een opwaartse beweging aan het eind voorkomt sluiten', () => {
      const { kop, onClose, sheet } = renderSheet()
      pointer(kop, 'pointerdown', { y: 0 })
      nu += 100
      pointer(kop, 'pointermove', { y: 300 })
      nu += 100
      pointer(kop, 'pointermove', { y: 150 })
      pointer(kop, 'pointerup', { y: 150 })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet.style.transform).toBe('')
    })

    it('omhoog slepen heeft rubberband-weerstand (minder dan de vinger)', () => {
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: -100 })
      const m = sheet.style.transform.match(/translateY\((-?[\d.]+)px\)/)
      expect(m).not.toBeNull()
      const v = parseFloat(m![1])
      expect(v).toBeLessThan(0)
      expect(Math.abs(v)).toBeLessThan(100)
    })

    it('horizontaal begonnen gebaar sluit niet en beweegt het blad niet', () => {
      const { kop, sheet, onClose } = renderSheet()
      veeg(kop, { x: 80, y: 20 })
      pointer(kop, 'pointermove', { x: 80, y: 400 })
      pointer(kop, 'pointerup', { x: 80, y: 400 })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(sheet.style.transform).toBe('')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('binnen de slop (8px) gebeurt er niets', () => {
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: 7 })
      expect(sheet.style.transform).toBe('')
    })

    it('muis doet niets', () => {
      const { kop, sheet, onClose } = renderSheet()
      veeg(kop, { y: 300 }, { pointerType: 'mouse' })
      pointer(kop, 'pointerup', { y: 300, pointerType: 'mouse' })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(sheet.style.transform).toBe('')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('pen werkt wel', () => {
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: 100 }, { pointerType: 'pen' })
      expect(sheet.style.transform).toBe('translateY(100px)')
    })

    it('doet niets vanaf 640px breed (tablet/desktop), ook met touch', () => {
      telefoon = false
      stubMatchMedia()
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: 300 })
      expect(sheet.style.transform).toBe('')
    })

    it('negeert een tweede pointerId tijdens een gebaar', () => {
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: 100 })
      pointer(kop, 'pointerdown', { y: 0, id: 2 })
      pointer(kop, 'pointermove', { y: 500, id: 2 })
      expect(sheet.style.transform).toBe('translateY(100px)')
      pointer(kop, 'pointerup', { y: 500, id: 2 })
      expect(sheet.style.transform).toBe('translateY(100px)')
    })

    it('pointercancel veert terug en sluit niet', () => {
      const { kop, sheet, onClose } = renderSheet()
      veeg(kop, { y: 300 })
      pointer(kop, 'pointercancel', { y: 300 })
      expect(sheet.style.transform).toBe('translateY(0px)')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('een tik zonder beweging op de sluitknop blijft een klik', () => {
      const { kop, onClose } = renderSheet()
      const knop = screen.getByRole('button', { name: 'Sluit het' })
      pointer(kop, 'pointerdown', { y: 0 })
      pointer(kop, 'pointerup', { y: 0 })
      fireEvent.click(knop)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ruimt timers op bij unmount (geen onClose na unmount)', () => {
      const { kop, onClose, unmount } = renderSheet()
      veeg(kop, { y: 300 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 300 })
      unmount()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('reduced motion: volgen blijft, sluiten is een opacity-fade zonder translate', () => {
      reduced = true
      stubMatchMedia()
      const { kop, sheet, onClose } = renderSheet()
      veeg(kop, { y: 200 }, { stapMs: 200 })
      expect(sheet.style.transform).toBe('translateY(200px)')
      pointer(kop, 'pointerup', { y: 200 })
      expect(sheet.style.transition).toContain('opacity 150ms')
      expect(sheet.style.opacity).toBe('0')
      expect(sheet.style.transform).toBe('translateY(200px)')
      act(() => { vi.advanceTimersByTime(170) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('reduced motion: terugveren is direct', () => {
      reduced = true
      stubMatchMedia()
      const { kop, sheet } = renderSheet()
      veeg(kop, { y: 40 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 40 })
      expect(sheet.style.transform).toBe('')
      expect(sheet.style.transition).toBe('none')
    })
  })

  describe('swipe met dirty', () => {
    it('veert eerst terug, vraagt dan; confirm(false) blijft open', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const { kop, sheet, onClose } = renderSheet({ dirty: true })
      veeg(kop, { y: 250 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 250 })
      expect(sheet.style.transform).toBe('translateY(0px)')
      expect(confirm).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 20) })
      expect(confirm).toHaveBeenCalledWith(nl.sheet.discardConfirm)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet.style.transform).toBe('')
    })

    it('confirm(true) sluit met de sluitanimatie', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { kop, sheet, onClose } = renderSheet({ dirty: true })
      veeg(kop, { y: 250 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 250 })
      act(() => { vi.advanceTimersByTime(SHEET_TERUG_MS + 20) })
      expect(sheet.style.transform).toBe('translateY(100%)')
      expect(onClose).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(SHEET_SLUIT_MS + 20) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('onder de drempel vraagt een dirty blad niets', () => {
      const confirm = vi.spyOn(window, 'confirm')
      const { kop } = renderSheet({ dirty: true })
      veeg(kop, { y: 40 }, { stapMs: 200 })
      pointer(kop, 'pointerup', { y: 40 })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(confirm).not.toHaveBeenCalled()
    })
  })
})
