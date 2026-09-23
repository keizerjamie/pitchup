'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { genericError, logError } from '@/lib/errors'
import { assertIsOwner, requireTeamContext } from '@/lib/team-context'
import { ONDERDELEN, RECHT_KOLOM, rechtenUitRij } from '@/lib/team-rechten'

// Staf beheren: wie zit er in het team, welke rechten heeft hij, en hem
// verwijderen. Alles hier is HOOFDTRAINER-WERK (AC 32/46) — ook voor een
// assistent met alle zes bewerkrechten.
//
// Dit bestand exporteert bewust ALLEEN async functies: een type-export uit een
// 'use server'-bestand lekt in Turbopack als runtime-verwijzing (geheugen.md,
// "Belangrijke gotchas"). De types en constanten staan in lib/team-rechten.ts.
//
// TWEE LAGEN, ALTIJD. De app-laag (assertIsOwner + het expliciete
// team_id-filter uit ctx) is de eerste; de RLS-policies op team_members
// ("team_members: owner wijzigt rechten", "team_members: owner of vertrek" in
// supabase/teams-en-leden.sql) zijn de tweede. Die policies eisen óók
// `rol = 'assistent'`, dus een owner-rij is langs geen van beide wegen te
// wijzigen of te verwijderen.

const LID_NIET_GEVONDEN = 'Teamlid niet gevonden'

// Precies de kolommen die de UI nodig heeft. Nooit `select('*')`: dan lekt een
// toekomstige kolom stil mee naar de client.
const LID_KOLOMMEN = ['user_id', 'rol', ...Object.values(RECHT_KOLOM)].join(', ')

type LidRij = Record<string, unknown>

// Alle leden van het ACTIEVE team, met e-mailadres waar dat kan.
//
// HET E-MAILADRES KOMT UIT DE ADMIN-CLIENT, want auth.users is niet leesbaar
// voor `authenticated`. Dat is een service-role-key en dus het scherpste
// gereedschap in de doos; daarom drie grenzen:
//   1. alleen ná assertIsOwner,
//   2. uitsluitend opgevraagd per user-id die al in team_members van DIT team
//      staat — nooit een lijstquery over alle gebruikers,
//   3. uitsluitend het e-mailadres komt terug, niets anders uit het
//      auth-record.
// Ontbreekt de key (lib/supabase/admin.ts geeft dan null), dan degradeert de
// lijst netjes naar e-mail = null in plaats van te falen (brief §3.3).
export async function listTeamMembers(): Promise<
  { userId: string; email: string | null; rol: 'owner' | 'assistent'; rechten: Record<string, boolean> }[]
> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .select(LID_KOLOMMEN)
    .eq('team_id', ctx.teamId)

  if (error) throw genericError('teamMembers.listTeamMembers', error)

  const rijen = ((data ?? []) as unknown as LidRij[]).filter(
    (rij): rij is LidRij & { user_id: string } => typeof rij.user_id === 'string',
  )

  const emails = await emailsVoor(rijen.map((rij) => rij.user_id))

  const leden = rijen.map((rij) => {
    const rol = rij.rol === 'owner' ? ('owner' as const) : ('assistent' as const)
    return {
      userId: rij.user_id,
      email: emails.get(rij.user_id) ?? null,
      rol,
      // Zelfde regel als can_edit() in SQL en canEdit() in lib/team-context.ts:
      // een hoofdtrainer heeft per definitie alles, ongeacht de kolommen.
      rechten: rol === 'owner'
        ? Object.fromEntries(ONDERDELEN.map((o) => [o, true]))
        : rechtenUitRij(rij),
    }
  })

  // Hoofdtrainer bovenaan, daarna op e-mailadres — stabiel, zodat de lijst
  // niet verspringt bij elke render.
  leden.sort((a, b) => {
    if (a.rol !== b.rol) return a.rol === 'owner' ? -1 : 1
    return (a.email ?? a.userId).localeCompare(b.email ?? b.userId, 'nl')
  })
  return leden
}

