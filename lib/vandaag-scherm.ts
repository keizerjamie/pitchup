// Het "Vandaag"-model van het startscherm: welke kaart staat bovenaan
// (hoofdkaart) en welke events komen eronder als weekregel. Puur: geen
// Supabase, geen klok, geen 'use server' — de pagina (app/page.tsx) levert de
// al opgebouwde To-do-taken en tellingen aan.
//
// Eén bron van waarheid voor de rangorde: de hoofdkaart is de eerste open
// taak in exact de volgorde van de To-do-lijst (sortTasks/compareTasks in
// lib/todos.mjs). Zichtbaarheid wordt NIET hier bepaald maar al bij het
// opbouwen van de taken (isTaskVisible/isSelfReviewVisible).

import { sortTasks } from '@/lib/todos.mjs'
import type { OpstellingTelling } from '@/lib/lineup-compleet'
import { dagenTussen } from '@/lib/amsterdam-dag'

// Weekregels tonen events van vandaag t/m vandaag + WEEKREGEL_DAGEN (AC7).
export const WEEKREGEL_DAGEN = 7

export type TaakType = 'squad' | 'lineup' | 'analysis' | 'training_plan' | 'self_review'

export interface VandaagTaak {
  eventId: string
  taskType: TaakType
  deadline: string
  eventDate: string
  effective: boolean
}

export interface KaartEvent {
  id: string
  type: 'training' | 'match'
  date: string
  time: string | null
  opponent: string | null
  home_away: 'home' | 'away' | null
}

export type KaartSoort =
  | 'training_plan'
  | 'squad'
  | 'lineup'
  | 'lineup_onvolledig'
  | 'analysis'
  | 'self_review'
  | 'volgend_event'

export interface VandaagKaart {
  soort: KaartSoort
  event: KaartEvent
  open: boolean
  href: string
  doelTaak: TaakType
  // Alleen bij lineup_onvolledig met een bekend aantal lege posities (> 0);
  // anders null (dan toont de UI geen aantal).
  legePosities: number | null
}

export interface VandaagModel {
  hoofdkaart: VandaagKaart | null
  regels: VandaagKaart[]
}

/** Doelpagina van een taak — dezelfde hrefs als de To-do-lijst. */
export function taakHref(eventId: string, taskType: TaakType): string {
  switch (taskType) {
    case 'squad': return `/events/${eventId}/squad`
    case 'lineup': return `/events/${eventId}/lineup`
    case 'analysis': return `/events/${eventId}/analysis`
    case 'training_plan': return `/events/${eventId}/training-plan`
    case 'self_review': return `/events/${eventId}#mijn-zelfreview`
  }
}

// Kaart voor één taak. Alleen een OPEN opstellingstaak met een lineups-rij die
// niet compleet is wordt een probleemkaart; een handmatig afgevinkte
// opstelling (effective, dus niet open) is nooit een probleem.
function kaartVoorTaak(
  taak: VandaagTaak,
  event: KaartEvent,
  opstellingPerEvent: ReadonlyMap<string, OpstellingTelling>,
): VandaagKaart {
  const open = !taak.effective
  const telling = taak.taskType === 'lineup' && open ? opstellingPerEvent.get(taak.eventId) : undefined
  const onvolledig = telling !== undefined && telling.compleet === false
  return {
    soort: onvolledig ? 'lineup_onvolledig' : taak.taskType,
    event,
    open,
    href: taakHref(taak.eventId, taak.taskType),
    doelTaak: taak.taskType,
    legePosities: onvolledig && telling.leeg !== null && telling.leeg > 0 ? telling.leeg : null,
  }
}

// Kaart voor het eerstvolgende event als alles klaar is (AC14). Training →
// planner; wedstrijd → opstelling als selectie of opstelling al klaar is,
// anders de selectie. De UI onderscheidt "Opstelling bekijken" van
// "Opstelling maken" via opstellingKlaarIds.
function kaartVoorVolgendEvent(
  event: KaartEvent,
  selectieKlaarIds: ReadonlySet<string>,
  opstellingKlaarIds: ReadonlySet<string>,
): VandaagKaart {
  let doelTaak: TaakType
  if (event.type === 'training') doelTaak = 'training_plan'
  else if (opstellingKlaarIds.has(event.id) || selectieKlaarIds.has(event.id)) doelTaak = 'lineup'
  else doelTaak = 'squad'
  return {
    soort: 'volgend_event',
    event,
    open: false,
    href: taakHref(event.id, doelTaak),
    doelTaak,
    legePosities: null,
  }
}

export function bepaalVandaag(p: {
  // Kalenderdag 'YYYY-MM-DD' (Amsterdam, zie vandaagIn) — alleen voor het
  // datumvenster van de weekregels; de functie leest zelf geen klok.
  vandaag: string
  taken: VandaagTaak[]
  events: ReadonlyMap<string, KaartEvent>
  volgendEvent: KaartEvent | null
  opstellingPerEvent: ReadonlyMap<string, OpstellingTelling>
  selectieKlaarIds: ReadonlySet<string>
  opstellingKlaarIds: ReadonlySet<string>
}): VandaagModel {
  // Taken waarvan het event onbekend is (zou niet moeten voorkomen) vallen
  // weg: zonder event is er geen kaart te tonen.
  const gesorteerd = (sortTasks(p.taken) as VandaagTaak[]).filter((t) => p.events.has(t.eventId))

  const eersteOpen = gesorteerd.find((t) => !t.effective)
  let hoofdkaart: VandaagKaart | null = null
  if (eersteOpen) {
    hoofdkaart = kaartVoorTaak(eersteOpen, p.events.get(eersteOpen.eventId)!, p.opstellingPerEvent)
  } else if (p.volgendEvent) {
    hoofdkaart = kaartVoorVolgendEvent(p.volgendEvent, p.selectieKlaarIds, p.opstellingKlaarIds)
  }

  // Eén regel per event, in de volgorde van zijn eerste taak in de
  // To-do-rangorde (OV-J5). Het event van de hoofdkaart staat al bovenaan.
  const perEvent = new Map<string, VandaagTaak[]>()
  for (const taak of gesorteerd) {
    if (hoofdkaart && taak.eventId === hoofdkaart.event.id) continue
    const lijst = perEvent.get(taak.eventId)
    if (lijst) lijst.push(taak)
    else perEvent.set(taak.eventId, [taak])
  }

  // AC7 (aangescherpt na browsercontrole): een regel alleen voor een event
  // binnen vandaag t/m vandaag+7, óf een event met nog een open taak (open
  // analyse/zelfreview uit het verleden blijft een actie). Afgeronde events
  // buiten het venster staan alleen nog in de To-do-lijst. Ongeldige datum →
  // NaN → buiten het venster. De hoofdkaart hierboven filtert bewust niet.
  const regels: VandaagKaart[] = []
  for (const [eventId, taken] of perEvent) {
    const event = p.events.get(eventId)!
    const eersteOpen = taken.find((t) => !t.effective)
    const dagen = dagenTussen(p.vandaag, event.date)
    const inVenster = dagen >= 0 && dagen <= WEEKREGEL_DAGEN
    if (!inVenster && !eersteOpen) continue
    regels.push(kaartVoorTaak(eersteOpen ?? taken[0], event, p.opstellingPerEvent))
  }

  return { hoofdkaart, regels }
}
