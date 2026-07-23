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

interface Props {
  params: Promise<{ id: string }>
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: players }, { data: attendance }, { data: lineup }, { data: meting }, { data: oefeningen }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('players').select('*').eq('team_id', user.id).eq('active', true).order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('*').eq('event_id', id).eq('team_id', user.id),
    supabase.from('lineups').select('id').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('metingen').select('*').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    supabase.from('oefeningen').select('id').eq('event_id', id).eq('team_id', user.id).limit(1),
  ])

  if (!event) notFound()

  const hasTrainingPlan = !!event.doelstelling || (oefeningen?.length ?? 0) > 0
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
    await supabase.from('attendance').insert(
      missingPlayers.map((p) => ({ event_id: id, player_id: p.id, status: 'unknown', team_id: user.id }))
    )
    for (const p of missingPlayers) attendanceMap.set(p.id, 'unknown')
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

      {/* Lineup / training-plan action */}
      {isMatch && (
        <ActionCard href={`/events/${id}/lineup`} done={!!lineup} icon="dashboard"
          title={t.event.lineup} hint={t.event.lineupHint}
          viewLabel={t.event.lineupView} viewHint={t.event.lineupViewHint} cta={t.event.lineupCta} />
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
  href, done, icon, title, hint, viewLabel, viewHint, cta,
}: {
  href: string; done: boolean; icon: string; title: string; hint: string
  viewLabel: string; viewHint: string; cta: string
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
  return (
    <Link href={href} className="rounded-2xl overflow-hidden block" style={{ border: '1px solid color-mix(in srgb, var(--primary) 35%, var(--border-soft))' }}>
      <div className="bg-surface flex items-center gap-4 p-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'color-mix(in srgb, var(--color-brand) 12%, transparent)', color: 'var(--brand-accent)' }}>
          <span className="ms text-[24px]">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink">{title}</div>
          <div className="text-[13px] font-semibold text-faint">{hint}</div>
        </div>
        <span className="ms text-[22px] text-faint">chevron_right</span>
      </div>
      <div className="px-4 py-2.5 flex items-center gap-2 text-white" style={{ background: 'var(--primary)' }}>
        <span className="ms text-[18px]">bolt</span>
        <span className="font-bold text-[13.5px]">{cta}</span>
      </div>
    </Link>
  )
}