// Haalt per user-id het e-mailadres op. Strikt begrensd tot de meegegeven
// id's; er is bewust geen listUsers()-variant, die zou álle accounts van het
// project teruggeven.
async function emailsVoor(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>()
  if (userIds.length === 0) return emails

  const admin = createAdminClient()
  if (!admin) {
    // Geen harde fout: de UI toont dan "Assistent" zonder adres. Wel loggen,
    // want in productie hoort de key er te zijn.
    logError('teamMembers.emails', { code: 'service_role_key_missing' })
    return emails
  }

  await Promise.all(userIds.map(async (userId) => {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) {
      logError('teamMembers.emails', error)
      return
    }
    const email = data?.user?.email
    if (typeof email === 'string' && email) emails.set(userId, email)
  }))

  return emails
}

// Zet de zes rechten van één assistent. Autosave per toggle in de UI, dus
// bewust een volledige set en geen patch: twee snel na elkaar geklikte
// schakelaars mogen elkaar niet half overschrijven.
//
// WEIGERT ZICHZELF EN ELKE OWNER-RIJ (AC 32). Zichzelf eerst, met een eigen
// check: een hoofdtrainer die zijn eigen rij zou kunnen bijwerken, zou zich
// kunnen degraderen zonder dat er nog een tweede owner is.
export async function updateMemberRights(
  userId: string,
  rechten: Record<string, unknown>,
): Promise<{ ok: true }> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)
  if (!userId || userId === ctx.userId) throw new Error(LID_NIET_GEVONDEN)

  // Alleen de zes bekende onderdelen, en alles wat geen expliciete `true` is
  // telt als "geen recht". Zo kan een client geen onbekende kolom meesturen.
  const kolommen: Record<string, boolean> = {}
  for (const onderdeel of ONDERDELEN) {
    kolommen[RECHT_KOLOM[onderdeel]] = rechten?.[onderdeel] === true
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .update(kolommen)
    // Drie filters, alle drie nodig: team_id is de tenant-grens, user_id het
    // doel, en `rol = 'assistent'` houdt de owner-rij onaanraakbaar — precies
    // wat de RLS-policy ook eist.
    .eq('team_id', ctx.teamId)
    .eq('user_id', userId)
    .eq('rol', 'assistent')
    .select('user_id')

  if (error) throw genericError('teamMembers.updateMemberRights', error)
  // 0 rijen betekent: geen lid van dit team, of de hoofdtrainer. Dezelfde
  // melding voor beide — die verraadt niet welk van de twee het was.
  if (!data || data.length === 0) throw new Error(LID_NIET_GEVONDEN)

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { ok: true }
}

// Verwijdert één assistent uit het actieve team (AC 10). Raakt NIETS anders:
// de teamdata blijft, de oefeningen van die persoon blijven van hem (die zijn
// persoonlijk bezit, zie lib/authz.ts bij assertOwnOefening), en zijn account
// blijft bestaan.
//
// Weigert zichzelf en elke owner-rij (AC 32). De hoofdtrainer kan zichzelf dus
// niet uit zijn eigen team schrijven — dat zou een team zonder hoofdtrainer
// opleveren, precies wat blok 13 van supabase/team-rls-verificatie.sql
// bewaakt.
export async function removeMember(userId: string): Promise<{ ok: true }> {
  const ctx = await requireTeamContext()
  assertIsOwner(ctx)
  if (!userId || userId === ctx.userId) throw new Error(LID_NIET_GEVONDEN)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', ctx.teamId)
    .eq('user_id', userId)
    .eq('rol', 'assistent')
    .select('user_id')

  if (error) throw genericError('teamMembers.removeMember', error)
  if (!data || data.length === 0) throw new Error(LID_NIET_GEVONDEN)

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { ok: true }
}
