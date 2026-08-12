'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE, logError } from '@/lib/errors'
import { CLUB_COLOR_KEYS, isClubColorSlot, normalizeHexColor } from '@/lib/club-colors'

// Clubkleuren leven als twee rijen in de bestaande settings-tabel
// (team_color_primary / team_color_secondary). Keys, validatie en fallback staan
// in lib/club-colors.ts, zodat de leeskant (server-components) en deze
// schrijfkant niet uit elkaar kunnen lopen — een 'use server'-bestand mag alleen
// async functies exporteren, dus die constanten kunnen hier niet wonen.
//
// Beide actions geven { error } terug in plaats van te throwen: ze worden vanuit
// het formulier op /settings aangeroepen, waar de melding naast het veld hoort
// te verschijnen. Zelfde contract als app/actions/team-logo.ts.

const NOT_LOGGED_IN = 'Je bent niet (meer) ingelogd. Log opnieuw in en probeer het nogmaals.'
const UNKNOWN_SLOT = 'Onbekende kleurinstelling.'
const INVALID_COLOR = 'Gebruik een geldige hexadecimale kleurcode, bijvoorbeeld #1a4f8b.'

export async function saveTeamColor(
  slot: string,
  value: string,
): Promise<{ error: string | null; value?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_LOGGED_IN }

  // Whitelist vóór alles: zonder deze check zou een client via `slot` elke
  // andere settings-key van zijn team kunnen overschrijven.
  if (!isClubColorSlot(slot)) return { error: UNKNOWN_SLOT }

  const color = normalizeHexColor(value)
  if (!color) return { error: INVALID_COLOR }

  // team_id komt uit de sessie, nooit uit client-invoer. De RLS op settings
  // (team_id = auth.uid()) is het tweede vangnet, niet het enige.
  const { error } = await supabase
    .from('settings')
    .upsert(
      { team_id: user.id, key: CLUB_COLOR_KEYS[slot], value: color },
      { onConflict: 'team_id,key' },
    )

  if (error) {
    logError('team-colors.saveTeamColor', error)
    return { error: GENERIC_ERROR_MESSAGE }
  }

  // Alleen /settings: clubkleuren zitten niet in de layout (anders dan het
  // clublogo), dus een layout-brede revalidatie is hier niet nodig.
  revalidatePath('/settings')
  // De genormaliseerde waarde terug, niet de ruwe invoer: het formulier toont
  // daarmee exact wat er is opgeslagen ('ABC' → '#aabbcc').
  return { error: null, value: color }
}

export async function resetTeamColor(slot: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NOT_LOGGED_IN }

  if (!isClubColorSlot(slot)) return { error: UNKNOWN_SLOT }

  // Resetten = de rij weghalen; afwezigheid ís "niet ingesteld". We schrijven
  // bewust geen lege string (settings.value is NOT NULL). Beide filters zijn
  // verplicht: zonder .eq('key', ...) zou dit álle settings van het team wissen.
  const { error } = await supabase
    .from('settings')
    .delete()
    .eq('team_id', user.id)
    .eq('key', CLUB_COLOR_KEYS[slot])

  // Anders dan bij deleteTeamLogo slikken we deze fout niet: daar was het
  // bestand al weg en zou een melding tot een zinloze tweede poging leiden. Hier
  // is de rij de enige resource — mislukt de delete, dan staat de oude kleur er
  // nog en zou "gelukt" melden liegen.
  if (error) {
    logError('team-colors.resetTeamColor', error)
    return { error: GENERIC_ERROR_MESSAGE }
  }

  revalidatePath('/settings')
  return { error: null }
}
