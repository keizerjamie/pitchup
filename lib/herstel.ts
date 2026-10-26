// Herstel-snapshots voor "Ongedaan maken" na een verwijderactie (UT).
//
// Een verwijder-action leest de rij vóór de DELETE en geeft deze snapshot
// terug; de bijbehorende herstel-action zet de rij met dezelfde id en
// created_at terug. Geen soft-delete en geen migratie: de server is het enige
// dat de snapshot maakt, maar de client kan hem vervalsen. Elke herstel-action
// valideert daarom ALLES opnieuw alsof het een nieuwe invoer is, gebruikt
// `teamId` uitsluitend als weigercontrole (herstel.teamId !== ctx.teamId →
// weigeren) en schrijft altijd met `ctx.teamId`.
//
// Bewust géén 'use server': dit bestand exporteert types en synchrone helpers,
// en die mogen niet uit een server-action-bestand komen (geheugen.md, gotcha
// "'use server'-bestanden mogen alleen async functies exporteren"). Importeer
// de types dus hier vandaan, nooit via app/actions/*.

import { isUuid } from '@/lib/authz'
import type { MatchEventKind, TegendoelpuntSoort } from '@/lib/types'

export type HerstelMeting = {
  soort: 'nulmeting'
  teamId: string
  id: string
  categorie: string
  datum: string
  stap: number
  notes: string | null
  createdAt: string | null
}

export type HerstelWedstrijdMoment = {
  soort: 'wedstrijdmoment'
  teamId: string
  id: string
  eventId: string
  playerId: string
  kind: MatchEventKind
  minute: number | null
  createdAt: string | null
}

// `soort` is hier de discriminator van de snapshot (net als bij de andere
// typen); de soort van het tegendoelpunt zelf heet daarom `doelpuntSoort`.
export type HerstelTegendoelpunt = {
  soort: 'tegendoelpunt'
  teamId: string
  id: string
  eventId: string
  doelpuntSoort: TegendoelpuntSoort
  minute: number | null
  createdAt: string | null
}

export type HerstelAfmeldperiode = {
  soort: 'afmeldperiode'
  teamId: string
  id: string
  playerId: string
  fromDate: string
  toDate: string
  createdAt: string | null
  // Rijen die het intrekken van 'absent' naar de standaardstatus zette.
  naarStandaardEventIds: string[]
  // Rijen waarvan het intrekken alleen de herkomst wiste (status bleef staan:
  // handmatig overruled of geblesseerd).
  alleenHerkomstEventIds: string[]
}

export type HerstelKoppeling = {
  soort: 'koppeling'
  teamId: string
  id: string
  eventId: string
  oefeningId: string
  volgorde: number
  duurMin: number | null
  stapOverride: number | null
  genestIn: string | null
  spelerindeling: unknown
  aantallenOverride: unknown | null
  parallelGroepId: string | null
  parallelSpelers: unknown
  createdAt: string | null
  // Het enige overgebleven groepslid, als het verwijderen de parallelle groep
  // deed vervallen (ruimEenzameGroepOp). Met zijn indeling van vóór het
  // opruimen, zodat herstel de groep in oude staat terugzet.
  partner: { id: string; parallelSpelers: unknown } | null
  // Koppelingen die in deze koppeling genest waren; ON DELETE SET NULL wiste
  // hun genest_in.
  kinderenGenestIds: string[]
  // Volledige koppelingvolgorde van de training vóór het verwijderen, voor
  // normaliseerBlokVolgorde bij het herstel.
  volgordeIds: string[]
}

// De enige melding die een herstel-action naar de client gooit, naast
// 'Geen toegang'/'Niet ingelogd' uit de teamcontext en de generieke melding
// bij een databasefout. Bewust één niet-onthullende tekst: of het om een
// vervalste snapshot, een ander team of een intussen bezette plek gaat, wordt
// niet verraden. De client toont toch zijn eigen i18n-string.
export const HERSTEL_FOUT = 'Herstel niet mogelijk'

export function herstelNietMogelijk(): Error {
  return new Error(HERSTEL_FOUT)
}

// Bovengrens van elke id-lijst in een snapshot. Een afmeldperiode kan een heel
// seizoen beslaan (MAX_SEASON_DAYS in lib/season-dates.ts is 800 dagen, met
// hooguit een paar events per week); een trainingsplan heeft er veel minder.
export const HERSTEL_MAX_IDS = 500

// Lijst van unieke UUID's, hooguit HERSTEL_MAX_IDS lang. Iets anders dan een
// array, of een element dat geen UUID is → null (de aanroeper weigert dan).
export function uuidLijst(waarde: unknown): string[] | null {
  if (!Array.isArray(waarde) || waarde.length > HERSTEL_MAX_IDS) return null
  if (!waarde.every((id) => isUuid(id))) return null
  return [...new Set(waarde as string[])]
}

// Vormcheck voor een timestamptz zoals PostgREST hem teruggeeft
// ('2026-10-25T08:15:30.123456+00:00'). Er wordt niets geconverteerd: de waarde
// gaat ongewijzigd terug naar dezelfde timestamptz-kolom. Alleen de vorm wordt
// begrensd, zodat er geen vrije tekst in een insert belandt.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

export function isTimestampString(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && waarde.length <= 40 && TIMESTAMP_RE.test(waarde)
}

// createdAt uit een snapshot: null → null (DB-default now()), geldige vorm →
// ongewijzigd, al het andere → undefined (= weigeren).
export function schoonCreatedAt(waarde: unknown): string | null | undefined {
  if (waarde === null) return null
  return isTimestampString(waarde) ? waarde : undefined
}
