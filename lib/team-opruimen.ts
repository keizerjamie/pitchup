// Eén team volledig opruimen, op één plek.
//
// Twee aanroepers, en die mogen NIET uit elkaar lopen (BR 49: "teamverwijdering
// los van accountverwijdering volgt hetzelfde opruimgedrag"):
//   * deleteAccount (app/actions/auth.ts) — voor elk team waarvan het account
//     hoofdtrainer is;
//   * deleteTeam (app/actions/team.ts) — één los team.
//
// Bewust een plain lib en GEEN 'use server'-bestand: elke export uit zo'n
// bestand is een publiek aanroepbaar endpoint. Deze functie doet zelf géén
// autorisatie (dat doen de twee aanroepers, elk op hun eigen manier) en mag dus
// nooit rechtstreeks vanaf de client bereikbaar zijn. RLS is hier de tweede
// laag: elke delete raakt alleen rijen waar de aanroeper bij mag.

import type { SupabaseClient } from '@supabase/supabase-js'
import { genericError, logError } from '@/lib/errors'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'

// De teamdata van ÉÉN team, in FK-veilige volgorde. De lijst is bewust
// volledig en niet "de rest cascadet wel": categorie_metingen heeft alleen een
// team_id en geen FK naar events of players, dus de nulmetingen per onderdeel
// bleven vroeger als wees achter. RLS beperkt elke delete tot rijen waar deze
// gebruiker bij mag; het expliciete team_id-filter is de tweede laag.
//
// `oefeningen` staat hier BEWUST NIET in: oefeningen zijn persoonlijk bezit
// (oefeningen.team_id = de EIGENAAR-USER, geen teams.id, BR 54) en overleven
// het verdwijnen van een team. Alleen hun KOPPELINGEN aan dit team
// (training_oefeningen) gaan mee.
//
// supabase/team-rls-verificatie.sql (blok 22) draait dezelfde lijst als echte
// deletes onder de rol van een hoofdtrainer; een structuurtest in
// assistent-fase1-fundament.acceptance.test.ts houdt die twee gelijk.
export const TEAM_TABELLEN = [
  'training_oefeningen',
  'task_overrides',
  'match_squad',
  'match_events',
  'match_ratings',
  'lineups',
  'attendance',
  'absence_periods',
  'categorie_metingen',
  'metingen',
  'events',
  'players',
  'settings',
] as const

// Wist alles van één team: het clublogo in Storage, de dertien teamtabellen en
// tot slot de teams-rij zelf.
//
// `logLabel` is het contextlabel voor de log (bijv. `auth.deleteAccount.team1`
// of `team.deleteTeam`). Er komt NOOIT een team-id in: dat is een
// tenant-sleutel en hoort niet in een log.
//
// Elke fout in een tabel of in de teams-rij gooit en stopt de rest, met een
// generieke melding naar de client. Dat is met opzet: een gedeeltelijke
// mislukking mag niet stil blijven, en de aanroeper kan het opnieuw proberen —
// alle stappen zijn idempotent (een delete op een al lege tabel is geen fout).
// Het label per stap maakt terug te vinden waar het stukging.
export async function ruimTeamOp(
  supabase: SupabaseClient,
  teamId: string,
  logLabel: string,
): Promise<void> {
  // Het clublogo staat in Storage en hangt dus aan geen enkele tabel; zonder
  // deze stap zou het bestand blijven bestaan (AVG). Bucket en pad komen uit
  // lib/logo-upload.ts — dezelfde bron als app/actions/team-logo.ts, zodat een
  // wijziging van de padconventie deze opruiming niet stil kan laten missen.
  // Bewust logError en géén throw: een ontbrekend object — een team dat nooit
  // een logo uploadde — mag de verwijdering niet blokkeren.
  const { error: storageError } = await supabase.storage
    .from(TEAM_LOGO_BUCKET)
    .remove([teamLogoPath(teamId)])
  if (storageError) logError(`${logLabel}.storage`, storageError)

  for (const table of TEAM_TABELLEN) {
    const { error } = await supabase.from(table).delete().eq('team_id', teamId)
    if (error) throw genericError(`${logLabel}.${table}`, error)
  }

  // Als laatste het team zelf: de cascade op team_members en team_invites
  // ruimt de lidmaatschappen op, inclusief die van eventuele assistenten. Hun
  // accounts blijven bestaan (AC 14). Sinds M5c
  // (supabase/team-fk-naar-teams.sql) neemt deze delete óók players, events,
  // attendance, lineups en settings mee via hun FK naar teams — dat overlapt
  // met de lus hierboven en is onschadelijk, want die heeft er dan al niets
  // meer in staan.
  //
  // RLS: "teams: owner mag wissen" (is_team_owner(id)). Die policy leest
  // team_members, en die rij bestaat op dit moment nog — de cascade loopt pas
  // ná het goedkeuren van de delete.
  const { error: teamError } = await supabase.from('teams').delete().eq('id', teamId)
  if (teamError) throw genericError(`${logLabel}.teams`, teamError)
}

// Welk team is actief nadat de gebruiker `weggevallenId` kwijt is (verwijderd
// of verlaten)? AC 17/53:
//   * was het weggevallen team NIET het actieve, dan blijft het actieve team
//     gewoon actief;
//   * was het wél het actieve, dan wordt het het eerstvolgende team in de
//     lijst — die is al alfabetisch op naam gesorteerd (met het id als
//     tiebreak) door getTeamContext;
//   * blijft er niets over: null (de lege staat, AC 16).
//
// Puur en synchroon: de lijst komt uit de teamcontext van deze request, die
// het weggevallen team nog bevat.
export function actiefTeamNaVerlies(
  teams: readonly { teamId: string }[],
  weggevallenId: string,
  actiefId: string,
): string | null {
  if (actiefId !== weggevallenId && teams.some((team) => team.teamId === actiefId)) {
    return actiefId
  }
  return teams.find((team) => team.teamId !== weggevallenId)?.teamId ?? null
}
