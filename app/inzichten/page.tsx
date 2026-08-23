import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAllSettings } from '@/app/actions/settings'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import { todayLocal } from '@/lib/utils'
import { matchResult } from '@/lib/match-analysis.mjs'
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
} from '@/lib/inzichten'
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
import PrintButton from '@/components/PrintButton'
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
  if (!venster) {
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <div>
          <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.insights.pageTitle}</h1>
          <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.insights.pageSubtitle}</p>
        </div>
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
  ] = await Promise.all([
    supabase.rpc('inzichten_aanwezigheid', { p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_training_opkomst_per_maand', { p_start: verleden.start, p_end: verleden.end }),
    supabase.rpc('inzichten_rating_team_per_wedstrijd', { p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_rating_per_speler', { p_start: venster.start, p_end: venster.end }),
    supabase.rpc('inzichten_aanwezigheid_per_speler', { p_start: verleden.start, p_end: verleden.end }),
    supabase.from('events')
      .select('id, date, goals_for, goals_against')
      .eq('team_id', user.id)
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
      .eq('team_id', user.id)
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
      .eq('team_id', user.id)
      .eq('active', true)
      .eq('type', 'regular')
      .order('name', { ascending: true }),
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

  const aanwezigheidRij: AanwezigheidRij | null =
    unwrap<AanwezigheidRij>('inzichten.aanwezigheid', aanwezigheidResult)[0] ?? null

  const maandOpkomst = toMaandOpkomst(unwrap<MaandOpkomstRij>('inzichten.maandOpkomst', maandOpkomstResult))

  const teamRating: TeamRatingRij[] = unwrap<TeamRatingRij>('inzichten.teamRating', teamRatingResult)

  // Top 5 / worst 5: één RPC per onderwerp levert álle spelers, het snijden in
  // twee lijstjes gebeurt hier (lib/inzichten.ts) — geen tweede databaseronde.
  const ratingTopWorst = topWorstRating(
    unwrap<RatingPerSpelerRij>('inzichten.ratingPerSpeler', ratingPerSpelerResult),
  )
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
    aanwezigheidTopWorst.top.length === 0

  if (geenEnkeleData) {
    // Twee verschillende lege staten, en het verschil is wezenlijk. Bij het
    // hele seizoen is er écht nog niets en is "ga registreren" het juiste
    // antwoord. Bij een afgeknipte periode kán er elders wél data zijn — dan
    // moet de periodekiezer zichtbaar blijven, anders zit de gebruiker vast
    // in een lege pagina zonder weg terug.
    const smallerDanSeizoen = periode !== PERIODE_STANDAARD
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <div>
          <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.insights.pageTitle}</h1>
          <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.insights.pageSubtitle}</p>
        </div>
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.insights.pageTitle}</h1>
          <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.insights.pageSubtitle}</p>
        </div>
        <PrintButton />
      </div>

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
        primaryColor={clubColors.primary}
        secondaryColor={clubColors.secondary}
      />
    </>
  )
}
