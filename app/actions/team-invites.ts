'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { genericError, logError } from '@/lib/errors'
import { generateInviteToken, hashInviteToken, isInviteToken } from '@/lib/invite-token'
import { NA_ACCEPTATIE_PAD, verzilverInvite, zetActiefTeamCookie } from '@/lib/team-invites'
import {
  INVITE_ACCEPT_IP_POLICY,
  INVITE_PEEK_IP_POLICY,
  checkRateLimit,
  clientIp,
  ipRateLimitKey,
  recordAttempt,
} from '@/lib/rate-limit'
import { getSiteUrl } from '@/lib/site-url'
import { assertIsOwner, requireTeamContext } from '@/lib/team-context'

// Uitnodigingen: een link genereren, intrekken, bekijken en verzilveren.
//
// Dit bestand exporteert bewust ALLEEN async functies (geheugen.md,
// "Belangrijke gotchas"). De frontend kan de vorm van een antwoord afleiden
// met `Awaited<ReturnType<typeof acceptInvite>>`; er is geen type-export.
//
// ── DRIE HARDE REGELS ───────────────────────────────────────
// 1. HET RUWE TOKEN VERLAAT DE SERVER PRECIES ÉÉN KEER: in het antwoord van
//    createInvite. In de database staat alleen de sha256-hash, en
//    getActiveInvite geeft hem nooit terug. Na het herladen van de
//    Instellingenpagina is de link dus niet opnieuw te tonen (beslissing 5 van
//    de eigenaar).
// 2. DE URL KOMT UITSLUITEND UIT getSiteUrl(), NOOIT UIT EEN REQUEST-HEADER.
//    Een `origin`/`Host`-header is door de client te sturen; dat was exact de
//    kritieke kwetsbaarheid uit de security-audit (zie lib/site-url.ts).
// 3. DE VERVALTIJD WORDT UITSLUITEND IN DE DATABASE BEOORDEELD, met `now()`
//    binnen accept_team_invite / active_team_invite
//    (supabase/team-invites-rpc.sql). Er komt hier nergens een JS-Date aan te
//    pas; de ISO-string die deze acties teruggeven is puur om te TONEN.

// Eén melding voor élke ongeldige link: verlopen, gebruikt, ingetrokken of
// onbekend zijn niet te onderscheiden (AC 23/24/25).
const ONGELDIG = { status: 'invalid' as const, teamNaam: null }

type PeekResultaat = { status: 'ok' | 'invalid'; teamNaam: string | null }
type AcceptResultaat = {
  status: 'ok' | 'already_member' | 'invalid' | 'rate_limited'
  teamId: string | null
}

// Genereert een nieuwe uitnodigingslink en trekt de bestaande direct in
// (AC 2/44). Alleen de hoofdtrainer (AC 46).
//
// Het antwoord bevat het ruwe token — dat is de enige keer. De aanroepende UI
// toont hem één keer met een kopieerknop.
export async function createInvite(): Promise<{ url: string; verlooptOp: string }> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)

  // Vóór het token genereren: zonder basis-URL is er geen bruikbare link en
  // zou er wél een invite in de database staan die niemand kan gebruiken.
  const siteUrl = getSiteUrl()
  if (!siteUrl) {
    logError('teamInvites.createInvite', { code: 'site_url_missing' })
    throw new Error('Uitnodigen is nu niet mogelijk. Neem contact op met de beheerder.')
  }

  const token = generateInviteToken()

  const supabase = await createClient()
  // Intrekken van de oude rij en de insert van de nieuwe gebeuren in één
  // transactie in de RPC — er staat bewust geen INSERT/UPDATE-policy op
  // team_invites, en twee losse statements zouden de race uit de story
  // ("nieuwe link terwijl iemand de oude gebruikt") openlaten.
  const { data, error } = await supabase
    .rpc('create_team_invite', { p_team_id: ctx.teamId, p_token_hash: hashInviteToken(token) })
    .single()

  if (error) throw genericError('teamInvites.createInvite', error)
  const verlooptOp = (data as { verloopt_op?: unknown } | null)?.verloopt_op
  if (typeof verlooptOp !== 'string') {
    throw genericError('teamInvites.createInvite', { code: 'geen_vervaldatum' })
  }

  revalidatePath('/settings')
  return { url: `${siteUrl}/invite/${token}`, verlooptOp }
}

