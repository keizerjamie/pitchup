import { isUuid } from '@/lib/authz'
import type { OefeningTeam, ParallelSpelers, TrainingOefeningWithData } from '@/lib/types'

// Gedeelde, framework-agnostische logica voor PARALLELLE oefeningen binnen één
// training: oefeningen die naast elkaar draaien en samen één blok in het
// trainingsplan vormen. Bewust géén 'use server', net als lib/spelerindeling.ts:
// zowel de server actions (app/actions/training-plan.ts) als de client gebruiken
// deze pure functies, en ze zijn los testbaar.
//
// Datamodel (supabase/parallelle-oefeningen.sql):
// - `parallel_groep_id` — vrije groepssleutel op training_oefeningen. Gelijke
//   waarde binnen hetzelfde event = zelfde parallelle groep; NULL = gewone
//   sequentiële koppeling. Alle leden van een groep delen dezelfde `volgorde`.
// - `parallel_spelers` — platte string[] met de player_id's die aan DEZE
//   oefening binnen de groep zijn toegewezen. Staat volledig los van
//   `spelerindeling` (string[][]), de teamindeling BINNEN een oefening.

// ────────────────────────────────────────────────
// Blokken (weergave-eenheid)
// ────────────────────────────────────────────────

// Eén blok in het trainingsplan: óf één losse koppeling, óf een parallelle
// groep met meerdere leden.
//
// Generiek in het ledentype, met TrainingOefeningWithData als default: zo
// blijven afgeleide velden die de leesgrens toevoegt (bv. `bezetting`,
// TrainingOefeningMetBezetting in lib/oefening-bezetting.ts) behouden in plaats
// van uit het type te vallen. Bestaande aanroepen wijzigen niet.
export interface ParallelBlok<T extends TrainingOefeningWithData = TrainingOefeningWithData> {
  // Stabiele React-key: 'g:<groepId>' voor een groep, 'k:<koppelingId>' voor een
  // losse koppeling.
  key: string
  groepId: string | null
  leden: T[]
}

// Groepssleutel van één rij. Een koppeling zonder groep vormt zijn eigen blok.
function blokSleutel(rij: { id: string; parallel_groep_id?: string | null }): string {
  return rij.parallel_groep_id ? `g:${rij.parallel_groep_id}` : `k:${rij.id}`
}

// Groepeert koppelingen tot blokken. Blokvolgorde = de volgorde waarin het
// eerste lid voorkomt (gesorteerd op volgorde, dan created_at, dan id); binnen
// een blok staan de leden in dezelfde deterministische volgorde.
//
// Defensief: een groep met minder dan 2 leden wordt als GEWOON blok
// teruggegeven (groepId: null). Dat dekt het weeskind dat kan ontstaan als een
// bibliotheek-oefening hard verwijderd wordt en de koppelrij via FK CASCADE
// verdwijnt zonder dat de groepsopruiming van de server actions langskomt.
export function blokkenVanKoppelingen<T extends TrainingOefeningWithData>(
  koppelingen: T[],
): ParallelBlok<T>[] {
  const gesorteerd = sorteerKoppelingen(koppelingen)

  const blokken: ParallelBlok<T>[] = []
  const perSleutel = new Map<string, ParallelBlok<T>>()

  for (const koppeling of gesorteerd) {
    const sleutel = blokSleutel(koppeling)
    const bestaand = perSleutel.get(sleutel)
    if (bestaand) {
      bestaand.leden.push(koppeling)
      continue
    }
    const blok: ParallelBlok<T> = {
      key: sleutel,
      groepId: koppeling.parallel_groep_id ?? null,
      leden: [koppeling],
    }
    perSleutel.set(sleutel, blok)
    blokken.push(blok)
  }

  // Groep met één overgebleven lid telt niet als parallelle groep.
  for (const blok of blokken) {
    if (blok.groepId !== null && blok.leden.length < 2) {
      blok.groepId = null
      blok.key = `k:${blok.leden[0].id}`
    }
  }

  return blokken
}

