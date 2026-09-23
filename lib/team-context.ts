import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorCode, genericError, logError } from '@/lib/errors'
import {
  ALLE_RECHTEN,
  RECHT_KOLOM,
  rechtenUitRij,
  type Onderdeel,
  type TeamRechten,
  type TeamRol,
} from '@/lib/team-rechten'

// De teamcontext van de huidige request: WIE ben ik (userId) en VOOR WELK TEAM
// werk ik nu (teamId). Tot deze feature vielen die twee samen — het account
// wás het team — en stond overal een filter op de sessie-user-id. Vanaf nu is
// `ctx.teamId` de enige juiste tenant-sleutel en is `ctx.userId` alleen nog de
// identiteit van de ingelogde persoon (en het eigenaarschap van oefeningen).
//
// Bewust een plain lib-bestand en GEEN 'use server': zulke bestanden mogen
// alleen async functies exporteren, en hier staan ook types en synchrone
// helpers (geheugen.md, "Belangrijke gotchas"). Het cookie-patroon is
// overgenomen van `locale` (app/actions/i18n.ts + getDict in lib/i18n.ts).

export const ACTIVE_TEAM_COOKIE = 'active_team'

// Sleutel in de Supabase user-metadata waarin `signUp` de gewenste teamnaam
// parkeert. Hij bestaat om precies één gat te dichten: staat e-mailbevestiging
// aan in Supabase, dan heeft signUp nog GEEN sessie en kan hij de teamrijen
// niet schrijven (RLS). De gebruiker bevestigt daarna zijn adres, logt in — en
// zou zonder deze vlag een account zonder enkel lidmaatschap hebben, waarmee
// elke pagina op 'Geen team' zou stuklopen.
//
// WAAROM EEN VLAG EN NIET "nul lidmaatschappen → maak een team": vanaf fase 2
// registreert iemand ook via een uitnodiging (signUpViaInvite). Zo iemand mag
// NOOIT een eigen team krijgen (BR 51), ook niet als hij eerst zijn e-mail
// bevestigt en daarna met nul lidmaatschappen inlogt. signUpViaInvite zet deze
// metadata dus bewust niet, en dan gebeurt er hier niets.
//
// De vlag wordt gewist zodra het team bestaat, zodat hij niet later — als
// iemand zijn laatste team verlaat (fase 2/3) — alsnog een team tovert.
//
// VEILIGHEID: user-metadata is door de gebruiker zelf te schrijven
// (auth.updateUser vanuit de browser). Dat is hier geen escalatie: het enige
// wat je ermee kunt afdwingen is je EIGEN team met id = je eigen user-id —
// precies wat een normale registratie ook oplevert, en precies wat de
// bootstrap-policies in supabase/teams-en-leden.sql toestaan. De naam is
// attacker-controlled en wordt daarom op dezelfde 80 tekens geknipt als in
// signUp.
export const TEAM_NAAM_METADATA_KEY = 'pitchup_team_name'

const MAX_TEAM_NAAM_LENGTE = 80

// Leest de gewenste teamnaam uit de user-metadata. Geeft null zodra de vlag
// ontbreekt, geen string is of na trimmen leeg is — dan wordt er geen team
// aangemaakt.
export function teamNaamUitMetadata(user: { user_metadata?: unknown } | null | undefined): string | null {
  const metadata = user?.user_metadata
  if (!metadata || typeof metadata !== 'object') return null
  const waarde = (metadata as Record<string, unknown>)[TEAM_NAAM_METADATA_KEY]
  if (typeof waarde !== 'string') return null
  return waarde.trim().slice(0, MAX_TEAM_NAAM_LENGTE) || null
}

// Een unieke-sleutelschending betekent hier "stond er al" en is dus geen fout:
// twee gelijktijdige requests kunnen allebei tegelijk het zelfherstel starten.
const UNIQUE_VIOLATION = '23505'

function bestaatAl(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION
}

