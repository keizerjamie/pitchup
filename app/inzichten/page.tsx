import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireTeamContextOrLogin } from '@/lib/team-context'
import { getAllSettings } from '@/app/actions/settings'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import { formatDate, todayLocal } from '@/lib/utils'
import { matchResult } from '@/lib/match-analysis.mjs'
import { countCategoryOccurrences } from '@/lib/periodization'
import { addDays } from '@/lib/utils'
import {
  seizoensVenster,
  verledenSeizoensVenster,
  berekenAanwezigheidPercentage,
  toMaandOpkomst,
  telVorm,
  topWorstRating,
  topWorstAanwezigheid,
  laatsteMaandTrend,
  teamRatingTrend,
  doelsaldo,
  bepaalSignalen,
  periodeVenster,
  isPeriode,
  PERIODE_STANDAARD,
  type Periode,
  MAX_SEIZOEN_WEDSTRIJDEN,
  type AanwezigheidRij,
  type MaandOpkomstRij,
  type TeamRatingRij,
  type DoelpuntItem,
  type SpelerOptie,
  type RatingPerSpelerRij,
  type AanwezigheidPerSpelerRij,
  splitsThuisUit,
  resultatenPerFormatie,
  bepaalTopscorers,
  kaartenPerSpeler,
  telPerKwartier,
  telTegendoelpunten,
  RATING_TREND_VENSTER,
  verdeelSpeelkansen,
  bepaalStijgersDalers,
  dekkingPerPositie,
  naastElkaarPerSpeler,
  blessuresPerMaand,
  verdeelSpeelminuten,
  belastingPerWeek,
  periodiseringVoortgang,
  telInvulDiscipline,
  periodiseringOndergrens,
  type TrainingKoppelingRij,
  type InvulDisciplineRij,
  type SpeelminutenRij,
  type SpeelkansenRij,
  type RatingVormRij,
  type TrainingOpkomstPerSpelerRij,
  type BlessuresPerMaandRij,
  type SpelerPositieRij,
  type WedstrijdUitslagRij,
  type SpelerMomentenRij,
  type DoelpuntMinuutRij,
  type TegendoelpuntMinuutRij,
} from '@/lib/inzichten'
import type { CategorieMeting } from '@/lib/types'
import type { FormStripItem } from '@/components/dashboard/FormStrip'
import AanwezigheidChart from '@/components/inzichten/AanwezigheidChart'
import OpkomstPerMaandChart from '@/components/inzichten/OpkomstPerMaandChart'
import RatingsChart from '@/components/inzichten/RatingsChart'
import DoelpuntenChart from '@/components/inzichten/DoelpuntenChart'
import VormChart from '@/components/inzichten/VormChart'
import TopWorstRatings from '@/components/inzichten/TopWorstRatings'
import TopWorstAanwezigheid from '@/components/inzichten/TopWorstAanwezigheid'
import KpiStrip from '@/components/inzichten/KpiStrip'
import SignalenBlok from '@/components/inzichten/SignalenBlok'
import PeriodeFilter from '@/components/inzichten/PeriodeFilter'
import SeizoensrapportPrint from '@/components/inzichten/SeizoensrapportPrint'
import TrainingsinhoudChart from '@/components/inzichten/TrainingsinhoudChart'
import ThuisUitKaart from '@/components/inzichten/ThuisUitKaart'
import FormatieKaart from '@/components/inzichten/FormatieKaart'
import TopscorersKaart from '@/components/inzichten/TopscorersKaart'
import GeleRodeKaartenLijst from '@/components/inzichten/GeleRodeKaartenLijst'
import KwartierChart from '@/components/inzichten/KwartierChart'
import TegendoelpuntenChart from '@/components/inzichten/TegendoelpuntenChart'
import SpeelkansenKaart from '@/components/inzichten/SpeelkansenKaart'
import StijgersDalersKaart from '@/components/inzichten/StijgersDalersKaart'
import PositiedekkingKaart from '@/components/inzichten/PositiedekkingKaart'
import OpkomstSelectieRatingKaart from '@/components/inzichten/OpkomstSelectieRatingKaart'
import BlessuresPerMaandChart from '@/components/inzichten/BlessuresPerMaandChart'
import SpeelminutenKaart from '@/components/inzichten/SpeelminutenKaart'
import BelastingKaart from '@/components/inzichten/BelastingKaart'
import PeriodiseringVoortgangKaart from '@/components/inzichten/PeriodiseringVoortgangKaart'
import InvulDisciplineKaart from '@/components/inzichten/InvulDisciplineKaart'
import PrintButton from '@/components/PrintButton'
import PageHeader from '@/components/ui/PageHeader'
import { resolveClubColors } from '@/lib/club-colors'

