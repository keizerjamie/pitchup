import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Oefening, Player, TrainingOefeningWithData, normalizeOefeningTeams } from '@/lib/types'
import { cycleWeekFor, countCategoryOccurrences, computeCurrentSteps, dueCategories } from '@/lib/periodization'
import { formatDateLong } from '@/lib/utils'
import { resolveClubColors } from '@/lib/club-colors'
import BackButton from '@/components/BackButton'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import type { KopieerOptie } from '@/components/KopieerVorigeTraining'
import AttendanceSummary from '@/components/AttendanceSummary'
import PrintButton from '@/components/PrintButton'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function TrainingPlanPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('team_id', user.id)
    .single()

  if (!event || event.type !== 'training') notFound()

  // ── Attendance overview: who is present / not present for this training ──
  // De settings-query loopt in dezelfde batch mee (geen extra roundtrip) en is
  // net als de andere queries op team_id gescoped.
  const [{ data: playersData }, { data: attendanceData }, { data: settingsRows }] = await Promise.all([
    supabase.from('players').select('*').eq('team_id', user.id).eq('active', true)
      .order('position').order('jersey_number', { ascending: true, nullsFirst: false }).order('name'),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
    supabase.from('settings').select('key, value').eq('team_id', user.id)
      .in('key', ['team_color_primary', 'team_color_secondary']),
  ])
  const activePlayers: Player[] = playersData ?? []
  const presentIds = new Set((attendanceData ?? []).filter((a) => a.status === 'present').map((a) => a.player_id))
  const presentPlayers = activePlayers.filter((p) => presentIds.has(p.id))
  const absentPlayers = activePlayers.filter((p) => !presentIds.has(p.id))

  // Clubkleuren serverzijdig geresolved (ingestelde waarde óf fallback), zodat
  // de printweergave altijd kant-en-klare hexstrings krijgt. Het doorgeven aan
  // de componenten en het toepassen in de DOM (CSS-variabelen/klassen) is
  // frontend-scope — zie de overdracht bij deze feature.
  const settingsMap: Record<string, string> = {}
  for (const row of settingsRows ?? []) settingsMap[row.key] = row.value
  const clubColors = resolveClubColors(settingsMap)

  // ── Find latest meting event before this training ──
  const { data: metingEvents } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', user.id)
    .eq('type', 'meting')
    .lt('date', event.date)
    .order('date', { ascending: false })
    .limit(1)

  const latestMetingEvent = metingEvents?.[0] ?? null

  // ── Load meting step data (parallel with exercises) ──
  // De bibliotheek-lijst (los van deze training) wordt hier ook geladen — niet
  // omdat de koppeling-query verandert, maar omdat OefeningPicker een
  // "kies uit bibliotheek"-lijst nodig heeft die de bestaande koppeling-query
  // niet levert (die geeft alleen al-gekoppelde oefeningen).
  const [metingResult, oefeningenResult, libraryResult] = await Promise.all([
    latestMetingEvent
      ? supabase.from('metingen').select('*').eq('event_id', latestMetingEvent.id).eq('team_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase.from('training_oefeningen').select('*, oefeningen(*)').eq('event_id', id).eq('team_id', user.id)
      .order('volgorde').order('created_at', { ascending: true }).order('id', { ascending: true }),
    supabase.from('oefeningen').select('*').eq('team_id', user.id).order('naam'),
  ])

  const latestMeting = metingResult.data
  // Koppelingen aan deze training, elk met de gejoinde bibliotheek-oefening.
  // Dual-read: bestaande rijen bevatten nog de legacy vorm {grootte, formatie};
  // normaliseer naar {grootte, formaties} vóórdat de UI de data ziet — zowel op
  // de gejoinde koppelingen als op de losse bibliotheeklijst.
  const oefeningen = ((oefeningenResult.data ?? []) as unknown as TrainingOefeningWithData[]).map((k) => ({
    ...k,
    oefeningen: { ...k.oefeningen, teams: normalizeOefeningTeams(k.oefeningen?.teams) },
  }))
  const library: Oefening[] = (libraryResult.data ?? []).map((o) => ({
    ...o,
    teams: normalizeOefeningTeams(o.teams),
  }))

  // ── Kandidaten om van te kopiëren ──────────────────────────────────
  // Eerdere trainingen van dit team die daadwerkelijk oefeningen hebben. Twee
  // ronden: eerst de events, dan één telquery over die id's — een join met een
  // count per rij levert de ongetypeerde client geen bruikbare vorm op.
  //
  // `lt` op de datum van DEZE training, niet op vandaag: bij het vooruit
  // plannen van meerdere weken wil je van de vorige week kopiëren, niet van de
  // laatste training die al geweest is.
  const { data: eerdereTrainingen } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', user.id)
    .eq('type', 'training')
    .lt('date', event.date)
    .order('date', { ascending: false })
    .limit(10)

  // De Supabase-client is ongetypeerd (lib/supabase/server.ts) en levert bij
  // een fout of een andere querystaat geen array. Zelfde defensieve vorm als
  // vormParallelGroep() in app/actions/training-plan.ts.
  const eerdereRijen: { id: string; date: string }[] = Array.isArray(eerdereTrainingen)
    ? (eerdereTrainingen as { id: string; date: string }[])
    : []
  const eerdereIds = eerdereRijen.map((e) => e.id)
  const { data: koppelingTellingen } = eerdereIds.length > 0
    ? await supabase
        .from('training_oefeningen')
        .select('event_id')
        .in('event_id', eerdereIds)
        .eq('team_id', user.id)
    : { data: [] }

  const aantalPerEvent = new Map<string, number>()
  const tellingRijen: { event_id: string }[] = Array.isArray(koppelingTellingen)
    ? (koppelingTellingen as { event_id: string }[])
    : []
  for (const rij of tellingRijen) {
    aantalPerEvent.set(rij.event_id, (aantalPerEvent.get(rij.event_id) ?? 0) + 1)
  }

  // Alleen trainingen met inhoud, en hooguit vijf: dit is een snelkoppeling,
  // geen archief.
  const kopieerOpties: KopieerOptie[] = eerdereRijen
    .map((e) => ({ id: e.id, date: e.date, aantal: aantalPerEvent.get(e.id) ?? 0 }))
    .filter((e) => e.aantal > 0)
    .slice(0, 5)

  // ── Current steps per category, as of this training's date ──
  const occurrences = latestMetingEvent
    ? await countCategoryOccurrences(supabase, user.id, latestMetingEvent.date, event.date)
    : {}
  const currentSteps = computeCurrentSteps(latestMeting, occurrences)

  // ── Cycle-week suggestion: which categories are due this week ──
  const cycleWeek = latestMetingEvent ? cycleWeekFor(latestMetingEvent.date, event.date) : null
  const suggestion = cycleWeek !== null
    ? {
        week: cycleWeek,
        items: dueCategories(cycleWeek).map((cat) => ({
          key: cat.key,
          step: currentSteps[cat.key] ?? null,
        })),
      }
    : null

  return (
    <div
      className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6 print:py-0 print:space-y-[3mm]"
      style={{ '--club-primary': clubColors.primary, '--club-secondary': clubColors.secondary } as React.CSSProperties}
    >

      <div className="flex items-center gap-3 print:border-b-2 print:pb-[1mm] print-club-border">
        <BackButton fallback={`/events/${id}`} className="print:hidden text-faint hover:text-ink flex-shrink-0">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <div className="min-w-0 flex-1 print:flex print:items-baseline print:gap-2">
          <h1 className="text-xl font-bold text-ink print:text-sm print-club-primary">{t.event.trainingPlan}</h1>
          <p className="text-sm text-muted print:text-xs print-club-secondary">{formatDateLong(event.date, t.browserLocale)}</p>
        </div>
        <PrintButton />
      </div>

      {/* Desktop: planner left, attendance overview right (sticky). Mobile: overview on top.
          Op papier ("kladblok"-model, op verzoek van de eigenaar): aanwezigheid
          als smalle kolom LINKS, oefeningen ernaast en — zodra die kolom op is —
          eronder doorlopend naar volgende pagina's. `print-plan-layout` +
          `print-attendance-col` (globals.css @media print) regelen dat via
          `float: left`, niet via grid/flex-kolommen (die zouden de oefeningen
          over ALLE pagina's in een vaste smalle kolom opsluiten). Werkt
          onafhankelijk van de lg:-breakpoint: bij staand A4 (~703 CSS-px)
          matcht `lg:grid` niet, bij liggend A4 (~1032 CSS-px) wél — de
          `display:block`-override in `.print-plan-layout` dwingt in beide
          gevallen de normale block-flow af die `float` nodig heeft. */}
      <div className="print-plan-layout lg:grid lg:grid-cols-[1fr_19rem] lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
        <div className="lg:order-2">
          <AttendanceSummary
            present={presentPlayers}
            absent={absentPlayers}
            eventId={id}
            t={t}
            className="lg:sticky lg:top-10 print-attendance-col"
          />
        </div>

        <div className="lg:order-1 min-w-0">
          <TrainingPlanEditor
            eventId={id}
            initialDoelstelling={event.doelstelling ?? null}
            initialOefeningen={oefeningen}
            library={library}
            currentSteps={currentSteps}
            hasNulmeting={!!latestMeting}
            suggestion={suggestion}
            players={activePlayers}
            presentPlayerIds={Array.from(presentIds)}
            startTijd={event.time}
            kopieerOpties={kopieerOpties}
          />
        </div>
      </div>

    </div>
  )
}
