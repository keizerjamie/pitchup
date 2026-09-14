'use server'

import { createClient } from '@/lib/supabase/server'
import { assertOwnPlayer, isUuid } from '@/lib/authz'
import { genericError } from '@/lib/errors'
import {
  seizoensVenster,
  periodeVenster,
  isPeriode,
  PERIODE_STANDAARD,
  verledenSeizoensVenster,
  berekenAanwezigheidPercentage,
  telMatchEvents,
  MAX_SEIZOEN_WEDSTRIJDEN,
  MAX_SPELER_MATCH_EVENTS,
} from '@/lib/inzichten'
import { getAllSettings } from '@/app/actions/settings'
import type {
  AanwezigheidPerSpelerRij,
  SpelerRatingPunt,
  SpelerStatistieken,
} from '@/lib/inzichten'

// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md).
// SpelerRatingPunt en de rest van de types staan daarom in lib/inzichten.ts en
// worden daar rechtstreeks geïmporteerd.

// De ratingreeks van één speler over het ingestelde seizoen, oplopend op datum.
//
// Een lege lijst is een geldige, verwachte uitkomst: geen seizoen ingesteld,
// geen wedstrijden in het venster, nog geen ratings, of een inactieve speler
// (die filtert de RPC weg, net als de teamgrafiek — zie O3 in
// supabase/inzichten.sql).
export async function getSpelerRatingReeks(playerId: string, periode?: string): Promise<SpelerRatingPunt[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Vormcheck vóór elke databasetoegang: een player_id is altijd een UUID.
  // Bewust dezelfde melding als assertOwnPlayer hieronder (lib/authz.ts:20-23),
  // zodat "bestaat niet", "van een ander team" en "geen geldig id" van buitenaf
  // niet uit elkaar te houden zijn.
  if (!isUuid(playerId)) throw new Error('Speler niet gevonden')
  await assertOwnPlayer(supabase, playerId, user.id)

  // Het seizoensvenster komt server-side opnieuw uit settings — nooit van de
  // client aannemen, anders kan een aanroeper zijn eigen datumbereik opgeven.
  // Zelfde hergebruik van getAllSettings() als deleteSeasonTrainings
  // (app/actions/settings.ts:79-81).
  const settings = await getAllSettings()
  const seizoen = seizoensVenster(settings)
  if (!seizoen) return []

  // De periode komt wél van de client, maar uitsluitend als TOKEN ('4w'/'8w'/
  // 'seizoen') — nooit als datumbereik. isPeriode() weigert alles wat daar
  // niet exact op past en valt terug op het hele seizoen, en periodeVenster()
  // rekent de datums hier server-side uit binnen het eigen seizoensvenster.
  // Een aanroeper kan daarmee nog steeds geen zelfgekozen bereik afdwingen.
  const venster = periodeVenster(seizoen, isPeriode(periode) ? periode : PERIODE_STANDAARD)

  // De RPC is security invoker en filtert zelf op team_id = auth.uid() bovenop
  // RLS; er gaat daarom bewust géén team_id-parameter mee.
  const { data, error } = await supabase.rpc('inzichten_rating_speler', {
    p_player: playerId,
    p_start: venster.start,
    p_end: venster.end,
  })
  if (error) throw genericError('inzichten.getSpelerRatingReeks', error)

  // De Supabase-client is ongetypeerd (lib/supabase/server.ts:7), vandaar de
  // expliciete annotatie op het RPC-resultaat.
  return (data ?? []) as SpelerRatingPunt[]
}

