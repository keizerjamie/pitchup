'use client'

// Bewerkformulier voor een bestaande training of wedstrijd. Puur UI: de
// pagina (app/events/[id]/edit/page.tsx) dwingt recht en type af en geeft de
// huidige waarden door; updateEvent toetst alles opnieuw server-side. Type,
// verzameltijd, trainingstype en uitslag zijn hier bewust niet bewerkbaar.

import { useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import ActionBar from '@/components/ui/ActionBar'
import Button, { LinkButton } from '@/components/ui/Button'
import EventFormFields from '@/components/EventFormFields'
import { updateEvent } from '@/app/actions/events'
import { useDict } from '@/lib/i18n-context'
import type { EventUpdateErrorCode } from '@/lib/event-input'
import type { HomeAway, MatchType } from '@/lib/types'

type Props = {
  event: {
    id: string
    type: 'training' | 'match'
    date: string
    time: string // al 'HH:MM' of ''
    location: string
    notes: string
    opponent: string
    matchType: MatchType | null
    homeAway: HomeAway | null
  }
}

// Bij succes eindigt updateEvent met redirect(): de client-await rejecteert
// dan met een NEXT_REDIRECT-fout terwijl Next de navigatie uitvoert. Dat is
// geen mislukking en mag niet als fout in beeld komen.
function isRedirectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('digest' in err)) return false
  const digest = (err as { digest: unknown }).digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

export default function EditEventForm({ event }: Props) {
  const t = useDict()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    try {
      const result = await updateEvent(event.id, formData)
      // Alleen een { error } komt hier terug; succes redirect en rejecteert.
      if (result && result.error) {
        const code: EventUpdateErrorCode = result.error
        setError(t.event.editErrors[code] ?? t.event.editErrorGeneric)
        setIsLoading(false)
      }
    } catch (err) {
      // Redirect: knop blijft in de bezig-state tot de navigatie klaar is.
      if (isRedirectError(err)) return
      setError(t.event.editErrorGeneric)
      setIsLoading(false)
    }
  }

  const title = event.type === 'match' ? t.event.editTitleMatch : t.event.editTitleTraining

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <PageHeader backFallback={`/events/${event.id}`} title={title} className="mb-6" />

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div role="alert" className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        <div className="bg-surface rounded-2xl p-6 border border-[var(--border-soft)] space-y-5">
          <EventFormFields
            type={event.type}
            defaults={{
              date: event.date,
              time: event.time,
              location: event.location,
              notes: event.notes,
              opponent: event.opponent,
              matchType: event.matchType,
              homeAway: event.homeAway,
            }}
          />
        </div>

        <ActionBar
          secondary={<LinkButton href={`/events/${event.id}`} variant="secondary">{t.common.cancel}</LinkButton>}
          primary={
            <Button type="submit" loading={isLoading} variant={event.type === 'match' ? 'match' : 'primary'}>
              {isLoading ? t.event.saving : t.event.saveChanges}
            </Button>
          }
        />
      </form>
    </div>
  )
}