// Pagina-brede lege staat. Twee gevallen delen deze schil: "geen seizoen
// ingesteld" en "seizoen ingesteld, maar nog geen enkel cijfer". Beide zijn
// een lege PAGINA, geen lege kaart — zeven kaarten die elk apart "nog geen
// data" melden herhaalt zeven keer dezelfde boodschap en oogt als een kapotte
// pagina in plaats van als een verse start.
//
// Zelfde visuele taal als de bestaande pagina-brede lege staten elders
// (bv. app/periodisering/page.tsx).
function LegeStaat({
  icoon,
  titel,
  hint,
  actieHref,
  actieLabel,
}: {
  icoon: string
  titel: string
  hint: string
  actieHref: string
  actieLabel: string
}) {
  return (
    <div className="max-w-lg surface-card p-10 text-center flex flex-col items-center gap-3">
      <span className="ms text-[40px] text-faint">{icoon}</span>
      <p className="text-ink font-bold">{titel}</p>
      <p className="text-faint text-sm">{hint}</p>
      <Link
        href={actieHref}
        className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white"
        style={{ background: 'var(--brand-btn)' }}
      >
        {actieLabel}
      </Link>
    </div>
  )
}

export default async function InzichtenPage({
  searchParams,
}: {
  // Optioneel én als Promise: Next levert dit als Promise aan, maar de
  // acceptatietests roepen deze functie rechtstreeks aan zonder props
  // (inzichten.acceptance.test.tsx). Zonder `?` zou elke bestaande test
  // klappen op het uitpakken hieronder.
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const params = searchParams ? await searchParams : {}
  // Onbekende of ontbrekende waarde valt terug op het hele seizoen — een
  // tikfout in de URL mag nooit stilzwijgend een smaller venster opleveren.
  const periode: Periode = isPeriode(params.periode) ? params.periode : PERIODE_STANDAARD
  const ctx = await requireTeamContextOrLogin()

  const settings = await getAllSettings()
  // Huisstijl voor het print-rapport. Geen extra query: getAllSettings() is
  // hierboven al opgehaald voor het seizoensvenster.
  const teamName = settings['team_name']?.trim() || null
  const teamLogoUrl = settings['team_logo_url'] || null
  const clubColors = resolveClubColors(settings)
  const seizoen = seizoensVenster(settings)
  // Vanaf hier is `venster` het GEKOZEN venster: het seizoen, of de laatste
  // 4/8 weken daarbinnen. Alle RPC's en queries hieronder gebruiken dit —
  // niet het volledige seizoen.
  const venster = seizoen ? periodeVenster(seizoen, periode) : null

  // Geen (geldig) seizoen ingesteld: ÉÉN pagina-brede lege staat, en geen
  // enkele RPC/query wordt uitgevoerd (O-vraag uit de technische brief).
  // `venster` is null precies als `seizoen` null is; de dubbele toets laat TS
  // zien dat `seizoen` hieronder niet null is.
  if (!seizoen || !venster) {
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <PageHeader title={t.insights.pageTitle} subtitle={t.insights.pageSubtitle} />
        <LegeStaat
          icoon="calendar_month"
          titel={t.insights.noSeason}
          hint={t.insights.noSeasonHint}
          actieHref="/settings"
          actieLabel={t.insights.goToSettings}
        />
      </div>
    )
  }

  const today = todayLocal()

  // Aanwezigheidscijfers kijken alleen naar wat al geweest is: het venster
  // stopt bij gisteren, ook als het seizoen nog doorloopt. Zonder deze grens
  // tellen al ingeplande (nog niet afgevinkte) trainingen/wedstrijden als
  // "niemand aanwezig" mee. Zelfde cutoff als de vorm-query hieronder
  // (`.lt('date', today)`). De rating-, doelpunten- en vormgrafieken hebben dit
  // niet nodig: die zijn per definitie verleden-only (een uitslag of rating
  // bestaat pas ná de wedstrijd).
  const verleden = verledenSeizoensVenster(venster, today)

  const [
    aanwezigheidResult,
    maandOpkomstResult,
    teamRatingResult,
    ratingPerSpelerResult,
    aanwezigheidPerSpelerResult,
    vormResult,
    doelpuntenResult,
    spelersResult,
    uitslagenResult,
    spelerMomentenResult,
    doelpuntMinutenResult,
    tegendoelpuntenResult,
    speelkansenResult,
    ratingVormResult,
    trainingOpkomstResult,
    blessuresResult,
    positiesResult,
    speelminutenResult,
    belastingResult,
    disciplineResult,
    metingenResult,
  ] = await Promise.all([
    // Alle vijf RPC's krijgen p_team_id VOORAAN uit de teamcontext. Sinds de
    // assistent-trainers is auth.uid() niet meer gelijk aan het team, dus de
    // functies kunnen het team niet zelf meer afleiden. Ze doen daarbovenop een
    // lidmaatschapscheck. Vereist supabase/inzichten-team-id.sql (M3a).
    supabase.rpc('inzichten_aanwezigheid', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_training_opkomst_per_maand', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_rating_team_per_wedstrijd', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_rating_per_speler', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_aanwezigheid_per_speler', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.from('events')
      .select('id, date, goals_for, goals_against')
      .eq('team_id', ctx.teamId)
      .eq('type', 'match')
      .gte('date', venster.start)
      .lte('date', venster.end)
      .lt('date', today)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
    supabase.from('events')
      .select('id, date, opponent, match_type, goals_for, goals_against')
      .eq('team_id', ctx.teamId)
      .eq('type', 'match')
      .gte('date', venster.start)
      .lte('date', venster.end)
      .not('goals_for', 'is', null)
      .not('goals_against', 'is', null)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_SEIZOEN_WEDSTRIJDEN),
    // Gastspelers vallen buiten alle inzichten-RPC's (supabase/inzichten.sql),
    // dus ook buiten de spelerskiezer: anders levert een gekozen gast een lege
    // grafiek op.
    supabase.from('players')
      .select('id, name')
      .eq('team_id', ctx.teamId)
      .eq('active', true)
      .eq('type', 'regular')
      .order('name', { ascending: true }),
    // Vier bronnen voor de metrics-kaarten (supabase/inzichten-metrics.sql). Alle
    // vier krijgen `venster`, niet `verleden`: een uitslag of vastgelegd moment
    // bestaat pas ná de wedstrijd, net als bij doelsaldo en de doelpuntenquery.
    // p_team_id komt uit de teamcontext, nooit van de client.
    supabase.rpc('inzichten_wedstrijd_uitslagen', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_speler_momenten', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_doelpunten_per_minuut', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_tegendoelpunten', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    // Fase 2a, spelers (supabase/inzichten-metrics-fase2.sql). Venster per kaart:
    // speelkansen, trainingsopkomst en blessures krijgen `verleden` (een selectie
    // kan nog wijzigen, net als aanwezigheid); de rating-vorm krijgt het HELE
    // seizoen, ongeacht de periodekiezer (W5). p_team_id komt uit de teamcontext.
    supabase.rpc('inzichten_speelkansen', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_rating_vorm_per_speler', {
      p_team_id: ctx.teamId,
      p_start: seizoen.start,
      p_end: seizoen.end,
      p_recent: RATING_TREND_VENSTER,
    }),
    supabase.rpc('inzichten_training_opkomst_per_speler', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_blessures_per_maand', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    // Positiedekking: momentopname van nu (geen periode), eigen query zodat de
    // spelerskiezer hierboven ongemoeid blijft en deze kaart een eigen foutvlag heeft.
    supabase.from('players')
      .select('id, name, position, secondary_positions, injured')
      .eq('team_id', ctx.teamId)
      .eq('active', true)
      .eq('type', 'regular')
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
    // Fase 2b: speelminuten en wissels. `venster`, niet `verleden`: minuten
    // bestaan pas ná de wedstrijd en een wedstrijd van vandaag telt mee.
    // Vereist supabase/inzichten-metrics-fase2b.sql.
    supabase.rpc('inzichten_speelminuten_per_speler', { p_team_id: ctx.teamId, p_start: venster.start, p_end: venster.end }),
    // Fase 3a, training en kwaliteit (supabase/inzichten-metrics-fase3a.sql).
    // Belasting en invul-discipline krijgen `verleden`: een nog niet gehouden
    // training of wedstrijd telt nergens mee. p_team_id komt uit de
    // teamcontext. De periodisering heeft een eigen, tweede aanroep hieronder.
    supabase.rpc('inzichten_training_koppelingen', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_invul_discipline', { p_team_id: ctx.teamId, p_start: verleden.start, p_end: verleden.end }),
    // Alle metingen van het team: de nulmeting is de eerste meting OOIT, ook
    // van vóór het seizoen.
    supabase.from('categorie_metingen')
      .select('id, team_id, categorie, datum, stap, notes, created_at')
      .eq('team_id', ctx.teamId)
      .order('datum')
      .order('id'),
  ])

  // Elke bron faalt onafhankelijk: bij een fout logt de pagina de context en
  // valt terug op [] voor precies díe dataset — de andere grafieken renderen
  // gewoon door (Promise.all klapt niet, Supabase gooit niet, {data,error}).
  function unwrap<T>(context: string, result: { data: T[] | null; error: unknown }): T[] {
    if (result.error) {
      logError(context, result.error)
      return []
    }
    return result.data ?? []
  }

  // Zoals unwrap, maar met een foutvlag: de nieuwe kaarten tonen bij een falende
  // bron `bronFout` in plaats van een (misleidende) lege staat. Logt de fout,
  // geeft nooit de ruwe fout door.
  function unwrapBron<T>(
    context: string,
    result: { data: T[] | null; error: unknown },
  ): { rijen: T[]; fout: boolean } {
    if (result.error) {
      logError(context, result.error)
      return { rijen: [], fout: true }
    }
    return { rijen: result.data ?? [], fout: false }
  }

  const aanwezigheidRij: AanwezigheidRij | null =
    unwrap<AanwezigheidRij>('inzichten.aanwezigheid', aanwezigheidResult)[0] ?? null

  const maandOpkomst = toMaandOpkomst(unwrap<MaandOpkomstRij>('inzichten.maandOpkomst', maandOpkomstResult))

  const teamRating: TeamRatingRij[] = unwrap<TeamRatingRij>('inzichten.teamRating', teamRatingResult)

  // Top 5 / worst 5: één RPC per onderwerp levert álle spelers, het snijden in
  // twee lijstjes gebeurt hier (lib/inzichten.ts) — geen tweede databaseronde.
  // Eén keer uitpakken met foutvlag: de rijen voeden de top/worst-lijstjes én
  // kaart "opkomst, selectie en rating", die bij een fout `bronFout` toont.
  const ratingPerSpelerBron = unwrapBron<RatingPerSpelerRij>('inzichten.ratingPerSpeler', ratingPerSpelerResult)
  const ratingTopWorst = topWorstRating(ratingPerSpelerBron.rijen)
  // Eén keer uitpakken: deze rijen voeden zowel de top/worst-lijstjes als het
  // signalenblok. Twee keer unwrap() zou de foutmelding bij een RPC-fout ook
  // twee keer loggen.
  const aanwezigheidPerSpeler = unwrap<AanwezigheidPerSpelerRij>(
    'inzichten.aanwezigheidPerSpeler',
    aanwezigheidPerSpelerResult,
  )
  const aanwezigheidTopWorst = topWorstAanwezigheid(aanwezigheidPerSpeler)

  const vormRows = unwrap<{ id: string; goals_for: number | null; goals_against: number | null }>(
    'inzichten.vorm',
    vormResult,
  )
  const vormItems: FormStripItem[] = vormRows.map((m) => ({ id: m.id, result: matchResult(m) }))
  const vormTelling = telVorm(vormRows)

  const doelpunten: DoelpuntItem[] = unwrap<DoelpuntItem>('inzichten.doelpunten', doelpuntenResult)

  const spelers: SpelerOptie[] = unwrap<SpelerOptie>('inzichten.spelers', spelersResult)

  const aanwezigheidData = aanwezigheidRij
    ? {
        aanwezig: aanwezigheidRij.aanwezig,
        afwezig: aanwezigheidRij.afwezig,
        percentage: berekenAanwezigheidPercentage(aanwezigheidRij.aanwezig, aanwezigheidRij.afwezig),
      }
    : null

  // Metrics-kaarten. De RPC levert hooguit MAX_SEIZOEN_WEDSTRIJDEN + 1 uitslagen:
  // meer dan MAX betekent afgekapt, en dan tonen de uitslagkaarten een melding
  // in plaats van cijfers die stilletjes te laag zouden zijn.
  const uitslagen = unwrapBron<WedstrijdUitslagRij>('inzichten.wedstrijdUitslagen', uitslagenResult)
  const spelerMomenten = unwrapBron<SpelerMomentenRij>('inzichten.spelerMomenten', spelerMomentenResult)
  const doelpuntMinuten = unwrapBron<DoelpuntMinuutRij>('inzichten.doelpuntenPerMinuut', doelpuntMinutenResult)
  const tegendoelpuntRijen = unwrapBron<TegendoelpuntMinuutRij>('inzichten.tegendoelpunten', tegendoelpuntenResult)
  // Fase 2a: elke bron faalt los (PGRST202 zonder migratie → bronFout per kaart).
  const speelkansenBron = unwrapBron<SpeelkansenRij>('inzichten.speelkansen', speelkansenResult)
  const ratingVormBron = unwrapBron<RatingVormRij>('inzichten.ratingVorm', ratingVormResult)
  const trainingOpkomstBron = unwrapBron<TrainingOpkomstPerSpelerRij>('inzichten.trainingOpkomstPerSpeler', trainingOpkomstResult)
  const blessuresBron = unwrapBron<BlessuresPerMaandRij>('inzichten.blessuresPerMaand', blessuresResult)
  const positiesBron = unwrapBron<SpelerPositieRij>('inzichten.posities', positiesResult)
  const speelminutenBron = unwrapBron<SpeelminutenRij>('inzichten.speelminuten', speelminutenResult)
  const speelminuten = verdeelSpeelminuten(speelminutenBron.rijen)
  const speelkansen = verdeelSpeelkansen(speelkansenBron.rijen)
  const stijgersDalers = bepaalStijgersDalers(ratingVormBron.rijen)
  const dekking = dekkingPerPositie(positiesBron.rijen)
  const naastElkaar = naastElkaarPerSpeler({
    opkomst: trainingOpkomstBron.rijen,
    speelkansen: speelkansenBron.rijen,
    ratings: ratingPerSpelerBron.rijen,
  })
  const blessureMaanden = blessuresPerMaand(blessuresBron.rijen, verleden)
  // Kaart 4 faalt zodra één van zijn drie bronnen faalt.
  const naastElkaarFout = trainingOpkomstBron.fout || speelkansenBron.fout || ratingPerSpelerBron.fout
  const uitslagenAfgekapt = uitslagen.rijen.length > MAX_SEIZOEN_WEDSTRIJDEN
  const thuisUit = splitsThuisUit(uitslagen.rijen)
  const formaties = resultatenPerFormatie(uitslagen.rijen)
  const topscorers = bepaalTopscorers(spelerMomenten.rijen)
  const kaarten = kaartenPerSpeler(spelerMomenten.rijen)
  const kwartieren = telPerKwartier(doelpuntMinuten.rijen)
  const tegenKwartieren = telTegendoelpunten(tegendoelpuntRijen.rijen)

  // Trainingsinhoud: in hoeveel trainingen kwam elke oefeningcategorie voor.
  // Hergebruikt de bestaande telling uit de periodisering — dezelfde functie
  // die daar de stap mee berekent, zodat beide pagina's nooit een ander cijfer
  // tonen.
  //
  // `verleden` en niet `venster`: dit gaat over wat je gedáán hebt. Een al
  // ingeplande training van volgende week heeft misschien al oefeningen, maar
  // die heb je nog niet getraind.
  //
  // De grenzen zijn EXCLUSIEF (zie countCategoryOccurrences), dus een dag naar
  // buiten om het venster inclusief te maken.
  //
  // De periodiseringskaart (fase 3a) hangt van de metingen af: hij toont altijd
  // het hele seizoen t/m gisteren (ongeacht de periodekiezer) en moet de
  // trainingen tellen vanaf de eigen meetdatum, ook als die vóór de
  // seizoensstart ligt. Een meting in de toekomst telt niet. Zonder meting
  // (of met alleen toekomstige metingen) is er geen RPC-call nodig.
  const metingenBron = unwrapBron<CategorieMeting>('inzichten.metingen', metingenResult)
  const seizoenVerleden = verledenSeizoensVenster(seizoen, today)
  const metingenTotGisteren = metingenBron.rijen.filter((m) => m.datum <= seizoenVerleden.end)
  // Ondergrens van de bron: per onderdeel de meting die bij de seizoensstart
  // gold (zo blijft k identiek aan getTrainingLog en groeit de bron niet mee
  // over seizoenen). Aan periodiseringVoortgang gaan wél alle metingen t/m
  // gisteren.
  const periodiseringStart = periodiseringOndergrens(metingenTotGisteren, seizoen.start)
  const [inhoudTellingen, periodiseringResult] = await Promise.all([
    countCategoryOccurrences(supabase, ctx.teamId, addDays(verleden.start, -1), addDays(verleden.end, 1)),
    periodiseringStart === null || periodiseringStart > seizoenVerleden.end
      ? Promise.resolve(null)
      : supabase.rpc('inzichten_training_koppelingen', {
          p_team_id: ctx.teamId,
          p_start: periodiseringStart,
          p_end: seizoenVerleden.end,
        }),
  ])

  // Fase 3a: elke bron faalt los (PGRST202 zonder migratie → bronFout per kaart).
  // De periodiseringsbron faalt ook als de metingen falen.
  const belastingBron = unwrapBron<TrainingKoppelingRij>('inzichten.belasting', belastingResult)
  const disciplineBron = unwrapBron<InvulDisciplineRij>('inzichten.discipline', disciplineResult)
  const periodiseringBron: { rijen: TrainingKoppelingRij[]; fout: boolean } = metingenBron.fout
    ? { rijen: [], fout: true }
    : periodiseringResult === null
      ? { rijen: [], fout: false }
      : unwrapBron<TrainingKoppelingRij>('inzichten.periodiseringKoppelingen', periodiseringResult)
  const belasting = belastingPerWeek(belastingBron.rijen, verleden)
  const voortgang = periodiseringVoortgang(periodiseringBron.rijen, metingenTotGisteren, seizoenVerleden, today)
  const discipline = telInvulDiscipline(disciplineBron.rijen)

  // Conclusie-laag. Alles hieronder rekent op de rijen die hierboven al zijn
  // opgehaald — geen extra query, geen extra RPC.
  const opkomstTrend = laatsteMaandTrend(maandOpkomst)
  const ratingTrend = teamRatingTrend(teamRating)
  const saldo = doelsaldo(doelpunten)
  const signalen = bepaalSignalen({
    maanden: maandOpkomst,
    aanwezigheidPerSpeler,
    teamRating,
    doelpunten,
  })

  // Seizoen staat ingesteld, maar er is nog geen enkele registratie: dan is
  // elke kaart leeg en zegt de KPI-strook vier keer "—". Eén uitleg met een
  // volgende stap is dan bruikbaarder dan zeven lege vakken. Alle bronnen
  // moeten leeg zijn — één ingevulde uitslag is al genoeg om de gewone pagina
  // te tonen.
  //
  // LET OP bij de eerste voorwaarde: `inzichten_aanwezigheid` levert ALTIJD
  // precies één rij, ook zonder registraties (dan 0/0) — zie AanwezigheidRij
  // in lib/inzichten.ts. `aanwezigheidData` is daarom vrijwel nooit null; het
  // ontbreken van data zit in `percentage === null`. Op `=== null` toetsen
  // maakt deze hele conditie stilzwijgend onbereikbaar.
  const geenEnkeleData =
    (aanwezigheidData === null || aanwezigheidData.percentage === null) &&
    maandOpkomst.length === 0 &&
    teamRating.length === 0 &&
    doelpunten.length === 0 &&
    vormItems.length === 0 &&
    ratingTopWorst.top.length === 0 &&
    aanwezigheidTopWorst.top.length === 0 &&
    // Ook de trainingsinhoud telt mee: een seizoen waarin je wél oefeningen aan
    // trainingen koppelde maar nog geen aanwezigheid of uitslagen invulde, is
    // niet leeg — die kaart heeft dan wél iets te tonen.
    Object.values(inhoudTellingen).every((n) => n === 0) &&
    // De vier nieuwe bronnen tellen mee: alleen vastgelegde momenten (zonder
    // uitslag) is al genoeg voor de gewone pagina.
    uitslagen.rijen.length === 0 &&
    spelerMomenten.rijen.length === 0 &&
    doelpuntMinuten.rijen.length === 0 &&
    tegendoelpuntRijen.rijen.length === 0 &&
    // Fase 2a: speelkansen, trainingsopkomst en blessures tellen mee. Stijgers
    // (volgt het venster niet: bij 4w zou een lege periode anders de volle
    // pagina tonen) en positiedekking (een spelerslijst is geen registratie)
    // bewust niet.
    !speelkansenBron.rijen.some((r) => r.noemer > 0) &&
    trainingOpkomstBron.rijen.every((r) => r.aanwezig + r.afwezig === 0) &&
    blessuresBron.rijen.every((r) => r.geblesseerd === 0) &&
    // Fase 2b: alleen speelminuten is genoeg voor de gewone pagina.
    !speelminutenBron.rijen.some((r) => r.wedstrijden > 0) &&
    // Fase 3a: een belasting met minstens één koppeling met een duur, een
    // meting, of een ingevulde analyse/uitslag/plan is genoeg. Alleen ingeplande
    // trainingen zonder enige invoer gelden bewust NIET als data: anders
    // verdwijnt de lege staat bij elk team met een gegenereerd seizoen.
    !belasting.heeftMinuten &&
    metingenBron.rijen.length === 0 &&
    discipline.metAnalyse + discipline.metUitslag + discipline.metPlan === 0

  if (geenEnkeleData) {
    // Twee verschillende lege staten, en het verschil is wezenlijk. Bij het
    // hele seizoen is er écht nog niets en is "ga registreren" het juiste
    // antwoord. Bij een afgeknipte periode kán er elders wél data zijn — dan
    // moet de periodekiezer zichtbaar blijven, anders zit de gebruiker vast
    // in een lege pagina zonder weg terug.
    const smallerDanSeizoen = periode !== PERIODE_STANDAARD
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <PageHeader title={t.insights.pageTitle} subtitle={t.insights.pageSubtitle} />
        {smallerDanSeizoen ? (
          <>
            <PeriodeFilter actief={periode} t={t} />
            <div className="max-w-lg surface-card p-10 text-center flex flex-col items-center gap-3">
              <span className="ms text-[40px] text-faint">calendar_month</span>
              <p className="text-ink font-bold">{t.insights.periodeLeeg}</p>
              <p className="text-faint text-sm">{t.insights.periodeLeegHint}</p>
            </div>
          </>
        ) : (
          <LegeStaat
            icoon="insights"
            titel={t.insights.geenDataTitle}
            hint={t.insights.geenDataHint}
            actieHref="/events"
            actieLabel={t.insights.geenDataNaarAgenda}
          />
        )}
      </div>
    )
  }

  const periodeLabel =
    periode === '4w' ? t.insights.periode4w : periode === '8w' ? t.insights.periode8w : t.insights.periodeSeizoen

  return (
    <>
      {/* Dual-markup: het scherm drukt niet mee. Wat er uit de printer komt is
          het los opgemaakte rapport hieronder, niet deze pagina — recharts-SVG
          en een schermindeling op A4 leveren nooit een presentabel document
          op. Zelfde patroon als de wedstrijdselectie (MatchSquadEditor). */}
      <div className="print:hidden max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <PageHeader title={t.insights.pageTitle} subtitle={t.insights.pageSubtitle} actions={<PrintButton pdf={{ doel: 'inzichten', periode }} />} />

      <PeriodeFilter actief={periode} t={t} />

      {/* Conclusie eerst, detail daarna. De vier cijfers en de signalen staan
          bewust bóven de grafieken: wie de pagina opent wil weten hoe het
          ervoor staat, niet meteen zes grafieken tegelijk lezen. */}
      <KpiStrip
        opkomst={opkomstTrend}
        maanden={maandOpkomst}
        aanwezigheidPercentage={aanwezigheidData?.percentage ?? null}
        rating={ratingTrend}
        saldo={saldo}
        t={t}
      />

      <SignalenBlok signalen={signalen} t={t} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* De vorm-strook staat boven de detailgrafieken en over de volle
            breedte: het is de meest bekeken regel van de pagina en stond
            eerder helemaal onderaan. */}
        <div className="lg:col-span-2">
          <VormChart items={vormItems} telling={vormTelling} t={t} />
        </div>
        <OpkomstPerMaandChart data={maandOpkomst} t={t} />
        <AanwezigheidChart data={aanwezigheidData} t={t} />
        <RatingsChart teamData={teamRating} spelers={spelers} periode={periode} t={t} />
        <DoelpuntenChart items={doelpunten} t={t} />
        <TopWorstRatings data={ratingTopWorst} t={t} />
        <TopWorstAanwezigheid data={aanwezigheidTopWorst} t={t} />
        <TrainingsinhoudChart tellingen={inhoudTellingen} t={t} />
        <ThuisUitKaart data={thuisUit} fout={uitslagen.fout} afgekapt={uitslagenAfgekapt} t={t} />
        <FormatieKaart rijen={formaties} fout={uitslagen.fout} afgekapt={uitslagenAfgekapt} t={t} />
        <TopscorersKaart data={topscorers} fout={spelerMomenten.fout} t={t} />
        <GeleRodeKaartenLijst rijen={kaarten} fout={spelerMomenten.fout} t={t} />
        <KwartierChart telling={kwartieren} fout={doelpuntMinuten.fout} t={t} />
        <TegendoelpuntenChart telling={tegenKwartieren} fout={tegendoelpuntRijen.fout} t={t} />
        <div className="lg:col-span-2">
          <SpeelkansenKaart regels={speelkansen} fout={speelkansenBron.fout} t={t} />
        </div>
        <StijgersDalersKaart data={stijgersDalers} fout={ratingVormBron.fout} t={t} />
        <PositiedekkingKaart dekking={dekking} heeftSpelers={positiesBron.rijen.length > 0} fout={positiesBron.fout} t={t} />
        <div className="lg:col-span-2">
          <OpkomstSelectieRatingKaart regels={naastElkaar} fout={naastElkaarFout} t={t} />
        </div>
        <BlessuresPerMaandChart maanden={blessureMaanden} fout={blessuresBron.fout} t={t} />
        <SpeelminutenKaart data={speelminuten} fout={speelminutenBron.fout} t={t} />
        <div className="lg:col-span-2">
          <BelastingKaart data={belasting} fout={belastingBron.fout} t={t} />
        </div>
        <PeriodiseringVoortgangKaart data={voortgang} fout={periodiseringBron.fout} t={t} />
        <InvulDisciplineKaart data={discipline} fout={disciplineBron.fout} t={t} />
      </div>
      </div>

      <SeizoensrapportPrint
        t={t}
        teamName={teamName}
        teamLogoUrl={teamLogoUrl}
        venster={venster}
        periodeLabel={periodeLabel}
        opkomst={opkomstTrend}
        maanden={maandOpkomst}
        aanwezigheidPercentage={aanwezigheidData?.percentage ?? null}
        rating={ratingTrend}
        saldo={saldo}
        signalen={signalen}
        ratingTopWorst={ratingTopWorst}
        aanwezigheidTopWorst={aanwezigheidTopWorst}
        vormTelling={vormTelling}
        vormItems={vormItems}
        generatedOn={formatDate(today, t.browserLocale)}
        primaryColor={clubColors.primary}
        secondaryColor={clubColors.secondary}
      />
    </>
  )
}
