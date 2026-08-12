import { describe, it, expect } from 'vitest'
import { parseMatchesFromText } from '@/lib/bulk-matches-text'
import { MAX_PREVIEW_ROWS, MAX_TEXT_CHARS, MAX_TEXT_LINES, type ParsedMatchRow } from '@/lib/bulk-matches'

function rowsOf(input: string): ParsedMatchRow[] {
  const result = parseMatchesFromText(input)
  if (!result.ok) throw new Error(`verwachtte ok:true, kreeg: ${result.error}`)
  return result.rows
}

function one(input: string): ParsedMatchRow {
  const rows = rowsOf(input)
  expect(rows).toHaveLength(1)
  return rows[0]
}

function errorOf(input: string): string {
  const result = parseMatchesFromText(input)
  if (result.ok) throw new Error('verwachtte ok:false')
  return result.error
}

describe('parseMatchesFromText — volledige regels', () => {
  it('leest een complete regel', () => {
    const row = one('za 12 september 2026 14:30 thuis competitie tegen DVC')
    expect(row).toEqual({
      id: 'r0',
      date: '2026-09-12',
      time: '14:30',
      opponent: 'DVC',
      home_away: 'home',
      match_type: 'league',
      location: '',
      gather_time: '',
      notes: '',
      uncertain: [],
      sourceLine: 'za 12 september 2026 14:30 thuis competitie tegen DVC',
    })
  })

  it('leest meerdere regels met eigen ids', () => {
    const rows = rowsOf([
      '2026-09-12 14:30 thuis competitie DVC',
      '2026-09-19 12:00 uit beker SV Tweede',
    ].join('\n'))
    expect(rows.map((r) => r.id)).toEqual(['r0', 'r1'])
    expect(rows[1]).toMatchObject({
      date: '2026-09-19', time: '12:00', home_away: 'away', match_type: 'cup', opponent: 'SV Tweede',
    })
  })

  it('vult locatie, verzameltijd en notities nooit vanuit vrije tekst', () => {
    const row = one('2026-09-12 14:30 thuis competitie DVC op Sportpark de Meent')
    expect(row.location).toBe('')
    expect(row.gather_time).toBe('')
    expect(row.notes).toBe('')
    // De locatietekst blijft bij de tegenstander staan; de trainer corrigeert
    // dat zelf in de preview.
    expect(row.opponent).toBe('DVC op Sportpark de Meent')
  })
})

describe('parseMatchesFromText — regelselectie', () => {
  it('negeert regels zonder datum-token', () => {
    const rows = rowsOf([
      'Programma najaar',
      '',
      '2026-09-12 14:30 thuis competitie DVC',
      'Groeten, de trainer',
    ].join('\n'))
    expect(rows).toHaveLength(1)
  })

  it('weigert tekst zonder enige datum', () => {
    expect(errorOf('DVC thuis competitie\nSV Tweede uit')).toContain('Geen wedstrijden gevonden')
  })

  it('leest \\r\\n en losse \\r als regeleinde', () => {
    expect(rowsOf('2026-09-12 DVC\r\n2026-09-19 SV\r2026-09-26 VV')).toHaveLength(3)
  })

  it('weigert tekst boven de tekenlimiet', () => {
    expect(errorOf('x'.repeat(MAX_TEXT_CHARS + 1))).toContain('te lang')
  })

  it('weigert tekst met te veel regels', () => {
    expect(errorOf('regel\n'.repeat(MAX_TEXT_LINES))).toContain('te veel regels')
  })

  it('leest precies 200 wedstrijdregels en weigert er 201', () => {
    const line = (i: number) => `2026-09-12 14:30 thuis competitie Club ${i}`
    const tweehonderd = Array.from({ length: MAX_PREVIEW_ROWS }, (_, i) => line(i)).join('\n')
    expect(rowsOf(tweehonderd)).toHaveLength(MAX_PREVIEW_ROWS)

    const teveel = Array.from({ length: MAX_PREVIEW_ROWS + 1 }, (_, i) => line(i)).join('\n')
    expect(errorOf(teveel)).toContain('meer dan 200')
  })
})

