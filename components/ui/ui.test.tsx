import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

const push = vi.fn()
const back = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back }) }))

import Button, { LinkButton, IconButton, buttonClasses } from '@/components/ui/Button'
import OverflowMenu from '@/components/ui/OverflowMenu'
import PageHeader from '@/components/ui/PageHeader'
import ActionBar from '@/components/ui/ActionBar'
import PageSkeleton from '@/components/ui/Skeleton'

function renderNl(ui: React.ReactElement) {
  return render(<DictProvider dict={nl}>{ui}</DictProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Button', () => {
  it('rendert standaard een primaire, ronde md-knop met type="button"', () => {
    render(<Button>Opslaan</Button>)
    const btn = screen.getByRole('button', { name: 'Opslaan' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn.className).toContain('btn-primary')
    expect(btn.className).toContain('rounded-full')
    expect(btn.className).toContain('h-11')
  })

  it('kent elke variant een eigen thema-klasse toe', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'warning'] as const) {
      expect(buttonClasses({ variant })).toContain(`btn-${variant}`)
    }
  })

  it('schakelt uit en meldt aria-busy tijdens loading', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Opslaan</Button>)
    const btn = screen.getByRole('button', { name: 'Opslaan' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('toont een icoonnaam als aria-hidden Material Symbol', () => {
    render(<Button icon="add">Nieuw</Button>)
    const icon = screen.getByText('add')
    expect(icon).toHaveClass('ms')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Nieuw' })).toBeInTheDocument()
  })

  it('LinkButton rendert een link met dezelfde klassen', () => {
    render(<LinkButton href="/events/new" variant="secondary">Nieuw event</LinkButton>)
    const link = screen.getByRole('link', { name: 'Nieuw event' })
    expect(link).toHaveAttribute('href', '/events/new')
    expect(link.className).toContain('btn-secondary')
  })

  it('IconButton gebruikt de verplichte aria-label als naam', () => {
    render(<IconButton aria-label="Sluiten"><svg /></IconButton>)
    expect(screen.getByRole('button', { name: 'Sluiten' })).toBeInTheDocument()
  })
})

describe('OverflowMenu', () => {
  it('is dicht tot de ⋯-knop wordt ingedrukt en sluit met Escape', () => {
    renderNl(<OverflowMenu items={[{ label: 'Bewerken', href: '/x/edit' }]} />)
    const trigger = screen.getByRole('button', { name: nl.common.moreActions })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Bewerken' })).toHaveAttribute('href', '/x/edit')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('sluit bij een klik buiten het menu', () => {
    renderNl(<div><p>buiten</p><OverflowMenu items={[{ label: 'Bewerken', href: '/x' }]} /></div>)
    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    fireEvent.pointerDown(screen.getByText('buiten'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('voert een destructieve actie pas uit na bevestiging', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderNl(<OverflowMenu items={[{ label: 'Verwijderen', danger: true, confirm: 'Zeker?', action }]} />)

    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Verwijderen' }))
    expect(confirmSpy).toHaveBeenCalledWith('Zeker?')
    expect(action).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Verwijderen' }))
    await act(async () => {})
    expect(action).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })

  it('zet een scheidingslijn vóór het eerste destructieve item', () => {
    renderNl(<OverflowMenu items={[
      { label: 'Bewerken', href: '/x' },
      { label: 'Verwijderen', danger: true, onSelect: () => {} },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: nl.common.moreActions }))
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('rendert niets zonder items', () => {
    const { container } = renderNl(<OverflowMenu items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PageHeader', () => {
  it('toont titel als h1, ondertitel, hoofdactie en ⋯-menu', () => {
    renderNl(
      <PageHeader
        title="vs CJVV"
        subtitle="Zaterdag 24 oktober"
        backFallback="/events"
        actions={<Button>Opslaan</Button>}
        menu={[{ label: 'Bewerken', href: '/e/edit' }]}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'vs CJVV' })).toHaveClass('page-title')
    expect(screen.getByText('Zaterdag 24 oktober')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opslaan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.common.moreActions })).toBeInTheDocument()
  })

  it('terugknop gaat naar de fallback zonder geschiedenis', () => {
    Object.defineProperty(window.history, 'length', { configurable: true, value: 1 })
    renderNl(<PageHeader title="Speler" backFallback="/players" />)
    fireEvent.click(screen.getByRole('button', { name: nl.nav.back }))
    expect(push).toHaveBeenCalledWith('/players')
  })

  it('heeft geen terugknop en geen actiezone als die niet zijn opgegeven', () => {
    renderNl(<PageHeader title="Spelers" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('ActionBar', () => {
  it('zet secundair vóór primair (Annuleren links, Opslaan rechts)', () => {
    render(<ActionBar secondary={<Button variant="secondary">Annuleren</Button>} primary={<Button type="submit">Opslaan</Button>} />)
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveAccessibleName('Annuleren')
    expect(second).toHaveAccessibleName('Opslaan')
    expect(second).toHaveAttribute('type', 'submit')
  })
})

describe('PageSkeleton', () => {
  it('meldt zich als status met een leesbaar label en heeft geen animatieklassen', () => {
    const { container } = render(<PageSkeleton label="Laden..." />)
    expect(screen.getByRole('status')).toHaveTextContent('Laden...')
    expect(container.innerHTML).not.toMatch(/animate-/)
  })
})
