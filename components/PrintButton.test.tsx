import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import PrintButton from '@/components/PrintButton'
import { volgOpslag } from '@/lib/opslag-wachtrij'

describe('PrintButton', () => {
  // Expliciete signatuur: vitest 4 typeert een generieke vi.fn() als
  // Procedure | Constructable, wat niet op window.print past.
  let printSpy: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    printSpy = vi.fn<() => void>()
    window.print = printSpy
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderButton() {
    return render(
      <DictProvider dict={nl}>
        <PrintButton pdf={{ doel: 'trainingsplan', eventId: 'e1', datum: '2026-10-28' }} />
      </DictProvider>,
    )
  }

  it('toont een knop met het label uit de dictionary', () => {
    renderButton()
    expect(screen.getByRole('button', { name: nl.trainingPlan.print })).toBeInTheDocument()
  })

  it('roept window.print() precies één keer aan bij een klik, zonder navigatie', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('is een knop van type "button" (geen submit, geen link/navigatie)', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('is verborgen op de afdruk zelf (print:hidden) — de knop is bedieningselement, geen inhoud', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button.className).toContain('print:hidden')
  })

  it('zonder disabled-prop: ongewijzigd gedrag — knop is niet disabled', () => {
    renderButton()
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button).not.toBeDisabled()
  })

  describe('iOS-beginscherm-app (navigator.standalone)', () => {
    let writeText: ReturnType<typeof vi.fn<(tekst: string) => Promise<void>>>

    beforeEach(() => {
      writeText = vi.fn<(tekst: string) => Promise<void>>().mockResolvedValue(undefined)
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    })

    afterEach(() => {
      delete (window.navigator as Navigator & { standalone?: boolean }).standalone
      Reflect.deleteProperty(window.navigator, 'clipboard')
    })

    it('toont een melding in plaats van window.print() aan te roepen', () => {
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      expect(printSpy).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toHaveTextContent(nl.trainingPlan.printStandaloneHint)
    })

    it('"Link kopiëren" zet de huidige URL op het klembord en bevestigt dat', async () => {
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.printCopyLink }))
      expect(writeText).toHaveBeenCalledWith(window.location.href)
      expect(await screen.findByRole('button', { name: nl.trainingPlan.printLinkCopied })).toBeInTheDocument()
    })

    it('klembord faalt: toont de link in een veld om zelf te kopiëren', async () => {
      writeText.mockRejectedValue(new Error('geweigerd'))
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.printCopyLink }))
      const veld = await screen.findByRole('textbox', { name: nl.trainingPlan.printCopyFailed })
      expect(veld).toHaveValue(window.location.href)
    })

    it('tik buiten de melding sluit hem', () => {
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('navigator.standalone === false (Safari zelf): gewoon window.print(), geen melding', () => {
      Object.defineProperty(window.navigator, 'standalone', { value: false, configurable: true })
      renderButton()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.print }))
      expect(printSpy).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('disabled={true}: de knop heeft het disabled-attribuut en een klik roept window.print() niet aan', () => {
    render(
      <DictProvider dict={nl}>
        <PrintButton disabled pdf={{ doel: 'trainingsplan', eventId: 'e1', datum: '2026-10-28' }} />
      </DictProvider>,
    )
    const button = screen.getByRole('button', { name: nl.trainingPlan.print })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(printSpy).not.toHaveBeenCalled()
  })
  describe('delen-modus (touch + bestand delen)', () => {
    const PDF = { doel: 'trainingsplan', eventId: 'e1', datum: '2026-10-28' } as const
    let share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>
    let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>
    let assign: ReturnType<typeof vi.fn<(url: string) => void>>

    function pdfResponse(over: Partial<{ ok: boolean; status: number; type: string; contentType: string }> = {}) {
      const { ok = true, status = 200, type = 'basic', contentType = 'application/pdf' } = over
      return {
        ok,
        status,
        type,
        headers: new Headers({ 'content-type': contentType }),
        blob: async () => new Blob(['%PDF-1.7']),
      } as unknown as Response
    }

    function renderDelen(pdf: React.ComponentProps<typeof PrintButton>['pdf'] = PDF) {
      return render(
        <DictProvider dict={nl}>
          <PrintButton pdf={pdf} />
        </DictProvider>,
      )
    }

    function fout(naam: string) {
      return Object.assign(new Error('x'), { name: naam })
    }

    // findBy* kan resolven zodra de DOM verschijnt, nog vóór React de
    // passieve effecten (document-listeners, opslag-abonnement) heeft
    // gekoppeld. Eerst die effecten laten uitvoeren, dan pas interactie.
    async function effectenUitvoeren() {
      await act(async () => { await Promise.resolve() })
    }

    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('pointer: coarse'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      })
      share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined)
      Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
      Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true })
      fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(pdfResponse())
      vi.stubGlobal('fetch', fetchMock)
      assign = vi.fn<(url: string) => void>()
      vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost/' })
    })

    afterEach(() => {
      Reflect.deleteProperty(window.navigator, 'share')
      Reflect.deleteProperty(window.navigator, 'canShare')
      vi.unstubAllGlobals()
      vi.useRealTimers()
    })

    it('toont het label "Delen" in plaats van "Afdrukken"', () => {
      renderDelen()
      expect(screen.getByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: nl.trainingPlan.print })).not.toBeInTheDocument()
    })

    it('een klik haalt /api/pdf op (met id en tz) en deelt een PDF-bestand met de datum van het event', async () => {
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))

      const [url, init] = fetchMock.mock.calls[0]
      const params = new URL(url, 'http://localhost').searchParams
      expect(url.startsWith('/api/pdf?')).toBe(true)
      expect(params.get('doel')).toBe('trainingsplan')
      expect(params.get('id')).toBe('e1')
      expect(params.get('tz')).toBeTruthy()
      expect(init?.redirect).toBe('manual')

      const bestand = share.mock.calls[0][0].files?.[0] as File
      expect(bestand.name).toBe('Trainingsplan 28-10-2026.pdf')
      expect(bestand.type).toBe('application/pdf')
      expect(printSpy).not.toHaveBeenCalled()
      expect(await screen.findByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
    })

    it('aanwezigheid: stuurt periode mee en gebruikt de datum van vandaag op het toestel', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 25, 23, 30) })
      renderDelen({ doel: 'aanwezigheid', periode: '8w' })
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
      const params = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams
      expect(params.get('periode')).toBe('8w')
      expect(params.has('id')).toBe(false)
      expect((share.mock.calls[0][0].files?.[0] as File).name).toBe('Aanwezigheid 25-10-2026.pdf')
    })

    it('dubbel tikken tijdens het maken geeft precies één fetch en toont de bezig-staat', async () => {
      let klaar!: (r: Response) => void
      fetchMock.mockReturnValue(new Promise<Response>((res) => { klaar = res }))
      renderDelen()
      const knop = screen.getByRole('button', { name: nl.trainingPlan.share })
      fireEvent.click(knop)
      const bezig = await screen.findByRole('button', { name: nl.trainingPlan.shareBusy })
      expect(bezig).toHaveAttribute('aria-busy', 'true')
      expect(bezig).toHaveAttribute('aria-disabled', 'true')
      expect(bezig).not.toBeDisabled()
      fireEvent.click(bezig)
      fireEvent.click(bezig)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => { klaar(pdfResponse()) })
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    })

    it.each([[500], [502], [404], [429]])('status %i: toont één vaste foutmelding, geen ruwe tekst', async (status) => {
      fetchMock.mockResolvedValue(pdfResponse({ ok: false, status }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(nl.trainingPlan.shareFailed)
      expect(share).not.toHaveBeenCalled()
    })

    it('een antwoord dat geen PDF is, geeft de foutmelding', async () => {
      fetchMock.mockResolvedValue(pdfResponse({ contentType: 'text/html' }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      expect(await screen.findByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
    })

    it('een netwerkfout (fetch gooit) geeft de foutmelding, en een nieuwe tik probeert opnieuw', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('offline'))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('Escape sluit de foutmelding', async () => {
      fetchMock.mockResolvedValue(pdfResponse({ ok: false, status: 500 }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await screen.findByRole('alert')
      await effectenUitvoeren()
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

    it('opaqueredirect (sessie verlopen): naar /login, geen foutmelding', async () => {
      fetchMock.mockResolvedValue(pdfResponse({ type: 'opaqueredirect', ok: false, status: 0 }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('een 401 uit de route zelf wordt behandeld als de opaqueredirect', async () => {
      fetchMock.mockResolvedValue(pdfResponse({ ok: false, status: 401 }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('AbortError (gebruiker annuleert): geen melding en terug naar idle', async () => {
      share.mockRejectedValue(fout('AbortError'))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
      expect(await screen.findByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('een andere share-fout geeft de foutmelding', async () => {
      share.mockRejectedValue(fout('DataError'))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      expect(await screen.findByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
    })

    it('NotAllowedError (gebaar verlopen): PDF klaar; de tweede tik deelt zonder nieuwe fetch', async () => {
      share.mockRejectedValueOnce(fout('NotAllowedError'))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      const klaar = await screen.findByRole('button', { name: nl.trainingPlan.shareReady })
      expect(screen.getByRole('status')).toHaveTextContent(nl.trainingPlan.shareReadyHint)
      fireEvent.click(klaar)
      await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect((share.mock.calls[1][0].files?.[0] as File).name).toBe('Trainingsplan 28-10-2026.pdf')
      expect(await screen.findByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
    })

    it('NotAllowedError ook bij de tweede tik: terug naar klaar met hetzelfde bestand', async () => {
      share.mockRejectedValueOnce(fout('NotAllowedError')).mockRejectedValueOnce(fout('NotAllowedError'))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      fireEvent.click(await screen.findByRole('button', { name: nl.trainingPlan.shareReady }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
      expect(await screen.findByRole('button', { name: nl.trainingPlan.shareReady })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(nl.trainingPlan.shareReadyHint)
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.shareReady }))
      await waitFor(() => expect(share).toHaveBeenCalledTimes(3))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('fetch-timeout start pas na het wachten op de opslag en ligt boven maxDuration', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let ronde!: () => void
      volgOpslag(new Promise<void>((res) => { ronde = res }))
      fetchMock.mockImplementation((_url, init) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')))
      }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      await act(async () => { ronde() })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      // 64 s na de start van de fetch: nog steeds bezig (server mag 60 s renderen).
      await act(async () => { await vi.advanceTimersByTimeAsync(64_000) })
      expect(screen.getByRole('button', { name: nl.trainingPlan.shareBusy })).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(screen.getByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
    })

    it('userActivation niet meer actief: gaat direct naar klaar zonder share-poging', async () => {
      Object.defineProperty(window.navigator, 'userActivation', { value: { isActive: false }, configurable: true })
      try {
        renderDelen()
        fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
        await screen.findByRole('button', { name: nl.trainingPlan.shareReady })
        expect(share).not.toHaveBeenCalled()
      } finally {
        Reflect.deleteProperty(window.navigator, 'userActivation')
      }
    })

    describe('klaar-staat vervalt', () => {
      async function naarKlaar() {
        share.mockRejectedValueOnce(fout('NotAllowedError'))
        renderDelen()
        fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
        await screen.findByRole('button', { name: nl.trainingPlan.shareReady })
      }

      it('na 60 s', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        await naarKlaar()
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
        expect(screen.getByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
      })

      it('zodra er een nieuwe opslag in de wachtrij komt', async () => {
        await naarKlaar()
        await effectenUitvoeren()
        act(() => { volgOpslag(Promise.resolve()) })
        expect(screen.getByRole('button', { name: nl.trainingPlan.share })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      })
    })

    it('opslag duurt langer dan de time-out: foutmelding en geen fetch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let ronde!: () => void
      volgOpslag(new Promise<void>((res) => { ronde = res }))
      renderDelen()
      fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(screen.getByRole('alert')).toHaveTextContent(nl.trainingPlan.shareFailed)
      expect(fetchMock).not.toHaveBeenCalled()
      ronde()
    })

    it('disabled blijft: geen fetch bij een klik', () => {
      render(
        <DictProvider dict={nl}>
          <PrintButton disabled pdf={PDF} />
        </DictProvider>,
      )
      const knop = screen.getByRole('button', { name: nl.trainingPlan.share })
      expect(knop).toBeDisabled()
      fireEvent.click(knop)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('beginscherm-app mét canShare: delen in plaats van de linkmelding', async () => {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
      try {
        renderDelen()
        fireEvent.click(screen.getByRole('button', { name: nl.trainingPlan.share }))
        await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      } finally {
        delete (window.navigator as Navigator & { standalone?: boolean }).standalone
      }
    })
  })
})
