// Pure logica voor "kopieer de oefeningen van een vorige training".
//
// Bewust los van de server action (zelfde scheiding als lib/parallel-groep.ts):
// het remappen van parallelle groepen en het doorschuiven van de volgorde is
// precies het soort rekenwerk dat je wilt kunnen testen zonder database.

// De velden die uit de bron worden overgenomen. Alleen de SAMENSTELLING van
// het plan — welke oefeningen, in welke volgorde, welke daarvan parallel
// draaien, en een eventuele handmatige stap.
export interface BronKoppeling {
  oefening_id: string
  volgorde: number
  stap_override: number | null
  parallel_groep_id?: string | null
}

export interface NieuweKoppeling {
  oefening_id: string
  volgorde: number
  stap_override: number | null
  parallel_groep_id: string | null
}

// Zet de koppelingen van de bron om naar rijen voor de doeltraining.
//
// BEWUST NIET GEKOPIEERD: `spelerindeling` en `parallel_spelers`. Dat zijn
// toewijzingen van individuele spelers, en bij een andere training staat er een
// andere groep op het veld. Een overgenomen indeling zou verwijzen naar spelers
// die er niet zijn — dat leest als een fout en kost meer tijd om op te ruimen
// dan om opnieuw te maken. Er wordt dus het PLAN gekopieerd, niet de opstelling.
//
// `volgordeOffset` schuift alles achter wat er al staat, zodat kopiëren nooit
// bestaande oefeningen overschrijft of ertussen valt.
//
// `nieuweGroepId` wordt per parallelle groep uit de bron één keer aangeroepen.
// Groep-id's worden opnieuw uitgedeeld en niet overgenomen: ze horen bij één
// training, en hergebruik zou twee trainingen aan elkaar knopen zodra er ooit
// iets over meerdere events tegelijk gequeryd wordt.
export function kopieerKoppelingen(
  bron: BronKoppeling[],
  volgordeOffset: number,
  nieuweGroepId: () => string,
): NieuweKoppeling[] {
  const groepMap = new Map<string, string>()

  // De bron-volgorde kan gaten hebben (bv. na verwijderen) en parallelle leden
  // DELEN een volgorde. Beide moeten blijven kloppen, dus de originele waarde
  // wordt behouden en alleen verschoven — niet hernummerd.
  return bron.map((rij) => {
    const bronGroep = rij.parallel_groep_id ?? null
    let groep: string | null = null
    if (bronGroep) {
      const bestaand = groepMap.get(bronGroep)
      if (bestaand) {
        groep = bestaand
      } else {
        groep = nieuweGroepId()
        groepMap.set(bronGroep, groep)
      }
    }
    return {
      oefening_id: rij.oefening_id,
      volgorde: rij.volgorde + volgordeOffset,
      stap_override: rij.stap_override,
      parallel_groep_id: groep,
    }
  })
}
