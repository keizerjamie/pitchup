import PageHeader from '@/components/ui/PageHeader'
import { LinkButton } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { FootballEvent, AttendanceStatus, POSITION_ABBREVIATIONS, PERIODIZATION_CATEGORIES, CategorieMeting } from '@/lib/types'
import { actueleMetingen, onderdeelStatus, getTrainingLog, computeCurrentSteps } from '@/lib/periodization'
import { addDays } from '@/lib/utils'
import { TIJDZONE_STARTSCHERM, dagenTussen, vandaagIn } from '@/lib/amsterdam-dag'
import { bepaalVandaag, type KaartEvent, type KaartSoort, type VandaagModel } from '@/lib/vandaag-scherm'
import { haalStatussenPerEvent } from '@/lib/dashboard-aanwezigheid'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import DashboardHero from '@/components/dashboard/DashboardHero'
import StatCard from '@/components/dashboard/StatCard'
import NextMatch from '@/components/dashboard/NextMatch'
import TodoList, { TaskType, TodoItem } from '@/components/dashboard/TodoList'
import Availability, { AvailabilityItem } from '@/components/dashboard/Availability'
import PeriodiseringStatus from '@/components/dashboard/PeriodiseringStatus'
import FormStrip, { FormStripItem } from '@/components/dashboard/FormStrip'
import ChartBarIcon from '@/components/icons/ChartBarIcon'
import JoinedBanner from '@/components/dashboard/JoinedBanner'
import { FORWARD, analysisDeadline, effectiveDone, hasTrainingPlanDone, isSelfReviewVisible, isTaskVisible, selfReviewNextTraining, sortTasks } from '@/lib/todos.mjs'
import { analyseBestaat, matchResult } from '@/lib/match-analysis.mjs'
import { OPKOMST_DOEL, berekenAanwezigheidPercentage, periodeVenster, seizoensVenster, verledenSeizoensVenster, type AanwezigheidRij } from '@/lib/inzichten'
import { teltMee, telAanwezigheid, vasteTelling } from '@/lib/aanwezigheid-telling'
import { telOpstelling, type OpstellingTelling } from '@/lib/lineup-compleet'
import Begroeting from '@/components/dashboard/Begroeting'
import WeekRegels from '@/components/dashboard/WeekRegels'
import { hoofdkaartTeksten } from '@/components/dashboard/vandaag-teksten'

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']
// AANNAME A1 (goedgekeurd): backward-fetchhorizon voor To-do kandidaat-events —
// ruim genoeg zodat wedstrijden/trainingen met een nog open taak niet gemist
// worden, ook als hun event-datum ver vóór vandaag ligt (bv. late analyse-deadline).
const FETCH_HORIZON_DAYS = 30

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase()
}