// Maakt het eigen team van één gebruiker: de teams-rij, de owner-rij in
// team_members en de teamnaam in settings — in die volgorde, want de
// settings-policy (settings_key_editable → is_team_owner) kan pas slagen als
// de owner-rij bestaat, en die heeft de teams-rij als foreign key nodig.
//
// teams.id IS BEWUST GELIJK AAN userId. Dat is de invariant waar de hele
// fase-1-migratie op rust (supabase/teams-en-leden.sql): voor elk bestaand én
// elk nieuw team geldt teams.id = user-id van de hoofdtrainer, dus
// is_team_member(team_id) dekt exact dezelfde rijen als het oude
// team_id = auth.uid(). Een willekeurige uuid zou een account dat tussen
// migratie M1 en M2 wordt aangemaakt meteen onbruikbaar maken.
// Fase 2 vervangt deze functie door de RPC create_team().
//
// Idempotent: al bestaande rijen zijn geen fout. Gooit wél bij elke andere
// fout op teams/team_members — zonder die twee rijen is het account
// onbruikbaar en dat mag niet stilzwijgend gebeuren. Een mislukte
// settings-insert wordt alleen gelogd: dan mist er enkel een teamnaam.
export async function maakEigenTeam(
  supabase: SupabaseClient,
  userId: string,
  teamNaam: string,
): Promise<void> {
  const { error: teamError } = await supabase.from('teams').insert({ id: userId })
  if (teamError && !bestaatAl(teamError)) throw genericError('teamContext.maakEigenTeam.team', teamError)

  const { error: memberError } = await supabase.from('team_members').insert({
    team_id: userId,
    user_id: userId,
    rol: 'owner',
    mag_spelers_bewerken: true,
    mag_agenda_bewerken: true,
    mag_aanwezigheid_bewerken: true,
    mag_wedstrijd_bewerken: true,
    mag_training_bewerken: true,
    mag_periodisering_bewerken: true,
  })
  if (memberError && !bestaatAl(memberError)) {
    throw genericError('teamContext.maakEigenTeam.lid', memberError)
  }

  const { error: settingsError } = await supabase.from('settings').insert({
    team_id: userId,
    key: 'team_name',
    value: teamNaam,
  })
  if (settingsError && !bestaatAl(settingsError)) {
    logError('teamContext.maakEigenTeam.naam', settingsError)
  }

  // Vlag wissen hoort bij "het team bestaat nu" en staat daarom hier, niet bij
  // de aanroepers: zo kan geen enkele aanroeper het vergeten. Zonder dit zou de
  // vlag blijven staan en vanaf fase 2 een team kunnen terugtoveren nadat
  // iemand zijn laatste team heeft verlaten. Alleen loggen bij een fout — het
  // team staat er dan al, en maakEigenTeam is idempotent.
  //
  // AANDACHTSPUNT VOOR FASE 2/3 — deze update KAN mislukken, en dan blijft de
  // vlag staan. In fase 1 is dat onschadelijk (zolang er een lidmaatschap is,
  // kijkt het zelfherstel niet naar de vlag), maar zodra `leaveTeam` en
  // `deleteTeam` bestaan kan iemand op nul lidmaatschappen uitkomen en zou een
  // achtergebleven vlag hem alsnog een nieuw team geven. Twee mogelijke
  // oplossingen, te kiezen bij het bouwen van fase 2/3:
  //   a) leaveTeam/deleteTeam wissen de vlag ook, of
  //   b) het zelfherstel negeert de vlag zodra er ooit een team heeft bestaan
  //      (bijvoorbeeld door in plaats van te wissen een afgehandeld-markering
  //      te zetten in plaats van null).
  // Bewust niet opgelost in fase 1: er is dan nog geen weg naar nul teams.
  const { error: metadataError } = await supabase.auth.updateUser({
    data: { [TEAM_NAAM_METADATA_KEY]: null },
  })
  if (metadataError) logError('teamContext.maakEigenTeam.vlag', metadataError)
}

export type TeamLidmaatschap = {
  teamId: string
  naam: string
  rol: TeamRol
  rechten: TeamRechten
}

export type TeamContext = {
  userId: string
  teamId: string
  rol: TeamRol
  rechten: TeamRechten
  // Alle lidmaatschappen, alfabetisch op teamnaam met het team-id als
  // tiebreak — zodat de volgorde stabiel is bij twee gelijke namen.
  teams: TeamLidmaatschap[]
}

type ContextResultaat = {
  ingelogd: boolean
  ctx: TeamContext | null
}

const LEEG: ContextResultaat = { ingelogd: false, ctx: null }

const MEMBER_KOLOMMEN = ['team_id', 'rol', ...Object.values(RECHT_KOLOM)].join(', ')

type RuweMemberRij = Record<string, unknown>

