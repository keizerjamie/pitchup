import { notFound, redirect } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { Player } from '@/lib/types'
import LineupBuilder from '@/components/LineupBuilder'
import { getDict } from '@/lib/i18n'
import { logError } from '@/lib/errors'
import { isDateString } from '@/lib/season-dates'
import { buildPlayerForms, FORM_MATCH_HORIZON } from '@/lib/lineup-form'
import { CLUB_COLOR_KEYS, resolveKitColors } from '@/lib/club-colors'
import type { FormMatchRow, FormRatingRow } from '@/lib/lineup-form'

interface Props {
  params: Promise<{ id: string }>
}

export default async function LineupPage({ params }: Props) {
  const { id } = await params
  const [supabase, t] = await Promise.all([createClient(), getDict()])
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: attendance }, { data: lineup }, { data: squad }, { data: settingsRows }] = await Promise.all([
    supabase.from('events').select('*').eq('id', id).eq('team_id', user.id).single(),
    supabase.from('attendance').select('player_id, status').eq('event_id', id).eq('team_id', user.id),
    supabase.from('lineups').select('*').eq('event_id', id).eq('team_id', user.id).maybeSingle(),
    // De wedstrijdselectie: de aanwezigheid van een rij ís de selectie
    // (app/actions/match-squad.ts). Nul rijen = nog niet gekozen.
    supabase.from('match_squad').select('player_id').eq('event_id', id).eq('team_id', user.id),
    // Alleen de twee kleursleutels — nooit een open select op settings, waar
    // ook team_logo_url en season_start in leven.
    supabase.from('settings').select('key, value').eq('team_id', user.id)
      .in('key', [CLUB_COLOR_KEYS.primary, CLUB_COLOR_KEYS.secondary]),
  ])

  if (!event || event.type !== 'match') notFound()

  const presentPlayerIds = new Set(
    (attendance ?? []).filter((a) => a.status === 'present').map((a) => a.player_id)
  )

  // Wie mag er voor deze wedstrijd op de bank en in de spelerspopup staan?
  // Is de wedstrijdselectie bepaald, dan uitsluitend die spelers; zolang dat
  // niet zo is, de aanwezige spelers. Beide sets zijn al team-gescoped
  // opgehaald, dus dit filter voegt geen nieuw isolatie-oppervlak toe — het is
  // puur zichtbaarheid, net als `selectable` op de squad-pagina.
  const squadPlayerIds = new Set((squad ?? []).map((s) => s.player_id))
  const eligiblePlayerIds = squadPlayerIds.size > 0 ? squadPlayerIds : presentPlayerIds

  // Clubkleuren serverzijdig geresolved tot een kant-en-klaar tenue (of null =
  // nog geen clubkleur gekozen, dan blijven de poppetjes wit). Bewust
  // resolveKitColors en NIET resolveClubColors: die laatste vult een
  // niet-ingestelde kleur met de fallback, waardoor elk team zonder
  // clubkleuren donkergroene poppetjes zou krijgen.
  const settingsMap: Record<string, string> = {}
  for (const row of settingsRows ?? []) settingsMap[row.key] = row.value
  const kit = resolveKitColors(settingsMap)

  // Signalering, GEEN gedragswijziging: `events.date` is DATE NOT NULL
  // (supabase/schema.sql), dus een niet-parseerbare peildatum hoort niet te
  // bestaan. Gebeurt het toch, dan spant buildPlayerForms geen venster op (de
  // `geldigeCutoff`-tak in lib/lineup-form.ts) en valt iedereen terug op X = 0
  // — correct, maar anders volstrekt spoorloos. Daarom hier één keer een
  // logregel met dezelfde helper en hetzelfde label als de faaltakken
  // hieronder. Bewust een statische code en NOOIT de waarde zelf: logError
  // logt alleen een veilige code (errorCode/SAFE_CODE_RE in lib/errors.ts),
  // precedent requestPasswordReset in app/actions/auth.ts. Dezelfde helper als
  // de module gebruikt (isDateString in lib/season-dates.ts), zodat er maar
  // één definitie van "geldige datum" is.
  //
  // Verwijzingen naar een benoemd symbool (functie/constante) staan hier
  // bewust ZONDER regelnummer: een naam schuift niet op als er elders in het
  // doelbestand een regel bijkomt, en is met grep in één keer te vinden. Deze
  // verwijzing wees eerder wél op regels en verouderde meteen toen er tien
  // regels commentaar boven de functie kwamen.
  if (!isDateString(event.date)) logError('lineup-form', { code: 'invalid_event_date' })

  // Ronde 2 — parallel: de spelers én het vormvenster. Pas hier is `event.date`
  // gegarandeerd bekend (de guard hierboven is de poort).
  const [{ data: allPlayers }, { data: formMatchRows, error: formMatchError }] = await Promise.all([
    // Bewust GEEN filter op players.type: gastspelers doen bij het opstellen
    // mee. Dat is een keuze, geen vergissing — de inzichten-RPC's sluiten
    // gasten juist wél uit (supabase/inzichten.sql:15-19), omdat die de
    // teamcijfers berekenen.
    supabase
      .from('players')
      .select('*')
      .eq('team_id', user.id)
      .eq('active', true)
      .order('jersey_number', { ascending: true, nullsFirst: false })
      .order('name'),
    // Vormvenster: de laatste wedstrijden vóór dit event. Bewust GEEN filter op
    // match_type — friendly/league/cup tellen allemaal mee, net als in de
    // vorm-strook op het dashboard (app/page.tsx:60-68), waarvan ook de
    // tie-break (date → created_at → id, alles desc) letterlijk is overgenomen.
    // Cutoff is `event.date`, niet de klok: twee kale DATE-waarden uit dezelfde
    // database vergelijken als 'YYYY-MM-DD'-string is tijdzone-onafhankelijk.
    supabase
      .from('events')
      .select('id, date, created_at')
      .eq('team_id', user.id)
      .eq('type', 'match')
      .lt('date', event.date)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(FORM_MATCH_HORIZON),
  ])

  const players: Player[] = allPlayers ?? []

  // Faaltak: nooit de ruwe PostgREST-fout loggen of tonen (lib/errors.ts:27-30).
  // Bij een fout gaan we verder met een lege rijenset; elke speler valt dan
  // terug op X = 0 — precies het gedrag van vóór deze feature.
  if (formMatchError) logError('lineup-form', formMatchError)
  const formMatches: FormMatchRow[] = formMatchError ? [] : (formMatchRows ?? [])
  const formMatchIds = formMatches.map((m) => m.id)

  // Ronde 3 — beoordelingen, afhankelijk van ronde 2. Nooit een open select op
  // match_ratings: de in()-lijst is per constructie hooguit FORM_MATCH_HORIZON
  // team-eigen event-ids vóór de peildatum. Zonder eerdere wedstrijden slaan we
  // de rondtrip helemaal over (zelfde vorm als app/page.tsx:90-92).
  const { data: formRatingRows, error: formRatingError } = formMatchIds.length > 0
    ? await supabase
        .from('match_ratings')
        .select('event_id, player_id, rating')
        .eq('team_id', user.id)
        .in('event_id', formMatchIds)
    : { data: [] as FormRatingRow[], error: null }

  if (formRatingError) logError('lineup-form', formRatingError)
  const formRatings: FormRatingRow[] = formRatingError ? [] : (formRatingRows ?? [])

  // Elke actieve speler krijgt een entry; wie geen beoordeelde wedstrijd heeft,
  // krijgt zijn kale rating-anker (emptyPlayerForm).
  const playerForm = buildPlayerForms({
    players: players.map((p) => ({ id: p.id, rating: p.rating })),
    matches: formMatches,
    ratings: formRatings,
    before: event.date,
  })

  // Inzetbare spelers eerst — dat is de volgorde waarin de bank en de
  // spelerspopup ze tonen. `players` blijft de VOLLEDIGE lijst: hij dient ook
  // als namenregister voor een al opgestelde speler die buiten de selectie
  // valt (getPlayerName in LineupBuilder).
  const sortedPlayers = [
    ...players.filter((p) => eligiblePlayerIds.has(p.id)),
    ...players.filter((p) => !eligiblePlayerIds.has(p.id)),
  ]

  const presentPlayers = players.filter((p) => presentPlayerIds.has(p.id))
  const absentPlayers = players.filter((p) => !presentPlayerIds.has(p.id))

  const overviewGroups = [
    { label: 'GK',   positions: ['Keeper'] },
    { label: 'Verd', positions: ['Linksachter', 'Centrale verdediger', 'Rechtsachter'] },
    { label: 'Mid',  positions: ['Defensieve middenvelder', 'Centrale middenvelder', 'Linksmiddenvelder', 'Rechtsmiddenvelder', 'Aanvallende middenvelder'] },
    { label: 'Aanv', positions: ['Linksbuiten', 'Rechtsbuiten', 'Spits'] },
  ]

  return (
    <div className="max-w-2xl lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/events/${id}`}>
          <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-muted hover:text-ink transition-colors" style={{ border: '1px solid var(--border-soft)' }}>
            <span className="ms text-[22px]">arrow_back</span>
          </span>
        </BackButton>
        <div>
          <h1 className="font-display text-[22px] lg:text-[26px] font-bold text-ink">{t.lineup.title}</h1>
          <p className="text-[13px] font-semibold text-faint">
            {t.lineup.vsLabel} {event.opponent} · {presentPlayers.length} {t.lineup.presentCount}
          </p>
        </div>
      </div>

      {/* Desktop: builder left, player overview right */}
      <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-10 lg:items-start flex flex-col gap-5">

        {/* Player overview */}
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 order-2 lg:sticky lg:top-8">
          {overviewGroups.map((group) => {
            const gp = presentPlayers.filter((p) => group.positions.includes(p.position))
            return (
              <div key={group.label} className="surface-card p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-brand-accent mb-1.5">{group.label}</p>
                <div className="flex flex-col gap-1">
                  {gp.map((p) => (
                    <div key={p.id} className="flex items-baseline gap-1.5 min-w-0">
                      {p.jersey_number != null && <span className="text-[10px] font-bold text-faint flex-shrink-0">{p.jersey_number}</span>}
                      <span className="text-xs font-semibold text-ink truncate">{p.name.split(' ')[0]}</span>
                    </div>
                  ))}
                  {gp.length === 0 && <span className="text-[10px] text-faint">—</span>}
                </div>
              </div>
            )
          })}
          <div className="surface-card p-3">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-faint mb-1.5">{t.event.absentStat}</p>
            <div className="flex flex-col gap-1">
              {absentPlayers.map((p) => (
                <div key={p.id} className="flex items-baseline gap-1.5 min-w-0">
                  {p.jersey_number != null && <span className="text-[10px] font-bold text-faint flex-shrink-0">{p.jersey_number}</span>}
                  <span className="text-xs text-muted truncate">{p.name.split(' ')[0]}</span>
                </div>
              ))}
              {absentPlayers.length === 0 && <span className="text-[10px] text-faint">—</span>}
            </div>
          </div>
        </div>

        <div className="order-1">
          <LineupBuilder
            eventId={id}
            players={sortedPlayers}
            eligiblePlayerIds={[...eligiblePlayerIds]}
            kit={kit}
            playerForm={playerForm}
            initialFormation={lineup?.formation}
            initialPositions={lineup?.positions}
          />
        </div>

      </div>
    </div>
  )
}