// Alle cijfers voor de Statistieken-tab van één speler (/players/[id]).
//
// null = er is geen (geldig) seizoensvenster ingesteld. Dat is de ENIGE reden
// waarop null terugkomt; de UI toont dan de lege staat met een link naar
// /settings. Een speler zonder data levert gewoon nullen en lege lijsten op.
//
// Guard-keten identiek aan getSpelerRatingReeks hierboven: 'Niet ingelogd' →
// vormcheck op het id → assertOwnPlayer. Het venster komt server-side uit
// settings, nooit van de client, en er is bewust geen periode-parameter.
export async function getSpelerStatistieken(playerId: string): Promise<SpelerStatistieken | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  if (!isUuid(playerId)) throw new Error('Speler niet gevonden')
  await assertOwnPlayer(supabase, playerId, user.id)

  const settings = await getAllSettings()
  const seizoen = seizoensVenster(settings)
  if (!seizoen) return null

  // Twee vensters, en dat verschil is niet cosmetisch:
  // - aanwezigheid gebruikt het op gisteren geklemde venster, want markInjured
  //   schrijft 'absent' weg op TOEKOMSTIGE events (app/actions/players.ts,
  //   markInjured). Zonder klemmen stort het percentage van elke geblesseerde
  //   speler in door wedstrijden die nog niet gespeeld zijn.
  // - ratings en kaarten gebruiken het volle seizoen: die bestaan per definitie
  //   pas ná de wedstrijd. Zelfde redenering als app/inzichten/page.tsx.
  const verleden = verledenSeizoensVenster(seizoen)

  // allSettled in plaats van all: bij twee tegelijk falende takken zou de
  // tweede rejection bij Promise.all onafgehandeld blijven. De eerste fout in
  // vaste volgorde wint; genericError heeft dan al gelogd.
  const [aanwezigheidResultaat, ratingResultaat, tellingenResultaat] = await Promise.allSettled([
    (async () => {
      // De RPC is security invoker en filtert zelf op team_id = auth.uid()
      // bovenop RLS; p_player is daarbovenop een extra beperking binnen de al
      // afgeschermde set. Daarom gaat er bewust geen team_id-parameter mee.
      const { data, error } = await supabase.rpc('inzichten_aanwezigheid_per_speler', {
        p_start: verleden.start,
        p_end: verleden.end,
        p_player: playerId,
      })
      if (error) throw genericError('inzichten.getSpelerStatistieken.aanwezigheid', error)

      // Nul rijen = geen enkele registratie in het venster. Dat is 0/0 en dus
      // percentage null, nooit 0%.
      const rij = ((data ?? []) as AanwezigheidPerSpelerRij[])[0]
      const aanwezig = rij?.aanwezig ?? 0
      const afwezig = rij?.afwezig ?? 0
      return {
        aanwezig,
        afwezig,
        percentage: berekenAanwezigheidPercentage(aanwezig, afwezig),
      }
    })(),

    // Bestaande action, hergebruikt. Die doet bewust zijn eigen volledige
    // guard-keten (hij wordt ook rechtstreeks vanuit de client aangeroepen) en
    // mag nooit op een aanroeper vertrouwen.
    getSpelerRatingReeks(playerId),

    (async () => {
      // Twee queries in plaats van een embedded join: match_events heeft geen
      // eigen datum, de datum hoort bij events. Zelfde patroon als app/page.tsx
      // (.in('event_id', ...)).
      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('id')
        .eq('team_id', user.id)
        .eq('type', 'match')
        .gte('date', seizoen.start)
        .lte('date', seizoen.end)
        .limit(MAX_SEIZOEN_WEDSTRIJDEN)
      if (eventsError) throw genericError('inzichten.getSpelerStatistieken.events', eventsError)

      const eventIds = ((events ?? []) as { id: string }[]).map((rij) => rij.id)
      // Geen wedstrijden in het venster: vier nullen, en geen tweede query.
      if (eventIds.length === 0) return telMatchEvents([])

      const { data: rows, error } = await supabase
        .from('match_events')
        .select('kind')
        .eq('team_id', user.id)
        .eq('player_id', playerId)
        .in('event_id', eventIds)
        .limit(MAX_SPELER_MATCH_EVENTS)
      if (error) throw genericError('inzichten.getSpelerStatistieken.matchEvents', error)

      return telMatchEvents((rows ?? []) as { kind: string }[])
    })(),
  ])

  if (aanwezigheidResultaat.status === 'rejected') throw aanwezigheidResultaat.reason
  if (ratingResultaat.status === 'rejected') throw ratingResultaat.reason
  if (tellingenResultaat.status === 'rejected') throw tellingenResultaat.reason

  const aanwezigheid = aanwezigheidResultaat.value
  const ratingReeks = ratingResultaat.value

  // Geen beoordeelde wedstrijden = geen gemiddelde. Bewust null en niet 0:
  // een 0 zou "slecht beoordeeld" suggereren in plaats van "nog niets".
  const gemiddeldeRating = ratingReeks.length > 0
    ? ratingReeks.reduce((som, punt) => som + punt.rating, 0) / ratingReeks.length
    : null

  return {
    aanwezig: aanwezigheid.aanwezig,
    afwezig: aanwezigheid.afwezig,
    aanwezigheidPercentage: aanwezigheid.percentage,
    ratingReeks,
    gemiddeldeRating,
    tellingen: tellingenResultaat.value,
  }
}