function leesRol(waarde: unknown): TeamRol {
  // Alles wat geen expliciete 'owner' is, is een assistent. De CHECK-constraint
  // op team_members.rol laat niets anders toe; dit is het vangnet voor het
  // geval de kolom ooit verruimd wordt zonder dat deze code meegaat.
  return waarde === 'owner' ? 'owner' : 'assistent'
}

// Eén DB-roundtrip per request, gedeeld door layout, pages en elke server
// action in diezelfde request. Zelfde cache()-patroon als getDict
// (lib/i18n.ts). Buiten een React-render valt cache() terug op gewoon
// doorroepen; dat is correct, alleen niet gememoïseerd.
const laadContext = cache(async (): Promise<ContextResultaat> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return LEEG

  // Expliciet op user_id filteren is niet optioneel: de RLS-policy op
  // team_members laat een hoofdtrainer ook de rijen van zijn assistenten zien.
  // Zonder dit filter zouden die rijen als eigen lidmaatschap meetellen.
  const { data: memberRows, error: memberError } = await supabase
    .from('team_members')
    .select(MEMBER_KOLOMMEN)
    .eq('user_id', user.id)

  if (memberError) {
    logError('teamContext.leden', memberError)
    return { ingelogd: true, ctx: null }
  }

  let rijen = ((memberRows ?? []) as unknown as RuweMemberRij[]).filter(
    (rij): rij is RuweMemberRij & { team_id: string } => typeof rij.team_id === 'string',
  )

  // De teamnaam staat in settings onder de key 'team_name' — bewust geen
  // tweede kolom op `teams`, die zou meteen uit elkaar lopen met wat de
  // Instellingenpagina schrijft. De map wordt hier al aangemaakt zodat het
  // zelfherstel hieronder de zojuist geschreven naam meteen kan invullen.
  const namen = new Map<string, string>()

  // ZELFHERSTEL — zie TEAM_NAAM_METADATA_KEY hierboven voor het waarom.
  // Nul lidmaatschappen én een geparkeerde teamnaam betekent: signUp kon de
  // teamrijen niet schrijven omdat er nog geen sessie was (e-mailbevestiging
  // staat aan). Dit is de eerste request mét sessie, dus nu kan het wel.
  //
  // Zonder die vlag gebeurt er niets: iemand die via een uitnodiging
  // registreert (fase 2) hoort géén eigen team te krijgen.
  //
  // Ja, dit is een schrijfactie in een leesfunctie. Dat is bewust: dit is het
  // enige punt waar élke ingang (layout, pages én actions) langskomt, en het
  // gebeurt hooguit één keer per account. cache() zorgt dat het binnen één
  // request maar één keer draait; maakEigenTeam is idempotent voor het geval
  // twee requests tegelijk binnenkomen.
  const teamNaamVlag = rijen.length === 0 ? teamNaamUitMetadata(user) : null
  if (rijen.length === 0 && teamNaamVlag) {
    try {
      await maakEigenTeam(supabase, user.id, teamNaamVlag)
    } catch (fout) {
      // maakEigenTeam heeft al gelogd via genericError. Geen team = geen
      // context; de volgende request probeert het opnieuw.
      logError('teamContext.zelfherstel', fout)
      return { ingelogd: true, ctx: null }
    }
    // Geen tweede leesronde: we weten precies welke rij er nu staat.
    rijen = [{ team_id: user.id, rol: 'owner' }]
    namen.set(user.id, teamNaamVlag)
  }

  if (rijen.length === 0) return { ingelogd: true, ctx: null }

  const { data: naamRows, error: naamError } = await supabase
    .from('settings')
    .select('team_id, value')
    .in('team_id', rijen.map((rij) => rij.team_id))
    .eq('key', 'team_name')

  // Een mislukte naam-lookup mag de context niet slopen: zonder naam werkt
  // alles nog, de wisselaar toont dan een lege naam.
  if (naamError) logError('teamContext.namen', naamError)
  for (const rij of (naamRows ?? []) as { team_id?: unknown; value?: unknown }[]) {
    if (typeof rij.team_id === 'string' && typeof rij.value === 'string') {
      namen.set(rij.team_id, rij.value)
    }
  }

  const teams: TeamLidmaatschap[] = rijen.map((rij) => {
    const rol = leesRol(rij.rol)
    return {
      teamId: rij.team_id,
      naam: namen.get(rij.team_id) ?? '',
      rol,
      // Een hoofdtrainer heeft per definitie alle rechten, ongeacht wat er in
      // de zes kolommen staat. Zelfde regel als `m.rol = 'owner' or ...` in de
      // SQL-functie can_edit().
      rechten: rol === 'owner' ? { ...ALLE_RECHTEN } : rechtenUitRij(rij),
    }
  })

  teams.sort((a, b) => {
    const opNaam = a.naam.localeCompare(b.naam, 'nl')
    return opNaam !== 0 ? opNaam : a.teamId.localeCompare(b.teamId)
  })

  // De cookie is NOOIT een autorisatiebron: hij mag alleen kiezen tússen de
  // lidmaatschappen die de database teruggaf. Een onbekende of vreemde waarde
  // valt stil terug op het eerste eigen team (alfabetisch). De cookie wordt
  // hier bewust niet rechtgezet — een server component mag in Next geen cookie
  // schrijven; dat gebeurt bij de eerstvolgende setActiveTeam.
  //
  // Bij precies één lidmaatschap wordt de cookie helemaal niet gelezen: hij
  // kan dan per definitie niets kiezen (`find() ?? teams[0]` geeft hoe dan ook
  // dat ene team). Dat scheelt een cookie-read op elke request van elke
  // gebruiker met één team — dat is vandaag iedereen.
  let actief = teams[0]
  if (teams.length > 1) {
    const gekozen = (await cookies()).get(ACTIVE_TEAM_COOKIE)?.value
    actief = teams.find((team) => team.teamId === gekozen) ?? teams[0]
  }

  return {
    ingelogd: true,
    ctx: {
      userId: user.id,
      teamId: actief.teamId,
      // Rol en rechten komen altijd uit het lidmaatschap van het ACTIEVE team,
      // nooit uit een ander lidmaatschap.
      rol: actief.rol,
      rechten: actief.rechten,
      teams,
    },
  }
})

