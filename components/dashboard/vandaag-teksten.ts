import type { Dict } from '@/messages/nl'
import { dagenTussen } from '@/lib/amsterdam-dag'
import type { KaartEvent, VandaagKaart } from '@/lib/vandaag-scherm'
import { formatDate } from '@/lib/utils'

// Teksten en iconen voor een Vandaag-kaart (hoofdkaart en weekregels). Puur:
// de klok komt binnen als `vandaag` (Amsterdamse dag-string uit app/page.tsx).

type DagSoort = 'vandaag' | 'morgen' | 'gisteren' | null

function dagSoort(datum: string, vandaag: string): { soort: DagSoort; diff: number } {
  const diff = dagenTussen(vandaag, datum)
  if (diff === 0) return { soort: 'vandaag', diff }
  if (diff === 1) return { soort: 'morgen', diff }
  if (diff === -1) return { soort: 'gisteren', diff }
  return { soort: null, diff }
}

/** Korte dagkolom van een weekregel: "Vandaag" / "Morgen" / "Gisteren" / "za 21 nov". */
export function dagKolomTekst(datum: string, vandaag: string, t: Dict): string {
  const { soort } = dagSoort(datum, vandaag)
  if (soort === 'vandaag') return t.dashboard.today
  if (soort === 'morgen') return t.dashboard.tomorrow
  if (soort === 'gisteren') return t.vandaag.whenYesterdayCap
  return formatDate(datum, t.browserLocale)
}

/** "vandaag" / "morgen" / "gisteren" / "over 3 dagen" / "op za 21 nov". */
export function wanneerTekst(datum: string, vandaag: string, t: Dict): string {
  const { soort, diff } = dagSoort(datum, vandaag)
  if (soort === 'vandaag') return t.vandaag.whenToday
  if (soort === 'morgen') return t.vandaag.whenTomorrow
  if (soort === 'gisteren') return t.vandaag.whenYesterday
  if (diff >= 2 && diff <= 7) return t.vandaag.whenInDays.replace('{n}', String(diff))
  return t.vandaag.whenOn.replace('{datum}', formatDate(datum, t.browserLocale))
}

/** Titel van een event: "Training vandaag" of "Diemen thuis" / "Diemen uit". */
export function eventTitel(event: KaartEvent, vandaag: string, t: Dict): string {
  if (event.type === 'training') {
    return t.vandaag.trainingTitle.replace('{wanneer}', wanneerTekst(event.date, vandaag, t))
  }
  const tegenstander = event.opponent ?? t.event.match
  if (event.home_away === 'home') return t.vandaag.matchHome.replace('{tegenstander}', tegenstander)
  if (event.home_away === 'away') return t.vandaag.matchAway.replace('{tegenstander}', tegenstander)
  return tegenstander
}

/** Tekst voor een onvolledige opstelling, met aantal als dat bekend is. */
export function opstellingMistTekst(legePosities: number | null, t: Dict): string {
  if (legePosities === 1) return t.vandaag.lineupMissingOne
  if (legePosities !== null && legePosities > 1) return t.vandaag.lineupMissingMany.replace('{n}', String(legePosities))
  return t.vandaag.lineupIncomplete
}

export type KaartToon = 'normaal' | 'probleem' | 'klaar'

export interface KaartTeksten {
  eyebrow: string
  tone: KaartToon
  title: string
  primaryLabel: string
  primaryIcon: string
}

/** Alle hoofdkaart-teksten uit het model. `opstellingKlaar` alleen relevant bij volgend_event-wedstrijd. */
export function hoofdkaartTeksten(kaart: VandaagKaart, vandaag: string, opstellingKlaar: boolean, t: Dict): KaartTeksten {
  const title = eventTitel(kaart.event, vandaag, t)
  const v = t.vandaag
  switch (kaart.soort) {
    case 'training_plan':
      return { eyebrow: v.eyebrowTodo, tone: 'normaal', title, primaryLabel: t.home.makeTrainingPlan, primaryIcon: 'assignment' }
    case 'squad':
      return { eyebrow: v.eyebrowTodo, tone: 'normaal', title, primaryLabel: v.actionSquad, primaryIcon: 'groups' }
    case 'lineup':
      return { eyebrow: v.eyebrowTodo, tone: 'normaal', title, primaryLabel: t.home.makeLineup, primaryIcon: 'sports' }
    case 'lineup_onvolledig':
      return { eyebrow: opstellingMistTekst(kaart.legePosities, t), tone: 'probleem', title, primaryLabel: v.actionFixLineup, primaryIcon: 'sports' }
    case 'analysis':
      return { eyebrow: v.eyebrowTodo, tone: 'normaal', title, primaryLabel: v.actionAnalysis, primaryIcon: 'assignment' }
    case 'self_review':
      return { eyebrow: v.eyebrowTodo, tone: 'normaal', title, primaryLabel: v.actionSelfReview, primaryIcon: 'assignment' }
    case 'volgend_event':
      if (kaart.event.type === 'training') {
        return { eyebrow: v.eyebrowAllDone, tone: 'klaar', title, primaryLabel: v.actionViewPlan, primaryIcon: 'assignment' }
      }
      if (kaart.doelTaak === 'squad') {
        return { eyebrow: v.eyebrowAllDone, tone: 'klaar', title, primaryLabel: v.actionSquad, primaryIcon: 'groups' }
      }
      return {
        eyebrow: v.eyebrowAllDone, tone: 'klaar', title,
        primaryLabel: opstellingKlaar ? v.actionViewLineup : t.home.makeLineup,
        primaryIcon: 'sports',
      }
  }
}
