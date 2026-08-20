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

export default async function InzichtenPage() {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const settings = await getAllSettings()
  const venster = seizoensVenster(settings)

  // Geen (geldig) seizoen ingesteld: ÉÉN pagina-brede lege staat, en geen
  // enkele RPC/query wordt uitgevoerd (O-vraag uit de technische brief).
  if (!venster) {
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <div>
          <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.insights.pageTitle}</h1>
          <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.insights.pageSubtitle}</p>
        </div>
        <div className="max-w-lg surface-card p-10 text-center flex flex-col items-center gap-3">
          <span className="ms text-[40px] text-faint">calendar_month</span>
          <p className="text-ink font-bold">{t.insights.noSeason}</p>
          <p className="text-faint text-sm">{t.insights.noSeasonHint}</p>
          <Link
            href="/settings"
            className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white"
            style={{ background: 'var(--brand-btn)' }}
          >
            {t.insights.goToSettings}
          </Link>
        </div>
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
  const aanwezigheidTopWorst = topWorstAanwezigheid(
    unwrap<AanwezigheidPerSpelerRij>('inzichten.aanwezigheidPerSpeler', aanwezigheidPerSpelerResult),
  )

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

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.insights.pageTitle}</h1>
        <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.insights.pageSubtitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AanwezigheidChart data={aanwezigheidData} t={t} />
        <OpkomstPerMaandChart data={maandOpkomst} t={t} />
        <RatingsChart teamData={teamRating} spelers={spelers} t={t} />
        <DoelpuntenChart items={doelpunten} t={t} />
        <TopWorstRatings data={ratingTopWorst} t={t} />
        <TopWorstAanwezigheid data={aanwezigheidTopWorst} t={t} />
        <div className="lg:col-span-2">
          <VormChart items={vormItems} telling={vormTelling} t={t} />
        </div>
      </div>
    </div>
  )
}
