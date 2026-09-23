import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import JoinedBanner from '@/components/dashboard/JoinedBanner'

const mockReplace = vi.fn()
let mockSearch = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

function renderBanner(search: string, teamName = 'FC Voorbeeld') {
  mockSearch = search
  return render(
    <DictProvider dict={nl}>
      <JoinedBanner teamName={teamName} />
    </DictProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JoinedBanner', () => {
  it('zonder ?joined=1 toont niets', () => {
    renderBanner('')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('met ?joined=1 toont de melding met de teamnaam, en wist meteen de query-param', async () => {
    renderBanner('?joined=1', 'FC Alpha')
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.getByText(nl.invite.joined.replace('{team}', 'FC Alpha'))).toBeInTheDocument()
    expect(mockReplace).toHaveBeenCalledWith('/', { scroll: false })
  })

  it('de sluitknop verbergt de banner', async () => {
    renderBanner('?joined=1')
    await waitFor(() => screen.getByRole('status'))
    screen.getByRole('button', { name: nl.common.close }).click()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
