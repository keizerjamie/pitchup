// Het verzilveren van een uitnodiging, op één plek.
//
// Bewust een plain lib en GEEN 'use server'-bestand. Twee redenen:
//   1. Een 'use server'-bestand mag alleen async functies exporteren, en hier
//      staan ook types (geheugen.md, "Belangrijke gotchas").
//   2. Belangrijker: élke export uit een 'use server'-bestand wordt een
//      publiek aanroepbaar endpoint. Zou deze functie daar staan, dan kon een
//      client hem rechtstreeks aanroepen en zo de IP-rate-limit op
//      acceptInvite (app/actions/team-invites.ts) overslaan.
//
// Twee aanroepers, allebei in de actions-laag:
//   * acceptInvite (app/actions/team-invites.ts) — de ingelogde gebruiker die
//     op "Word assistent bij <team>" klikt; die zet er een rate-limit voor.
//   * signUpViaInvite (app/actions/auth.ts) — vlak na registratie, met de
//     sessie die signUp net opleverde; die is al langs de signUp-tellers
//     gekomen.

import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { genericError } from '@/lib/errors'
import { hashInviteToken, isInviteToken } from '@/lib/invite-token'
import { ACTIVE_TEAM_COOKIE } from '@/lib/team-context'

export type InviteStatus = 'ok' | 'already_member' | 'invalid' | 'rate_limited'

export type InviteResultaat = {
  status: InviteStatus
  teamId: string | null
}

export const ONGELDIGE_INVITE: InviteResultaat = { status: 'invalid', teamId: null }

// Waar een geslaagde acceptatie op uitkomt. De `joined`-vlag is het signaal
// waarmee het dashboard "Je bent toegevoegd aan <team>" toont (brief §2.3) —
// zonder die vlag landt de genodigde op een dashboard dat niets bevestigt.
//
// BEWUST GEEN TEAMNAAM OF -ID IN DE QUERY: de naam staat al in de
// teamcontext van het (net gezette) actieve team, en een id in de URL is een
// tenant-sleutel die dan in browsergeschiedenis, server-logs en een eventuele
// Referer belandt. Eén vlag is genoeg.
//
// Eén constante voor beide wegen naar binnen — acceptInvite
// (app/actions/team-invites.ts) en signUpViaInvite (app/actions/auth.ts) —
// zodat ze niet uit elkaar kunnen lopen.
export const NA_ACCEPTATIE_PAD = '/?joined=1'

// Roept accept_team_invite aan (supabase/team-invites-rpc.sql) en vertaalt het
// antwoord naar een vaste vorm.
//
// DE VERVALTOETS ZIT IN DE DATABASE (`verloopt_op <= now()`), niet hier. Er
// komt in deze hele keten geen JS-Date aan te pas bij de geldigheidsbeslissing.
//
// 'already_member' laat de uitnodiging ONGEBRUIKT en de bestaande rechten
// ongemoeid (beslissing 9, AC 26) — dat is gedrag van de RPC, niet van deze
// functie.
export async function verzilverInvite(
  supabase: SupabaseClient,
  token: string,
  context: string,
): Promise<InviteResultaat> {
  // Vormcheck vóór de database-roundtrip; houdt meteen begrensd wat er als
  // hash-invoer wordt gebruikt.
  if (!isInviteToken(token)) return ONGELDIGE_INVITE

  const { data, error } = await supabase
    .rpc('accept_team_invite', { p_token_hash: hashInviteToken(token) })
    .maybeSingle()

  if (error) throw genericError(context, error)

  const rij = data as { status?: unknown; team_id?: unknown } | null
  const teamId = typeof rij?.team_id === 'string' ? rij.team_id : null

  if (rij?.status === 'already_member') return { status: 'already_member', teamId }
  if (rij?.status !== 'ok' || !teamId) return ONGELDIGE_INVITE
  return { status: 'ok', teamId }
}

// Zet het actieve team na een geslaagde acceptatie.
//
// Hier mag geen lidmaatschapscheck omheen zoals in setActiveTeam: het team-id
// komt niet van de client maar rechtstreeks uit de RPC, die de gebruiker er
// net zelf als lid heeft ingeschreven.
export async function zetActiefTeamCookie(teamId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, { path: '/', maxAge: 60 * 60 * 24 * 365 })
}
