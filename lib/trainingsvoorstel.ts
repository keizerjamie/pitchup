import { dueCategories } from '@/lib/periodization'
import { berekenDuurUitStap, clampStapOverride } from '@/lib/periodization-stappen'
import { clampDuurMin, STANDAARD_SESSIEDUUR_MIN } from '@/lib/sessie-tijdlijn'
import { EMPTY_OEFENING_FILTERS, matchesOefeningFilters } from '@/lib/oefening-filter'
import { sorteerOpPassendheid } from '@/lib/oefening-bezetting'
import type { Oefening, OefeningCategorie } from '@/lib/types'

// ────────────────────────────────────────────────
// Trainingsvoorstel in één tik
// ────────────────────────────────────────────────
// Pure logica (geen React, geen Supabase), zodat het algoritme los te testen is
// en de server action stelTrainingVoor (app/actions/training-plan.ts) alleen
// nog leest, aanroept en wegschrijft. De types staan hier en niet in de action:
// een 'use server'-bestand mag alleen async functies exporteren.

// Foutcodes die de action als `{ ok: false }` teruggeeft. De client vertaalt
// elke code (trainingPlan.voorstelFout.<code>); een ruwe foutmelding gaat nooit
// naar de client.
export type TrainingsvoorstelFoutcode =
  | 'teamtactisch'
  | 'plan_niet_leeg'
  | 'geen_cyclusweek'
  | 'lege_bibliotheek'
  | 'niets_passend'

export type TrainingsvoorstelResultaat =
  | { ok: true; aantal: number; overgeslagen: OefeningCategorie[] }
  | { ok: false; error: TrainingsvoorstelFoutcode }

export interface VoorstelInput {
  cycleWeek: number
  // Uit getTrainingLog (lib/periodization.ts): de actuele, NIET geclampte stap
  // per categorie, of null zonder (actuele) meting.
  currentSteps: Record<string, number | null>
  library: Oefening[]
  // Aantal spelers met status 'present'. 0 = geen voorkeur op speleraantal.
  aanwezigen: number
  // Duurbudget in minuten; standaard STANDAARD_SESSIEDUUR_MIN (90).
  maxDuurMin?: number
}

export interface VoorstelBlok {
  oefeningId: string
  categorie: OefeningCategorie
  // Altijd null (besluit V-A): het voorstel zet geen handmatige stap vast, zodat
  // het blok de periodisering blijft volgen zonder "(handmatig)"-label.
  stapOverride: null
  // De (geclampte) periodiseringsstap waarop de duur is berekend. Alleen
  // informatief — wordt NIET opgeslagen.
  stap: number | null
  // De training-specifieke duur die de koppeling krijgt; null = geen duur.
  duurMin: number | null
}

export type VoorstelUitkomst =
  | { ok: true; blokken: VoorstelBlok[]; overgeslagen: OefeningCategorie[] }
  | { ok: false; error: 'lege_bibliotheek' | 'niets_passend' }

// Code-point-vergelijking (geen localeCompare): de uitkomst mag niet van de
// locale van de server afhangen.
function vergelijkNaamDanId(a: Oefening, b: Oefening): number {
  if (a.naam < b.naam) return -1
  if (a.naam > b.naam) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

// Stelt per categorie die deze cyclusweek aan de beurt is (dueCategories, in de
// volgorde van PERIODIZATION_CATEGORIES) één oefening uit de bibliotheek voor.
//
// Keuze binnen een categorie, deterministisch:
// 1. alfabetisch op naam, dan op id (zodat de invoervolgorde er niet toe doet);
// 2. bij aanwezigen > 0 eerst de oefeningen waarvan het spelersbereik het aantal
//    aanwezigen bevat (stabiele partitie — een voorkeur, geen eis);
// 3. binnen elke partitie exacte oefeningen vóór flexibele (sorteerOpPassendheid);
// 4. de eerste kandidaat die nog binnen het duurbudget past. Past er geen, dan
//    komt de categorie in `overgeslagen`.
//
// Duur = berekenDuurUitStap(categorie, stap) ?? clampDuurMin(oefening.duur_min),
// exact zoals updateKoppeling de duur bij een stapkeuze herberekent. Een duur van
// null of 0 telt als 0 in het budget en sluit de oefening niet uit.
//
// Muteert de invoer niet.
export function maakTrainingsvoorstel(input: VoorstelInput): VoorstelUitkomst {
  if (input.library.length === 0) return { ok: false, error: 'lege_bibliotheek' }

  const budget = input.maxDuurMin ?? STANDAARD_SESSIEDUUR_MIN
  const blokken: VoorstelBlok[] = []
  const overgeslagen: OefeningCategorie[] = []
  // Vangnet: dezelfde bibliotheek-oefening nooit twee keer voorstellen.
  const gekozen = new Set<string>()
  let gebruikt = 0

  for (const cat of dueCategories(input.cycleWeek)) {
    const ruweStap = input.currentSteps[cat.key]
    const stap = ruweStap === null || ruweStap === undefined ? null : clampStapOverride(ruweStap, cat.key)
    const duurVan = (o: Oefening) => berekenDuurUitStap(cat.key, stap) ?? clampDuurMin(o.duur_min)

    const opNaam = input.library
      .filter((o) => o.categorie === cat.key && !gekozen.has(o.id))
      .sort(vergelijkNaamDanId)

    let kandidaten: Oefening[]
    if (input.aanwezigen > 0) {
      const filter = { ...EMPTY_OEFENING_FILTERS, bevatAantal: input.aanwezigen }
      const passend = opNaam.filter((o) => matchesOefeningFilters(o, filter))
      const rest = opNaam.filter((o) => !matchesOefeningFilters(o, filter))
      kandidaten = [...sorteerOpPassendheid(passend), ...sorteerOpPassendheid(rest)]
    } else {
      kandidaten = sorteerOpPassendheid(opNaam)
    }

    const keuze = kandidaten.find((o) => (duurVan(o) ?? 0) <= budget - gebruikt)
    if (!keuze) {
      overgeslagen.push(cat.key)
      continue
    }

    const duurMin = duurVan(keuze)
    gebruikt += duurMin ?? 0
    gekozen.add(keuze.id)
    blokken.push({ oefeningId: keuze.id, categorie: cat.key, stapOverride: null, stap, duurMin })
  }

  if (blokken.length === 0) return { ok: false, error: 'niets_passend' }
  return { ok: true, blokken, overgeslagen }
}
