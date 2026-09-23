import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { genericError, logError } from '@/lib/errors'
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
// De vlag wordt gewist zodra er een lidmaatschap bestaat, zodat hij niet later
// — als iemand zijn laatste team verliest (removeMember in fase 2, leaveTeam/
// deleteTeam in fase 3) — alsnog een team tovert. Zie `wisTeamNaamVlag` en
// het blok daarboven voor waarom dat wissen in laadContext staat en niet
// alleen in maakEigenTeam.
//
// VEILIGHEID: user-metadata is door de gebruiker zelf te schrijven
// (auth.updateUser vanuit de browser). Dat is hier geen escalatie, maar de
// reden is sinds fase 2 een andere dan hierboven ooit stond. Vroeger was het
// argument "je kunt er alleen je eigen team met id = je user-id mee maken,
// precies wat de bootstrap-policies toestaan" — die policies verdwijnen met
// M5b en een nieuw team krijgt een gen_random_uuid(), dus dat argument geldt
// niet meer. Wat er nu voor in de plaats komt:
//   * de vlag kan hooguit create_team() laten draaien, en die functie maakt
//     ALTIJD een vers, leeg team met de aanroeper als hoofdtrainer. Hij kan
//     niet naar een bestaand team wijzen en de rol staat er hard in;
//   * diezelfde handeling staat sowieso open via createTeam
//     (app/actions/team.ts) — er is geen limiet op het aantal teams (BR 37).
// Het enige wat een gebruiker met de vlag bereikt is dus een leeg team dat hij
// ook gewoon met een knop had kunnen maken. De naam is attacker-controlled en
// wordt daarom op dezelfde 80 tekens geknipt als in signUp.
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

// Wist de geparkeerde teamnaam uit de user-metadata.
//
// WAAROM DIT EEN LOSSE FUNCTIE IS, EN WAAROM LAADCONTEXT HEM OOK AANROEPT
// (oplossing voor het fase-2/3-aandachtspunt uit validatieronde 2, punt 5):
// deze update kan mislukken. Stond het wissen alleen in maakEigenTeam, dan
// bleef de vlag na zo'n mislukking voorgoed staan — en zou hij vanaf fase 2,
// zodra iemand via removeMember zijn laatste lidmaatschap verliest, alsnog een
// leeg team terugtoveren.
//
// Gekozen oplossing: variant (b) uit die notitie — "de vlag telt alleen zolang
// er nog nooit een lidmaatschap was". Dat is hier geïmplementeerd door hem te
// wissen zodra er WEL een lidmaatschap is (zie laadContext). Die poging
// herhaalt zich bij elke request tot hij lukt, dus de vlag convergeert naar
// weg. Variant (a) — removeMember/leaveTeam laten wissen — is bewust NIET
// gekozen: removeMember wordt uitgevoerd door de hoofdtrainer, en die kan de
// user-metadata van een ánder account alleen met de service-role-key
// aanpassen. Zonder die key (die optioneel is, zie lib/supabase/admin.ts) zou
// het gat gewoon openblijven.
//
// Alleen loggen bij een fout: het team staat er dan al en de volgende request
// probeert het opnieuw.
export async function wisTeamNaamVlag(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { [TEAM_NAAM_METADATA_KEY]: null },
  })
  if (error) logError('teamContext.vlagWissen', error)
}

// Maakt het eigen team van één gebruiker en geeft het nieuwe team-id terug.
//
// SINDS FASE 2 LOOPT DIT VIA DE RPC create_team()
// (supabase/team-aanmaken-rpc.sql). Twee redenen, en de eerste is dwingend:
//   1. De bootstrap-INSERT-policies op teams en team_members worden ná de
//      deploy van fase 2 gedropt (M5b). Vanaf dat moment is er geen enkele weg
//      meer waarlangs een gewone client zelf een teams-rij of een owner-rij
//      kan schrijven. De oude drie losse inserts zouden dus stilvallen en elk
//      zelfherstel zou op 'Geen team' stranden.
//   2. De drie inserts zijn nu één transactie. Faalde vroeger de tweede, dan
//      bestond er een team ZONDER hoofdtrainer en was de gebruiker permanent
//      buitengesloten van zijn eigen data, zonder dat iets dat detecteerde.
//
// `p_alleen_zonder_team: true` maakt de aanroep idempotent: bestaat er al een
// lidmaatschap (twee gelijktijdige requests, of een dubbele formulierinzending),
// dan geeft de functie dat team terug in plaats van een tweede aan te maken.
// Vóór fase 2 deed de primaire sleutel teams.id = user.id dat werk; een
// gen_random_uuid() botst nooit, dus die bescherming moest mee verhuizen.
//
// LET OP: het nieuwe team-id is NIET meer gelijk aan de user-id. De
// fase-1-invariant gold alleen om fase 1 zonder gedragsverandering uit te
// kunnen rollen; bestaande teams houden hun oude id.
//
// Gooit bij elke fout — zonder team is het account onbruikbaar en dat mag niet
// stilzwijgend gebeuren.
export async function maakEigenTeam(
  supabase: SupabaseClient,
  teamNaam: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_team', {
    p_naam: teamNaam,
    p_alleen_zonder_team: true,
  })
  if (error) throw genericError('teamContext.maakEigenTeam', error)
  if (typeof data !== 'string' || !data) {
    throw genericError('teamContext.maakEigenTeam', { code: 'geen_team_id' })
  }

  await wisTeamNaamVlag(supabase)
  return data
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

