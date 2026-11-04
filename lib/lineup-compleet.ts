// Wanneer is een opstelling "gemaakt"? Pure regel, bewust géén 'use server' en
// géén Supabase-afhankelijkheid: het dashboard (To-do), de eventdetailpagina
// (ActionCard) en de server action saveLineup gebruiken dezelfde telling, en
// het type SaveLineupResultaat mag niet in een 'use server'-bestand staan (dat
// mag alleen async functies exporteren, zie geheugen.md).
//
// Vroeger gold het bestaan van een lineups-rij als "gemaakt". Maar saveLineup
// slaat ook een opstelling met lege posities op (player_id null), dus een
// half ingevulde opstelling vinkte de taak al af. Nu telt een opstelling pas
// als compleet wanneer ELKE positie van de formatie een (unieke) speler heeft.

import { FORMATIONS } from '@/lib/types'

export interface OpstellingTelling {
  totaal: number | null  // aantal posities van de formatie; null = onbekende formatie/kapotte vorm
  leeg: number | null    // posities zonder (unieke) speler; null = niet te bepalen
  compleet: boolean
}

// Wat saveLineup teruggeeft aan de LineupBuilder. Hier en niet in
// app/actions/attendance.ts: een 'use server'-bestand mag geen types/consts
// exporteren die de client los importeert zonder dat het een action wordt.
export interface SaveLineupResultaat {
  legePosities: number | null          // null = onbekende formatie
  selectieAutomatischGevuld: boolean
  selectieFout: boolean                // lineup wél opgeslagen, auto-vullen mislukt
}

const ONBEKEND: OpstellingTelling = { totaal: null, leeg: null, compleet: false }

function spelerIdVan(positie: unknown): string | null {
  if (typeof positie !== 'object' || positie === null) return null
  const id = (positie as { player_id?: unknown }).player_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// Telt de opstelling. `formation` en `positions` komen rechtstreeks uit de
// database (JSONB) of uit de client, dus beide zijn `unknown`: deze functie
// gooit nooit, ook niet bij een kapotte vorm — die levert gewoon ONBEKEND op
// (niet compleet, de taak blijft open).
//
// Het totaal komt uit FORMATIONS (lib/types.ts), niet uit een vaste 11: een
// formatie bepaalt zelf hoeveel posities ze heeft. Alleen de eerste `totaal`
// posities tellen; een speler die twee keer is opgesteld telt één keer, zodat
// "elf vakjes gevuld met tien spelers" niet als compleet geldt.
export function telOpstelling(formation: unknown, positions: unknown): OpstellingTelling {
  if (typeof formation !== 'string' || !Object.hasOwn(FORMATIONS, formation)) return ONBEKEND
  if (!Array.isArray(positions)) return ONBEKEND
  const formatie = FORMATIONS[formation]
  if (!formatie || !Array.isArray(formatie.positions)) return ONBEKEND

  const totaal = formatie.positions.length
  const uniek = new Set<string>()
  for (const positie of positions.slice(0, totaal)) {
    const id = spelerIdVan(positie)
    if (id !== null) uniek.add(id)
  }
  const gevuld = uniek.size
  const leeg = totaal - gevuld

  return {
    totaal,
    leeg,
    compleet: positions.length === totaal && gevuld === totaal,
  }
}