// null = niet ingelogd óf geen enkel lidmaatschap. Gebruik dit in layout/pages
// die ook zonder team iets moeten kunnen tonen; gebruik requireTeamContext in
// alles wat data leest of schrijft.
export async function getTeamContext(): Promise<TeamContext | null> {
  return (await laadContext()).ctx
}

export async function requireTeamContext(): Promise<TeamContext> {
  const { ingelogd, ctx } = await laadContext()
  // Bewust dezelfde melding als het oude `if (!user) throw new Error(...)` in
  // elke action: bestaande tests en foutafhandeling leunen erop.
  if (!ingelogd) throw new Error('Niet ingelogd')
  if (!ctx) throw new Error('Geen team')
  return ctx
}

// Variant voor server components (pages). Geen sessie → redirect('/login'),
// exact het gedrag van vóór deze feature (en wat proxy.ts al afdwingt).
//
// Wél een sessie maar geen enkel lidmaatschap gooit bewust 'Geen team' en
// redirect NIET: proxy.ts stuurt een ingelogde bezoeker van /login meteen
// terug naar '/', dus een redirect zou daar een lus opleveren. In fase 1 is
// dat pad onbereikbaar (de backfill geeft elk account een team en signUp maakt
// er een aan); fase 2 vervangt het door de lege staat in AppShell.
export async function requireTeamContextOrLogin(): Promise<TeamContext> {
  const { ingelogd, ctx } = await laadContext()
  if (!ingelogd) redirect('/login')
  if (!ctx) throw new Error('Geen team')
  return ctx
}

// Synchroon en puur, zodat een server component hem mag gebruiken om een knop
// wel of niet te renderen.
export function canEdit(ctx: TeamContext, onderdeel: Onderdeel): boolean {
  return ctx.rol === 'owner' || ctx.rechten[onderdeel] === true
}

export function assertCanEdit(ctx: TeamContext, onderdeel: Onderdeel): void {
  if (!canEdit(ctx, onderdeel)) throw new Error('Geen toegang')
}

// Zonder teamId gaat het over het actieve team. Met teamId wordt het
// lidmaatschap van dát team opgezocht in de context — nooit los uit de
// database, zodat een meegegeven id nooit meer kan dan wat de gebruiker al is.
export function assertIsOwner(ctx: TeamContext, teamId?: string): void {
  const doel = teamId ?? ctx.teamId
  const lidmaatschap = ctx.teams.find((team) => team.teamId === doel)
  if (!lidmaatschap || lidmaatschap.rol !== 'owner') throw new Error('Geen toegang')
}
