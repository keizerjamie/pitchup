import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { logError } from '@/lib/errors'
import type { AttendanceStatus, FootballEvent } from '@/lib/types'
import { telAanwezigheid, vasteTelling, type TelbareSpeler } from '@/lib/aanwezigheid-telling'
import { eventBatchGrootte, inBatches, TERUGVAL_BATCH_GROOTTE } from '@/lib/attendance-batches'
import CalendarView from '@/components/CalendarView'

// Eén rij uit de attendance-batches hieronder.
interface AttendanceRij {
  event_id: string
  player_id: string
  status: AttendanceStatus
}

interface SpelerRij extends TelbareSpeler {
  active: boolean
}

export default async function EventsPage() {
  const supabase = await createClient()
  const ctx = await requireTeamContextOrLogin()

  const [{ data: events }, { data: playerRows, error: playerError }] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', ctx.teamId).neq('type', 'meting').order('date', { ascending: false }),
    // ALLE spelers van het team (actief en inactief, vast en gast): `active`
    // en `type` bepalen wie er meetelt, en het totaal bepaalt hoe groot een
    // attendance-batch hieronder mag zijn (een inactieve speler heeft ook rijen).
    supabase.from('players').select('id, type, active').eq('team_id', ctx.teamId),
  ])

  const allEvents: FootballEvent[] = events ?? []

  // Faalt de spelersquery, dan weten we niet wie actief of gast is. Terugval:
  // de oude, ongefilterde telling op de records zelf (teller = aanwezig-rijen,
  // noemer = alle rijen). Een informatieve teller op elke rij weghalen is een
  // grotere regressie dan een zeldzaam afwijkend getal. Alleen een statisch
  // label naar de log, nooit de ruwe PostgREST-fout (lib/errors.ts, logError).
  if (playerError) logError('events.players', playerError)
  const spelers: SpelerRij[] = playerError ? [] : (playerRows ?? [])
  const actieveSpelers = spelers.filter((p) => p.active)

  // Eén attendance-query voor álle events wordt door PostgREST afgekapt op
  // 1000 rijen; dan tonen de oudste events stilzwijgend een te lage teller.
  // Daarom per batch events, zo groot dat (events × spelers) onder die grens
  // blijft (lib/attendance-batches.ts), en parallel.
  const batchGrootte = playerError ? TERUGVAL_BATCH_GROOTTE : eventBatchGrootte(spelers.length)
  const batches = inBatches(allEvents.map((e) => e.id), batchGrootte)
  const batchResultaten = await Promise.all(
    batches.map((ids) =>
      supabase.from('attendance').select('event_id, player_id, status').eq('team_id', ctx.teamId).in('event_id', ids),
    ),
  )

  // Per event: player_id → status. Een gefaalde batch levert géén entry op
  // voor zijn events: liever geen teller (CalendarView toont er dan geen)
  // dan een fout getal.
  const statusPerEvent = new Map<string, Map<string, AttendanceStatus>>()
  batchResultaten.forEach(({ data, error }, i) => {
    if (error) {
      logError('events.attendanceBatch', error)
      return
    }
    for (const id of batches[i]) statusPerEvent.set(id, new Map())
    for (const rij of (data ?? []) as AttendanceRij[]) {
      statusPerEvent.get(rij.event_id)?.set(rij.player_id, rij.status)
    }
  })

  const attendanceMap: Record<string, { present: number; total: number }> = {}
  for (const event of allEvents) {
    const statussen = statusPerEvent.get(event.id)
    if (!statussen) continue
    if (playerError) {
      const records = [...statussen.values()]
      attendanceMap[event.id] = { present: records.filter((s) => s === 'present').length, total: records.length }
      continue
    }
    // Dezelfde telling als de dashboardhero (app/page.tsx): over de ACTIEVE
    // spelers, een speler zonder rij telt als 'unknown', en teller/noemer
    // gaan UITSLUITEND over vaste spelers (vasteTelling). Inactieve spelers
    // vallen weg omdat ze niet in actieveSpelers staan, ook al hebben ze nog
    // rijen. De team-RPC's inzichten_aanwezigheid en
    // inzichten_training_opkomst_per_maand filteren nu óók op actieve vaste
    // spelers (supabase/inzichten-inactieve-spelers.sql); agenda en inzichten
    // rekenen dus over dezelfde spelers.
    const { aanwezig, noemer } = vasteTelling(
      telAanwezigheid(actieveSpelers, (p) => statussen.get(p.id) ?? 'unknown'),
    )
    attendanceMap[event.id] = { present: aanwezig, total: noemer }
  }

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
      <CalendarView events={allEvents} attendanceMap={attendanceMap} canEdit={canEdit(ctx, 'agenda')} />
    </div>
  )
}
