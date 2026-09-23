'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertOwnEvent } from '@/lib/authz'
import { isValidTaskType } from '@/lib/todos.mjs'
import { genericError } from '@/lib/errors'
import { assertCanEdit, requireTeamContext } from '@/lib/team-context'

type TaskType = 'squad' | 'lineup' | 'analysis' | 'training_plan'

// Vinkt een taak (squad/lineup/analysis/training_plan) voor een event handmatig af.
// Idempotent: onConflict laat een bestaande rij ongemoeid.
export async function markTaskDone(eventId: string, taskType: TaskType): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  if (!isValidTaskType(taskType)) throw new Error('Ongeldige taak')

  // Afvinken volgt het onderdeel van de taak, gelijk aan de RLS-policy op
  // task_overrides: het trainingsplan hoort bij Training, squad/lineup/analysis
  // bij Wedstrijd.
  assertCanEdit(ctx, taskType === 'training_plan' ? 'training' : 'wedstrijd')

  await assertOwnEvent(supabase, eventId, ctx.teamId)

  const { error } = await supabase
    .from('task_overrides')
    .upsert(
      { team_id: ctx.teamId, event_id: eventId, task_type: taskType },
      { onConflict: 'team_id,event_id,task_type' },
    )

  if (error) throw genericError('todos.markTaskDone', error)
  revalidatePath('/')
}

// Heropent een handmatig afgevinkte taak. Idempotente no-op als er geen rij is.
export async function reopenTask(eventId: string, taskType: TaskType): Promise<void> {
  const supabase = await createClient()
  const ctx = await requireTeamContext()

  if (!isValidTaskType(taskType)) throw new Error('Ongeldige taak')

  // Afvinken volgt het onderdeel van de taak, gelijk aan de RLS-policy op
  // task_overrides: het trainingsplan hoort bij Training, squad/lineup/analysis
  // bij Wedstrijd.
  assertCanEdit(ctx, taskType === 'training_plan' ? 'training' : 'wedstrijd')

  await assertOwnEvent(supabase, eventId, ctx.teamId)

  const { error } = await supabase
    .from('task_overrides')
    .delete()
    .eq('team_id', ctx.teamId)
    .eq('event_id', eventId)
    .eq('task_type', taskType)

  if (error) throw genericError('todos.reopenTask', error)
  revalidatePath('/')
}