describe('parseMatchesFromText — datum', () => {
  it('neemt een ISO-datum over zoals hij is', () => {
    expect(one('2026-09-12 DVC').date).toBe('2026-09-12')
  })

  it('weigert een ISO-datum die niet bestaat', () => {
    const row = one('2026-02-30 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
    // Het token is wél uit de regel gehaald, anders zou het in de naam belanden.
    expect(row.opponent).toBe('DVC')
  })

  it('leest een Nederlandse tekstdatum, ook afgekort en met punt', () => {
    expect(one('12 september 2026 DVC').date).toBe('2026-09-12')
    expect(one('12 sept. 2026 DVC').date).toBe('2026-09-12')
    expect(one('1 mrt 2026 DVC').date).toBe('2026-03-01')
    expect(one('5 mei 2026 DVC').date).toBe('2026-05-05')
  })

  it('raadt geen seizoensjaar bij een ontbrekend jaartal', () => {
    const row = one('12 september DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
    expect(row.opponent).toBe('DVC')
  })

  it('raadt niet bij een onbekende maandnaam', () => {
    const row = one('12 sptember 2026 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
  })

  it('neemt een ondubbelzinnige dag-maand-jaar over', () => {
    expect(one('13-09-2026 DVC').date).toBe('2026-09-13')
    expect(one('13/09/2026 DVC').date).toBe('2026-09-13')
    expect(one('13.9.2026 DVC').date).toBe('2026-09-13')
  })

  it('laat een dubbelzinnige numerieke datum leeg', () => {
    const row = one('03-04-2026 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
    expect(row.opponent).toBe('DVC')
  })

  it('leest een numerieke datum nooit als maand-dag-jaar', () => {
    const row = one('09-13-2026 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
  })

  it('vult een tweecijferig jaartal niet aan', () => {
    const row = one('13-09-26 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
    expect(row.opponent).toBe('DVC')
  })

  it('weigert een niet-bestaande dag-maand-combinatie', () => {
    const row = one('31-02-2026 DVC')
    expect(row.date).toBe('')
    expect(row.uncertain).toContain('date')
  })

  it('gebruikt de weekdag nergens voor en strippt hem weg', () => {
    for (const prefix of ['za ', 'zaterdag ', 'ZA, ', 'vr. ']) {
      const row = one(`${prefix}2026-09-12 DVC`)
      expect(row.date).toBe('2026-09-12')
      expect(row.opponent).toBe('DVC')
    }
  })
})

describe('parseMatchesFromText — tijd', () => {
  it('normaliseert de schrijfwijzen naar HH:MM', () => {
    expect(one('2026-09-12 9:30 DVC').time).toBe('09:30')
    expect(one('2026-09-12 14.30 DVC').time).toBe('14:30')
    expect(one('2026-09-12 14u30 DVC').time).toBe('14:30')
  })

  it('laat de tijd leeg zonder twijfelmelding als er geen tijd staat', () => {
    const row = one('2026-09-12 thuis competitie DVC')
    expect(row.time).toBe('')
    expect(row.uncertain).toEqual([])
  })

  it('weigert een tijd buiten het bereik', () => {
    const row = one('2026-09-12 25:00 DVC')
    expect(row.time).toBe('')
    expect(row.uncertain).toContain('time')
    expect(row.opponent).toBe('DVC')
  })

  it('laat beide tijdvelden leeg bij twee tijden op één regel', () => {
    const row = one('2026-09-12 13:45 14:30 thuis competitie DVC')
    expect(row.time).toBe('')
    expect(row.gather_time).toBe('')
    expect(row.uncertain).toContain('time')
    expect(row.opponent).toBe('DVC')
  })

  it('verwart een datum met punten niet met een tijd', () => {
    const row = one('13.9.2026 14.30 DVC')
    expect(row.date).toBe('2026-09-13')
    expect(row.time).toBe('14:30')
  })
})

describe('parseMatchesFromText — thuis/uit', () => {
  it('herkent thuis en uit, in beide talen', () => {
    expect(one('2026-09-12 thuis DVC').home_away).toBe('home')
    expect(one('2026-09-12 UIT DVC').home_away).toBe('away')
    expect(one('2026-09-12 home DVC').home_away).toBe('home')
    expect(one('2026-09-12 away DVC').home_away).toBe('away')
  })

  it('herkent (T), (H) en (U)', () => {
    expect(one('2026-09-12 DVC (T)').home_away).toBe('home')
    expect(one('2026-09-12 DVC (h)').home_away).toBe('home')
    expect(one('2026-09-12 DVC (U)').home_away).toBe('away')
    expect(one('2026-09-12 DVC ( u )').home_away).toBe('away')
  })

  it('herkent losse letters zonder haakjes niet', () => {
    const row = one('2026-09-12 DVC T')
    expect(row.home_away).toBe('')
    expect(row.uncertain).toContain('home_away')
    expect(row.opponent).toBe('DVC T')
  })

  it('twijfelt bij zowel thuis als uit op één regel', () => {
    const row = one('2026-09-12 thuis of uit DVC')
    expect(row.home_away).toBe('')
    expect(row.uncertain).toContain('home_away')
  })

  it('twijfelt als er niets staat', () => {
    expect(one('2026-09-12 DVC').uncertain).toContain('home_away')
  })
})

describe('parseMatchesFromText — wedstrijdtype', () => {
  it('herkent de drie types', () => {
    expect(one('2026-09-12 competitie DVC').match_type).toBe('league')
    expect(one('2026-09-12 comp. DVC').match_type).toBe('league')
    expect(one('2026-09-12 league DVC').match_type).toBe('league')
    expect(one('2026-09-12 beker DVC').match_type).toBe('cup')
    expect(one('2026-09-12 cup DVC').match_type).toBe('cup')
    expect(one('2026-09-12 oefen DVC').match_type).toBe('friendly')
    expect(one('2026-09-12 oefenwedstrijd DVC').match_type).toBe('friendly')
    expect(one('2026-09-12 vriendschappelijk DVC').match_type).toBe('friendly')
  })

  it('haalt het gevonden type uit de tegenstandernaam', () => {
    expect(one('2026-09-12 competitie DVC').opponent).toBe('DVC')
    expect(one('2026-09-12 comp. DVC').opponent).toBe('DVC')
  })

  it('twijfelt bij twee types op één regel', () => {
    const row = one('2026-09-12 beker of competitie DVC')
    expect(row.match_type).toBe('')
    expect(row.uncertain).toContain('match_type')
  })

  it('vult nooit een standaardtype in als er niets staat', () => {
    // Bewuste afwijking van het losse formulier, dat 'competitie' voorselecteert.
    const row = one('2026-09-12 thuis DVC')
    expect(row.match_type).toBe('')
    expect(row.uncertain).toContain('match_type')
  })
})

describe('parseMatchesFromText — tegenstander', () => {
  it('strippt tegen, vs en vs.', () => {
    expect(one('2026-09-12 tegen DVC').opponent).toBe('DVC')
    expect(one('2026-09-12 vs DVC').opponent).toBe('DVC')
    expect(one('2026-09-12 vs. DVC').opponent).toBe('DVC')
  })

  it('haalt scheidingstekens en dubbele spaties weg', () => {
    expect(one('2026-09-12 - DVC  Zaterdag 1 -').opponent).toBe('DVC Zaterdag 1')
    expect(one('2026-09-12 | DVC;').opponent).toBe('DVC')
  })

  it('twijfelt als er geen naam overblijft', () => {
    const row = one('2026-09-12 14:30 thuis competitie')
    expect(row.opponent).toBe('')
    expect(row.uncertain).toEqual(['opponent'])
  })

  it('kapt een te lange naam niet af (de validatie weigert hem)', () => {
    const naam = 'A'.repeat(120)
    expect(one(`2026-09-12 ${naam}`).opponent).toBe(naam)
  })
})

describe('parseMatchesFromText — twijfelgevallen', () => {
  it('somt alle twijfelvelden op en bewaart de bronregel', () => {
    const regel = '03-04-2026 25:00 DVC'
    const row = one(regel)
    expect(row.uncertain).toEqual(['date', 'time', 'home_away', 'match_type'])
    expect(row.sourceLine).toBe(regel)
  })

  it('geeft een lege uncertain-lijst bij een volledige regel', () => {
    expect(one('2026-09-12 14:30 uit beker DVC').uncertain).toEqual([])
  })
})
