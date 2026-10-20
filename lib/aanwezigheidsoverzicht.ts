// Pure helpers voor het aanwezigheidsoverzicht op /players
// (?weergave=aanwezigheid). Bewust géén 'use server', géén Supabase en géén
// klok: de page haalt de RPC-rijen op (aanwezigheidsoverzicht_per_speler,
// supabase/aanwezigheidsoverzicht.sql) en bepaalt het venster met
// periodeVenster/verledenSeizoensVenster (lib/inzichten.ts); dit bestand
// voegt alleen samen, rekent percentages en formatteert. Scherm en afdruk
// gebruiken dezelfde uitkomst van bouwAanwezigheidsoverzicht, zodat ze nooit
// uit de pas lopen.

import { berekenAanwezigheidPercentage } from '@/lib/inzichten'
import type { Player } from '@/lib/types'

// ── URL-parameter `weergave` ──────────────────────────────────────────
export const WEERGAVES = ['lijst', 'aanwezigheid'] as const
export type Weergave = (typeof WEERGAVES)[number]
export const WEERGAVE_STANDAARD: Weergave = 'lijst'

export function isWeergave(w: unknown): w is Weergave {
  return typeof w === 'string' && (WEERGAVES as readonly string[]).includes(w)
}

// ── Samenvoegen en rekenen ────────────────────────────────────────────

// Eén rij zoals de RPC hem teruggeeft. 'unknown' telt in geen van de drie.
export interface OverzichtRpcRij {
  player_id: string
  naam: string
  aanwezig: number
  afwezig: number      // UITSLUITEND 'absent'
  geblesseerd: number  // UITSLUITEND 'injured'
}

export interface OverzichtRij {
  playerId: string
  naam: string
  aanwezig: number
  afwezig: number
  geblesseerd: number
  // aanwezig / (aanwezig + afwezig + geblesseerd). Per constructie gelijk aan
  // het per-spelerpercentage op /inzichten (daar is afwezig = absent + injured).
  pctIncl: number | null
  // aanwezig / (aanwezig + afwezig): blessures buiten beschouwing.
  pctZonder: number | null
}

// Alle actieve VASTE spelers, ook zonder één registratie (0/0/0), alfabetisch
// op naam met het id als tie-break. Gasten en inactieve spelers vallen weg —
// dezelfde filters als de RPC (p.active, p.type = 'regular'). De naam komt uit
// de spelerslijst, niet uit de RPC, zodat ook spelers zonder RPC-rij een naam
// hebben. Muteert de invoer niet.
export function bouwAanwezigheidsoverzicht(
  spelers: Pick<Player, 'id' | 'name' | 'active' | 'type'>[],
  rpcRijen: OverzichtRpcRij[],
  locale: string,
): OverzichtRij[] {
  const perSpeler = new Map<string, OverzichtRpcRij>()
  for (const rij of rpcRijen) perSpeler.set(rij.player_id, rij)

  return spelers
    .filter((s) => s.active && s.type === 'regular')
    .map((s) => {
      const rij = perSpeler.get(s.id)
      const aanwezig = rij?.aanwezig ?? 0
      const afwezig = rij?.afwezig ?? 0
      const geblesseerd = rij?.geblesseerd ?? 0
      return {
        playerId: s.id,
        naam: s.name,
        aanwezig,
        afwezig,
        geblesseerd,
        // Eén afronding en één null-bij-noemer-0 voor de hele app.
        pctIncl: berekenAanwezigheidPercentage(aanwezig, afwezig + geblesseerd),
        pctZonder: berekenAanwezigheidPercentage(aanwezig, afwezig),
      }
    })
    .sort((a, b) => {
      const opNaam = a.naam.localeCompare(b.naam, locale)
      if (opNaam !== 0) return opNaam
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
    })
}

// Is er iets te tonen? Nee bij geen spelers, of als niemand in het venster één
// aanwezig/afwezig/geblesseerd-registratie heeft. De page toont dan de lege
// staat, zonder printknop en zonder printblok.
export function heeftOverzichtData(rijen: OverzichtRij[]): boolean {
  return rijen.some((r) => r.aanwezig + r.afwezig + r.geblesseerd > 0)
}

// null -> '—' (geen percentage, nooit 0%), anders `${p}%`.
export function formatPercentage(p: number | null): string {
  return p === null ? '—' : `${p}%`
}
