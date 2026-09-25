'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isUuid } from '@/lib/authz'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { genericError } from '@/lib/errors'
import {
  ACTIVE_TEAM_COOKIE,
  assertIsOwner,
  requireTeamContext,
  wisTeamNaamVlag,
  type TeamContext,
} from '@/lib/team-context'
import { actiefTeamNaVerlies, ruimTeamOp } from '@/lib/team-opruimen'

// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md).
// TeamContext/TeamLidmaatschap komen uit lib/team-context.ts, de rollen en
// rechten uit lib/team-rechten.ts.
//
// ELKE EXPORT HIERUIT IS EEN PUBLIEK ENDPOINT. Gedeelde logica die zelf geen
// autorisatie doet (de opruiming van één team) staat daarom in
// lib/team-opruimen.ts en niet als tweede export hier.

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

// ────────────────────────────────────────────────
// Fase 3 — een team verwijderen of verlaten
// ────────────────────────────────────────────────

// Wat het bevestigingsscherm van "Team verwijderen" moet tonen (AC 14, BR 49):
// de teamnaam en het aantal assistenten dat toegang verliest.
//
// Alleen voor de hoofdtrainer van DAT team — ook een id van een team waar de
// aanroeper alleen assistent is, of helemaal geen lid, geeft 'Geen toegang'
// (zelfde melding voor beide, zodat hij niet verraadt welk van de twee het
// is). De naam komt uit de teamcontext (settings.team_name) en is '' als het
// team geen naam heeft — nooit null.
export async function getTeamDeleteInfo(
  teamId: string,
): Promise<{ naam: string; aantalAssistenten: number }> {
  const ctx = await requireTeamContext()
  // VORMCHECK VÓÓR assertIsOwner, en die is niet optioneel: assertIsOwner valt
  // bij een ontbrekend teamId terug op het ACTIEVE team. Een action-argument
  // komt van de client; zonder deze regel zou getTeamDeleteInfo(undefined) de
  // gegevens van het actieve team teruggeven. Zelfde melding als een niet-owner.
  if (!isUuid(teamId)) throw new Error('Geen toegang')
  assertIsOwner(ctx, teamId)
  // assertIsOwner garandeert dat dit lidmaatschap bestaat.
  const lidmaatschap = ctx.teams.find((team) => team.teamId === teamId)!

  // RLS: "team_members: eigen rij of eigen team" laat een hoofdtrainer alle
  // rijen van zijn eigen team zien. Het team_id-filter is de tweede laag.
  // Bewust een gewone select en geen count-head: de lijst is per definitie
  // klein en zo blijft het één vorm voor elke testmock.
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)
    .eq('rol', 'assistent')
  if (error) throw genericError('team.getTeamDeleteInfo', error)

  return {
    naam: lidmaatschap.naam,
    aantalAssistenten: Array.isArray(data) ? data.length : 0,
  }
}

// Verwijdert één team van de aanroeper, los van zijn account (AC 14, 31, 49).
//
// Volgorde, en elke stap doet ertoe:
//   1. assertIsOwner(ctx, teamId) — een assistent of een niet-lid krijgt
//      'Geen toegang' en er wordt NIETS geraakt (AC 31). De teamcontext komt
//      uit de database, dus een vervalst id kan nooit meer dan wat de
//      aanroeper al is.
//   2. ruimTeamOp — logo, de dertien teamtabellen, de teams-rij (cascade op
//      team_members en team_invites). Exact dezelfde code als deleteAccount
//      (BR 49). OEFENINGEN NOOIT: die zijn persoonlijk bezit (BR 54); alleen
//      hun koppelingen aan dit team verdwijnen. De assistenten verliezen hun
//      lidmaatschap, hun accounts blijven bestaan.
//   3. Het actieve team opnieuw bepalen (AC 17/53) en de cookie daarop zetten,
//      of wissen als er geen team meer over is (lege staat, AC 16).
//   4. revalidate + redirect('/'). De redirect is niet cosmetisch: de
//      teamcontext is cache()-gewrapt en zou binnen deze request het net
//      verwijderde team nog tonen.
//
// Faalt stap 2 halverwege, dan gooit de action met een generieke melding en
// blijft de cookie ongemoeid; per stap staat er een log met contextlabel
// `team.deleteTeam.<tabel>` (nooit het team-id). Opnieuw proberen is veilig:
// elke stap is idempotent.
export async function deleteTeam(teamId: string) {
  const ctx = await requireTeamContext()
  // VORMCHECK VÓÓR assertIsOwner, en die is niet optioneel: assertIsOwner valt
  // bij een ontbrekend teamId terug op het ACTIEVE team. Een action-argument
  // komt van de client; zonder deze regel zou deleteTeam(undefined) het
  // actieve team als doel goedkeuren. Zelfde melding als een niet-owner.
  if (!isUuid(teamId)) throw new Error('Geen toegang')
  assertIsOwner(ctx, teamId)

  const supabase = await createClient()
  await ruimTeamOp(supabase, teamId, 'team.deleteTeam')

  await naVerliesVanTeam(supabase, ctx, teamId)
}

