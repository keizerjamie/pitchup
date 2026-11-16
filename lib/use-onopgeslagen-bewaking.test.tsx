import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Link from 'next/link'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import BackButton from '@/components/BackButton'
import { useOnopgeslagenBewaking, TERUG_DOEL } from '@/lib/use-onopgeslagen-bewaking'

const push = vi.fn()
const back = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}))

function Proef({ actief }: { actief: boolean }) {
  const { doel, blijf, verlaat } = useOnopgeslagenBewaking(actief)
  return (
    <div>
      <Link href="/events/e1/squad">intern</Link>
      <Link href="/events/e1/squad?x=1#top">intern met zoekstring</Link>
      <a href="#anker">alleen hash</a>
      <a href="https://example.com/ergens">extern</a>
      <a href="/events/e1/squad" target="_blank">nieuw tabblad</a>
      <a href="/bestand.pdf" download>download</a>
      <BackButton fallback="/events/e1">terug</BackButton>
      <output data-testid="doel">{doel ?? 'geen'}</output>
      <button type="button" onClick={blijf}>blijf</button>
      <button type="button" onClick={verlaat}>verlaat</button>
    </div>
  )
}

function renderProef(actief: boolean) {
  return render(
    <DictProvider dict={nl}>
      <Proef actief={actief} />
    </DictProvider>,
  )
}

// Een gewone <a>-klik laat jsdom "navigeren" (niet geïmplementeerd). Een
// listener in de bubble-fase vangt dat af; voor onderschepte klikken is de
// klik dan al defaultPrevented en doet dit niets.
let genavigeerd: string[] = []
function vangNavigatie(e: MouseEvent) {
  const a = (e.target as Element).closest('a[href]')
  if (a && !e.defaultPrevented) genavigeerd.push(a.getAttribute('href') ?? '')
  e.preventDefault()
}

beforeEach(() => {
  push.mockClear()
  back.mockClear()
  genavigeerd = []
  document.addEventListener('click', vangNavigatie)
})
afterEach(() => {
  document.removeEventListener('click', vangNavigatie)
  vi.restoreAllMocks()
})

describe('useOnopgeslagenBewaking', () => {
  it('onderschept een interne link-klik als actief en zet het doel', () => {
    renderProef(true)
    fireEvent.click(screen.getByText('intern'))
    expect(screen.getByTestId('doel')).toHaveTextContent('/events/e1/squad')
    expect(genavigeerd).toEqual([])
  })

  it('neemt pad, zoekstring en hash mee in het doel', () => {
    renderProef(true)
    fireEvent.click(screen.getByText('intern met zoekstring'))
    expect(screen.getByTestId('doel')).toHaveTextContent('/events/e1/squad?x=1#top')
  })

  it('onderschept niets als niet actief', () => {
    renderProef(false)
    fireEvent.click(screen.getByText('intern'))
    expect(screen.getByTestId('doel')).toHaveTextContent('geen')
    expect(genavigeerd).toEqual(['/events/e1/squad'])
  })

  it.each([
    ['alleen hash', 'alleen hash', {}],
    ['externe link', 'extern', {}],
    ['target=_blank', 'nieuw tabblad', {}],
    ['download', 'download', {}],
    ['cmd-klik', 'intern', { metaKey: true }],
    ['ctrl-klik', 'intern', { ctrlKey: true }],
    ['shift-klik', 'intern', { shiftKey: true }],
    ['alt-klik', 'intern', { altKey: true }],
    ['middelste muisknop', 'intern', { button: 1 }],
  ])('laat %s met rust', (_naam, tekst, init) => {
    renderProef(true)
    fireEvent.click(screen.getByText(tekst), init)
    expect(screen.getByTestId('doel')).toHaveTextContent('geen')
  })

  it('zet beforeunload met een lege returnValue als actief en ruimt hem op', () => {
    const { rerender } = renderProef(true)
    const ev = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)

    rerender(
      <DictProvider dict={nl}>
        <Proef actief={false} />
      </DictProvider>,
    )
    const na = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(na)
    expect(na.defaultPrevented).toBe(false)
  })

  it('zet beforeunload niet als niet actief, en ruimt op bij unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderProef(false)
    expect(add.mock.calls.filter(([n]) => n === 'beforeunload')).toHaveLength(0)
    unmount()
    const actief = renderProef(true)
    expect(add.mock.calls.filter(([n]) => n === 'beforeunload')).toHaveLength(1)
    actief.unmount()
    expect(remove.mock.calls.filter(([n]) => n === 'beforeunload')).toHaveLength(1)
  })

  it('blijf wist het doel en navigeert niet', () => {
    renderProef(true)
    fireEvent.click(screen.getByText('intern'))
    fireEvent.click(screen.getByText('blijf'))
    expect(screen.getByTestId('doel')).toHaveTextContent('geen')
    expect(push).not.toHaveBeenCalled()
  })

  it('verlaat roept router.push met het doel aan en haalt de bewaking weg', () => {
    renderProef(true)
    fireEvent.click(screen.getByText('intern'))
    fireEvent.click(screen.getByText('verlaat'))
    expect(push).toHaveBeenCalledWith('/events/e1/squad')
    expect(screen.getByTestId('doel')).toHaveTextContent('geen')
    // Na verlaten wordt een volgende klik niet meer onderschept.
    fireEvent.click(screen.getByText('intern'))
    expect(screen.getByTestId('doel')).toHaveTextContent('geen')
  })

  it('verlaat zonder doel doet niets', () => {
    renderProef(true)
    fireEvent.click(screen.getByText('verlaat'))
    expect(push).not.toHaveBeenCalled()
    expect(back).not.toHaveBeenCalled()
  })

  describe('terugpijl in de paginakop (BackButton)', () => {
    it('onderschept de klik: doel is de terug-sentinel en router.back wordt nog niet aangeroepen', () => {
      renderProef(true)
      fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
      expect(screen.getByTestId('doel')).toHaveTextContent(TERUG_DOEL)
      expect(back).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })

    it('verlaat roept router.back aan als er geschiedenis is', () => {
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
      renderProef(true)
      fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
      fireEvent.click(screen.getByText('verlaat'))
      expect(back).toHaveBeenCalledTimes(1)
      expect(push).not.toHaveBeenCalled()
    })

    it('verlaat gebruikt de fallback van de BackButton zonder geschiedenis', () => {
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
      renderProef(true)
      fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
      fireEvent.click(screen.getByText('verlaat'))
      expect(push).toHaveBeenCalledWith('/events/e1')
      expect(back).not.toHaveBeenCalled()
    })

    it('blijf laat de terugpijl ongemoeid: router.back is niet aangeroepen', () => {
      renderProef(true)
      fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
      fireEvent.click(screen.getByText('blijf'))
      expect(back).not.toHaveBeenCalled()
      expect(screen.getByTestId('doel')).toHaveTextContent('geen')
    })

    it('zonder actieve bewaking werkt de terugpijl gewoon (router.back)', () => {
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
      renderProef(false)
      fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
      expect(back).toHaveBeenCalledTimes(1)
    })
  })
})
