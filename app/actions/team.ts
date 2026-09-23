'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/authz'
import { createClient } from '@/lib/supabase/server'
import { genericError } from '@/lib/errors'
import { ACTIVE_TEAM_COOKIE, requireTeamContext } from '@/lib/team-context'

// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md).
// TeamContext/TeamLidmaatschap komen uit lib/team-context.ts, de rollen en
// rechten uit lib/team-rechten.ts.
//
// deleteTeam/getTeamDeleteInfo/leaveTeam horen bij fase 3 en staan hier bewust
// nog niet.

// Dezelfde grens als in app/actions/auth.ts (signUp) en in de RPC create_team
// zelf. Drie plekken, bewust: de UI geeft een nette melding, de action is de
// poort, en de database is het laatste vangnet.
const MAX_TEAM_NAAM = 80

// Zelfde maxAge als bij de locale-cookie: een jaar. Er staat geen `httpOnly`
// op — dit is een voorkeur, geen autorisatie (getTeamContext toetst het id bij
// élke request aan de lidmaatschappen uit de database).
const COOKIE_OPTIES = { path: '/', maxAge: 60 * 60 * 24 * 365 } as const

// Zet het actieve team voor deze browser. De cookie is alleen een KEUZE tussen
// de eigen lidmaatschappen, nooit een autorisatiebron: hij wordt hier getoetst
// aan de lidmaatschappen uit de database (requireTeamContext) en in
// getTeamContext bij élke request opnieuw.
export async function setActiveTeam(teamId: string) {
  const ctx = await requireTeamContext()

  // Vormcheck vóór de vergelijking, zelfde aanpak als assertKnownPlayerId in
  // lib/authz.ts: dit begrenst meteen de lengte van wat er in de cookie belandt.
  if (!isUuid(teamId)) throw new Error('Team niet gevonden')
  if (!ctx.teams.some((team) => team.teamId === teamId)) throw new Error('Team niet gevonden')

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, COOKIE_OPTIES)

  // De redirect is niet cosmetisch: getTeamContext is cache()-gewrapt, dus
  // binnen dezelfde request zou de oude waarde blijven hangen. Bewust naar '/'
  // en niet terug naar de referer zoals setLocale doet — een event- of
  // speler-id in het huidige pad hoort bij het oude team en bestaat in het
  // nieuwe team niet.
  revalidatePath('/', 'layout')
  redirect('/')
}

// Maakt een nieuw, leeg team met de aanroeper als hoofdtrainer (BR 46) en
// schakelt er meteen naartoe. Er is bewust geen limiet op het aantal teams
// (BR 37).
//
// De drie schrijfacties (teams, de owner-rij, de teamnaam) gebeuren in ÉÉN
// transactie in de RPC create_team (supabase/team-aanmaken-rpc.sql). Dat is
// geen netheid: zouden ze los gebeuren en faalt de tweede, dan bestaat er een
// team zonder hoofdtrainer en is de maker permanent buitengesloten van zijn
// eigen data, zonder dat iets dat detecteert.
//
// Eindigt altijd in een redirect, net als setActiveTeam — zonder die redirect
// leest dezelfde request de oude, cache()-de teamcontext en blijft de
// gebruiker in zijn vorige team hangen.
export async function createTeam(naam: string) {
  // Ingelogd zijn is genoeg; een team aanmaken vereist geen bestaand
  // lidmaatschap. Daarom getTeamContext-achtige afhandeling via de supabase-
  // sessie en niet requireTeamContext(): iemand in de lege staat (nul teams)
  // moet dit juist kunnen (AC 16/52).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const schoon = (naam ?? '').trim().slice(0, MAX_TEAM_NAAM)
  if (!schoon) throw new Error('Vul een teamnaam in')

  const { data, error } = await supabase.rpc('create_team', {
    p_naam: schoon,
    p_alleen_zonder_team: false,
  })
  if (error) throw genericError('team.createTeam', error)
  if (typeof data !== 'string' || !data) {
    throw genericError('team.createTeam', { code: 'geen_team_id' })
  }

  // De cookie mag hier zonder lidmaatschapscheck: het team-id komt niet van de
  // client maar rechtstreeks uit de RPC, die de aanroeper net als owner heeft
  // ingeschreven.
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TEAM_COOKIE, data, COOKIE_OPTIES)

  revalidatePath('/', 'layout')
  redirect('/')
}
