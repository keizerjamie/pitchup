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

const ALLE = { squad: true, lineup: true, analysis: true, training_plan: true }

function item(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    eventId: 'e1', taskType: 'squad', opponent: 'FC Test',
    deadline: '2099-01-01', eventDate: '2099-01-02', auto: false, manual: false,
    ...overrides,
  }
}

function view(items: TodoItem[], canEditTask = ALLE) {
  return (
    <DictProvider dict={nl}>
      <TodoList items={items} canEditTask={canEditTask} />
    </DictProvider>
  )
}

const knop = (naam: string) => screen.getByRole('button', { name: naam })

beforeEach(() => {
  mockDone.mockReset().mockResolvedValue(undefined)
  mockReopen.mockReset().mockResolvedValue(undefined)
})

describe('TodoList', () => {
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
})
