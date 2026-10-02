import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND') })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/app/actions/events', () => ({ updateEvent: vi.fn() }))

const eqCalls: Array<[string, unknown]> = []
let eventRow: Record<string, unknown> | null = null
let allowed = true
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return q }
    q.maybeSingle = async () => ({ data: eventRow, error: null })
    return { from: () => q }
  },
}))
vi.mock('@/lib/team-context', () => ({
  requireTeamContextOrLogin: async () => ({ teamId: 'team-1', userId: 'u1' }),
  canEdit: () => allowed,
}))

import EditEventPage from '@/app/events/[id]/edit/page'

async function renderPage() {
  const ui = await EditEventPage({ params: Promise.resolve({ id: 'e1' }) })
  return render(<DictProvider dict={nl}>{ui}</DictProvider>)
}

beforeEach(() => {
  eqCalls.length = 0
  allowed = true
  redirectMock.mockClear()
  notFoundMock.mockClear()
  eventRow = {
    id: 'e1', type: 'match', date: '2026-10-10', time: '14:30:00', location: null, notes: null,
    opponent: 'FC Test', match_type: 'league', home_away: 'home',
  }
})

describe('EditEventPage', () => {
  it('leest alleen met id én team_id en toont de tijd als HH:MM', async () => {
    const { container } = await renderPage()
    expect(eqCalls).toEqual([['id', 'e1'], ['team_id', 'team-1']])
    expect(container.querySelector('input[name="time"]')).toHaveValue('14:30')
    expect(container.querySelector('input[name="date"]')).toHaveValue('2026-10-10')
    expect(container.querySelector('input[name="location"]')).toHaveValue('')
    expect(container.querySelector('textarea[name="notes"]')).toHaveValue('')
    expect(screen.getByRole('heading', { name: nl.event.editTitleMatch })).toBeInTheDocument()
  })

  it('zonder agenda-recht: redirect naar de detailpagina, geen query', async () => {
    allowed = false
    await expect(renderPage()).rejects.toThrow('REDIRECT:/events/e1')
    expect(eqCalls).toHaveLength(0)
  })

  it('onbekend event of ander team: notFound', async () => {
    eventRow = null
    await expect(renderPage()).rejects.toThrow('NOT_FOUND')
  })

  it('legacy meting: redirect naar de detailpagina', async () => {
    eventRow = { ...eventRow, type: 'meting' }
    await expect(renderPage()).rejects.toThrow('REDIRECT:/events/e1')
  })

  it('training rendert de trainingstitel', async () => {
    eventRow = { ...eventRow, type: 'training', opponent: null, match_type: null, home_away: null }
    await renderPage()
    expect(screen.getByRole('heading', { name: nl.event.editTitleTraining })).toBeInTheDocument()
  })
})
