// Rollen en bewerkingsrechten binnen een team.
//
// Puur en dependency-vrij (geen 'use server', geen React, geen Supabase), zodat
// zowel server actions, server components als client components hier types en
// constanten uit kunnen halen. Een 'use server'-bestand mag alleen async
// functies exporteren — types en constanten horen dus hier, niet in
// app/actions/team*.ts (zie geheugen.md, "Belangrijke gotchas").
//
// De zes onderdelen zijn hetzelfde zestal als de zes boolean-kolommen op
// team_members (supabase/teams-en-leden.sql) en de `case`-takken van de
// SQL-functie can_edit(). Komt er ooit een zevende bij, dan moeten die drie
// plekken samen mee.

export const ONDERDELEN = [
  'spelers',
  'agenda',
  'aanwezigheid',
  'wedstrijd',
  'training',
  'periodisering',
] as const

export type Onderdeel = (typeof ONDERDELEN)[number]

export type TeamRol = 'owner' | 'assistent'

export type TeamRechten = Record<Onderdeel, boolean>

// De kolomnaam per onderdeel. Eén bron voor zowel het lezen van een
// team_members-rij als het schrijven ervan, zodat lees- en schrijfkant niet uit
// elkaar kunnen lopen.
export const RECHT_KOLOM: Record<Onderdeel, string> = {
  spelers: 'mag_spelers_bewerken',
  agenda: 'mag_agenda_bewerken',
  aanwezigheid: 'mag_aanwezigheid_bewerken',
  wedstrijd: 'mag_wedstrijd_bewerken',
  training: 'mag_training_bewerken',
  periodisering: 'mag_periodisering_bewerken',
}

function rechtenMet(waarde: boolean): TeamRechten {
  return {
    spelers: waarde,
    agenda: waarde,
    aanwezigheid: waarde,
    wedstrijd: waarde,
    training: waarde,
    periodisering: waarde,
  }
}

// Bevroren, zodat een aanroeper er niet per ongeluk in schrijft en daarmee de
// rechten van élke volgende aanroep in hetzelfde proces wijzigt.
export const GEEN_RECHTEN: TeamRechten = Object.freeze(rechtenMet(false))
export const ALLE_RECHTEN: TeamRechten = Object.freeze(rechtenMet(true))

// De vorm van een team_members-rij zoals hij uit de database komt. Bewust
// `unknown` per kolom: de Supabase-client is ongetypeerd, dus alles wat geen
// echte `true` is telt hieronder als "geen recht".
export type TeamMemberRij = Record<string, unknown>

export function rechtenUitRij(rij: TeamMemberRij): TeamRechten {
  const rechten = rechtenMet(false)
  for (const onderdeel of ONDERDELEN) {
    rechten[onderdeel] = rij[RECHT_KOLOM[onderdeel]] === true
  }
  return rechten
}

// Andersom: van rechten naar de zes kolommen voor een insert/update.
export function rechtenNaarKolommen(rechten: TeamRechten): Record<string, boolean> {
  const kolommen: Record<string, boolean> = {}
  for (const onderdeel of ONDERDELEN) {
    kolommen[RECHT_KOLOM[onderdeel]] = rechten[onderdeel] === true
  }
  return kolommen
}

export function isOnderdeel(waarde: unknown): waarde is Onderdeel {
  return typeof waarde === 'string' && (ONDERDELEN as readonly string[]).includes(waarde)
}
