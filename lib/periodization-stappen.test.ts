import { describe, it, expect } from 'vitest'
import {
  PERIODIZATION_STEP_TABLES,
  PERIODIZATION_STEP_MINUTEN,
  berekenDuurUitStap,
  maxStapVoor,
  clampStapOverride,
  stapInhoud,
  heeftStapInhoud,
  type StapRij,
  type StapRekenRij,
} from '@/lib/periodization-stappen'
import { PERIODIZATION_CATEGORIES, type OefeningCategorie } from '@/lib/types'

const TABEL_KEYS = Object.keys(PERIODIZATION_STEP_TABLES) as OefeningCategorie[]

// ────────────────────────────────────────────────
// Data-integriteit (76 handmatig overgetypte rijen)
// ────────────────────────────────────────────────

describe('PERIODIZATION_STEP_TABLES — omvang', () => {
  it('bevat precies de vijf meting-categorieën met een kolommentabel', () => {
    expect([...TABEL_KEYS].sort()).toEqual([
      'partijen_groot',
      'partijen_klein',
      'partijen_midden',
      'sprints_veel_rust',
      'sprints_weinig_rust',
    ])
  })

  it.each(TABEL_KEYS)('%s heeft evenveel rijen als maxStap in PERIODIZATION_CATEGORIES', (key) => {
    const meta = PERIODIZATION_CATEGORIES.find((c) => c.key === key)
    expect(meta, `categorie ${key} bestaat niet in PERIODIZATION_CATEGORIES`).toBeDefined()
    expect(PERIODIZATION_STEP_TABLES[key]!.length).toBe(meta!.maxStap)
  })

  it.each(TABEL_KEYS)('%s heeft op elke rij een gevulde arbeid/herhalingen/rustHH', (key) => {
    for (const [i, rij] of PERIODIZATION_STEP_TABLES[key]!.entries()) {
      expect(rij.arbeid, `${key} stap ${i + 1}`).toBeTruthy()
      expect(rij.herhalingen, `${key} stap ${i + 1}`).toBeTruthy()
      expect(rij.rustHH, `${key} stap ${i + 1}`).toBeTruthy()
    }
  })
})

// Kolomcontract per categorie: welke optionele velden er op ELKE rij horen te
// staan (`true`) en op GEEN ENKELE rij mogen voorkomen (`false`).
const KOLOM_CONTRACT: Record<string, { series: boolean; rustSeries: boolean }> = {
  sprints_weinig_rust: { series: true,  rustSeries: true  },
  sprints_veel_rust:   { series: false, rustSeries: true  },
  partijen_groot:      { series: false, rustSeries: false },
  partijen_midden:     { series: false, rustSeries: false },
  partijen_klein:      { series: true,  rustSeries: true  },
}

describe('PERIODIZATION_STEP_TABLES — kolomcontract', () => {
  it.each(Object.entries(KOLOM_CONTRACT))('%s houdt zijn kolommen consistent', (key, contract) => {
    const tabel = PERIODIZATION_STEP_TABLES[key as OefeningCategorie]!
    for (const veld of ['series', 'rustSeries'] as const) {
      for (const [i, rij] of tabel.entries()) {
        if (contract[veld]) {
          expect(rij[veld], `${key} stap ${i + 1} mist ${veld}`).toBeTruthy()
        } else {
          expect(rij[veld], `${key} stap ${i + 1} heeft onverwacht ${veld}`).toBeUndefined()
        }
      }
    }
  })
})