// Leest alle lidmaatschappen van één gebruiker.
//
// Expliciet op user_id filteren is niet optioneel: de RLS-policy op
// team_members laat een hoofdtrainer ook de rijen van zijn assistenten zien.
// Zonder dit filter zouden die rijen als eigen lidmaatschap meetellen.
async function leesLidmaatschappen(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ rijen: (RuweMemberRij & { team_id: string })[]; error: unknown }> {
  const { data, error } = await supabase
    .from('team_members')
    .select(MEMBER_KOLOMMEN)
    .eq('user_id', userId)

  const rijen = ((data ?? []) as unknown as RuweMemberRij[]).filter(
    (rij): rij is RuweMemberRij & { team_id: string } => typeof rij.team_id === 'string',
  )
  return { rijen, error }
}

// Eén DB-roundtrip per request, gedeeld door layout, pages en elke server
// action in diezelfde request. Zelfde cache()-patroon als getDict
// (lib/i18n.ts). Buiten een React-render valt cache() terug op gewoon
// doorroepen; dat is correct, alleen niet gememoïseerd.
const laadContext = cache(async (): Promise<ContextResultaat> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return LEEG

  const { rijen: eersteRonde, error: memberError } = await leesLidmaatschappen(supabase, user.id)

  if (memberError) {
    logError('teamContext.leden', memberError)
    return { ingelogd: true, ctx: null }
  }

  let rijen = eersteRonde

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
  const teamNaamVlag = teamNaamUitMetadata(user)
  if (rijen.length === 0 && teamNaamVlag) {
    try {
      const nieuwTeamId = await maakEigenTeam(supabase, teamNaamVlag)

      // TWEEDE LEESRONDE, EN DIE IS NIET OPTIONEEL. De verleiding is om hier
      // `[{ team_id: nieuwTeamId, rol: 'owner' }]` te construeren — dat
      // scheelt een query. Maar dan verzint deze functie een rol in plaats van
      // hem te lezen, en tussen de eerste lees en deze aanroep kan er in een
      // ander tabblad een uitnodiging geaccepteerd zijn. Dat lidmaatschap zou
      // dan óf ontbreken, óf (als create_team het had teruggegeven) als
      // 'owner' worden bestempeld terwijl het een assistent-rij is. RLS zou
      // elke echte schrijfactie nog tegenhouden, maar canEdit/assertIsOwner
      // zouden één request lang openstaan — en dat maakt van de twee
      // beschermingslagen (BR 45) er tijdelijk één.
      const herlezen = await leesLidmaatschappen(supabase, user.id)
      // Mislukt de herlees, dan valt hij terug op wat create_team net
      // aantoonbaar heeft aangemaakt: die rij is er, met rol owner.
      rijen = herlezen.error || herlezen.rijen.length === 0
        ? [{ team_id: nieuwTeamId, rol: 'owner' }]
        : herlezen.rijen
      if (herlezen.error) logError('teamContext.ledenNaHerstel', herlezen.error)
      // Vast alvast invullen; de settings-lees hieronder overschrijft hem met
      // dezelfde waarde zodra create_team's rij zichtbaar is.
      namen.set(nieuwTeamId, teamNaamVlag)
    } catch (fout) {
      // maakEigenTeam heeft al gelogd via genericError. Geen team = geen
      // context; de volgende request probeert het opnieuw.
      logError('teamContext.zelfherstel', fout)
      return { ingelogd: true, ctx: null }
    }
  } else if (rijen.length > 0 && teamNaamVlag) {
    // Er is een lidmaatschap én er staat nog een vlag: die hoort hier niet
    // meer te staan (het wissen in maakEigenTeam is een keer mislukt, of de
    // gebruiker heeft hem zelf gezet — user-metadata is client-schrijfbaar).
    // Wissen, zodat hij later nooit een leeg team kan terugtoveren wanneer dit
    // account zijn laatste lidmaatschap verliest. Zie wisTeamNaamVlag voor de
    // volledige onderbouwing van deze keuze.
    await wisTeamNaamVlag(supabase)
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