// Zegt het eigen assistent-lidmaatschap van een team op ("eigen vertrek",
// AC 21). Beslissing 8 van de eigenaar: de policy staat dit toe, maar er komt
// in deze scope GEEN UI voor. De action bestaat zodat het contract uit brief
// §3.3 compleet is en voegt niets toe wat een directe PostgREST-aanroep niet
// al kon: de DELETE-policy "team_members: owner of vertrek" laat precies deze
// eigen assistent-rij toe.
//
// Een hoofdtrainer kan zijn eigen team niet verlaten — er is geen overdracht
// van het hoofdtrainerschap (out of scope), en een team zonder owner is
// onbereikbaar. Daarvoor is deleteTeam. De policy weigert het ook (rol =
// 'assistent' in de using-clausule); dit is de eerste laag.
//
// Teamdata blijft volledig intact, net als de eigen oefeningen en hun
// koppelingen in dit team (AC 21, BR 57).
export async function leaveTeam(teamId: string) {
  const ctx = await requireTeamContext()
  // Zelfde meldingen en vormcheck als setActiveTeam: verraadt niet of het
  // team bestaat.
  if (!isUuid(teamId)) throw new Error('Team niet gevonden')
  const lidmaatschap = ctx.teams.find((team) => team.teamId === teamId)
  if (!lidmaatschap) throw new Error('Team niet gevonden')
  if (lidmaatschap.rol === 'owner') throw new Error('Geen toegang')

  const supabase = await createClient()
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', ctx.userId)
  if (error) throw genericError('team.leaveTeam', error)

  await naVerliesVanTeam(supabase, ctx, teamId)
}

// Gemeenschappelijke staart van deleteTeam en leaveTeam: het actieve team
// opnieuw bepalen, de cookie bijwerken en de pagina verversen.
//
// NIET geëxporteerd, en dat is bewust: elke export uit dit bestand is een
// publiek endpoint.
async function naVerliesVanTeam(
  supabase: SupabaseClient,
  ctx: TeamContext,
  weggevallenId: string,
): Promise<never> {
  const nieuwActief = actiefTeamNaVerlies(ctx.teams, weggevallenId, ctx.teamId)
  const cookieStore = await cookies()

  if (nieuwActief) {
    // Geen lidmaatschapscheck nodig: het id komt uit de teamcontext van deze
    // request, die uit de database komt — niet van de client.
    cookieStore.set(ACTIVE_TEAM_COOKIE, nieuwActief, COOKIE_OPTIES)
  } else {
    cookieStore.delete(ACTIVE_TEAM_COOKIE)
    // Nul teams over: de geparkeerde teamnaam uit signUp mag nu nooit meer een
    // leeg team terugtoveren (fase-2/3-aandachtspunt, zie wisTeamNaamVlag in
    // lib/team-context.ts). Normaal is hij al gewist zodra er een
    // lidmaatschap was; dit dekt het geval dat élke eerdere wispoging mislukte.
    // Alleen loggen bij een fout — het team is al weg.
    await wisTeamNaamVlag(supabase)
  }

  revalidatePath('/', 'layout')
  redirect('/')
}
