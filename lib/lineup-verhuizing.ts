import { POSITION_FALLBACKS, POSITION_LABEL_MAP } from '@/lib/types'
import type { LineupPosition } from '@/lib/types'

// Spelers meeverhuizen bij een formatiewissel.
//
// Tot 2026-08-28 gooide een formatiewissel de hele opstelling leeg. Met vijf
// formaties viel dat mee; met vijftien wissel je vaker en ben je dus vaker je
// werk kwijt. Deze module bepaalt per bezet slot uit de OUDE formatie welk slot
// in de NIEUWE formatie er het dichtst bij ligt.
//
// Bewust geen 'use server' en geen React: puur, los testbaar, en gedeeld tussen
// de component en zijn tests. Zelfde opzet als lib/spelerindeling.ts.
//
// ── Waarom slot-naar-slot en niet speler-naar-positie ──
// Er ligt al een scorefunctie voor "past deze SPELER op dit slot"
// (getFitScore in components/LineupBuilder.tsx, gevoed door Auto-opstelling).
// Die is hier bewust NIET gebruikt: die kijkt naar de voorkeurspositie van de
// speler en zou de opstelling opnieuw optimaliseren. Een spits die de coach
// expres op links-midden zette, zou dan bij elke wissel terugspringen naar de
// spits. Meeverhuizen betekent: houd vast wat de coach heeft bedacht. Daarom
// vergelijkt deze module het OUDE slot met het NIEUWE slot.

export type SlotVorm = Omit<LineupPosition, 'player_id'>

export interface Verhuizing {
  /** De nieuwe formatie, met de meeverhuisde spelers al ingevuld. */
  posities: LineupPosition[]
  /** Aantal spelers dat een plek kreeg in de nieuwe formatie. */
  verhuisd: number
  /** Spelers zonder vergelijkbaar slot; die vallen terug op de bank. */
  naarBank: string[]
}

// Hoe vergelijkbaar zijn twee slots? 0 = niet vergelijkbaar (dan verhuist er
// niemand), 1 = dezelfde rol.
//
// De middenwaarden komen uit dezelfde formule als getFitScore, zodat "LM kan
// CM invullen" hier en daar even zwaar weegt. Onbekende labels leveren 0 op —
// die horen niet te bestaan (lib/formations.test.ts bewaakt dat elke formatie
// alleen labels uit POSITION_LABEL_MAP gebruikt), maar een verzonnen label mag
// nooit stilzwijgend een willekeurige speler verplaatsen.
export function slotAffiniteit(oudLabel: string, nieuwLabel: string): number {
  const oud = POSITION_LABEL_MAP[oudLabel]
  const nieuw = POSITION_LABEL_MAP[nieuwLabel]
  if (!oud || !nieuw) return 0
  // Verschillende labels, zelfde rol: LV en LVB zijn allebei 'Linksachter'.
  if (oud === nieuw) return 1

  // POSITION_FALLBACKS['Keeper'] is leeg én 'Keeper' komt in geen enkele andere
  // lijst voor. Een keeper verlaat het doel dus nooit, en niemand komt er
  // ongevraagd in te staan — zonder dat daar een aparte uitzondering voor nodig is.
  const fallbacks = POSITION_FALLBACKS[nieuw] ?? []
  const idx = fallbacks.indexOf(oud)
  if (idx < 0) return 0
  return Math.max(0.2, 0.65 - idx * 0.1)
}

// Afstand tussen twee slots in het coördinatenstelsel van het veld.
//
// x en y zijn allebei percentages, maar van een vak dat 1,4x zo hoog is als
// breed (paddingTop: 140% in LineupBuilder). Zonder die factor telt een
// verticale sprong ~40% te licht mee en zou een linksback net zo lief naar de
// linksbuiten verhuizen als naar de linkshalf.
export function slotAfstand(a: SlotVorm, b: SlotVorm): number {
  const dx = a.x - b.x
  const dy = (a.y - b.y) * 1.4
  return Math.sqrt(dx * dx + dy * dy)
}

// Gewicht van een toegestane koppeling. PLAATSINGSBONUS domineert elk
// affiniteitsverschil, zodat de optimalisatie eerst het AANTAL geplaatste
// spelers maximaliseert en daarna pas de kwaliteit — precies de volgorde die
// een coach wil ("raak niemand kwijt", en dan "zet ze zo logisch mogelijk").
const PLAATSINGSBONUS = 1000

// De afstand telt als laatste, piepkleine correctie mee: hij mag nooit een
// affiniteitsverschil overstemmen (de kleinste stap daarin is 0,1), maar breekt
// wel de gelijkstand tussen spiegelbeeldige slots — de twee centrale
// verdedigers blijven zo aan hun eigen kant van het veld.
const AFSTAND_DEMPING = 10000

