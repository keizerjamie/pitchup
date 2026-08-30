import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Oefening, Player, TrainingOefeningWithData, normalizeOefeningTeams, CategorieMeting } from '@/lib/types'
import { concretiseerBezetting, type TrainingOefeningMetBezetting } from '@/lib/oefening-bezetting'
import { cycleWeekFor, actueleMetingen, ankerDatum, getTrainingLog, dueCategories } from '@/lib/periodization'
import { formatDateLong } from '@/lib/utils'
import { resolveClubColors, readableAccentOnWhite } from '@/lib/club-colors'
import BackButton from '@/components/BackButton'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import type { KopieerOptie } from '@/components/KopieerVorigeTraining'
import AttendanceSummary from '@/components/AttendanceSummary'
import PrintButton from '@/components/PrintButton'
import TeamLogo from '@/components/TeamLogo'
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
      .in('key', ['team_color_primary', 'team_color_secondary', 'team_name', 'team_logo_url']),
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
  // Voor de print-kop en -voet (familieconventie met de wedstrijdselectie-
  // poster en het seizoensrapport): teamnaam + logo, zelfde settings-batch.
  const teamName = settingsMap['team_name']?.trim() || null
  const teamLogoUrl = settingsMap['team_logo_url'] || null

  // ── Load category-metingen + exercises (parallel) ──
  // De bibliotheek-lijst (los van deze training) wordt hier ook geladen — niet
  // omdat de koppeling-query verandert, maar omdat OefeningPicker een
  // "kies uit bibliotheek"-lijst nodig heeft die de bestaande koppeling-query
  // niet levert (die geeft alleen al-gekoppelde oefeningen).
  const [categorieMetingenResult, oefeningenResult, libraryResult] = await Promise.all([
    supabase.from('categorie_metingen').select('*').eq('team_id', user.id)
      .order('datum', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('training_oefeningen').select('*, oefeningen(*)').eq('event_id', id).eq('team_id', user.id)
      .order('volgorde').order('created_at', { ascending: true }).order('id', { ascending: true }),
    supabase.from('oefeningen').select('*').eq('team_id', user.id).order('naam'),
  ])

  const metingen: CategorieMeting[] = categorieMetingenResult.data ?? []
  // Peildatum EXCLUSIEF = de datum van DEZE training (strikt vóór — AC 18,
  // edge 11): een meting op de trainingsdag zelf telt nog niet mee.
  const actueel = actueleMetingen(metingen, event.date)
  const anker = ankerDatum(actueel)
  // Koppelingen aan deze training, elk met de gejoinde bibliotheek-oefening.
  // Dual-read: bestaande rijen bevatten nog de legacy vorm {grootte, formatie};
  // normaliseer naar {grootte, formaties} vóórdat de UI de data ziet — zowel op
  // de gejoinde koppelingen als op de losse bibliotheeklijst.
  //
  // Hier wordt ook, ÉÉN keer, de effectieve bezetting berekend
  // (concretiseerBezetting): basisvorm + eventuele training-specifieke
  // override, geclampt tegen het ACTUELE bereik van de bibliotheek-oefening.
  // `k.oefeningen.teams` blijft daarna de BASISVORM — nooit overschrijven; de
  // effectieve groottes staan uitsluitend in `k.bezetting.teams`. Zo draaien
  // alle consumers (FormationField-labels, TeamIndelingEditor, groepStatus,
  // print) op precies dezelfde ene uitkomst.
  const oefeningen: TrainingOefeningMetBezetting[] = ((oefeningenResult.data ?? []) as unknown as TrainingOefeningWithData[]).map((k) => {
    const oefening = { ...k.oefeningen, teams: normalizeOefeningTeams(k.oefeningen?.teams) }
    return { ...k, oefeningen: oefening, bezetting: concretiseerBezetting(oefening, k.aantallen_override ?? null) }
  })
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
  // Eén rekenpad voor stap + cyclusweek (AC 17/18): getTrainingLog telt per
  // onderdeel de trainingen sinds zijn EIGEN meetdatum en levert currentSteps
  // meteen mee; alleen currentSteps wordt op deze pagina gebruikt.
  const { currentSteps } = await getTrainingLog(supabase, user.id, actueel, event.date)

  // ── Cycle-week suggestion: which categories are due this week ──
  const cycleWeek = anker !== null ? cycleWeekFor(anker, event.date) : null
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
      style={{ '--club-primary': clubColors.primary, '--club-secondary': clubColors.secondary, '--club-accent-text': readableAccentOnWhite(clubColors.primary) } as React.CSSProperties}
    >

      {/* Print-only: dunne tweekleurige clubbalk — zelfde familie als het
          wedstrijdselectie-teamsheet (klassen gedeeld met dat printblok). */}
      <div className="hidden print:flex print-poster-topbar" aria-hidden="true">
        <span className="print-poster-topbar-primair" />
        <span className="print-poster-accent" />
      </div>

      <div className="flex items-center gap-3 print:border-b-2 print:pb-[1mm] print-club-border">
        <BackButton fallback={`/events/${id}`} className="print:hidden text-faint hover:text-ink flex-shrink-0">
          <span className="ms text-[24px]" aria-hidden="true">arrow_back</span>
        </BackButton>
        <div className="min-w-0 flex-1 print:flex print:items-baseline print:gap-2">
          {/* .print-accent-text / .print-poster-meta bestaan alleen in het
              @media print-blok en raken de schermweergave dus niet. */}
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink print:text-[10px] print:uppercase print:tracking-[0.18em] print-accent-text">{t.event.trainingPlan}</h1>
          <p className="text-sm text-muted print:text-[10px] print:font-bold print-poster-meta">{formatDateLong(event.date, t.browserLocale)}</p>
        </div>
        {/* Print-only: teamnaam + clublogo rechts in de kopregel — dezelfde
            familieconventie als de poster- en rapportkop. */}
        {(teamName || teamLogoUrl) && (
          <div className="hidden print:flex items-center gap-1.5 flex-shrink-0">
            {teamLogoUrl && <TeamLogo src={teamLogoUrl} size={16} alt="" fallback={null} />}
            {teamName && <span className="text-xs font-bold print-accent-text">{teamName}</span>}
          </div>
        )}
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
            hasNulmeting={Object.keys(actueel).length > 0}
            suggestion={suggestion}
            players={activePlayers}
            presentPlayerIds={Array.from(presentIds)}
            startTijd={event.time}
            kopieerOpties={kopieerOpties}
          />
        </div>
      </div>

      {/* Print-only voetstrook — zelfde drie-elementenconventie als de
          poster-foot (teamnaam · datum · merk). `.print-plan-voet` cleart de
          gefloate aanwezigheidskolom (globals.css). */}
      <div className="hidden print:flex print-plan-voet items-center">
        <span>{teamName}</span>
        <span className="print-plan-voet-datum">{formatDateLong(event.date, t.browserLocale)}</span>
        <span className="print-plan-voet-merk">
          {/* eslint-disable-next-line @next/next/no-img-element -- print-only, zelfde afweging als de poster-/rapportvoet: synchroon renderende <img> */}
          <img src="/logo.png" alt="" aria-hidden="true" />
          {t.matchSquad.footerGenerated}
        </span>
      </div>

    </div>
  )
}
