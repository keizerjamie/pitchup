import { notFound } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { Player, AttendanceStatus } from '@/lib/types'
import { formatDateLong, todayLocal } from '@/lib/utils'
import { toMatchFormItems } from '@/lib/match-form'
import { resolveClubColors, readableAccentOnWhite } from '@/lib/club-colors'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import WedstrijdStapper from '@/components/wedstrijd/WedstrijdStapper'
import VolgendeStap from '@/components/wedstrijd/VolgendeStap'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import { teltMee } from '@/lib/aanwezigheid-telling'
import { bouwStapperData, telBeschikbaarheid } from '@/lib/wedstrijd-stappen'
import { bouwRecenteMinuten, RECENTE_WEDSTRIJDEN, type RecenteMinuten, type RecenteWedstrijd } from '@/lib/wedstrijd-selectie-info'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MatchSquadPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const ctx = await requireTeamContextOrLogin()

  const [{ data: event }, { data: squad, error: squadError }, { data: allPlayers }, { data: attendance, error: attendanceError }, { data: settingsRows }, { data: formRows }, { data: lineup, error: lineupError }, { data: ratingCheck, error: ratingError }, { data: matchEventCheck, error: matchEventError }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', ctx.teamId).single(),
    supabase.from('match_squad').select('player_id').eq('event_id', id).eq('team_id', ctx.teamId),
    supabase.from('players').select('*').eq('team_id', ctx.teamId).order('name'),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', ctx.teamId),
    supabase.from('settings').select('key, value').eq('team_id', ctx.teamId)
      .in('key', ['team_name', 'team_logo_url', 'team_color_primary', 'team_color_secondary']),
    // Vorm van de laatste 5 afgeronde wedstrijden (dit event zelf uitgesloten,
    // ongeacht zijn eigen datum) — zelfde order-clausules als de
    // dashboardquery in app/page.tsx, zie het API-contract van de
    // backend-engineer voor toMatchFormItems().
    supabase.from('events')
      .select('id, date, opponent, goals_for, goals_against, home_away')
      .eq('team_id', ctx.teamId)
      .eq('type', 'match')
      .neq('id', id)
      .lt('date', todayLocal())
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
    // Statusbronnen voor de wedstrijdstapper (alleen bestaan/compleet, geen
    // inhoud): opstelling en analyse. De selectie zelf werkt zonder lineups-rij.
    supabase.from('lineups').select('formation, positions').eq('event_id', id).eq('team_id', ctx.teamId).maybeSingle(),
    supabase.from('match_ratings').select('id').eq('event_id', id).eq('team_id', ctx.teamId).limit(1),
    supabase.from('match_events').select('id').eq('event_id', id).eq('team_id', ctx.teamId).limit(1),
  ])

  if (!event || event.type !== 'match') notFound()

  const selectedIds = new Set((squad ?? []).map((s) => s.player_id))
  const statusMap = new Map<string, AttendanceStatus>()
  for (const a of attendance ?? []) statusMap.set(a.player_id, a.status as AttendanceStatus)
  // Geen attendance-rij = nog geen reactie.
  const statusVan = (p: Player): AttendanceStatus => statusMap.get(p.id) ?? 'unknown'
  const players: Player[] = allPlayers ?? []
  // Zichtbare spelers (de wedstrijd als één flow): ALLE actieve spelers, in de
  // editor verdeeld over aanwezig / nog geen reactie / afwezig, plus elke
  // al-geselecteerde speler. Een speler die ná selectie inactief wordt gemaakt
  // of niet (meer) aanwezig is, verdwijnt dus nooit stilzwijgend uit de lijst
  // (en de export). Een afwezige of onbekende gast valt weg volgens de vaste
  // gast-regel (teltMee in lib/aanwezigheid-telling.ts). Dit is uitsluitend een
  // zichtbaarheidsfilter: match_squad zelf blijft losstaand van attendance.
  const selectable = players.filter((p) =>
    selectedIds.has(p.id) || (p.active && teltMee(p.type, statusVan(p) === 'present')),
  )
  // Status per zichtbare speler; een ontbrekende rij wordt 'unknown'.
  const statusPerSpeler: Record<string, AttendanceStatus> = Object.fromEntries(
    selectable.map((p) => [p.id, statusVan(p)]),
  )
  const hasAnyActivePlayers = players.some((p) => p.active)
  const dateLabel = formatDateLong(event.date, t.browserLocale)

  const settingsMap: Record<string, string> = {}
  for (const row of settingsRows ?? []) settingsMap[row.key] = row.value
  const teamName = settingsMap['team_name']?.trim() || null
  const teamLogoUrl = settingsMap['team_logo_url'] || null
  // Clubkleuren worden hier serverzijdig geresolved (ingestelde waarde óf
  // fallback), zodat de printweergave altijd kant-en-klare hexstrings krijgt en
  // nooit zelf hoeft te beslissen wat "niet ingesteld" betekent.
  // Doorgeven aan MatchSquadEditor als primaryColor={clubColors.primary} /
  // secondaryColor={clubColors.secondary} doet de frontend-engineer, samen met
  // de propsdefinitie in dat component (frontend-scope).
  const clubColors = resolveClubColors(settingsMap)
  const formItems = toMatchFormItems(formRows ?? [])

  // Speelminuten van de laatste RECENTE_WEDSTRIJDEN eerdere, gespeelde
  // wedstrijden. "Eerder" = datum vóór dit event (een tweede wedstrijd op
  // dezelfde dag valt dus buiten de lijst), "gespeeld" = datum op of vóór
  // vandaag (servertijd, wedstrijdDatumBereikt-regel). Twee kale DATE-strings
  // vergelijken is tijdzone-onafhankelijk. De in()-lijst van de minutenquery
  // komt uitsluitend uit deze teamgefilterde events-query. Faalt een van beide,
  // dan null: de editor laat de minutenkolommen weg met een melding.
  let recenteMinuten: RecenteMinuten | null = null
  const { data: recenteRijen, error: recenteError } = await supabase
    .from('events')
    .select('id, date')
    .eq('team_id', ctx.teamId)
    .eq('type', 'match')
    .neq('id', id)
    .lt('date', event.date)
    .lte('date', todayLocal())
    .order('date', { ascending: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(RECENTE_WEDSTRIJDEN)
  if (recenteError) {
    logError('matchSquad.recenteMinuten', recenteError)
  } else {
    const wedstrijden: RecenteWedstrijd[] = (recenteRijen ?? [])
      .filter((w) => typeof w.id === 'string' && typeof w.date === 'string')
      .map((w) => ({ id: w.id, date: w.date }))
    const ids = wedstrijden.map((w) => w.id)
    const { data: minutenRijen, error: minutenError } = ids.length > 0
      ? await supabase
          .from('speelminuten')
          .select('event_id, player_id, minuten')
          .eq('team_id', ctx.teamId)
          .in('event_id', ids)
      : { data: [], error: null }
    if (minutenError) logError('matchSquad.recenteMinuten', minutenError)
    else recenteMinuten = bouwRecenteMinuten(wedstrijden, minutenRijen ?? [], selectable.map((p) => p.id))
  }

  // Wedstrijdstapper (stap 2 "selectie"). Een gefaalde statusquery geeft
  // 'onbekend', nooit een vals vinkje. De samenvatting telt actieve spelers.
  if (squadError) logError('matchSquad.stapper.selectie', squadError)
  if (attendanceError) logError('matchSquad.stapper.aanwezigheid', attendanceError)
  if (lineupError) logError('matchSquad.stapper.lineup', lineupError)
  if (ratingError) logError('matchSquad.stapper.ratings', ratingError)
  if (matchEventError) logError('matchSquad.stapper.events', matchEventError)
  const stapper = bouwStapperData({
    eventId: id,
    huidig: 'selectie',
    aanwezigheid: telBeschikbaarheid(players.filter((p) => p.active), statusVan),
    selectieRijen: squadError ? null : (squad?.length ?? 0),
    lineup: lineupError ? undefined : (lineup ?? null),
    uitslag: event,
    ratingCount: ratingError ? null : (ratingCheck?.length ?? 0),
    eventCount: matchEventError ? null : (matchEventCheck?.length ?? 0),
    eventDate: event.date,
    vandaag: todayLocal(),
  })

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <PageHeader backFallback={`/events/${id}`} title={t.matchSquad.title} subtitle={dateLabel} className="print:hidden" />

      <WedstrijdStapper data={stapper} t={t} />

      <MatchSquadEditor
        eventId={id}
        players={selectable}
        initialSelectedIds={[...selectedIds]}
        statusPerSpeler={statusPerSpeler}
        recenteMinuten={recenteMinuten}
        hasAnyActivePlayers={hasAnyActivePlayers}
        opponent={event.opponent}
        dateLabel={dateLabel}
        eventDate={event.date}
        teamName={teamName}
        teamLogoUrl={teamLogoUrl}
        homeAway={event.home_away}
        kickoffTime={event.time}
        location={event.location}
        initialGatherTime={event.gather_time}
        formItems={formItems}
        primaryColor={clubColors.primary}
        secondaryColor={clubColors.secondary}
        accentText={readableAccentOnWhite(clubColors.primary)}
        canEdit={canEdit(ctx, 'wedstrijd')}
      />

      <VolgendeStap data={stapper} t={t} />
    </div>
  )
}
