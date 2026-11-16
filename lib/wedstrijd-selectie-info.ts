// Extra informatie voor de selectiestap (/events/[id]/squad): speelminuten van
// de laatste gespeelde wedstrijden per speler, en de indeling van de spelers in
// drie groepen. Pure module, bewust géén 'use server' en géén Supabase-import:
// de squad-pagina haalt de rijen teamgefilterd op en geeft ze hier door. Het
// type RecenteMinuten wordt ook door MatchSquadEditor (client) gebruikt; types
// komen daarom hier vandaan en nooit uit een 'use server'-bestand.
//
// Alles hier is uitsluitend schermdata (print:hidden): het printblok
// (MatchSquadPrintList) krijgt hier niets van.

import { isValidSpeelminuten } from '@/lib/match-analysis.mjs'
import type { AttendanceStatus } from '@/lib/types'

// Aantal eerdere, gespeelde wedstrijden waarvan de minuten getoond worden.
export const RECENTE_WEDSTRIJDEN = 3

export interface RecenteWedstrijd {
  id: string
  date: string  // 'YYYY-MM-DD'
}

export interface RecenteMinuten {
  wedstrijden: RecenteWedstrijd[]               // 0..RECENTE_WEDSTRIJDEN, nieuwste eerst
  // Elke opgegeven speler-id; lengte === wedstrijden.length, zelfde volgorde.
  // null = geen speelminuten-rij voor die wedstrijd ("–"); 0 blijft 0.
  perSpeler: Record<string, (number | null)[]>
}

// Bouwt de minutentabel. `wedstrijden` is al gesorteerd (nieuwste eerst) en
// komt uit een teamgefilterde events-query; rijen met een event_id daarbuiten
// (spookrijen, of een rij van een ander team) en rijen met ongeldige minuten
// (niet geheel 0..130, de CHECK op speelminuten) worden genegeerd. Een rij voor
// een speler die niet in `spelerIds` staat, wordt ook genegeerd. Gooit nooit.
export function bouwRecenteMinuten(
  wedstrijden: RecenteWedstrijd[],
  rijen: { event_id: unknown; player_id: unknown; minuten: unknown }[],
  spelerIds: string[],
): RecenteMinuten {
  const lijst = wedstrijden.slice(0, RECENTE_WEDSTRIJDEN)
  const kolomVan = new Map<string, number>()
  lijst.forEach((w, i) => { if (!kolomVan.has(w.id)) kolomVan.set(w.id, i) })

  const perSpeler: Record<string, (number | null)[]> = {}
  for (const id of spelerIds) perSpeler[id] = lijst.map(() => null)

  for (const rij of Array.isArray(rijen) ? rijen : []) {
    if (!rij || typeof rij !== 'object') continue
    const { event_id, player_id, minuten } = rij
    if (typeof event_id !== 'string' || typeof player_id !== 'string') continue
    const kolom = kolomVan.get(event_id)
    if (kolom === undefined) continue
    if (!Object.hasOwn(perSpeler, player_id)) continue
    if (!isValidSpeelminuten(minuten)) continue
    perSpeler[player_id][kolom] = minuten as number
  }

  return { wedstrijden: lijst, perSpeler }
}

export type SelectieGroep = 'aanwezig' | 'geenReactie' | 'afwezig'

// Inactief gaat vóór de status: een inactieve speler staat altijd bij
// "afwezig", ook als hij voor dit event nog aanwezig staat. 'injured' telt hier
// (net als in de bestaande cijfers) als afwezig.
export function selectieGroepVan(speler: { active: boolean }, status: AttendanceStatus): SelectieGroep {
  if (!speler.active) return 'afwezig'
  if (status === 'present') return 'aanwezig'
  if (status === 'unknown') return 'geenReactie'
  return 'afwezig'
}

// Verdeelt de spelers over de drie groepen. Behoudt de invoervolgorde en
// muteert de invoer niet.
export function groepeerSelectie<T extends { id: string; active: boolean }>(
  spelers: T[],
  statusVan: (s: T) => AttendanceStatus,
): Record<SelectieGroep, T[]> {
  const groepen: Record<SelectieGroep, T[]> = { aanwezig: [], geenReactie: [], afwezig: [] }
  for (const speler of spelers) groepen[selectieGroepVan(speler, statusVan(speler))].push(speler)
  return groepen
}
