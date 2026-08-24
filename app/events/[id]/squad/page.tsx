import { notFound, redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import { formatDateLong, todayLocal } from '@/lib/utils'
import { toMatchFormItems } from '@/lib/match-form'
import { resolveClubColors, readableAccentOnWhite } from '@/lib/club-colors'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import { getDict } from '@/lib/i18n'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MatchSquadPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: squad }, { data: allPlayers }, { data: attendance }, { data: settingsRows }, { data: formRows }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('match_squad').select('player_id').eq('event_id', id).eq('team_id', user.id),
    supabase.from('players').select('*').eq('team_id', user.id).order('name'),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
    supabase.from('settings').select('key, value').eq('team_id', user.id)
      .in('key', ['team_name', 'team_logo_url', 'team_color_primary', 'team_color_secondary']),
    // Vorm van de laatste 5 afgeronde wedstrijden (dit event zelf uitgesloten,
    // ongeacht zijn eigen datum) — zelfde order-clausules als de
    // dashboardquery in app/page.tsx, zie het API-contract van de
    // backend-engineer voor toMatchFormItems().
    supabase.from('events')
      .select('id, date, opponent, goals_for, goals_against, home_away')
      .eq('team_id', user.id)
      .eq('type', 'match')
      .neq('id', id)
      .lt('date', todayLocal())
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(5),
  ])

  if (!event || event.type !== 'match') notFound()

  const selectedIds = new Set((squad ?? []).map((s) => s.player_id))
  const presentIds = new Set(
    (attendance ?? []).filter((a) => a.status === 'present').map((a) => a.player_id)
  )
  const players: Player[] = allPlayers ?? []
  // Unie van (actieve én aanwezige) spelers en al-geselecteerde spelers: een
  // speler die ná selectie inactief wordt gemaakt óf niet (meer) aanwezig is
  // verdwijnt niet stilzwijgend uit de lijst (en dus de export) — hij blijft
  // zichtbaar met het inactief- resp. niet-aanwezig-label. Dit is uitsluitend
  // een zichtbaarheidsfilter: match_squad zelf blijft losstaand van attendance.
  const selectable = players.filter((p) => selectedIds.has(p.id) || (p.active && presentIds.has(p.id)))
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

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div className="flex items-center gap-3 print:hidden">
        <BackButton fallback={`/events/${id}`}>
          <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
            <span className="ms text-[22px]">arrow_back</span>
          </span>
        </BackButton>
        <div>
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink">{t.matchSquad.title}</h1>
        </div>
      </div>

      <MatchSquadEditor
        eventId={id}
        players={selectable}
        initialSelectedIds={[...selectedIds]}
        presentPlayerIds={[...presentIds]}
        hasAnyActivePlayers={hasAnyActivePlayers}
        opponent={event.opponent}
        dateLabel={dateLabel}
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
      />
    </div>
  )
}
