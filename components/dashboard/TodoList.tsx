'use client'

import Link from 'next/link'
import { useState } from 'react'
import { markTaskDone, reopenTask } from '@/app/actions/todos'
import { useDict } from '@/lib/i18n-context'
import { useRijOpslag } from '@/lib/use-rij-opslag'
import { daysUntil, formatDate } from '@/lib/utils'

export type TaskType = 'squad' | 'lineup' | 'analysis' | 'training_plan'

export interface TodoItem {
  eventId: string
  taskType: TaskType
  opponent: string | null
  deadline: string   // 'YYYY-MM-DD'
  eventDate: string   // 'YYYY-MM-DD'
  auto: boolean
  manual: boolean
}

const taskKey = (item: TodoItem) => `${item.eventId}:${item.taskType}`
const manualVan = (items: TodoItem[]): Record<string, boolean> =>
  Object.fromEntries(items.map((item) => [taskKey(item), item.manual]))

// Route per taak-type — zelfde paden als de ActionCard-hrefs op de event-detailpagina.
const TASK_HREF: Record<TaskType, string> = {
  squad: 'squad',
  lineup: 'lineup',
  analysis: 'analysis',
  training_plan: 'training-plan',
}

// Server-gesorteerde To-do-lijst: open wedstrijdselecties, opstellingen,
// wedstrijdanalyses en trainingsplannen. Checkbox = optimistisch (lokale manual-state), auto-done
// taken blijven altijd aangevinkt (ook na "reopen" — bewust, zie brief).
//
// `canEditTask` (brief §4.5): markTaskDone/reopenTask vragen 'training' bij
// task_type='training_plan', anders 'wedstrijd' (squad/lineup/analysis) —
// app/page.tsx berekent die twee waarden en geeft ze hier als kaart door.
// Zonder het bijbehorende recht blijft de taak zichtbaar en aanklikbaar (de
// link naar de onderliggende pagina blijft werken), alleen het vinkje zelf
// wordt uitgeschakeld.
export default function TodoList({ items, canEditTask }: { items: TodoItem[]; canEditTask: Record<TaskType, boolean> }) {
  const t = useDict()
  const [saveError, setSaveError] = useState(false)
  const { waarden: manual, zet, synchroniseer } = useRijOpslag<boolean>({
    bevestigd: manualVan(items),
    opslaan: (key, done) => {
      const item = items.find((i) => taskKey(i) === key)
      // Onbekende sleutel kan alleen als de lijst intussen is ververst; dan
      // is er niets meer op te slaan.
      if (!item) return Promise.resolve()
      return done ? markTaskDone(item.eventId, item.taskType) : reopenTask(item.eventId, item.taskType)
    },
    onFout: () => setSaveError(true),
  })

  // Nieuwe server-props (na revalidatePath('/')): serverwaarde overnemen voor
  // taken die niet onderweg zijn. "Adjust state during render", zoals
  // PlayerAbsenceList.
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    synchroniseer(manualVan(items))
  }

  function toggle(item: TodoItem) {
    const key = taskKey(item)
    const effective = item.auto || manual[key]
    setSaveError(false)
    zet(key, !effective)
  }

  const label: Record<TaskType, string> = {
    squad: t.todo.taskSquad,
    lineup: t.todo.taskLineup,
    analysis: t.todo.taskAnalysis,
    training_plan: t.todo.taskTraining,
  }

  // Teller = alleen ÓPEN taken (afgevinkt telt niet mee) en beweegt live mee
  // met de optimistische checkbox-state.
  const openCount = items.filter((item) => !(item.auto || manual[taskKey(item)])).length

  return (
    <div className="surface-card p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-faint">{t.todo.title}</span>
        {openCount > 0 && (
          <span
            className="text-[11px] font-extrabold px-2 py-[2px] rounded-full"
            style={{ color: 'var(--warning-text)', background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }}
          >
            {openCount}
          </span>
        )}
      </div>

      {saveError && (
        <p role="alert" className="text-[13px] font-semibold text-panel-red-ink bg-panel-red border border-panel-red-edge px-3 py-2 rounded-lg">
          {t.todo.saveError}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-[13.5px] text-faint font-medium py-2">{t.todo.empty}</p>
      ) : (
        items.map((item) => {
          const key = taskKey(item)
          const checked = item.auto || manual[key]
          const overdue = !checked && daysUntil(item.deadline) < 0
          const context = item.opponent ? `${t.lineup.vsLabel} ${item.opponent}` : t.event.training

          return (
            <div
              key={key}
              className="flex items-center gap-3.5 p-3 rounded-[15px] bg-surface-sunken"
              style={{ border: '1px solid var(--border-soft)' }}
            >
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={!canEditTask[item.taskType]}
                aria-pressed={checked}
                aria-label={label[item.taskType]}
                title={canEditTask[item.taskType] ? undefined : t.errors.noPermission}
                className="relative hit-slop w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-60"
                style={checked
                  ? { background: 'var(--primary)', color: '#fff' }
                  : { background: 'var(--surface)', border: '1.5px solid var(--border-soft)' }}
              >
                {checked && <span className="ms text-[19px]">check</span>}
              </button>

              <Link
                href={`/events/${item.eventId}/${TASK_HREF[item.taskType]}`}
                className="flex-1 flex flex-col gap-0.5"
                style={{ minWidth: 0 }}
              >
                <span className={`text-[14.5px] font-bold leading-snug line-clamp-2 ${checked ? 'line-through text-faint' : 'text-ink'}`}>{label[item.taskType]}</span>
                <span className="text-[12.5px] font-semibold text-muted truncate">{context}</span>
              </Link>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span
                  className="text-[12.5px] font-bold"
                  style={overdue ? { color: 'var(--warning)' } : undefined}
                >
                  {formatDate(item.deadline, t.browserLocale)}
                </span>
                {overdue && (
                  <span
                    className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-[2px] rounded-md"
                    style={{ color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 14%, transparent)' }}
                  >
                    {t.todo.overdue}
                  </span>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