// Deterministische sortering: volgorde → created_at → id. Leden van één groep
// delen hun `volgorde`, dus created_at/id bepalen de volgorde binnen een blok.
function sorteerKoppelingen<T extends TrainingOefeningWithData>(koppelingen: T[]): T[] {
  return [...koppelingen].sort(
    (a, b) =>
      (a.volgorde ?? 0) - (b.volgorde ?? 0) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

// ────────────────────────────────────────────────
// Labels
// ────────────────────────────────────────────────

// Sub-letter van een lid binnen een parallelle groep: 0 → 'a' … 25 → 'z',
// 26 → 'aa', 27 → 'ab', … (bijectief base-26). Puur cosmetisch; groepen groter
// dan 26 komen in de praktijk niet voor, maar leveren zo nooit een lege letter.
export function subLetter(i: number): string {
  let n = Number.isFinite(i) && i > 0 ? Math.floor(i) : 0
  let out = ''
  for (;;) {
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
    if (n < 0) return out
  }
}

// Label van één oefening in het plan: "3" voor een los blok, "3a"/"3b"/… voor
// de leden van een parallelle groep. `blokIndex` is 0-based, het label 1-based.
export function blokLabel(blokIndex: number, aantalLeden: number, ledenIndex: number): string {
  const nummer = String(Math.max(0, Math.floor(blokIndex)) + 1)
  return aantalLeden > 1 ? `${nummer}${subLetter(ledenIndex)}` : nummer
}

// ────────────────────────────────────────────────
// Benodigd aantal spelers per oefening
// ────────────────────────────────────────────────

// Minimale vorm van een (bibliotheek-)oefening voor de bezettingsberekening.
export interface BenodigdAantalInput {
  teams?: OefeningTeam[] | null
  aantal_neutralen?: number | null
}

// Hoeveel spelers deze oefening nodig heeft: som van de teamgroottes plus de
// neutralen. `null` als dat niet te bepalen is — geen teams, of een team zonder
// geldige grootte (grootte <= 0 of niet-eindig; zo'n "los" team heeft bewust
// geen limiet, zie autoAssignTeams in lib/spelerindeling.ts). Bij `null` toont
// de UI geen tekort/overschot.
export function benodigdAantal(oefening: BenodigdAantalInput | null | undefined): number | null {
  const teams = Array.isArray(oefening?.teams) ? oefening.teams : []
  if (teams.length === 0) return null

  let som = 0
  for (const team of teams) {
    const grootte = team?.grootte
    if (typeof grootte !== 'number' || !Number.isFinite(grootte) || grootte <= 0) return null
    som += grootte
  }

  const neutralen = oefening?.aantal_neutralen
  if (typeof neutralen === 'number' && Number.isFinite(neutralen) && neutralen > 0) {
    som += Math.floor(neutralen)
  }
  return som
}

// ────────────────────────────────────────────────
// Validatie / normalisatie (server-side tenant-check)
// ────────────────────────────────────────────────

// Gooit een nette Error bij ongeldige input; retourneert anders de
// genormaliseerde platte lijst player_id's voor één lid van de groep.
// Vormcheck (isUuid) vóór de tenant-check, zodat er nooit ongecontroleerde
// vrije tekst in de JSONB-kolom belandt.
export function validateParallelSpelers(
  input: unknown,
  opts: { ownPlayerIds: Set<string> },
): ParallelSpelers {
  if (!Array.isArray(input)) throw new Error('Ongeldige indeling')

  const clean: string[] = []
  const seen = new Set<string>()

  for (const id of input) {
    if (!isUuid(id)) throw new Error('Ongeldige indeling')
    // Tenant-check: elk id moet een eigen speler zijn.
    if (!opts.ownPlayerIds.has(id)) throw new Error('Speler niet gevonden')
    // Binnen één oefening mag een speler maar één keer staan.
    if (seen.has(id)) throw new Error('Speler in meerdere oefeningen')
    seen.add(id)
    clean.push(id)
  }

  return clean
}

// Een speler kan niet tegelijk aan twee parallelle oefeningen meedoen: de
// verdeling van de andere leden van dezelfde groep mag niet overlappen.
export function assertGeenOverlap(
  clean: readonly string[],
  andereLedenSpelers: readonly (readonly string[] | null | undefined)[],
): void {
  const bezet = new Set<string>()
  for (const spelers of andereLedenSpelers) {
    if (!Array.isArray(spelers)) continue
    for (const id of spelers) if (typeof id === 'string') bezet.add(id)
  }
  for (const id of clean) {
    if (bezet.has(id)) throw new Error('Speler in meerdere oefeningen')
  }
}

// ────────────────────────────────────────────────
// Status van een parallelle groep (puur afgeleid, niets opgeslagen)
// ────────────────────────────────────────────────

export interface ParallelLidStatus {
  koppelingId: string
  toegewezen: number
  benodigd: number | null
  tekort: number
  overschot: number
}

export interface ParallelGroepStatus {
  perLid: ParallelLidStatus[]
  // Aanwezige spelers die bij geen enkel lid van de groep staan.
  nietIngedeeld: string[]
  // Ingedeelde spelers die vandaag niet aanwezig zijn.
  afwezigIngedeeld: string[]
  compleet: boolean
}

// Minimale vorm van een groepslid; TrainingOefeningWithData past hier op.
export interface ParallelLid {
  id: string
  parallel_spelers?: ParallelSpelers | null
  oefeningen?: BenodigdAantalInput | null
  // Effectieve bezetting van deze koppeling (concretiseerBezetting in
  // lib/oefening-bezetting.ts). Aanwezig → leidend boven `oefeningen`: een
  // training-specifieke bezetting bepaalt hoeveel spelers deze oefening vandaag
  // nodig heeft. Afwezig → het bestaande gedrag, de basisvorm.
  bezetting?: BenodigdAantalInput | null
}

export function groepStatus(params: {
  leden: ParallelLid[]
  presentPlayerIds: Iterable<string>
}): ParallelGroepStatus {
  const aanwezig = [...params.presentPlayerIds]
  const aanwezigSet = new Set(aanwezig)

  const ingedeeld = new Set<string>()
  const perLid: ParallelLidStatus[] = []

  for (const lid of params.leden) {
    const spelers = Array.isArray(lid.parallel_spelers) ? lid.parallel_spelers : []
    for (const id of spelers) ingedeeld.add(id)

    const benodigd = benodigdAantal(lid.bezetting ?? lid.oefeningen)
    const toegewezen = spelers.length
    perLid.push({
      koppelingId: lid.id,
      toegewezen,
      benodigd,
      // Zonder betrouwbaar benodigd aantal geen tekort/overschot-indicatie.
      tekort: benodigd === null ? 0 : Math.max(0, benodigd - toegewezen),
      overschot: benodigd === null ? 0 : Math.max(0, toegewezen - benodigd),
    })
  }

  const nietIngedeeld = aanwezig.filter((id) => !ingedeeld.has(id))
  const afwezigIngedeeld = [...ingedeeld].filter((id) => !aanwezigSet.has(id))

  const compleet =
    nietIngedeeld.length === 0 &&
    perLid.every((lid) => lid.benodigd === null || lid.toegewezen === lid.benodigd)

  return { perLid, nietIngedeeld, afwezigIngedeeld, compleet }
}
