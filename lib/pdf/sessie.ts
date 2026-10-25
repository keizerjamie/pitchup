// Sessie-voorbereiding voor de headless PDF-render (GET /api/pdf).
//
// HET PROBLEEM: Chromium opent de pagina met de cookies van de gebruiker. Komt
// die navigatie langs proxy.ts terwijl het access-token bijna verlopen is, dan
// ververst de proxy de sessie IN CHROMIUM — en krijgt alleen Chromium het
// nieuwe (geroteerde) refresh-token. De browser van de gebruiker houdt het
// oude, inmiddels gebruikte token over en kan bij de volgende verversing
// uitgelogd raken.
//
// supabase-js ververst zodra er minder dan EXPIRY_MARGIN_MS (90 s,
// @supabase/auth-js lib/constants.js) over is. De proxy doet dat al vlak vóór
// deze route; maar had het token bij binnenkomst bijv. 100 s over, dan zakt
// het tijdens een render van (cold start) tientallen seconden alsnog onder die
// grens. Daarom ververst de route zelf zodra er minder dan
// MIN_RESTERENDE_SESSIE_S over is. Die verversing loopt via de cookie-store
// van de route: Next zet ze als Set-Cookie op het antwoord aan de gebruiker
// (app-route module, appendMutableCookies), én `cookies().getAll()` geeft
// daarna de nieuwe waarden — dus Chromium en de gebruiker houden hetzelfde,
// verse token.

import type { SupabaseClient } from '@supabase/supabase-js'

// 90 s verversmarge van supabase-js + 60 s render-budget (maxDuration van de
// route). Met een vers token (standaard 1 uur geldig) wordt hier nooit
// ververst; alleen in het smalle venster vlak voor het verlopen.
export const MIN_RESTERENDE_SESSIE_S = 150

// true = er is een sessie die de hele render meegaat (eventueel net
// ververst). false = geen bruikbare sessie (de route antwoordt dan 401).
export async function zorgVoorRuimeSessie(supabase: SupabaseClient, nuMs: number = Date.now()): Promise<boolean> {
  // getSession leest alleen de cookie (geen autorisatie — die deed
  // requireTeamContext met getUser al); hier gaat het enkel om expires_at.
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) return false

  const verlooptOp = data.session.expires_at
  if (typeof verlooptOp !== 'number') return true
  if (verlooptOp * 1000 - nuMs >= MIN_RESTERENDE_SESSIE_S * 1000) return true

  const { data: ververst, error: ververstFout } = await supabase.auth.refreshSession()
  return !ververstFout && ververst.session !== null
}

// Cookies voor Chromium: een cookie die in deze request verwijderd is
// (bijv. een overbodig geworden sessie-chunk `sb-…-auth-token.1`) staat in de
// cookie-store nog als lege waarde; die mag niet mee, anders plakt de server
// in Chromium een lege chunk aan het token.
export function cookiesVoorRender(alle: readonly { name: string; value: string }[]): { name: string; value: string }[] {
  return alle.filter((cookie) => cookie.value !== '').map(({ name, value }) => ({ name, value }))
}
