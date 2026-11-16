import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { Player, AttendanceStatus } from '@/lib/types'
import { formatDateLong, formatTime, todayLocal } from '@/lib/utils'
import TrainingAttendance from '@/components/TrainingAttendance'
import TrainingEvaluatieSectie from '@/components/TrainingEvaluatieSectie'
import TrainerZelfreviewSectie from '@/components/TrainerZelfreviewSectie'
import MetingEditor from '@/components/MetingEditor'
import PageHeader from '@/components/ui/PageHeader'
import { LinkButton } from '@/components/ui/Button'
import type { OverflowMenuItem } from '@/components/ui/OverflowMenu'
import TrashIcon from '@/components/icons/TrashIcon'
import { deleteEvent } from '@/app/actions/events'
import { getDict } from '@/lib/i18n'
import { periodIdByPlayerForDate } from '@/lib/absence-periods'
import { buildAttendanceRow } from '@/lib/attendance-rows'
import { genericError, logError } from '@/lib/errors'
import { isTrainingOordeel, isValidRpe } from '@/lib/training-evaluatie'
import type { TrainingEvaluatie } from '@/lib/types'
import { zelfreviewUitRij } from '@/lib/trainer-zelfreview'
import WedstrijdStapper from '@/components/wedstrijd/WedstrijdStapper'
import VolgendeStap from '@/components/wedstrijd/VolgendeStap'
import { bouwStapperData, telBeschikbaarheid, wedstrijdDatumBereikt, type WedstrijdStapperData } from '@/lib/wedstrijd-stappen'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const ctx = await requireTeamContextOrLogin()

  const [{ data: event }, { data: players }, { data: attendance }, { data: lineup, error: lineupError }, { data: meting }, { data: oefeningen }, { data: matchRatings, error: matchRatingsError }, { data: matchEvents, error: matchEventsError }, { data: squadCheck, error: squadError }, { data: evaluatieRij, error: evaluatieError }, { data: zelfreviewRij, error: zelfreviewError }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', ctx.teamId).single(),
    supabase.from('players').select('*').eq('team_id', ctx.teamId).eq('active', true).order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('*').eq('event_id', id).eq('team_id', ctx.teamId),
    supabase.from('lineups').select('formation, positions').eq('event_id', id).eq('team_id', ctx.teamId).maybeSingle(),
    supabase.from('metingen').select('*').eq('event_id', id).eq('team_id', ctx.teamId).maybeSingle(),
    supabase.from('training_oefeningen').select('id').eq('event_id', id).eq('team_id', ctx.teamId).limit(1),
    supabase.from('match_ratings').select('id').eq('event_id', id).eq('team_id', ctx.teamId),
    supabase.from('match_events').select('id').eq('event_id', id).eq('team_id', ctx.teamId),
    supabase.from('match_squad').select('id').eq('event_id', id).eq('team_id', ctx.teamId).limit(1),
    // Fase 3b: RPE en oordeel van de training. Loopt voor elk eventtype (geen
    // extra roundtrip) maar wordt alleen gebruikt en gelogd bij een training.
    // Vereist supabase/inzichten-metrics-fase3b.sql.
    supabase.from('training_evaluaties').select('rpe, oordeel').eq('event_id', id).eq('team_id', ctx.teamId).maybeSingle(),
    // Privé zelfreview van de ingelogde trainer: alleen de eigen rij (RLS borgt
    // dat ook). Vereist supabase/trainer-zelfreview.sql.
    supabase.from('trainer_zelfreviews')
      .select('score_uitleg, score_organisatie, score_coaching, score_sfeer, score_tijdsbewaking, meeneem')
      .eq('event_id', id).eq('team_id', ctx.teamId).eq('user_id', ctx.userId).maybeSingle(),
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

  // Designronde 3: verwijderen staat in het ⋯-menu van de paginakop (rood,
  // met bevestiging), niet meer onderaan de pagina naast "Bewerken".
  const deleteItem: OverflowMenuItem = {
    label: t.event.deleteEvent,
    icon: <TrashIcon />,
    danger: true,
    confirm: `${t.event.deleteEvent}?`,
    action: handleDelete,
  }

  const metaLine = [
    event.time ? formatTime(event.time) : null,
    event.location || null,
    isMatch && event.home_away ? (event.home_away === 'home' ? t.calendar.homeLabel : t.calendar.awayLabel) : null,
  ].filter(Boolean).join(' · ')

  // ── Meting detail ──
  if (isMeting) {
    return (
      <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <PageHeader
          backFallback="/events"
          title={<span className="flex items-center gap-2"><span className="ms text-[24px] text-panel-purple-ink" aria-hidden="true">straighten</span>{t.event.meting}</span>}
          subtitle={<span className="capitalize">{formatDateLong(event.date, t.browserLocale)}</span>}
          menu={canEdit(ctx, 'agenda') ? [deleteItem] : undefined}
        />
        {metaLine && <div className="surface-card px-4 py-3 text-[13.5px] font-semibold text-muted">{metaLine}</div>}
        {event.notes && <div className="surface-card px-4 py-3 text-[13.5px] text-muted">{event.notes}</div>}
        <MetingEditor eventId={id} initialMeting={meting} canEdit={canEdit(ctx, 'periodisering')} />
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
      .eq('team_id', ctx.teamId)
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
    // op een event vanaf vandaag op 'injured' — anders herintroduceert deze
    // backfill precies het bugsymptoom dat markInjured moest oplossen. Een
    // verleden-event krijgt geen 'injured' (de blessure is de toestand van nu).
    const today = todayLocal()
    const backfillRows = missingPlayers.map((p) => buildAttendanceRow({
      eventId: id,
      playerId: p.id,
      teamId: ctx.teamId,
      defaultStatus: 'unknown',
      injured: p.injured === true,
      eventDate: event.date,
      today,
      periodId: periodByPlayer.get(p.id) ?? null,
      // Een gastspeler staat altijd afwezig; de backfill moet exact dezelfde
      // regel toepassen als de drie aanmaakplekken, anders geeft déze pagina
      // hem alsnog 'unknown'. `type` komt uit de select('*') hierboven.
      isGuest: p.type === 'guest',
    }))

    // Elke rij krijgt dezelfde sleutels — PostgREST weigert een bulk-insert
    // met afwijkende kolommen, dus buildAttendanceRow zet ze altijd alle vijf.
    // Upsert met ignoreDuplicates in plaats van insert: twee gelijktijdige
    // pagina-loads backfillen dezelfde ontbrekende spelers, en de tweede liep
    // dan op UNIQUE(event_id, player_id) stuk (harde fout op de pagina). Een
    // bestaande rij wordt zo nooit overschreven — wat er al staat wint.
    const { error: backfillError } = await supabase
      .from('attendance')
      .upsert(backfillRows, { onConflict: 'event_id,player_id', ignoreDuplicates: true })
    // Zonder deze check zou de lus hieronder de attendanceMap vullen alsof de
    // insert lukte: de coach ziet dan statussen die nooit zijn opgeslagen.
    // Zelfde harde faal als settings.generateSeasonTrainings.attendance
    // (app/actions/settings.ts:206).
    if (backfillError) throw genericError('eventDetail.backfill.attendance', backfillError)

    // Dezelfde rijen als de upsert hierboven. Bij een gelijktijdige backfill
    // kan de andere load net eerder geschreven hebben; die rij is dan via
    // dezelfde regel (buildAttendanceRow) bepaald, dus de getoonde status
    // klopt met wat er in de database staat.
    for (const row of backfillRows) attendanceMap.set(row.player_id, row.status)
  }

  // Een falende evaluatiequery (bv. zonder migratie) laat de pagina werken; alleen
  // de nieuwe sectie meldt het (A13). Gelezen waarden worden gevalideerd.
  let evaluatieFout = false
  if (isTraining && evaluatieError) {
    logError('eventDetail.evaluatie', evaluatieError)
    evaluatieFout = true
  }
  const evaluatie: TrainingEvaluatie = {
    rpe: isValidRpe(evaluatieRij?.rpe) ? evaluatieRij.rpe : null,
    oordeel: isTrainingOordeel(evaluatieRij?.oordeel) ? evaluatieRij.oordeel : null,
  }
  // Zelfde regel voor de zelfreview: een falende query (bv. zonder migratie)
  // laat de pagina werken, alleen de sectie meldt het. Een rij met een
  // ongeldige score telt als "geen review" (zelfreviewUitRij).
  let zelfreviewFout = false
  if (isTraining && zelfreviewError) {
    logError('eventDetail.zelfreview', zelfreviewError)
    zelfreviewFout = true
  }
  const zelfreview = zelfreviewError ? null : zelfreviewUitRij(zelfreviewRij)
  // Is de datum van het event bereikt (vandaag of eerder)? Eén expressie voor
  // de trainingsevaluatie én (via de stapper) de analysestap van een
  // wedstrijd: vóór de wedstrijddag valt er niets te analyseren. Servertijd (todayLocal), zelfde
  // als /inzichten en de analysepagina — bewust. De regel zelf staat op één
  // plek (wedstrijdDatumBereikt in lib/wedstrijd-stappen.ts), gedeeld met de
  // stapper en de analysepagina.
  const datumBereikt = wedstrijdDatumBereikt(event.date, todayLocal())
  const trainingGehouden = datumBereikt
  const initialStatuses = Object.fromEntries(attendanceMap) as Record<string, AttendanceStatus>

  // Wedstrijdstapper (stap 1 "beschikbaar"): na notFound() en na de backfill,
  // zodat de samenvatting exact toont wat er is weggeschreven. Geen extra
  // queries: de vier statusbronnen hierboven, met hun fout apart, zodat een
  // gefaalde query 'onbekend' wordt in plaats van een vals "open" of "klaar".
  // null bij training en meting: daar komt geen stapper.
  let stapper: WedstrijdStapperData | null = null
  if (isMatch) {
    if (lineupError) logError('eventDetail.stapper.lineup', lineupError)
    if (squadError) logError('eventDetail.stapper.selectie', squadError)
    if (matchRatingsError) logError('eventDetail.stapper.ratings', matchRatingsError)
    if (matchEventsError) logError('eventDetail.stapper.events', matchEventsError)
    stapper = bouwStapperData({
      eventId: id,
      huidig: 'beschikbaar',
      aanwezigheid: telBeschikbaarheid(allPlayers, (p) => attendanceMap.get(p.id) ?? 'unknown'),
      selectieRijen: squadError ? null : (squadCheck?.length ?? 0),
      lineup: lineupError ? undefined : (lineup ?? null),
      uitslag: event,
      ratingCount: matchRatingsError ? null : (matchRatings?.length ?? 0),
      eventCount: matchEventsError ? null : (matchEvents?.length ?? 0),
      eventDate: event.date,
      vandaag: todayLocal(),
    })
  }
  const title = isMatch && event.opponent ? `vs ${event.opponent}` : t.event.training

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      {/* Header — Bewerken zichtbaar rechts (op mobiel als icoon), verwijderen
          in het ⋯-menu (designronde 3; vervangt de knoppenrij onderaan). */}
      <PageHeader
        backFallback="/events"
        title={title}
        subtitle={<span className="capitalize">{formatDateLong(event.date, t.browserLocale)}{metaLine && ` · ${metaLine}`}</span>}
        badge={isMatch && event.match_type ? (
          <span className="max-sm:hidden text-[11px] font-extrabold px-3 py-1.5 rounded-full text-brand-accent"
            style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
            {t.event.matchTypes[event.match_type as keyof typeof t.event.matchTypes]}
          </span>
        ) : undefined}
        actions={canEdit(ctx, 'agenda') ? (
          <LinkButton href={`/events/${id}/edit`} variant="secondary" icon="edit" className="max-sm:w-11 max-sm:px-0">
            <span className="max-sm:sr-only">{t.event.editEvent}</span>
          </LinkButton>
        ) : undefined}
        menu={canEdit(ctx, 'agenda') ? [deleteItem] : undefined}
      />

      {stapper && <WedstrijdStapper data={stapper} t={t} />}

      {/* Desktop: acties + notities links, aanwezigheid rechts (designronde 3;
          stond als één smalle kolom met veel lege ruimte). Mobiel: zelfde volgorde
          als voorheen. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {/* Wedstrijd: één "Volgende: selectie" i.p.v. drie actiekaarten; de
              stapper erboven toont de voortgang. Training en meting houden
              hun eigen kaart. */}
          {stapper && <VolgendeStap data={stapper} t={t} />}
          {isTraining && (
            <ActionCard href={`/events/${id}/training-plan`} done={hasTrainingPlan} icon="assignment"
              title={t.event.trainingPlan} hint={t.event.trainingPlanHint}
              viewLabel={t.event.trainingPlanView} viewHint={t.event.trainingPlanViewHint} cta={t.event.trainingPlanCta} />
          )}
          {/* Notes */}
          {event.notes && (
            <div className="surface-card p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-faint mb-1">{t.event.notes}</div>
              <div className="text-[14px] text-muted">{event.notes}</div>
            </div>
          )}
          {/* Na de training: RPE en doelstelling-oordeel (fase 3b), onderaan de
              linkerkolom; op mobiel dus vóór de aanwezigheidslijst. */}
          {isTraining && (
            <TrainingEvaluatieSectie
              eventId={id}
              initial={evaluatie}
              doelstelling={typeof event.doelstelling === 'string' ? event.doelstelling : null}
              canEdit={canEdit(ctx, 'training')}
              trainingGehouden={trainingGehouden}
              bronFout={evaluatieFout}
            />
          )}
          {/* Privé zelfreview van de trainer: alleen met trainingsrecht, of
              (alleen-lezen) als er al een eigen review is. */}
          {isTraining && (canEdit(ctx, 'training') || zelfreview !== null) && (
            <TrainerZelfreviewSectie
              eventId={id}
              initial={zelfreview}
              canEdit={canEdit(ctx, 'training')}
              trainingGehouden={trainingGehouden}
              bronFout={zelfreviewFout}
            />
          )}
        </div>
        <div className="min-w-0">
          {/* Attendance (stat cards + list) */}
          <TrainingAttendance eventId={id} players={allPlayers} initialStatuses={initialStatuses} canEdit={canEdit(ctx, 'aanwezigheid')} />
        </div>
      </div>
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
  const borderCol = 'color-mix(in srgb, var(--primary) 35%, var(--border-soft))'
  const iconBg = 'color-mix(in srgb, var(--color-brand) 12%, transparent)'
  const iconColor = 'var(--brand-accent)'
  const barBg = 'var(--primary)'
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
