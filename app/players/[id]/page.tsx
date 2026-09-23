import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { getDict } from '@/lib/i18n'
import { todayLocal } from '@/lib/utils'
import { isUuid } from '@/lib/authz'
import { AttendanceStatus } from '@/lib/types'
import { getDefaultAttendance } from '@/app/actions/settings'
import { getSpelerStatistieken } from '@/app/actions/inzichten'
import { isProfielTab, PROFIEL_TAB_STANDAARD } from '@/lib/player-profile'
import PlayerProfile from '@/components/players/PlayerProfile'

interface Props {
  params: Promise<{ id: string }>
  // Optioneel én met default, zodat een acceptatietest de pagina rechtstreeks
  // kan aanroepen — zelfde reden en zelfde vorm als app/inzichten/page.tsx.
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function PlayerProfilePage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = searchParams ? await searchParams : {}
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const ctx = await requireTeamContextOrLogin()

  // Vóór elke DB-aanroep: een ongeldig id mag nooit als Postgres-cast-fout/500
  // eindigen (AC26).
  if (!isUuid(id)) notFound()

  const today = todayLocal()

  // Volgorde-eis uit het API-contract (backend.md): getSpelerStatistieken
  // gooit 'Speler niet gevonden' voor een vreemd (van een ander team) id,
  // terwijl de speler-query voor datzelfde geval gewoon `null` teruggeeft. Zou
  // getSpelerStatistieken in dezelfde Promise.all zitten als de speler-query,
  // dan verwordt "vreemd id" tot een onafgevangen 500 in plaats van
  // notFound(). Daarom eerst de vijf niet-gooiende takken (speler-query zelf
  // gooit nooit), dán pas de statistiekenloader — precies de mitigatie die
  // brief §4.1 en backend.md voorschrijven.
  const [{ data: player }, { data: events }, { data: attendance }, { data: periods }, defaultStatus] = await Promise.all([
    supabase.from('players').select('*').eq('id', id).eq('team_id', ctx.teamId).single(),
    supabase.from('events').select('*').eq('team_id', ctx.teamId).neq('type', 'meting').gte('date', today).order('date', { ascending: true }).limit(60),
    supabase.from('attendance').select('event_id, status').eq('player_id', id).eq('team_id', ctx.teamId),
    supabase.from('absence_periods').select('id, player_id, from_date, to_date').eq('player_id', id).eq('team_id', ctx.teamId).order('from_date', { ascending: true }).limit(60),
    getDefaultAttendance(),
  ])

  // .single() geeft null bij 0 rijen — een speler van een ander team is dus
  // niet te onderscheiden van "bestaat niet" (AC23).
  if (!player) notFound()

  // Nu player bewezen van dit team is, kan getSpelerStatistieken nooit meer op
  // 'Speler niet gevonden' stuiten (assertOwnPlayer slaagt) — een eventuele
  // fout hierna is 'Niet ingelogd' (theoretisch, user is hierboven al
  // gecontroleerd) of een echte DB-/RPC-fout (genericError, bv. PGRST202 als
  // de migratie nog niet gedraaid heeft — brief §1 r.83/§6 risico 1).
  //
  // Bewust NIET ongevangen laten: zonder try/catch gooit deze pagina de
  // action-fout door naar Next's onbeheerde foutpagina (er is geen
  // app/error.tsx) en kantelt het HELE profiel om, terwijl Info en
  // Aanwezigheid niets met deze fout te maken hebben. `statsError` geeft een
  // aparte, van "geen seizoen" te onderscheiden toestand door — `stats` blijft
  // `null` ook betekenen "geen seizoen ingesteld" (ongewijzigd contract).
  let stats: Awaited<ReturnType<typeof getSpelerStatistieken>> = null
  let statsError = false
  try {
    stats = await getSpelerStatistieken(id)
  } catch {
    statsError = true
  }

  const attendanceMap = new Map<string, AttendanceStatus>()
  for (const a of attendance ?? []) {
    attendanceMap.set(a.event_id, a.status as AttendanceStatus)
  }

  const eventsWithStatus = (events ?? []).map((e) => ({
    ...e,
    status: attendanceMap.get(e.id) ?? 'unknown' as AttendanceStatus,
  }))

  const initialTab = isProfielTab(sp.tab) ? sp.tab : PROFIEL_TAB_STANDAARD

  return (
    <PlayerProfile
      player={player}
      initialTab={initialTab}
      events={eventsWithStatus}
      periods={periods ?? []}
      defaultStatus={defaultStatus}
      stats={stats}
      statsError={statsError}
      t={t}
      canEditSpelers={canEdit(ctx, 'spelers')}
      canEditAanwezigheid={canEdit(ctx, 'aanwezigheid')}
    />
  )
}