// Grenswaarden: eerste en laatste rij van elke tabel letterlijk vastgelegd.
const GRENSRIJEN: Record<string, { eerste: StapRij; laatste: StapRij }> = {
  sprints_weinig_rust: {
    eerste:  { arbeid: '15m', herhalingen: '6',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    laatste: { arbeid: '20m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
  },
  sprints_veel_rust: {
    eerste:  { arbeid: '5/15/25m', herhalingen: '6/4/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    laatste: { arbeid: '5/15/25m', herhalingen: '10/8/6', rustHH: '30/45/60 sec', rustSeries: '4 min' },
  },
  partijen_groot: {
    eerste:  { arbeid: '10 min', herhalingen: '2', rustHH: '2 min' },
    laatste: { arbeid: '15 min', herhalingen: '6', rustHH: '2 min' },
  },
  partijen_midden: {
    eerste:  { arbeid: '4 min', herhalingen: '4', rustHH: '2 min' },
    laatste: { arbeid: '8 min', herhalingen: '6', rustHH: '2 min' },
  },
  partijen_klein: {
    eerste:  { arbeid: '1 min', herhalingen: '6',  rustHH: '3 min', series: '2', rustSeries: '4 min' },
    laatste: { arbeid: '3 min', herhalingen: '10', rustHH: '1 min', series: '2', rustSeries: '4 min' },
  },
}

describe('PERIODIZATION_STEP_TABLES — grenswaarden en spot-checks', () => {
  it.each(Object.entries(GRENSRIJEN))('%s: stap 1 en stap maxStap kloppen', (key, verwacht) => {
    const categorie = key as OefeningCategorie
    expect(stapInhoud(categorie, 1)).toEqual(verwacht.eerste)
    expect(stapInhoud(categorie, maxStapVoor(categorie))).toEqual(verwacht.laatste)
  })

  // Decimaalkomma's staan LETTERLIJK in de brondata en mogen nooit
  // geherformatteerd of gelokaliseerd worden.
  it('bewaart de decimaalnotatie letterlijk', () => {
    expect(PERIODIZATION_STEP_TABLES.partijen_midden![1].arbeid).toBe('4,5 min')
    expect(PERIODIZATION_STEP_TABLES.partijen_klein![1].rustHH).toBe('2,5 min')
    expect(PERIODIZATION_STEP_TABLES.partijen_klein![3].rustHH).toBe('1,5 min')
  })

  it('sprints_weinig_rust schakelt bij stap 13 naar 20m', () => {
    expect(PERIODIZATION_STEP_TABLES.sprints_weinig_rust![11].arbeid).toBe('15m')
    expect(PERIODIZATION_STEP_TABLES.sprints_weinig_rust![12].arbeid).toBe('20m')
  })
})

// ────────────────────────────────────────────────
// Volledige data-integriteit: ALLE 76 rijen van alle 5 tabellen, letterlijk
// overgetypt uit de brondata (niet afgeleid van de module zelf) — dekt het
// gat dat de grenswaarden/spot-checks hierboven laten liggen (~26 van de 76
// rijen hadden nergens een assertie).
// ────────────────────────────────────────────────

const VOLLEDIGE_TABELLEN: Record<
  'sprints_weinig_rust' | 'sprints_veel_rust' | 'partijen_groot' | 'partijen_midden' | 'partijen_klein',
  StapRij[]
> = {
  sprints_weinig_rust: [
    { arbeid: '15m', herhalingen: '6',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '7',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '2', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '7',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '3', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '8',  rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '9',  rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '15m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '20m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
    { arbeid: '20m', herhalingen: '10', rustHH: '10 sec', series: '4', rustSeries: '4 min' },
  ],
  sprints_veel_rust: [
    { arbeid: '5/15/25m', herhalingen: '6/4/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/4/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/5/2',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '7/5/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/5/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/6/3',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '8/6/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/6/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/7/4',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '9/7/5',  rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/7/5', rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/8/5', rustHH: '30/45/60 sec', rustSeries: '4 min' },
    { arbeid: '5/15/25m', herhalingen: '10/8/6', rustHH: '30/45/60 sec', rustSeries: '4 min' },
  ],
  partijen_groot: [
    { arbeid: '10 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '11 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '2', rustHH: '2 min' },
    { arbeid: '11 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '3', rustHH: '2 min' },
    { arbeid: '12 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '13 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '14 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '15 min', herhalingen: '6', rustHH: '2 min' },
  ],
  partijen_midden: [
    { arbeid: '4 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '4,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '5 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '5,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '6 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '6,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '4', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '4', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '5', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '5', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '5', rustHH: '2 min' },
    { arbeid: '7 min',   herhalingen: '6', rustHH: '2 min' },
    { arbeid: '7,5 min', herhalingen: '6', rustHH: '2 min' },
    { arbeid: '8 min',   herhalingen: '6', rustHH: '2 min' },
  ],
  partijen_klein: [
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '3 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '2,5 min', series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '2 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '1,5 min', series: '2', rustSeries: '4 min' },
    { arbeid: '1 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '1,5 min', herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '2 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '2,5 min', herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '6',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '7',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '8',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '9',  rustHH: '1 min',   series: '2', rustSeries: '4 min' },
    { arbeid: '3 min',   herhalingen: '10', rustHH: '1 min',   series: '2', rustSeries: '4 min' },
  ],
}

// Platgeslagen lijst van alle 76 (categorie, stapnummer, verwachte rij)-combinaties.
const ALLE_RIJEN: [OefeningCategorie, number, StapRij][] = Object.entries(VOLLEDIGE_TABELLEN).flatMap(
  ([categorie, rijen]) => rijen.map((rij, i): [OefeningCategorie, number, StapRij] => [categorie as OefeningCategorie, i + 1, rij]),
)

describe('PERIODIZATION_STEP_TABLES — volledige data-integriteit (alle 76 rijen)', () => {
  it('bevat exact 76 rijen verdeeld over de 5 tabellen', () => {
    expect(ALLE_RIJEN).toHaveLength(76)
    expect(VOLLEDIGE_TABELLEN.sprints_weinig_rust).toHaveLength(14)
    expect(VOLLEDIGE_TABELLEN.sprints_veel_rust).toHaveLength(13)
    expect(VOLLEDIGE_TABELLEN.partijen_groot).toHaveLength(21)
    expect(VOLLEDIGE_TABELLEN.partijen_midden).toHaveLength(15)
    expect(VOLLEDIGE_TABELLEN.partijen_klein).toHaveLength(13)
  })

  it.each(ALLE_RIJEN)('%s stap %i komt exact overeen met de brondata', (categorie, stap, verwacht) => {
    expect(stapInhoud(categorie, stap)).toEqual(verwacht)
    expect(PERIODIZATION_STEP_TABLES[categorie]![stap - 1]).toEqual(verwacht)
  })
})

// ────────────────────────────────────────────────
// maxStapVoor
// ────────────────────────────────────────────────

describe('maxStapVoor', () => {
  it('leest het maximum uit PERIODIZATION_CATEGORIES', () => {
    expect(maxStapVoor('partijen_groot')).toBe(21)
    expect(maxStapVoor('partijen_klein')).toBe(13)
    expect(maxStapVoor('steigerungs')).toBe(5)
  })

  it('valt terug op 99 voor een onbekende categorie', () => {
    expect(maxStapVoor('onbekende_cat')).toBe(99)
    expect(maxStapVoor('')).toBe(99)
  })

  it('geeft 99 voor categorieën zonder brondata', () => {
    for (const key of ['warming_up', 'positiespel', 'pass_trap', 'overig']) {
      expect(maxStapVoor(key)).toBe(99)
    }
  })
})

// ────────────────────────────────────────────────
// clampStapOverride
// ────────────────────────────────────────────────

describe('clampStapOverride', () => {
  it('clamt op de categorie-specifieke bovengrens', () => {
    expect(clampStapOverride(40, 'partijen_klein')).toBe(13)
    expect(clampStapOverride(21, 'partijen_groot')).toBe(21)
    expect(clampStapOverride(9, 'steigerungs')).toBe(5)
  })

  it('houdt 1 als ondergrens', () => {
    expect(clampStapOverride(0, 'partijen_groot')).toBe(1)
    expect(clampStapOverride(-7, 'partijen_groot')).toBe(1)
  })

  it('gebruikt de fallback-grens 99 voor categorieën zonder brondata', () => {
    expect(clampStapOverride(150, 'overig')).toBe(99)
    expect(clampStapOverride(150, 'warming_up')).toBe(99)
    expect(clampStapOverride(5, 'onbekende_cat')).toBe(5)
  })

  it('laat null ongemoeid (= override wissen)', () => {
    expect(clampStapOverride(null, 'partijen_groot')).toBeNull()
    expect(clampStapOverride(null, 'onbekende_cat')).toBeNull()
  })

  it('maakt van een niet-eindig getal 1', () => {
    expect(clampStapOverride(NaN, 'partijen_groot')).toBe(1)
    expect(clampStapOverride(Infinity, 'partijen_groot')).toBe(1)
    expect(clampStapOverride(-Infinity, 'partijen_groot')).toBe(1)
  })

  it('kapt een decimaal getal af naar beneden', () => {
    expect(clampStapOverride(3.9, 'partijen_groot')).toBe(3)
  })
})

// ────────────────────────────────────────────────
// stapInhoud
// ────────────────────────────────────────────────

describe('stapInhoud', () => {
  it('geeft de rij die bij het stapnummer hoort (1-based)', () => {
    expect(stapInhoud('partijen_midden', 2)).toEqual({ arbeid: '4,5 min', herhalingen: '4', rustHH: '2 min' })
  })

  it('clamt boven maxStap naar de zwaarste beschikbare rij', () => {
    expect(stapInhoud('partijen_klein', 22)).toEqual(PERIODIZATION_STEP_TABLES.partijen_klein![12])
    expect(stapInhoud('partijen_groot', 999)).toEqual(PERIODIZATION_STEP_TABLES.partijen_groot![20])
  })

  it('clamt onder 1 naar de eerste rij', () => {
    expect(stapInhoud('partijen_groot', 0)).toEqual(PERIODIZATION_STEP_TABLES.partijen_groot![0])
  })

  it('geeft null zonder stap', () => {
    expect(stapInhoud('partijen_groot', null)).toBeNull()
    expect(stapInhoud('partijen_groot', undefined)).toBeNull()
  })

  it('geeft null voor steigerungs (tekst komt uit i18n, niet uit deze tabel)', () => {
    expect(stapInhoud('steigerungs', 3)).toBeNull()
  })

  it('geeft null voor categorieën zonder tabel', () => {
    for (const key of ['warming_up', 'positiespel', 'pass_trap', 'overig', 'onbekende_cat']) {
      expect(stapInhoud(key, 1)).toBeNull()
    }
  })
})

// ────────────────────────────────────────────────
// heeftStapInhoud
// ────────────────────────────────────────────────

describe('heeftStapInhoud', () => {
  it('is waar voor de vijf tabel-categorieën én voor steigerungs', () => {
    for (const key of TABEL_KEYS) expect(heeftStapInhoud(key)).toBe(true)
    expect(heeftStapInhoud('steigerungs')).toBe(true)
    expect(heeftStapInhoud('partijen_groot')).toBe(true)
  })

  it('is onwaar voor categorieën zonder inhoud', () => {
    for (const key of ['warming_up', 'positiespel', 'pass_trap', 'overig', 'onbekende_cat']) {
      expect(heeftStapInhoud(key)).toBe(false)
    }
  })
})

// ────────────────────────────────────────────────
// PERIODIZATION_STEP_MINUTEN — de numerieke tegenhanger
// ────────────────────────────────────────────────

const MINUTEN_KEYS = Object.keys(PERIODIZATION_STEP_MINUTEN) as OefeningCategorie[]

// Terugformatteren van een numerieke rij naar de weergavestring van de
// brontabel. STAAT BEWUST IN HET TESTBESTAND: productiecode mag deze strings
// nooit genereren (zie de kop van lib/periodization-stappen.ts). Alleen hier,
// als bewijsmiddel dat beide tabellen dezelfde waarheid vertellen.
function alsGetal(n: number): string {
  return String(n).replace('.', ',')
}
function alsMinuten(n: number): string {
  return `${alsGetal(n)} min`
}
function terugNaarStapRij(rij: StapRekenRij): StapRij {
  const uit: StapRij = {
    arbeid: alsMinuten(rij.arbeidMin),
    herhalingen: alsGetal(rij.herhalingen),
    rustHH: alsMinuten(rij.rustHHMin),
  }
  if (rij.series !== undefined) uit.series = alsGetal(rij.series)
  if (rij.rustSeriesMin !== undefined) uit.rustSeries = alsMinuten(rij.rustSeriesMin)
  return uit
}

describe('PERIODIZATION_STEP_MINUTEN — omvang', () => {
  it('bevat EXACT de drie partijen-categorieën', () => {
    // Een vierde key zou stilzwijgend auto-berekening aanzetten bij een
    // categorie waar niets uit de stap te berekenen valt (sprints hebben een
    // afstand als arbeid, steigerungs alleen tekst).
    expect([...MINUTEN_KEYS].sort()).toEqual(['partijen_groot', 'partijen_klein', 'partijen_midden'])
  })

  it.each(MINUTEN_KEYS)('%s heeft evenveel rijen als de weergavetabel', (key) => {
    expect(PERIODIZATION_STEP_MINUTEN[key]!.length).toBe(PERIODIZATION_STEP_TABLES[key]!.length)
  })

  it('heeft de drie controlerijen uit de brief exact overgetypt', () => {
    expect(PERIODIZATION_STEP_MINUTEN.partijen_groot![0]).toEqual({ arbeidMin: 10, herhalingen: 2, rustHHMin: 2 })
    expect(PERIODIZATION_STEP_MINUTEN.partijen_midden![1]).toEqual({ arbeidMin: 4.5, herhalingen: 4, rustHHMin: 2 })
    expect(PERIODIZATION_STEP_MINUTEN.partijen_klein![1]).toEqual({
      arbeidMin: 1, herhalingen: 6, rustHHMin: 2.5, series: 2, rustSeriesMin: 4,
    })
  })
})

describe('PERIODIZATION_STEP_MINUTEN — consistentie met de weergavetabel', () => {
  // De kernbewaking van deze feature: twee tabellen, één waarheid. Deze test
  // valt zowel bij een gewijzigd getal als bij een gewijzigde weergavestring.
  it.each(MINUTEN_KEYS)('%s: elke numerieke rij formatteert terug naar de brontabel-rij', (key) => {
    const getallen = PERIODIZATION_STEP_MINUTEN[key]!
    const strings = PERIODIZATION_STEP_TABLES[key]!
    for (const [i, rij] of getallen.entries()) {
      expect(terugNaarStapRij(rij), `${key} stap ${i + 1}`).toEqual(strings[i])
    }
  })
})

// ────────────────────────────────────────────────
// berekenDuurUitStap
// ────────────────────────────────────────────────

describe('berekenDuurUitStap', () => {
  it('rekent de formule uit de story, per categorie', () => {
    expect(berekenDuurUitStap('partijen_groot', 1)).toBe(22)   // 10*2 + 2*1
    expect(berekenDuurUitStap('partijen_midden', 2)).toBe(24)  // 4,5*4 + 2*3
    expect(berekenDuurUitStap('partijen_klein', 2)).toBe(41)   // (1*6 + 2,5*5)*2 + 4*1
  })

  it('levert over álle stappen gehele minuten op', () => {
    // duur_min is een SMALLINT. Zou een toekomstige rij wél afronden, dan wordt
    // dat hier zichtbaar in plaats van stil.
    for (const key of MINUTEN_KEYS) {
      for (let stap = 1; stap <= PERIODIZATION_STEP_MINUTEN[key]!.length; stap++) {
        const duur = berekenDuurUitStap(key, stap)!
        expect(duur % 1, `${key} stap ${stap}`).toBe(0)
        expect(duur).toBeGreaterThan(0)
        expect(duur).toBeLessThanOrEqual(600)
      }
    }
  })

  it('clamt de stap-index net als stapInhoud: onder 1 → eerste rij, boven het maximum → laatste rij', () => {
    expect(berekenDuurUitStap('partijen_groot', 0)).toBe(berekenDuurUitStap('partijen_groot', 1))
    expect(berekenDuurUitStap('partijen_groot', -5)).toBe(berekenDuurUitStap('partijen_groot', 1))
    expect(berekenDuurUitStap('partijen_klein', 999)).toBe(berekenDuurUitStap('partijen_klein', 13))
  })

  it('geeft null zonder bruikbare stap', () => {
    expect(berekenDuurUitStap('partijen_groot', null)).toBeNull()
    expect(berekenDuurUitStap('partijen_groot', undefined)).toBeNull()
    expect(berekenDuurUitStap('partijen_groot', NaN)).toBeNull()
    expect(berekenDuurUitStap('partijen_groot', Infinity)).toBeNull()
  })

  it('geeft null voor elke categorie zonder numerieke tabel', () => {
    // null = "niet automatisch berekenen"; de aanroeper laat de bestaande duur
    // dan met rust. Sprints hebben een AFSTAND als arbeid — daar valt niets uit
    // te rekenen.
    for (const key of [
      'sprints_weinig_rust', 'sprints_veel_rust', 'steigerungs',
      'warming_up', 'positiespel', 'pass_trap', 'overig', 'onzin',
    ]) {
      expect(berekenDuurUitStap(key, 3), key).toBeNull()
    }
  })
})
