// "Opstelling vorige wedstrijd overnemen" op /events/[id]/lineup. Pure module,
// bewust géén 'use server' en géén Supabase-import: de lineup-pagina haalt de
// kandidaat-wedstrijden en hun lineups-rijen teamgefilterd op, deze functie
// kiest de bron en bouwt de over te nemen posities. Het type VorigeOpstelling
// wordt ook door LineupBuilder (client) gebruikt; importeer het hier vandaan,
// nooit via een 'use server'-bestand.
//
// Overnemen gebeurt alleen in de clientstate. Opslaan gaat via de bestaande
// saveLineup, die elke player_id opnieuw tegen het eigen team valideert — deze
// module is dus filtering voor de weergave, niet de beveiligingsgrens.

import { FORMATIONS, type LineupPosition } from '@/lib/types'

export type VorigeOpstelling =
  | {
      beschikbaar: true
      bronEventId: string
      bronDatum: string        // 'YYYY-MM-DD'
      formation: string
      positions: LineupPosition[]
      leegGelaten: number      // slots die in de bron een speler hadden maar nu leeg blijven
    }
  | { beschikbaar: false; reden: 'geen' | 'onleesbaar' | 'fout' }

export interface VorigeOpstellingInvoer {
  // Nieuwste eerst; al gefilterd op eerdere, gespeelde wedstrijden van het team.
  kandidaten: { id: string; date: string }[]
  lineupRijen: { event_id: unknown; formation: unknown; positions: unknown }[]
  // Wie nu op het veld mag: actief, in de bank-set en niet afwezig/geblesseerd.
  beschikbareSpelerIds: ReadonlySet<string>
}

function spelerIdVan(positie: unknown): string | null {
  if (typeof positie !== 'object' || positie === null) return null
  const id = (positie as { player_id?: unknown }).player_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// Kiest de eerste kandidaat (in volgorde) met een lineups-rij en neemt die
// over. Rijen voor een event buiten `kandidaten` worden genegeerd (een rij van
// een ander team kan zo nooit de bron worden). Is de bron onleesbaar, dan is
// het resultaat 'onleesbaar' — bewust GEEN terugval op een oudere wedstrijd:
// de trainer zou dan stil een andere opstelling krijgen dan hij verwacht.
// Gooit nooit.
export function bepaalVorigeOpstelling(invoer: VorigeOpstellingInvoer): VorigeOpstelling {
  const rijPerEvent = new Map<string, { formation: unknown; positions: unknown }>()
  for (const rij of Array.isArray(invoer.lineupRijen) ? invoer.lineupRijen : []) {
    if (!rij || typeof rij !== 'object' || typeof rij.event_id !== 'string') continue
    if (!rijPerEvent.has(rij.event_id)) rijPerEvent.set(rij.event_id, rij)
  }

  const bron = (Array.isArray(invoer.kandidaten) ? invoer.kandidaten : [])
    .find((k) => rijPerEvent.has(k.id))
  if (!bron) return { beschikbaar: false, reden: 'geen' }

  const rij = rijPerEvent.get(bron.id)!
  const { formation, positions } = rij
  if (typeof formation !== 'string' || !Object.hasOwn(FORMATIONS, formation) || !Array.isArray(positions)) {
    return { beschikbaar: false, reden: 'onleesbaar' }
  }
  const basis = FORMATIONS[formation]?.positions
  if (!Array.isArray(basis)) return { beschikbaar: false, reden: 'onleesbaar' }

  const geplaatst = new Set<string>()
  let leegGelaten = 0
  const nieuw: LineupPosition[] = basis.map((slot, i) => {
    const id = spelerIdVan(positions[i])
    let player_id: string | null = null
    if (id !== null) {
      if (invoer.beschikbareSpelerIds.has(id) && !geplaatst.has(id)) {
        player_id = id
        geplaatst.add(id)
      } else {
        leegGelaten++
      }
    }
    return { ...slot, player_id }
  })

  return {
    beschikbaar: true,
    bronEventId: bron.id,
    bronDatum: bron.date,
    formation,
    positions: nieuw,
    leegGelaten,
  }
}
