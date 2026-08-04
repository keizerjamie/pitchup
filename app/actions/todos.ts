'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent } from '@/lib/authz'
import { isValidTaskType } from '@/lib/todos.mjs'
import { genericError } from '@/lib/errors'

type TaskType = 'lineup' | 'analysis' | 'training_plan'

// Vinkt een taak (lineup/analysis/training_plan) voor een event handmatig af.
// Idempotent: onConflict laat een bestaande rij ongemoeid.
export async function markTaskDone(eventId: string, taskType: TaskType): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  if (!isValidTaskType(taskType)) throw new Error('Ongeldige taak')

  await assertOwnEvent(supabase, eventId, user.id)

  const { error } = await supabase
    .from('task_overrides')
    .upsert(
      { team_id: user.id, event_id: eventId, task_type: taskType },
      { onConflict: 'team_id,event_id,task_type' },
    )

  if (error) throw genericError('todos.markTaskDone', error)
  revalidatePath('/')
}

// Heropent een handmatig afgevinkte taak. Idempotente no-op als er geen rij is.
export async function reopenTask(eventId: string, taskType: TaskType): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  if (!isValidTaskType(taskType)) throw new Error('Ongeldige taak')

  await assertOwnEvent(supabase, eventId, user.id)

  const { error } = await supabase
    .from('task_overrides')
    .delete()
    .eq('team_id', user.id)
    .eq('event_id', eventId)
    .eq('task_type', taskType)

  if (error) throw genericError('todos.reopenTask', error)
  revalidatePath('/')
}
