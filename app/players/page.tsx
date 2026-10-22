import { createClient } from '@/lib/supabase/server'
import { canEdit, requireTeamContextOrLogin } from '@/lib/team-context'
import { getAllSettings } from '@/app/actions/settings'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import { formatDate, todayLocal } from '@/lib/utils'
import { resolveClubColors } from '@/lib/club-colors'
import {
  PERIODE_STANDAARD,
  isPeriode,
  periodeVenster,
  seizoensVenster,
  verledenSeizoensVenster,
  type Periode,
} from '@/lib/inzichten'
import {
  WEERGAVE_STANDAARD,
  bouwAanwezigheidsoverzicht,
  heeftOverzichtData,
  isWeergave,
  type OverzichtRpcRij,
} from '@/lib/aanwezigheidsoverzicht'
import { Player } from '@/lib/types'
import PlayerList from '@/components/PlayerList'
import WeergaveSchakelaar from '@/components/players/WeergaveSchakelaar'
import AanwezigheidsOverzicht, { type OverzichtStaat } from '@/components/players/AanwezigheidsOverzicht'
import AanwezigheidsOverzichtPrint from '@/components/players/AanwezigheidsOverzichtPrint'

export default async function PlayersPage({
  searchParams,
}: {
  // Optioneel én als Promise: Next levert dit als Promise aan, maar bestaande
  // tests roepen de page rechtstreeks aan zonder props (zelfde patroon als
  // app/inzichten/page.tsx).
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const params = searchParams ? await searchParams : {}
  // Onbekende waarden vallen terug op de standaard (lijst / hele seizoen).
  const weergave = isWeergave(params.weergave) ? params.weergave : WEERGAVE_STANDAARD
  const periode: Periode = isPeriode(params.periode) ? params.periode : PERIODE_STANDAARD
  const ctx = await requireTeamContextOrLogin()

  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('team_id', ctx.teamId)
    .order('jersey_number', { ascending: true, nullsFirst: false })
    .order('name')

  const allPlayers: Player[] = players ?? []
  const active = allPlayers.filter((p) => p.active)
  const inactive = allPlayers.filter((p) => !p.active)

  // Lijstweergave: ongewijzigd, geen settings-call en geen RPC.
  if (weergave === 'lijst') {
    return (
      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
        <PlayerList active={active} inactive={inactive} canEdit={canEdit(ctx, 'spelers')} schakelaar={<WeergaveSchakelaar actief="lijst" t={t} />} />
      </div>
    )
  }

  // ── Aanwezigheidsweergave ──
  const settings = await getAllSettings()
  const seizoen = seizoensVenster(settings)

  const container = 'print:hidden max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5'

  // Geen (geldig) seizoen: lege staat, geen RPC.
  if (!seizoen) {
    return (
      <div className={container}>
        <AanwezigheidsOverzicht staat={{ soort: 'geenSeizoen' }} t={t} schakelaar={<WeergaveSchakelaar actief="aanwezigheid" t={t} />} />
      </div>
    )
  }

  // Het getelde venster stopt bij gisteren (zelfde regel als /inzichten):
  // ingeplande, nog niet afgevinkte events tellen anders als "afwezig" mee.
  const today = todayLocal()
  const venster = periodeVenster(seizoen, periode)
  const verleden = verledenSeizoensVenster(venster, today)

  const { data: rpcData, error } = await supabase.rpc('aanwezigheidsoverzicht_per_speler', {
    p_team_id: ctx.teamId,
    p_start: verleden.start,
    p_end: verleden.end,
  })

  if (error) {
    logError('players.aanwezigheidsoverzicht', error)
    return (
      <div className={container}>
        <AanwezigheidsOverzicht staat={{ soort: 'fout', periode }} t={t} schakelaar={<WeergaveSchakelaar actief="aanwezigheid" t={t} />} />
      </div>
    )
  }

  const rijen = bouwAanwezigheidsoverzicht(allPlayers, (rpcData ?? []) as OverzichtRpcRij[], t.browserLocale)

  if (!heeftOverzichtData(rijen)) {
    const staat: OverzichtStaat = { soort: 'leeg', periode }
    return (
      <div className={container}>
        <AanwezigheidsOverzicht staat={staat} t={t} schakelaar={<WeergaveSchakelaar actief="aanwezigheid" t={t} />} />
      </div>
    )
  }

  const clubColors = resolveClubColors(settings)
  const periodeLabel =
    periode === '4w' ? t.insights.periode4w : periode === '8w' ? t.insights.periode8w : t.insights.periodeSeizoen

  return (
    <>
      {/* Dual-markup: het scherm drukt niet mee, het printblok eronder wel. */}
      <div className={container}>
        <AanwezigheidsOverzicht staat={{ soort: 'data', periode, rijen }} t={t} schakelaar={<WeergaveSchakelaar actief="aanwezigheid" t={t} />} />
      </div>
      <AanwezigheidsOverzichtPrint
        t={t}
        rijen={rijen}
        teamName={settings['team_name']?.trim() || null}
        teamLogoUrl={settings['team_logo_url'] || null}
        venster={verleden}
        periodeLabel={periodeLabel}
        generatedOn={formatDate(today, t.browserLocale)}
        primaryColor={clubColors.primary}
        secondaryColor={clubColors.secondary}
      />
    </>
  )
}