// "Staat er een link open, en tot wanneer?" Geeft NOOIT het token of de hash
// terug — die is gehasht opgeslagen en niet te reproduceren.
//
// De vervaltoets zit in de RPC, met now() van de database. Een filter hier met
// een JS-Date zou de klok van de app-server laten beslissen terwijl
// accept_team_invite de klok van de database gebruikt; die twee mogen niet uit
// elkaar kunnen lopen.
export async function getActiveInvite(): Promise<{ verlooptOp: string } | null> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('active_team_invite', { p_team_id: ctx.teamId })
    .maybeSingle()

  if (error) throw genericError('teamInvites.getActiveInvite', error)
  const verlooptOp = (data as { verloopt_op?: unknown } | null)?.verloopt_op
  return typeof verlooptOp === 'string' ? { verlooptOp } : null
}

// Trekt de actieve link in zonder een nieuwe te maken. Idempotent: is er niets
// open, dan gebeurt er niets en is dat geen fout.
export async function revokeInvite(): Promise<{ ok: true }> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)

  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_team_invite', { p_team_id: ctx.teamId })
  if (error) throw genericError('teamInvites.revokeInvite', error)

  revalidatePath('/settings')
  return { ok: true }
}

// Bekijkt een link zonder hem te verzilveren: geeft de teamnaam bij een
// geldige link en anders één ononderscheidbare 'invalid'.
//
// ANONIEM TOEGESTAAN (beslissing 12): de invite-pagina is publiek
// (proxy.ts) en een bezoeker zonder account moet de teamnaam zien vóór hij
// registreert. Het token is de enige sleutel; daarom staat hier een
// IP-rate-limit voor.
//
// WIJZIGT NIETS. Een hoofdtrainer die zijn eigen link controleert verbrandt
// hem dus niet.
export async function peekInvite(token: string): Promise<PeekResultaat> {
  if (!isInviteToken(token)) return ONGELDIG

  // Een geblokkeerd IP krijgt bewust dezelfde neutrale uitkomst als een
  // onbekend token: zo blijft de invite-pagina op precies drie takken staan en
  // verraadt een 'te veel pogingen'-melding niet dat er íéts met dit token aan
  // de hand is.
  const ip = clientIp(await headers())
  const key = ipRateLimitKey('invite-peek', ip)
  if ((await checkRateLimit(key)).blocked) return ONGELDIG
  await recordAttempt(key, INVITE_PEEK_IP_POLICY)

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('peek_team_invite', { p_token_hash: hashInviteToken(token) })
    .maybeSingle()

  if (error) {
    // Ook een databasefout wordt hier een neutrale 'invalid'. De pagina blijft
    // daarmee renderbaar; de echte oorzaak staat alleen in de log.
    logError('teamInvites.peekInvite', error)
    return ONGELDIG
  }

  const rij = data as { status?: unknown; team_naam?: unknown } | null
  if (rij?.status !== 'ok') return ONGELDIG
  return { status: 'ok', teamNaam: typeof rij.team_naam === 'string' ? rij.team_naam : '' }
}

// Verzilvert een link voor de INGELOGDE gebruiker (AC 4). Maakt hem assistent
// met nul rechten (BR 39); de rol en de rechten staan hard in de RPC, dus de
// client kan ze niet kiezen.
//
// Uitkomsten:
//   'ok'             -> lidmaatschap aangemaakt, cookie op het nieuwe team,
//                       eindigt in een redirect naar NA_ACCEPTATIE_PAD en
//                       keert dus nooit terug.
//   'already_member' -> niets gewijzigd, rechten ongemoeid, de link blijft
//                       ONGEBRUIKT (beslissing 9, AC 26).
//   'invalid'        -> verlopen, gebruikt, ingetrokken of onbekend — één
//                       melding voor alle vier.
//   'rate_limited'   -> te veel pogingen vanaf dit IP; de link is níét
//                       verbruikt en werkt later gewoon.
export async function acceptInvite(token: string): Promise<AcceptResultaat> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const ip = clientIp(await headers())
  const key = ipRateLimitKey('invite-accept', ip)
  if ((await checkRateLimit(key)).blocked) return { status: 'rate_limited', teamId: null }
  await recordAttempt(key, INVITE_ACCEPT_IP_POLICY)

  const resultaat = await verzilverInvite(supabase, token, 'teamInvites.acceptInvite')
  if (resultaat.status !== 'ok' || !resultaat.teamId) return resultaat

  await zetActiefTeamCookie(resultaat.teamId)
  revalidatePath('/', 'layout')
  // Eindigt hier: redirect() gooit NEXT_REDIRECT, dus de tak 'ok' keert nooit
  // terug. Hij staat wél in het type, zodat de aanroepende UI exhaustief kan
  // switchen zonder een onbereikbare tak te moeten verzinnen. De joined-vlag
  // in het pad is het enige signaal dat de bevestiging op het dashboard
  // aanzet — zie NA_ACCEPTATIE_PAD.
  redirect(NA_ACCEPTATIE_PAD)
}
