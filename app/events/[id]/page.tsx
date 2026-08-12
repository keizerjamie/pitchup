import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Player, AttendanceStatus } from '@/lib/types'
import { formatDateLong, formatTime } from '@/lib/utils'
import TrainingAttendance from '@/components/TrainingAttendance'
import MetingEditor from '@/components/MetingEditor'
import BackButton from '@/components/BackButton'
import DeleteButton from '@/components/DeleteButton'
import { deleteEvent } from '@/app/actions/events'
import { getDict } from '@/lib/i18n'
import { analyseBestaat as computeAnalyseBestaat } from '@/lib/match-analysis.mjs'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'
import { buildAttendanceRow } from '@/lib/attendance-rows'
import { genericError } from '@/lib/errors'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: players }, { data: attendance }, { data: lineup }, { data: meting }, { data: oefeningen }, { data: matchRatings }, { data: matchEvents }, { data: squadCheck }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('players').select('*').eq('team_id', user.id).eq('active', true).order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('*').eq('event_id', id).eq('team_id', user.id),
    supabase.from('lineups').select('id').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('metingen').select('*').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('training_oefeningen').select('id').eq('event_id', id).eq('team_id', user.id).limit(1),
    supabase.from('match_ratings').select('id').eq('event_id', id).eq('team_id', user.id),
    supabase.from('match_events').select('id').eq('event_id', id).eq('team_id', user.id),
    supabase.from('match_squad').select('id').eq('event_id', id).eq('team_id', user.id).limit(1),
  ])

  if (!event) notFound()

  const hasTrainingPlan = !!event.doelstelling || (oefeningen?.length ?? 0) > 0
  const analyseBestaat = computeAnalyseBestaat({
    goals_for: event.goals_for,
    goals_against: event.goals_against,
    ratingCount: (matchRatings?.length ?? 0),
    eventCount: (matchEvents?.length ?? 0),
  })
  const isMatch = event.type === 'match'
  const isTraining = event.type === 'training'
  const isMeting = event.type === 'meting'

  async function handleDelete() {
    'use server'
    await deleteEvent(id)
    redirect('/events')
  }

  const backIcon = (
    <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
      <span className="ms text-[22px]">arrow_back</span>
    </span>
  )

  const metaLine = [
    event.time ? formatTime(event.time) : null,
    event.location || null,
    isMatch && event.home_away ? (event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel) : null,
  ].filter(Boolean).join(' · ')

  // ── Meting detail ──
  if (isMeting) {
    return (
      <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <BackButton fallback="/events">{backIcon}</BackButton>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-[22px] font-bold text-ink flex items-center gap-2">
              <span style={{ color: '#8b5cf6' }}>◆</span>{t.event.meting}
            </h1>
            <p className="text-[13px] font-semibold text-faint capitalize">{formatDateLong(event.date, t.browserLocale)}</p>
          </div>
        </div>
        {metaLine && <div className="surface-card px-4 py-3 text-[13.5px] font-semibold text-muted">{metaLine}</div>}
        {event.notes && <div className="surface-card px-4 py-3 text-[13.5px] text-muted">{event.notes}</div>}
        <MetingEditor eventId={id} initialMeting={meting} />
        <DeleteButton label={t.event.deleteEvent} confirmMessage={`${t.event.deleteEvent}?`} action={handleDelete} />
      </div>
    )
  }

  // ── Training / Match detail ──
  const allPlayers: Player[] = players ?? []
  const attendanceMap = new Map<string, AttendanceStatus>()
  for (const a of (attendance ?? [])) attendanceMap.set(a.player_id, a.status)

  const missingPlayers = allPlayers.filter((p) => !attendanceMap.has(p.id))
  if (missingPlayers.length > 0) {
    // Een ontbrekende rij kan komen doordat het event is aangemaakt terwijl de
    // speler (nog) inactief was — createEvent maakt dan geen attendance-rij
    // aan (app/actions/events.ts:65 filtert op active=true). Is de speler
    // inmiddels weer actief én valt deze event-datum binnen een lopende
    // afmeldperiode, dan moet de backfill 'absent' invullen in plaats van
    // 'unknown' — anders herintroduceert deze pagina exact het bugsymptoom
    // dat de periode-afmelding moest oplossen. Zelfde patroon als
    // createEvent (app/actions/events.ts:70-77).
    const { data: periods, error: periodsError } = await supabase
      .from('absence_periods')
      .select('id, player_id, from_date, to_date')
      .eq('team_id', user.id)
      .in('player_id', missingPlayers.map((p) => p.id))
      .lte('from_date', event.date)
      .gte('to_date', event.date)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    // Faalt deze query, dan mag de backfill NIET doorlopen: `periods` is dan
    // null en elke ontbrekende speler zou blijvend op 'unknown' worden gezet
    // (dit is een insert, geen render) — precies het bugsymptoom dat de
    // afmeldperiode moest oplossen, maar dan persistent in de database. Deze
    // pagina heeft geen eigen patroon voor faalbare queries (de andere queries
    // hierboven kennen alleen `if (!event) notFound()`), dus faalt dit pad
    // hard zoals de twee zusterplekken met exact dezelfde logica:
    // createEvent (app/actions/events.ts:82) en generateSeasonTrainings
    // (app/actions/settings.ts:171).
    if (periodsError) throw genericError('eventDetail.backfill.periods', periodsError)

    const periodByPlayer = periodIdByPlayerForDate(periods ?? [], event.date)

    // Eén keer opgebouwd en daarna hergebruikt voor de attendanceMap hieronder:
    // de pagina moet exact tonen wat er is weggeschreven. Een geblesseerde
    // speler (players.injured, al opgehaald met de select('*') hierboven) komt
    // net als bij een lopende periode op 'absent' — anders herintroduceert deze
    // backfill precies het bugsymptoom dat markInjured moest oplossen.
    const backfillRows = missingPlayers.map((p) => buildAttendanceRow({
      eventId: id,
      playerId: p.id,
      teamId: user.id,
      defaultStatus: 'unknown',
      injured: p.injured === true,
      periodId: periodByPlayer.get(p.id) ?? null,
    }))

    // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
    // met afwijkende kolommen, dus buildAttendanceRow zet ze altijd alle zes.
    const { error: backfillError } = await supabase.from('attendance').insert(backfillRows)
    // Zonder deze check zou de lus hieronder de attendanceMap vullen alsof de
    // insert lukte: de coach ziet dan statussen die nooit zijn opgeslagen.
    // Zelfde harde faal als settings.generateSeasonTrainings.attendance
    // (app/actions/settings.ts:206).
    if (backfillError) throw genericError('eventDetail.backfill.attendance', backfillError)

    // Dezelfde rijen als de insert hierboven: de gerenderde status kan zo niet
    // uit de pas lopen met wat er daadwerkelijk in de database staat.
    for (const row of backfillRows) attendanceMap.set(row.player_id, row.status)
  }

  const initialStatuses = Object.fromEntries(attendanceMap) as Record<string, AttendanceStatus>
  const title = isMatch && event.opponent ? `vs ${event.opponent}` : t.event.training

  return (
    <div className="max-w-2xl lg:max-w-4xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallback="/events">{backIcon}</BackButton>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink truncate">{title}</h1>
          <p className="text-[13px] font-semibold text-faint capitalize">
            {formatDateLong(event.date, t.browserLocale)}{metaLine && ` · ${metaLine}`}
          </p>
        </div>
        {isMatch && event.match_type && (
          <span className="flex-shrink-0 text-[11px] font-extrabold px-3 py-1.5 rounded-full text-brand-accent"
            style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
            {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
          </span>
        )}
      </div>

      {/* Squad / lineup / training-plan action */}
      {isMatch && (
        <ActionCard href={`/events/${id}/squad`} done={(squadCheck?.length ?? 0) > 0} icon="groups"
          title={t.event.squad} hint={t.event.squadHint}
          viewLabel={t.event.squadView} viewHint={t.event.squadViewHint} cta={t.event.squadCta} />
      )}
      {isMatch && (
        <ActionCard href={`/events/${id}/lineup`} done={!!lineup} icon="dashboard"
          title={t.event.lineup} hint={t.event.lineupHint}
          viewLabel={t.event.lineupView} viewHint={t.event.lineupViewHint} cta={t.event.lineupCta} />
      )}
      {isMatch && (
        <ActionCard href={`/events/${id}/analysis`} done={analyseBestaat} icon="scoreboard"
          title={t.event.analysis} hint={t.event.analysisHint}
          viewLabel={t.event.analysisView} viewHint={t.event.analysisViewHint} cta={t.event.analysisCta}
          accent="var(--warning)" />
      )}
      {isTraining && (
        <ActionCard href={`/events/${id}/training-plan`} done={hasTrainingPlan} icon="assignment"
          title={t.event.trainingPlan} hint={t.event.trainingPlanHint}
          viewLabel={t.event.trainingPlanView} viewHint={t.event.trainingPlanViewHint} cta={t.event.trainingPlanCta} />
      )}

      {/* Attendance (stat cards + list) */}
      <TrainingAttendance eventId={id} players={allPlayers} initialStatuses={initialStatuses} />

      {/* Notes */}
      {event.notes && (
        <div className="surface-card p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-faint mb-1">{t.event.notes}</div>
          <div className="text-[14px] text-muted">{event.notes}</div>
        </div>
      )}

      <DeleteButton label={t.event.deleteEvent} confirmMessage={`${t.event.deleteEvent}?`} action={handleDelete} />
    </div>
  )
}

