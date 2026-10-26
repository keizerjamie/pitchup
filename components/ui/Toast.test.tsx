import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { ToastProvider, useToast, TOAST_DUUR_MS, TOAST_EXIT_MS, type ToastInput } from '@/components/ui/Toast'

let reduced = false
beforeEach(() => {
  vi.useFakeTimers()
  reduced = false
  window.matchMedia = ((q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? reduced : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  vi.useRealTimers()
})

const handle: { api: ReturnType<typeof useToast> } = { api: { toon() {}, sluit() {} } }
function Capture() {
  const api = useToast()
  useEffect(() => {
    handle.api = api
  }, [api])
  return null
}

function setup(teamId = 'team-1') {
  const ui = (id: string) => (
    <DictProvider dict={nl}>
      <ToastProvider teamId={id}>
        <Capture />
        <button>buiten</button>
      </ToastProvider>
    </DictProvider>
  )
  const r = render(ui(teamId))
  return { ...r, wissel: (id: string) => r.rerender(ui(id)) }
}

function toon(input: ToastInput) {
  act(() => handle.api.toon(input))
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('Toast', () => {
  it('is een no-op zonder provider', () => {
    function Los() {
      const x = useToast()
      return <button onClick={() => x.toon({ bericht: 'x' })}>klik</button>
    }
    render(<Los />)
    fireEvent.click(screen.getByText('klik'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('toont bericht met role=status, actie en sluitknop (common.close)', () => {
    setup()
    toon({ bericht: 'Verwijderd', actie: { label: 'Ongedaan maken', onActie: async () => {}, foutBericht: 'fout' } })
    expect(screen.getByRole('status')).toHaveTextContent('Verwijderd')
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.common.close })).toBeInTheDocument()
  })

  it('verdwijnt na 5000 ms (plus exit-animatie)', async () => {
    setup()
    toon({ bericht: 'Weg' })
    await tick(TOAST_DUUR_MS - 1)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await tick(1 + TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sluitknop sluit de toast', async () => {
    setup()
    toon({ bericht: 'Weg' })
    fireEvent.click(screen.getByRole('button', { name: nl.common.close }))
    await tick(TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('pauzeert bij focus binnen de toast en hervat met resterende tijd', async () => {
    setup()
    toon({ bericht: 'Pauze' })
    await tick(3000)
    const knop = screen.getByRole('button', { name: nl.common.close })
    act(() => knop.focus())
    await tick(10_000)
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => knop.blur())
    await tick(1900)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await tick(100 + TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('pauzeert bij hover (pointerenter) en hervat bij pointerleave', async () => {
    setup()
    toon({ bericht: 'Hover' })
    const el = screen.getByRole('status')
    fireEvent.pointerEnter(el)
    await tick(10_000)
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.pointerLeave(el)
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('pauzeert wanneer het tabblad verborgen is', async () => {
    setup()
    toon({ bericht: 'Verborgen' })
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await tick(10_000)
    expect(screen.getByRole('status')).toBeInTheDocument()
    spy.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('een nieuwe toast vervangt de vorige direct en start de timer opnieuw', async () => {
    setup()
    toon({ bericht: 'Eerste' })
    await tick(4000)
    toon({ bericht: 'Tweede' })
    expect(screen.queryByText('Eerste')).not.toBeInTheDocument()
    expect(screen.getByText('Tweede')).toBeInTheDocument()
    await tick(2000)
    expect(screen.getByText('Tweede')).toBeInTheDocument()
  })

  it('teamwissel wist de toast', () => {
    const { wissel } = setup('team-1')
    toon({ bericht: 'Team 1' })
    wissel('team-2')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('onActie resolve sluit de toast; knop is tijdens de actie disabled + aria-busy', async () => {
    setup()
    let los!: () => void
    const onActie = vi.fn(() => new Promise<void>((r) => { los = r }))
    toon({ bericht: 'B', actie: { label: 'Ongedaan maken', onActie, foutBericht: 'fout' } })
    const knop = screen.getByRole('button', { name: 'Ongedaan maken' })
    fireEvent.click(knop)
    expect(knop).toBeDisabled()
    expect(knop).toHaveAttribute('aria-busy', 'true')
    // Dubbelklik: nog steeds één aanroep.
    fireEvent.click(knop)
    expect(onActie).toHaveBeenCalledTimes(1)
    await act(async () => { los() })
    await tick(TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('onActie reject toont een fouttoast zonder actie (role=alert) die na 5 s verdwijnt', async () => {
    setup()
    toon({ bericht: 'B', actie: { label: 'Ongedaan maken', onActie: async () => { throw new Error('x') }, foutBericht: 'Herstellen is mislukt' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }))
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Herstellen is mislukt')
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).not.toBeInTheDocument()
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 20)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reduced motion: geen translate-beweging, alleen opacity', async () => {
    reduced = true
    setup()
    toon({ bericht: 'Rustig' })
    expect(screen.getByRole('status').style.transform).toBe('none')
  })

  it('muis: klik op sluiten zonder pointerleave -> volgende toast verdwijnt gewoon na 5000 ms', async () => {
    setup()
    toon({ bericht: 'Eerste' })
    fireEvent.pointerEnter(screen.getByTestId('toast-kaart'))
    fireEvent.click(screen.getByRole('button', { name: nl.common.close }))
    await tick(TOAST_EXIT_MS + 20)
    expect(screen.queryByTestId('toast-kaart')).not.toBeInTheDocument()
    toon({ bericht: 'Tweede' })
    await tick(TOAST_DUUR_MS - 1)
    expect(screen.getByText('Tweede')).toBeInTheDocument()
    await tick(1 + TOAST_EXIT_MS + 20)
    expect(screen.queryByText('Tweede')).not.toBeInTheDocument()
  })

  it('muis: nieuwe toast terwijl de cursor nog op de vorige stond (geen pointerleave) start de timer', async () => {
    setup()
    toon({ bericht: 'Eerste' })
    fireEvent.pointerEnter(screen.getByTestId('toast-kaart'))
    toon({ bericht: 'Tweede' })
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 20)
    expect(screen.queryByText('Tweede')).not.toBeInTheDocument()
  })

  it('focus: sluiten met de focus op de toast (zonder blur) -> volgende toast verdwijnt na 5000 ms', async () => {
    setup()
    toon({ bericht: 'Eerste' })
    const knop = screen.getByRole('button', { name: nl.common.close })
    act(() => knop.focus())
    fireEvent.click(knop)
    await tick(TOAST_EXIT_MS + 20)
    toon({ bericht: 'Tweede' })
    await tick(TOAST_DUUR_MS + TOAST_EXIT_MS + 20)
    expect(screen.queryByText('Tweede')).not.toBeInTheDocument()
  })
})
