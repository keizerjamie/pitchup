import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TodoList, { type TodoItem } from '@/components/dashboard/TodoList'

vi.mock('@/app/actions/todos', () => ({
  markTaskDone: vi.fn().mockResolvedValue(undefined),
  reopenTask: vi.fn().mockResolvedValue(undefined),
}))
import { markTaskDone, reopenTask } from '@/app/actions/todos'
const mockDone = markTaskDone as unknown as ReturnType<typeof vi.fn>
const mockReopen = reopenTask as unknown as ReturnType<typeof vi.fn>

const ALLE = { squad: true, lineup: true, analysis: true, training_plan: true, self_review: true }

function item(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    eventId: 'e1', taskType: 'squad', opponent: 'FC Test',
    deadline: '2099-01-01', eventDate: '2099-01-02', auto: false, manual: false,
    ...overrides,
  }
}

function view(items: TodoItem[], canEditTask = ALLE, vandaag = '2026-11-16') {
  return (
    <DictProvider dict={nl}>
      <TodoList items={items} canEditTask={canEditTask} vandaag={vandaag} />
    </DictProvider>
  )
}

const knop = (naam: string) => screen.getByRole('button', { name: naam })

beforeEach(() => {
  mockDone.mockReset().mockResolvedValue(undefined)
  mockReopen.mockReset().mockResolvedValue(undefined)
})

describe('TodoList', () => {
  describe('"Te laat" volgt de vandaag-prop', () => {
    it('deadline gisteren (t.o.v. vandaag) is te laat', () => {
      render(view([item({ deadline: '2026-11-15' })]))
      expect(screen.getByText(nl.todo.overdue)).toBeInTheDocument()
    })

    it('deadline vandaag is niet te laat', () => {
      render(view([item({ deadline: '2026-11-16' })]))
      expect(screen.queryByText(nl.todo.overdue)).not.toBeInTheDocument()
    })

    it('dezelfde taak is wel te laat zodra vandaag een dag opschuift (middernacht Amsterdam)', () => {
      const { rerender } = render(view([item({ deadline: '2026-11-16' })], ALLE, '2026-11-16'))
      expect(screen.queryByText(nl.todo.overdue)).not.toBeInTheDocument()
      rerender(view([item({ deadline: '2026-11-16' })], ALLE, '2026-11-17'))
      expect(screen.getByText(nl.todo.overdue)).toBeInTheDocument()
    })

    it('een afgevinkte taak met verstreken deadline is niet te laat', () => {
      render(view([item({ deadline: '2026-11-01', auto: true })]))
      expect(screen.queryByText(nl.todo.overdue)).not.toBeInTheDocument()
    })
  })

  it('toont de lege staat zonder taken', () => {
    render(view([]))
    expect(screen.getByText(nl.todo.empty)).toBeInTheDocument()
  })

  it('vinkt direct af, roept markTaskDone aan en de teller beweegt mee', async () => {
    let resolve: () => void = () => {}
    mockDone.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))
    render(view([item()]))
    expect(screen.getByText('1')).toBeInTheDocument()
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
    expect(mockDone).toHaveBeenCalledWith('e1', 'squad')
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    await act(async () => { resolve() })
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('heropent een handmatig afgevinkte taak met reopenTask', async () => {
    render(view([item({ manual: true })]))
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(mockReopen).toHaveBeenCalledWith('e1', 'squad')
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
  })

  it('knoppen blijven klikbaar terwijl een andere taak nog opslaat', async () => {
    let resolve: () => void = () => {}
    mockDone.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))
    render(view([item(), item({ taskType: 'lineup' })]))
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(knop(nl.todo.taskLineup)).not.toBeDisabled()
    await act(async () => { fireEvent.click(knop(nl.todo.taskLineup)) })
    expect(mockDone).toHaveBeenCalledTimes(2)
    await act(async () => { resolve() })
  })

  it('rollback + i18n-melding (niet de serverstring) als markTaskDone faalt', async () => {
    mockDone.mockRejectedValueOnce(new Error('Geen toegang'))
    render(view([item()]))
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent(nl.todo.saveError)
    expect(screen.queryByText('Geen toegang')).not.toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('rollback bij een falende reopenTask: weer afgevinkt', async () => {
    mockReopen.mockRejectedValueOnce(new Error('x'))
    render(view([item({ manual: true })]))
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('de melding verdwijnt bij de volgende tik', async () => {
    mockDone.mockRejectedValueOnce(new Error('x'))
    render(view([item()]))
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('zonder recht voor het taaktype is alleen dat vinkje uitgeschakeld', () => {
    render(view([item(), item({ taskType: 'training_plan' })], { ...ALLE, training_plan: false }))
    expect(knop(nl.todo.taskTraining)).toBeDisabled()
    expect(knop(nl.todo.taskSquad)).not.toBeDisabled()
  })

  it('een auto-taak blijft afgevinkt', async () => {
    render(view([item({ auto: true })]))
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { fireEvent.click(knop(nl.todo.taskSquad)) })
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
  })

  it('neemt nieuwe server-props over', () => {
    const { rerender } = render(view([item()]))
    rerender(view([item({ manual: true })]))
    expect(knop(nl.todo.taskSquad)).toHaveAttribute('aria-pressed', 'true')
  })

  describe('zelfreview-item', () => {
    const review = (o: Partial<TodoItem> = {}) =>
      item({ taskType: 'self_review', opponent: null, deadline: '2020-01-01', eventDate: '2020-01-01', ...o })

    it('toont label, context "Training" en linkt naar de zelfreview-sectie', () => {
      render(view([review({ eventId: 'tr1' })]))
      const link = screen.getByRole('link', { name: new RegExp(nl.todo.taskSelfReview) })
      expect(link).toHaveAttribute('href', '/events/tr1#mijn-zelfreview')
      expect(link).toHaveTextContent(nl.event.training)
    })

    it('het vinkje is altijd uitgeschakeld, ook mét recht, en roept geen action aan', async () => {
      render(view([review()]))
      const vink = knop(nl.todo.taskSelfReview)
      expect(vink).toBeDisabled()
      expect(vink).toHaveAttribute('title', nl.todo.selfReviewAutoDone)
      await act(async () => { fireEvent.click(vink) })
      expect(mockDone).not.toHaveBeenCalled()
      expect(mockReopen).not.toHaveBeenCalled()
    })

    it('aria-pressed volgt auto: open = false, ingevuld = true en doorgestreept', () => {
      const { rerender } = render(view([review()]))
      expect(knop(nl.todo.taskSelfReview)).toHaveAttribute('aria-pressed', 'false')
      rerender(view([review({ auto: true })]))
      expect(knop(nl.todo.taskSelfReview)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText(nl.todo.taskSelfReview)).toHaveClass('line-through')
    })

    it('toont nooit "Te laat", ook niet met een verstreken datum', () => {
      render(view([review()]))
      expect(screen.queryByText(nl.todo.overdue)).not.toBeInTheDocument()
    })

    it('telt een open review mee in de teller en een ingevulde niet', () => {
      const { rerender } = render(view([review(), item()]))
      expect(screen.getByText('2')).toBeInTheDocument()
      rerender(view([review({ auto: true }), item()]))
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })
})