// Verhuist de bezette slots van `oud` naar de vorm van `nieuweVorm`.
//
// Dit is een toewijzingsprobleem, opgelost met de Hongaarse methode
// (O(n³), n ≤ 11 — verwaarloosbaar). De uitkomst is optimaal: van alle manieren
// om spelers over slots te verdelen wint die met de meeste geplaatste spelers,
// en bij gelijk aantal die met de hoogste opgetelde affiniteit.
//
// ── Twee eerdere pogingen, en waarom ze faalden ──
// 1. Greedy (beste paar eerst). Faalde op de alledaagse wissel 4-3-3 →
//    4-3-3 (controleur): de CM pakte een CM-slot, de LM het tweede, en de RM
//    hield niets over terwijl het DM-slot leeg bleef.
// 2. Maximale koppeling (Kuhn). Loste het aantal op, maar maximaliseert
//    UITSLUITEND het aantal: dezelfde wissel leverde elf geplaatste spelers op
//    doordat de hele verdediging een plek opschoof — de linkshalf stond
//    linksachter en de rechtsback op het middenveld. Formeel correct, voor een
//    coach onbruikbaar.
// Vandaar de kostenformulering: aantal én kwaliteit, in die volgorde.
export function verhuisOpstelling(oud: LineupPosition[], nieuweVorm: SlotVorm[]): Verhuizing {
  const bezet = oud.filter((p): p is LineupPosition & { player_id: string } => p.player_id !== null)
  const n = bezet.length
  const m = nieuweVorm.length

  if (n === 0 || m === 0) {
    return {
      posities: nieuweVorm.map((slot) => ({ ...slot, player_id: null })),
      verhuisd: 0,
      naarBank: bezet.map((p) => p.player_id),
    }
  }

  // Kostenmatrix (1-geïndexeerd, zoals de klassieke implementatie verwacht).
  // Toegestaan paar → negatieve kosten (winst); verboden paar → 0, wat altijd
  // duurder is dan élke toegestane koppeling. Een speler zonder enig toegestaan
  // slot krijgt dus wel een kolom toegewezen, maar die gooien we hieronder weg.
  const affiniteiten: number[][] = []
  const kosten: number[][] = []
  for (let i = 0; i <= n; i++) {
    affiniteiten.push(new Array(m + 1).fill(0))
    kosten.push(new Array(m + 1).fill(0))
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const affiniteit = slotAffiniteit(bezet[i - 1].position_label, nieuweVorm[j - 1].position_label)
      affiniteiten[i][j] = affiniteit
      kosten[i][j] = affiniteit <= 0
        ? 0
        : -(PLAATSINGSBONUS + affiniteit) + slotAfstand(bezet[i - 1], nieuweVorm[j - 1]) / AFSTAND_DEMPING
    }
  }

  // Hongaarse methode met potentialen (e-maxx-variant). Vereist n ≤ m; dat
  // geldt hier altijd, want een opstelling heeft nooit meer bezette slots dan
  // de formatie posities heeft. De guard houdt die aanname zichtbaar.
  if (n > m) throw new Error('verhuisOpstelling: meer bezette slots dan posities')

  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const rijVanKolom = new Array(m + 1).fill(0)
  const pad = new Array(m + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    rijVanKolom[0] = i
    let j0 = 0
    const minimum = new Array(m + 1).fill(Infinity)
    const gebruikt = new Array(m + 1).fill(false)
    do {
      gebruikt[j0] = true
      const i0 = rijVanKolom[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (gebruikt[j]) continue
        const huidig = kosten[i0][j] - u[i0] - v[j]
        if (huidig < minimum[j]) {
          minimum[j] = huidig
          pad[j] = j0
        }
        if (minimum[j] < delta) {
          delta = minimum[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (gebruikt[j]) {
          u[rijVanKolom[j]] += delta
          v[j] -= delta
        } else {
          minimum[j] -= delta
        }
      }
      j0 = j1
    } while (rijVanKolom[j0] !== 0)
    do {
      const j1 = pad[j0]
      rijVanKolom[j0] = rijVanKolom[j1]
      j0 = j1
    } while (j0)
  }

  // Verboden koppelingen (affiniteit 0) alsnog weggooien: die zijn er alleen
  // omdat de methode elke rij een kolom geeft. Zonder deze stap zou een keeper
  // op de spitspositie kunnen belanden.
  const spelerVanSlot: (number | null)[] = new Array(m).fill(null)
  for (let j = 1; j <= m; j++) {
    const i = rijVanKolom[j]
    if (i > 0 && affiniteiten[i][j] > 0) spelerVanSlot[j - 1] = i - 1
  }

  const geplaatst = new Set(spelerVanSlot.filter((i): i is number => i !== null))

  return {
    posities: nieuweVorm.map((slot, slotIdx) => {
      const i = spelerVanSlot[slotIdx]
      return { ...slot, player_id: i === null ? null : bezet[i].player_id }
    }),
    verhuisd: geplaatst.size,
    // Volgorde van de oorspronkelijke opstelling aanhouden, zodat een testfout
    // leesbaar blijft.
    naarBank: bezet.filter((_, i) => !geplaatst.has(i)).map((p) => p.player_id),
  }
}
