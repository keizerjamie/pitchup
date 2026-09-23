'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/authz'
import { ACTIVE_TEAM_COOKIE, requireTeamContext } from '@/lib/team-context'

// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md).
// TeamContext/TeamLidmaatschap komen uit lib/team-context.ts, de rollen en
// rechten uit lib/team-rechten.ts.
//
// createTeam/deleteTeam horen bij fase 2/3 van deze feature en staan hier
// bewust nog niet: in fase 1 verandert er niets zichtbaars voor de gebruiker.

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
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, { path: '/', maxAge: 60 * 60 * 24 * 365 })

  // De redirect is niet cosmetisch: getTeamContext is cache()-gewrapt, dus
  // binnen dezelfde request zou de oude waarde blijven hangen. Bewust naar '/'
  // en niet terug naar de referer zoals setLocale doet — een event- of
  // speler-id in het huidige pad hoort bij het oude team en bestaat in het
  // nieuwe team niet.
  revalidatePath('/', 'layout')
  redirect('/')
}