export default async function DashboardPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const ctx = await requireTeamContextOrLogin()

  // Eén "vandaag" voor het hele startscherm: de kalenderdag in Europe/
  // Amsterdam, niet de klok van het serverproces (lib/amsterdam-dag.ts).
  // Alle datumlogica hieronder rekent vanuit deze string.
  const today = vandaagIn(TIJDZONE_STARTSCHERM)
  const windowEnd = addDays(today, FORWARD)
  const fetchStart = addDays(today, -FETCH_HORIZON_DAYS)

  const [
    { data: upcomingEvents },
    { data: playerRows },
    { data: settingsRows },
    { data: todoCandidateEvents },
    { data: trainingDateRows },
    { data: recentMatchRows },
    { data: categorieMetingenRows },
  ] = await Promise.all([
    supabase.from('events').select('*').eq('team_id', ctx.teamId).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(10),
    supabase.from('players').select('id, name, position, jersey_number, injured, type').eq('team_id', ctx.teamId).eq('active', true).order('jersey_number', { ascending: true, nullsFirst: false }),
    // Teamnaam plus het seizoensvenster voor de KPI-tegel "Aanwezigheid ·
    // laatste 4 weken" (zelfde bron als /inzichten, zie aanwezigheid4w).
    supabase.from('settings').select('key, value').eq('team_id', ctx.teamId).in('key', ['team_name', 'season_start', 'season_end']),
    // Kandidaat-events voor de To-do: alles binnen het venster, ongeacht status
    // (zichtbaarheid wordt verderop bepaald door isTaskVisible).
    supabase.from('events').select('*').eq('team_id', ctx.teamId).neq('type', 'meting').gte('date', fetchStart).lte('date', windowEnd).order('date', { ascending: true }),
    // Trainingsdatums voor de live analyse-deadline — bewust ONbegrensd naar
    // voren (geen lte windowEnd): never-miss, zie lib/todos.mjs isTaskVisible.
    supabase.from('events').select('date').eq('team_id', ctx.teamId).eq('type', 'training').gte('date', fetchStart).order('date', { ascending: true }),
    // Recente vorm (W/G/V) van de laatste 5 afgeronde wedstrijden — alle
    // match_type's tellen mee, oefenwedstrijden inclusief.
    supabase.from('events')
      .select('id, date, goals_for, goals_against')
      .eq('team_id', ctx.teamId)
      .eq('type', 'match')
      .lt('date', today)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
    // Periodisering per onderdeel (vervangt de vroegere alles-of-niets
    // count-query op `metingen`). Team-gescoped, nieuwste eerst — zelfde vorm
    // als backend-samenvatting §"Voor fase 2 relevant".
    supabase.from('categorie_metingen').select('*').eq('team_id', ctx.teamId)
      .order('datum', { ascending: false }).order('created_at', { ascending: false }),
  ])

  const settings: Record<string, string | undefined> = {}
  for (const r of (settingsRows ?? []) as { key: string; value: string }[]) settings[r.key] = r.value
  const teamName = settings['team_name']?.trim() || null

  // KPI-tegel "Aanwezigheid · laatste 4 weken": EXACT dezelfde keten als
  // /inzichten met ?periode=4w (app/inzichten/page.tsx): seizoensVenster →
  // periodeVenster('4w') → verledenSeizoensVenster (t/m gisteren) → RPC
  // inzichten_aanwezigheid. Zo tonen beide schermen per definitie hetzelfde
  // percentage. Zonder (geldig) seizoen geen RPC en geen getal.
  const seizoen = seizoensVenster(settings)
  const aanwezigheid4w = seizoen ? verledenSeizoensVenster(periodeVenster(seizoen, '4w', today), today) : null

  // ── Periodisering: status per onderdeel ──────────────────────────
  // Peildatum EXCLUSIEF = morgen: een meting van vandaag telt al mee (AC 13).
  // Leeg ⇒ geen enkel onderdeel heeft een actuele meting; getTrainingLog
  // hieronder doet dan zelf geen enkele query (D3, backend-contract) en elk
  // onderdeel toont "nog te meten" — precies het gedrag voor een nieuw team.
  const categorieMetingen: CategorieMeting[] = categorieMetingenRows ?? []
  const actueel = actueleMetingen(categorieMetingen, addDays(today, 1))
  const heeftActueleMeting = Object.keys(actueel).length > 0
  const steigerungsCat = PERIODIZATION_CATEGORIES.find((c) => c.key === 'steigerungs')
  const steigerungsWeken: [number, number] = [steigerungsCat?.cycleWeeks[0] ?? 1, steigerungsCat?.cycleWeeks[1] ?? 2]

  const upcoming: FootballEvent[] = upcomingEvents ?? []
  const players = playerRows ?? []
  const totalActive = players.length
  // Drie elkaar uitsluitende groepen voor de balk in de tegel "Actieve spelers":
  // een blessure weegt zwaarder dan het gast-zijn, dus een geblesseerde gast
  // telt rood mee (rood = ALLE geblesseerden, zoals voorheen). Oranje is dus
  // "fitte gasten", groen "fitte vaste spelers".
  const injuredCount = players.filter((p) => p.injured).length
  const guestCount = players.filter((p) => !p.injured && p.type === 'guest').length
  const fitCount = totalActive - injuredCount - guestCount
  const injuredPct = totalActive > 0 ? Math.round((injuredCount / totalActive) * 100) : 0
  const recentForm: FormStripItem[] =
    (recentMatchRows ?? []).map((m) => ({ id: m.id, result: matchResult(m) }))

  // Het chronologisch eerstvolgende event (training of wedstrijd); upcoming is
  // oplopend op datum. Voedt de Beschikbaarheid-tegel en, als er geen open
  // taak is, de hoofdkaart (AC14). De eerstvolgende wedstrijd krijgt daarnaast
  // zijn eigen tegel.
  const nextMatch = upcoming.find((e) => e.type === 'match') ?? null
  const volgendEvent: FootballEvent | null = upcoming[0] ?? null

  // ── Greeting + date line ──
  // De Begroeting-component rekent zelf met het Amsterdamse uur.
  const begroetingLabels = { morning: t.home.greetingMorning, afternoon: t.home.greetingAfternoon, evening: t.home.greetingEvening }
  const dateLine = (() => {
    const d = new Date(today + 'T00:00:00').toLocaleDateString(t.browserLocale, { weekday: 'long', day: 'numeric', month: 'long' })
    return d.charAt(0).toUpperCase() + d.slice(1)
  })()

  // ── To-do (open selectie/opstelling/analyse/trainingsplan-taken) ──
  const todoCandidates: FootballEvent[] = todoCandidateEvents ?? []
  const trainingDates: string[] = (trainingDateRows ?? []).map((r: { date: string }) => r.date)
  const matchCandidateIds = todoCandidates.filter((e) => e.type === 'match').map((e) => e.id)
  const trainingCandidateIds = todoCandidates.filter((e) => e.type === 'training').map((e) => e.id)
  const allCandidateIds = todoCandidates.map((e) => e.id)
  // Zelfreview-taak: alleen voor een trainer met trainingsrecht, en alleen voor
  // trainingen die al zijn gehouden (datum <= vandaag). Zonder kandidaat of
  // zonder recht gaat er geen query uit.
  const magZelfreviewen = canEdit(ctx, 'training')
  const zelfreviewKandidaatIds = magZelfreviewen
    ? todoCandidates.filter((e) => e.type === 'training' && dagenTussen(today, e.date) <= 0).map((e) => e.id)
    : []

  // Selectie/opstelling ook voor het eerstvolgende event als dat een
  // wedstrijd ná het To-do-venster is: de hoofdkaart (AC14) kiest daarmee
  // tussen "Selectie maken" en "Opstelling maken/bekijken". De takenloop
  // hieronder blijft over todoCandidates lopen.
  const selectieIds = [...new Set([
    ...matchCandidateIds,
    ...(volgendEvent?.type === 'match' ? [volgendEvent.id] : []),
  ])]
  // Events die een kaart met aanwezigheidstelling kunnen worden: trainingen
  // en wedstrijden van vandaag t/m het einde van het venster, plus het
  // eerstvolgende event (Beschikbaarheid-tegel en AC14-kaart).
  const tellingIds = [...new Set([
    ...todoCandidates
      .filter((e) => (e.type === 'training' || e.type === 'match') && e.date >= today && e.date <= windowEnd)
      .map((e) => e.id),
    ...(volgendEvent ? [volgendEvent.id] : []),
  ])]
  const actieveSpelerIds = players.map((p) => p.id)

  const [
    statusPerEvent,
    aanwezigheid4wResult,
    { data: squadRows },
    { data: lineupRows },
    { data: matchRatingRows },
    { data: matchEventRows },
    { data: oefeningRows },
    { data: overrideRows },
    trainingLogResult,
    zelfreviewResult,
  ] = await Promise.all([
    // Aanwezigheid van de events die een kaart met telling kunnen worden,
    // gebatcht onder de PostgREST-grens van 1000 rijen, team-gescoped en
    // alleen actieve spelers. Gewoonlijk één query; 0 ids of 0 spelers → geen.
    // De KPI-tegel rekent hier niet op (die komt uit de RPC hieronder).
    haalStatussenPerEvent(supabase, ctx.teamId, tellingIds, actieveSpelerIds),
    // p_team_id uit de teamcontext; de RPC doet zelf een lidmaatschapscheck.
    aanwezigheid4w
      ? supabase.rpc('inzichten_aanwezigheid', { p_team_id: ctx.teamId, p_start: aanwezigheid4w.start, p_end: aanwezigheid4w.end })
      : Promise.resolve({ data: null, error: null }),
    selectieIds.length > 0
      ? supabase.from('match_squad').select('event_id').eq('team_id', ctx.teamId).in('event_id', selectieIds)
      : Promise.resolve({ data: [] }),
    selectieIds.length > 0
      ? supabase.from('lineups').select('event_id, formation, positions').eq('team_id', ctx.teamId).in('event_id', selectieIds)
      : Promise.resolve({ data: [] }),
    matchCandidateIds.length > 0
      ? supabase.from('match_ratings').select('event_id').eq('team_id', ctx.teamId).in('event_id', matchCandidateIds)
      : Promise.resolve({ data: [] }),
    matchCandidateIds.length > 0
      ? supabase.from('match_events').select('event_id').eq('team_id', ctx.teamId).in('event_id', matchCandidateIds)
      : Promise.resolve({ data: [] }),
    trainingCandidateIds.length > 0
      ? supabase.from('training_oefeningen').select('event_id').eq('team_id', ctx.teamId).in('event_id', trainingCandidateIds)
      : Promise.resolve({ data: [] }),
    allCandidateIds.length > 0
      ? supabase.from('task_overrides').select('event_id, task_type').eq('team_id', ctx.teamId).in('event_id', allCandidateIds)
      : Promise.resolve({ data: [] }),
    // Periodisering: alleen echt bevragen zolang er iets te bevragen valt —
    // getTrainingLog zelf doet ook al geen query zonder actuele meting, maar
    // de guard hier maakt dat expliciet (D3: 0 extra round-trips voor een
    // team zonder nulmetingen), consistent met de guards hierboven.
    heeftActueleMeting
      ? getTrainingLog(supabase, ctx.teamId, actueel, addDays(today, 1))
      : Promise.resolve({ log: [], lastByCategory: {}, occurrences: {}, currentSteps: computeCurrentSteps(actueel, {}) }),
    // Eigen zelfreviews (privé): alleen de event-ids van de ingelogde trainer.
    // Vereist supabase/trainer-zelfreview.sql.
    zelfreviewKandidaatIds.length > 0
      ? supabase.from('trainer_zelfreviews').select('event_id').eq('team_id', ctx.teamId).eq('user_id', ctx.userId).in('event_id', zelfreviewKandidaatIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const periodiseringItems = onderdeelStatus(actueel, trainingLogResult.currentSteps)

  // KPI: fout → statisch label naar de log en geen getal ("—"), net als een
  // ontbrekend seizoen. berekenAanwezigheidPercentage geeft null bij 0/0, dus
  // nooit NaN% — zelfde afronding als /inzichten.
  if (aanwezigheid4wResult.error) logError('dashboard.aanwezigheid4w', aanwezigheid4wResult.error)
  const aanwezigheid4wRij = aanwezigheid4wResult.error
    ? null
    : ((aanwezigheid4wResult.data as AanwezigheidRij[] | null)?.[0] ?? null)
  const attendancePct = aanwezigheid4wRij
    ? berekenAanwezigheidPercentage(aanwezigheid4wRij.aanwezig, aanwezigheid4wRij.afwezig)
    : null

  // De aanwezigheid van minstens één match_squad-rij ÍS de selectie — zelfde
  // done-criterium als de selectie-ActionCard op de event-detailpagina.
  const squadSet = new Set<string>((squadRows ?? []).map((r: { event_id: string }) => r.event_id))
  // Een opstelling is pas "gemaakt" als élke positie van de formatie een
  // unieke speler heeft (telOpstelling, lib/lineup-compleet.ts) — een
  // opgeslagen opstelling met lege posities laat de taak open. Dezelfde regel
  // als de opstelling-ActionCard op de event-detailpagina.
  // opstellingPerEvent bewaart dezelfde telling voor de probleemkaart
  // "opstelling onvolledig" (AC9) — één telOpstelling-aanroep per rij.
  const opstellingPerEvent = new Map<string, OpstellingTelling>()
  for (const r of (lineupRows ?? []) as { event_id: string; formation: unknown; positions: unknown }[]) {
    opstellingPerEvent.set(r.event_id, telOpstelling(r.formation, r.positions))
  }
  const lineupSet = new Set<string>(
    [...opstellingPerEvent].filter(([, telling]) => telling.compleet).map(([eventId]) => eventId),
  )
  const manualSet = new Set<string>(
    (overrideRows ?? []).map((r: { event_id: string; task_type: string }) => `${r.event_id}:${r.task_type}`)
  )
  function countByEvent(rows: { event_id: string }[] | null): Map<string, number> {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.event_id, (m.get(r.event_id) ?? 0) + 1)
    return m
  }
  const ratingCountMap = countByEvent(matchRatingRows)
  const matchEventCountMap = countByEvent(matchEventRows)
  const oefCountMap = countByEvent(oefeningRows)
  // Een falende zelfreview-query laat de rest van het dashboard werken; er
  // verschijnen dan simpelweg geen zelfreview-items (anders zouden ze ten
  // onrechte als "open" getoond worden).
  if (zelfreviewResult.error) logError('dashboard.zelfreviews', zelfreviewResult.error)
  const zelfreviewFout = !!zelfreviewResult.error
  const reviewSet = new Set<string>(
    ((zelfreviewResult.data ?? []) as { event_id: string }[]).map((r) => r.event_id),
  )

  interface RawTask {
    eventId: string
    taskType: TaskType
    opponent: string | null
    deadline: string
    eventDate: string
    auto: boolean
    manual: boolean
    effective: boolean
  }
  const rawTasks: RawTask[] = []

  for (const e of todoCandidates) {
    if (e.type === 'match') {
      // Selectie vóór opstelling: bij een gelijke deadline houdt de stabiele
      // sort (sortTasks) deze volgorde aan, en dat is ook de werkvolgorde.
      const squadAuto = squadSet.has(e.id)
      const squadManual = manualSet.has(`${e.id}:squad`)
      const squadEffective = effectiveDone(squadAuto, squadManual)
      if (isTaskVisible({ taskType: 'squad', done: squadEffective, daysUntilEvent: dagenTussen(today, e.date), daysUntilDeadline: 0 })) {
        rawTasks.push({
          eventId: e.id, taskType: 'squad', opponent: e.opponent, deadline: e.date, eventDate: e.date,
          auto: squadAuto, manual: squadManual, effective: squadEffective,
        })
      }

      const lineupAuto = lineupSet.has(e.id)
      const lineupManual = manualSet.has(`${e.id}:lineup`)
      const lineupEffective = effectiveDone(lineupAuto, lineupManual)
      if (isTaskVisible({ taskType: 'lineup', done: lineupEffective, daysUntilEvent: dagenTussen(today, e.date), daysUntilDeadline: 0 })) {
        rawTasks.push({
          eventId: e.id, taskType: 'lineup', opponent: e.opponent, deadline: e.date, eventDate: e.date,
          auto: lineupAuto, manual: lineupManual, effective: lineupEffective,
        })
      }

      const analysisAuto = analyseBestaat({
        goals_for: e.goals_for,
        goals_against: e.goals_against,
        ratingCount: ratingCountMap.get(e.id) ?? 0,
        eventCount: matchEventCountMap.get(e.id) ?? 0,
      })
      const analysisManual = manualSet.has(`${e.id}:analysis`)
      const analysisEffective = effectiveDone(analysisAuto, analysisManual)
      const deadline = analysisDeadline(e.date, trainingDates)
      if (isTaskVisible({ taskType: 'analysis', done: analysisEffective, daysUntilEvent: dagenTussen(today, e.date), daysUntilDeadline: dagenTussen(today, deadline) })) {
        rawTasks.push({
          eventId: e.id, taskType: 'analysis', opponent: e.opponent, deadline, eventDate: e.date,
          auto: analysisAuto, manual: analysisManual, effective: analysisEffective,
        })
      }
    } else if (e.type === 'training') {
      const auto = hasTrainingPlanDone(e.doelstelling, oefCountMap.get(e.id) ?? 0)
      const manual = manualSet.has(`${e.id}:training_plan`)
      const effective = effectiveDone(auto, manual)
      if (isTaskVisible({ taskType: 'training_plan', done: effective, daysUntilEvent: dagenTussen(today, e.date), daysUntilDeadline: 0 })) {
        rawTasks.push({
          eventId: e.id, taskType: 'training_plan', opponent: null, deadline: e.date, eventDate: e.date,
          auto, manual, effective,
        })
      }

      // Zelfreview van een gehouden training: zichtbaar vanaf de trainingsdag
      // tot de eerstvolgende training (strikt ná deze datum; twee trainingen
      // op één dag geven dus twee items). Ingevuld = automatisch afgerond en
      // niet handmatig af te vinken.
      if (magZelfreviewen && !zelfreviewFout) {
        const volgendeTraining = selfReviewNextTraining(e.date, trainingDates)
        if (isSelfReviewVisible({
          daysUntilEvent: dagenTussen(today, e.date),
          daysUntilNextTraining: volgendeTraining === null ? null : dagenTussen(today, volgendeTraining),
        })) {
          const reviewAuto = reviewSet.has(e.id)
          rawTasks.push({
            eventId: e.id, taskType: 'self_review', opponent: null, deadline: e.date, eventDate: e.date,
            auto: reviewAuto, manual: false, effective: reviewAuto,
          })
        }
      }
    }
  }

  const todoItems: TodoItem[] = sortTasks(rawTasks).map((task) => ({
    eventId: task.eventId,
    taskType: task.taskType,
    opponent: task.opponent,
    deadline: task.deadline,
    eventDate: task.eventDate,
    auto: task.auto,
    manual: task.manual,
  }))

  // ── Vandaag-model: hoofdkaart + weekregels ──
  // Selectie/opstelling "klaar" = effectief klaar (automatisch OF handmatig
  // afgevinkt), dezelfde regel als de To-do. Voor een event buiten het
  // To-do-venster zijn geen overrides opgehaald; daar telt alleen automatisch.
  const selectieKlaarIds = new Set<string>(
    selectieIds.filter((id) => effectiveDone(squadSet.has(id), manualSet.has(`${id}:squad`))),
  )
  const opstellingKlaarIds = new Set<string>(
    selectieIds.filter((id) => effectiveDone(lineupSet.has(id), manualSet.has(`${id}:lineup`))),
  )
  function naarKaartEvent(e: FootballEvent): KaartEvent | null {
    if (e.type !== 'training' && e.type !== 'match') return null
    return { id: e.id, type: e.type, date: e.date, time: e.time, opponent: e.opponent, home_away: e.home_away }
  }
  const eventPerId = new Map<string, FootballEvent>()
  for (const e of [...todoCandidates, ...upcoming]) eventPerId.set(e.id, e)
  const kaartEvents = new Map<string, KaartEvent>()
  for (const e of eventPerId.values()) {
    const k = naarKaartEvent(e)
    if (k) kaartEvents.set(e.id, k)
  }
  const vandaagModel: VandaagModel = bepaalVandaag({
    vandaag: today,
    taken: rawTasks,
    events: kaartEvents,
    volgendEvent: volgendEvent ? naarKaartEvent(volgendEvent) : null,
    opstellingPerEvent,
    selectieKlaarIds,
    opstellingKlaarIds,
  })
  const hoofdkaartEvent: FootballEvent | null = vandaagModel.hoofdkaart
    ? eventPerId.get(vandaagModel.hoofdkaart.event.id) ?? null
    : null

  // ── Aanwezigheidstellingen ──
  // Eén telling per event, dezelfde als de kalender (app/events/page.tsx):
  // telAanwezigheid over de ACTIEVE spelers (`players` is al op active = true
  // gefilterd), zonder rij = 'unknown'. Teller en noemer gaan UITSLUITEND over
  // vaste spelers (vasteTelling); een aanwezige gast verhoogt "x/y" dus niet.
  // Geblesseerd staat apart in de legenda. Event zonder entry in
  // statusPerEvent (batch gefaald of niet opgehaald) → null: geen getallen.
  type Telling = { present: number; absent: number; injured: number; squadSize: number }
  function tellingVoor(eventId: string): Telling | null {
    const statussen = statusPerEvent.get(eventId)
    if (!statussen) return null
    const telling = telAanwezigheid(players, (p) => statussen.get(p.id) ?? 'unknown')
    const vast = vasteTelling(telling)
    return { present: vast.aanwezig, absent: telling.afwezig, injured: telling.geblesseerd, squadSize: vast.noemer }
  }
  // Alleen kaarten over een aankomend event tonen een telling; analyse en
  // zelfreview gaan over een gespeeld/gehouden event.
  const SOORTEN_MET_TELLING: ReadonlySet<KaartSoort> = new Set<KaartSoort>([
    'training_plan', 'squad', 'lineup', 'lineup_onvolledig', 'volgend_event',
  ])
  const hoofdkaartTelling: Telling | null =
    vandaagModel.hoofdkaart && SOORTEN_MET_TELLING.has(vandaagModel.hoofdkaart.soort)
      ? tellingVoor(vandaagModel.hoofdkaart.event.id)
      : null

  // ── Availability for the next event ──
  // Statussen uit dezelfde map; een gefaalde batch geeft een lege map (alle
  // spelers 'unknown'), net als voorheen bij een gefaalde hero-query.
  const heroAttendance: ReadonlyMap<string, AttendanceStatus> =
    (volgendEvent ? statusPerEvent.get(volgendEvent.id) : undefined) ?? new Map<string, AttendanceStatus>()

  // Een afwezige of onbekende gast hoort niet in de Beschikbaarheid-tegel, die
  // er anders een chip "Afwezig"/"nog niet gereageerd" aan hangt. Filteren VÓÓR
  // de slice, anders bezet hij alsnog een van de zes plekken. Een aanwezige
  // gast mag er wel tussen staan. Nul extra queries.
  const availabilityItems: AvailabilityItem[] = players
    .filter((p) => teltMee(p.type, heroAttendance.get(p.id) === 'present'))
    .slice(0, 6)
    .map((p, i) => ({
      id: p.id,
      initials: initialsOf(p.name),
      avatarBg: AVATAR_BG[i % AVATAR_BG.length],
      name: p.name,
      num: p.jersey_number,
      pos: POSITION_ABBREVIATIONS[p.position] ?? p.position,
      status: heroAttendance.get(p.id) ?? 'unknown',
      injured: p.injured,
    }))

  // Teksten voor de hoofdkaart (eyebrow, titel, knop) uit het model.
  const hoofdkaart = vandaagModel.hoofdkaart
  const hoofdkaartTekst = hoofdkaart
    ? hoofdkaartTeksten(hoofdkaart, today, opstellingKlaarIds.has(hoofdkaart.event.id), t)
    : null

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      {/* Eenmalige bevestiging ná het accepteren van een uitnodiging (brief
          §2.3 punt 3, validatiebevinding 3) — zie components/dashboard/
          JoinedBanner.tsx voor waarom en hoe de ?joined=1-param verdwijnt. */}
      <JoinedBanner teamName={teamName || t.team.activeTeam} />

      {/* Topbar — vaste PageHeader-opbouw (designronde 3). De aanmaakknop
          staat alleen vanaf md: op mobiel neemt de contextuele FAB hem over. */}
      <PageHeader
        eyebrow={dateLine}
        title={<><Begroeting labels={begroetingLabels} /> 👋</>}
        actions={canEdit(ctx, 'agenda') ? (
          <LinkButton href="/events/new" icon="add" className="max-md:hidden">{t.home.newEvent}</LinkButton>
        ) : undefined}
      />

      {/* Vandaag-rij: hoofdkaart (of de lege staat) met rechts, vanaf lg, de
          weekregels. Zelfde DOM-volgorde op mobiel en desktop. */}
      <div className={`grid grid-cols-1 gap-4 items-start ${vandaagModel.regels.length > 0 ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
        {hoofdkaart && hoofdkaartEvent && hoofdkaartTekst ? (
          <DashboardHero
            event={hoofdkaartEvent}
            vandaag={today}
            eyebrow={hoofdkaartTekst.eyebrow}
            tone={hoofdkaartTekst.tone}
            title={hoofdkaartTekst.title}
            t={t}
            telling={hoofdkaartTelling}
            primaryHref={hoofdkaart.href}
            primaryLabel={hoofdkaartTekst.primaryLabel}
            primaryIcon={hoofdkaartTekst.primaryIcon}
            secondaryHref={`/events/${hoofdkaart.event.id}`}
            secondaryLabel={t.home.viewEvent}
          />
        ) : (
          <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
            <span className="ms text-[40px] text-faint">calendar_month</span>
            <p className="text-ink font-bold">{t.home.empty}</p>
            <p className="text-faint text-sm">{t.home.emptyHint}</p>
            <LinkButton href="/events/new" icon="add" className="mt-1">{t.home.newEvent}</LinkButton>
          </div>
        )}
        <WeekRegels regels={vandaagModel.regels} vandaag={today} t={t} />
      </div>

      {/* Beslissing-eerst-volgorde (mobiel én desktop dezelfde DOM-volgorde):
          eerst de open taken, dan pas de kengetallen — het dashboard is een
          "vandaag"-scherm, de analyse leeft op /inzichten. De vier tegels
          staan als 2×2-bento in de hoofdkolom en linken elk door naar hun
          detailpagina. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <TodoList
            items={todoItems}
            vandaag={today}
            canEditTask={{
              training_plan: canEdit(ctx, 'training'),
              self_review: canEdit(ctx, 'training'),
              squad: canEdit(ctx, 'wedstrijd'),
              lineup: canEdit(ctx, 'wedstrijd'),
              analysis: canEdit(ctx, 'wedstrijd'),
            }}
          />

          <div className="grid grid-cols-2 gap-3.5">
            <StatCard
              label={t.home.statAttendance}
              icon="trending_up"
              href="/inzichten?periode=4w"
              value={attendancePct !== null ? `${attendancePct}%` : '—'}
            >
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <div className="h-[7px] rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <div className="h-full" style={{ width: `${attendancePct ?? 0}%`, background: 'linear-gradient(90deg,#16a34a,#4ade80)' }} />
                  </div>
                  {/* Doelstreepje op de balk: maakt van het percentage een
                      oordeel (zelfde 85%-norm als de inzichtenpagina). */}
                  <span
                    aria-hidden="true"
                    className="absolute top-[-2px] h-[11px] w-[2px] rounded-full"
                    style={{ left: `${OPKOMST_DOEL}%`, background: 'var(--faint)' }}
                  />
                </div>
                <span
                  className="text-[11.5px] font-semibold"
                  style={{ color: attendancePct !== null && attendancePct >= OPKOMST_DOEL ? 'var(--chip-green-fg)' : 'var(--faint)' }}
                >
                  {t.home.attendanceGoal.replace('{n}', String(OPKOMST_DOEL))}
                </span>
              </div>
            </StatCard>
            <StatCard label={t.home.statActivePlayers} icon="groups" href="/players" value={totalActive}>
              <div className="flex flex-col gap-2">
                {/* Segmentvolgorde = beschikbaar (groen fit, oranje gast) links,
                    niet-beschikbaar (rood) rechts. De hexkleuren zijn bewust
                    constant over beide thema's, net als de opkomstbalk hierboven. */}
                <div className="h-[7px] rounded-full overflow-hidden flex" style={{ background: 'var(--track)' }}>
                  {totalActive > 0 && fitCount > 0 && (
                    <div style={{ width: `${(fitCount / totalActive) * 100}%`, background: '#16a34a' }} />
                  )}
                  {totalActive > 0 && guestCount > 0 && (
                    <div style={{ width: `${(guestCount / totalActive) * 100}%`, background: '#f59e0b' }} />
                  )}
                  {totalActive > 0 && injuredCount > 0 && (
                    <div style={{ width: `${(injuredCount / totalActive) * 100}%`, background: '#ef4444' }} />
                  )}
                </div>
                <span className="text-[11.5px] font-semibold text-faint">
                  {fitCount} {t.home.fit}
                  {guestCount > 0 && ` · ${guestCount} ${t.home.guest}`}
                  {` · ${injuredCount} ${t.home.injured} (${injuredPct}%)`}
                </span>
              </div>
            </StatCard>
            <StatCard label={t.home.statForm} icon={<ChartBarIcon className="w-5 h-5" />} href="/inzichten" value={
              recentForm.length > 0
                ? <FormStrip items={recentForm} t={t} />
                : <span className="text-[13px] font-semibold text-faint">{t.home.formEmpty}</span>
            } />
            <NextMatch match={nextMatch} t={t} vandaag={today} />
          </div>
        </div>

        {/* Rechterkolom (desktop) / onder de kengetallen (mobiel): status-
            informatie zonder directe actie. Periodisering stond eerder direct
            onder de hero en duwde de To-do en kengetallen op mobiel ver naar
            beneden (designronde 3). */}
        <div className="flex flex-col gap-4 min-w-0">
          <Availability items={availabilityItems} t={t} />
          <PeriodiseringStatus t={t} items={periodiseringItems} steigerungsWeken={steigerungsWeken} />
        </div>
      </div>
    </div>
  )
}
