// Begrenzing van het aantal gelijktijdige PDF-renders per server-instance.
//
// Elke render start een eigen Chromium (honderden MB geheugen, seconden CPU).
// Zonder grens kan één gebruiker met een paar parallelle requests de instance
// laten vastlopen of de functiekosten opdrijven. Besluit van Jamie
// (2026-10-25): maximaal 2 tegelijk, in-memory, géén nieuwe infra; daarboven
// weigert de route met 429.
//
// BEWUST in-memory, anders dan lib/rate-limit.ts (die in de database telt):
// dit is geen beveiligingsgrens tegen een aanvaller die over instances
// spreidt, maar een bescherming van de instance zélf tegen te veel Chromiums
// naast elkaar. Precies dat is per instance — een teller in de database zou
// het verkeerde meten.

export const MAX_GELIJKTIJDIGE_RENDERS = 2

export type SlotTeller = {
  // Geeft een vrijgeef-functie terug als er plek is, anders null. De
  // vrijgeef-functie is idempotent: twee keer aanroepen geeft maar één plek
  // vrij, zodat een dubbele `finally` de teller nooit onder nul duwt.
  probeer(): (() => void) | null
  actief(): number
}

export function maakSlotTeller(max: number): SlotTeller {
  let actief = 0
  return {
    probeer() {
      if (actief >= max) return null
      actief++
      let vrijgegeven = false
      return () => {
        if (vrijgegeven) return
        vrijgegeven = true
        actief--
      }
    },
    actief: () => actief,
  }
}

// Eén teller per Node-proces (= per server-instance). Synchroon gecontroleerd
// en opgehoogd, dus binnen één proces kunnen twee requests niet allebei de
// laatste plek pakken.
export const renderSlots: SlotTeller = maakSlotTeller(MAX_GELIJKTIJDIGE_RENDERS)