function ActionCard({
  href, done, icon, title, hint, viewLabel, viewHint, cta, accent,
}: {
  href: string; done: boolean; icon: string; title: string; hint: string
  viewLabel: string; viewHint: string; cta: string; accent?: string
}) {
  if (done) {
    return (
      <Link href={href} className="surface-card rounded-2xl p-4 flex items-center gap-4 hover:bg-surface-sunken transition-colors"
        style={{ borderColor: 'color-mix(in srgb, var(--primary) 45%, var(--border-soft))' }}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--brand-accent)' }}>
          <span className="ms text-[24px]">check_circle</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink">{viewLabel}</div>
          <div className="text-[13px] font-semibold text-faint">{viewHint}</div>
        </div>
        <span className="ms text-[22px] text-faint">chevron_right</span>
      </Link>
    )
  }
  // Default groen (--primary/--brand-accent); een optioneel accent (bv. oranje
  // voor "nog invullen") kleurt rand, icoon en CTA-balk zonder de andere kaarten
  // te raken.
  const borderCol = `color-mix(in srgb, ${accent ?? 'var(--primary)'} 35%, var(--border-soft))`
  const iconBg = accent
    ? `color-mix(in srgb, ${accent} 14%, transparent)`
    : 'color-mix(in srgb, var(--color-brand) 12%, transparent)'
  const iconColor = accent ?? 'var(--brand-accent)'
  const barBg = accent ?? 'var(--primary)'
  return (
    <Link href={href} className="rounded-2xl overflow-hidden block" style={{ border: `1px solid ${borderCol}` }}>
      <div className="bg-surface flex items-center gap-4 p-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: iconBg, color: iconColor }}>
          <span className="ms text-[24px]">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink">{title}</div>
          <div className="text-[13px] font-semibold text-faint">{hint}</div>
        </div>
        <span className="ms text-[22px] text-faint">chevron_right</span>
      </div>
      <div className="px-4 py-2.5 flex items-center gap-2 text-white" style={{ background: barBg }}>
        <span className="ms text-[18px]">bolt</span>
        <span className="font-bold text-[13.5px]">{cta}</span>
      </div>
    </Link>
  )
}
