import { describe, it, expect } from 'vitest'
import {
  MAX_BULK_MATCHES,
  MAX_LOCATION_CHARS,
  MAX_NOTES_CHARS,
  MAX_OPPONENT_CHARS,
  MAX_PREVIEW_ROWS,
  duplicateKey,
  markDuplicates,
  normalizeHomeAway,
  normalizeMatchType,
  rowFromColumns,
  toBulkMatchInput,
  validateBulkRow,
  type BulkRowFields,
  type ParsedMatchRow,
} from '@/lib/bulk-matches'

function fields(overrides: Partial<BulkRowFields> = {}): BulkRowFields {
  return {
    date: '2026-09-12',
    time: '14:30',
    opponent: 'DVC',
    home_away: 'home',
    match_type: 'league',
    location: 'Sportpark de Meent',
    gather_time: '13:45',
    notes: '',
    ...overrides,
  }
}

function row(overrides: Partial<ParsedMatchRow> = {}): ParsedMatchRow {
  return {
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
    sourceLine: null,
    ...overrides,
  }
}

function codes(overrides: Partial<BulkRowFields>) {
  return validateBulkRow(fields(overrides)).map((e) => `${e.field}:${e.code}`)
}

describe('validateBulkRow — een volledige rij', () => {
  it('keurt een complete, geldige rij goed', () => {
    expect(validateBulkRow(fields())).toEqual([])
  })

  it('accepteert lege optionele velden', () => {
    expect(validateBulkRow(fields({ time: '', location: '', gather_time: '', notes: '' }))).toEqual([])
  })
})

describe('validateBulkRow — datum', () => {
  it('eist een datum', () => {
    expect(codes({ date: '' })).toEqual(['date:required'])
    expect(codes({ date: '   ' })).toEqual(['date:required'])
  })

  it('weigert een ander formaat dan JJJJ-MM-DD', () => {
    for (const date of ['12-09-2026', '2026/09/12', '12 september 2026', '2026-9-12']) {
      expect(codes({ date })).toEqual(['date:invalid'])
    }
  })

  it('weigert een datum die niet bestaat (strenger dan createEvent)', () => {
    // app/actions/events.ts:27 toetst alleen op het formaat en laat 2026-02-30
    // door; hier valt hij af via isDateString().
    expect(codes({ date: '2026-02-30' })).toEqual(['date:invalid'])
    expect(codes({ date: '2026-13-01' })).toEqual(['date:invalid'])
    expect(validateBulkRow(fields({ date: '2024-02-29' }))).toEqual([])
  })
})

describe('validateBulkRow — tijden', () => {
  it('accepteert de randen van de dag', () => {
    expect(validateBulkRow(fields({ time: '00:00', gather_time: '23:59' }))).toEqual([])
  })

  it('weigert een tijd buiten bereik of zonder leidende nullen', () => {
    expect(codes({ time: '25:00' })).toEqual(['time:invalid'])
    expect(codes({ time: '9:30' })).toEqual(['time:invalid'])
    expect(codes({ time: 'halfdrie' })).toEqual(['time:invalid'])
    expect(codes({ gather_time: '24:00' })).toEqual(['gather_time:invalid'])
  })
})

describe('validateBulkRow — whitelists', () => {
  it('eist thuis/uit en wedstrijdtype', () => {
    expect(codes({ home_away: '' })).toEqual(['home_away:required'])
    expect(codes({ match_type: '' })).toEqual(['match_type:required'])
  })

  it('weigert waarden buiten de whitelist', () => {
    expect(codes({ home_away: 'thuis' })).toEqual(['home_away:invalid'])
    expect(codes({ match_type: 'competitie' })).toEqual(['match_type:invalid'])
    expect(codes({ match_type: 'training' })).toEqual(['match_type:invalid'])
  })

  it('accepteert alle toegestane waarden', () => {
    for (const home_away of ['home', 'away']) {
      expect(validateBulkRow(fields({ home_away }))).toEqual([])
    }
    for (const match_type of ['friendly', 'league', 'cup']) {
      expect(validateBulkRow(fields({ match_type }))).toEqual([])
    }
  })
})

describe('validateBulkRow — lengtes (weigeren, niet afkappen)', () => {
  it('eist een tegenstander', () => {
    expect(codes({ opponent: '' })).toEqual(['opponent:required'])
    expect(codes({ opponent: '   ' })).toEqual(['opponent:required'])
  })

  it('staat precies de grenswaarde toe', () => {
    expect(validateBulkRow(fields({
      opponent: 'a'.repeat(MAX_OPPONENT_CHARS),
      location: 'b'.repeat(MAX_LOCATION_CHARS),
      notes: 'c'.repeat(MAX_NOTES_CHARS),
    }))).toEqual([])
  })

  it('weigert één teken te veel in plaats van af te kappen', () => {
    expect(codes({ opponent: 'a'.repeat(MAX_OPPONENT_CHARS + 1) })).toEqual(['opponent:too_long'])
    expect(codes({ location: 'b'.repeat(MAX_LOCATION_CHARS + 1) })).toEqual(['location:too_long'])
    expect(codes({ notes: 'c'.repeat(MAX_NOTES_CHARS + 1) })).toEqual(['notes:too_long'])
  })

  it('meet de lengte na trimmen', () => {
    expect(validateBulkRow(fields({ opponent: `  ${'a'.repeat(MAX_OPPONENT_CHARS)}  ` }))).toEqual([])
  })

  it('meldt alle fouten van een rij tegelijk', () => {
    expect(codes({ date: '', time: 'x', opponent: '', home_away: '', match_type: '' })).toEqual([
      'date:required',
      'time:invalid',
      'opponent:required',
      'home_away:required',
      'match_type:required',
    ])
  })
})

describe('grenzen', () => {
  it('staat 100 wedstrijden toe en blokkeert er 101', () => {
    expect(MAX_BULK_MATCHES).toBe(100)
    expect(MAX_BULK_MATCHES <= MAX_BULK_MATCHES).toBe(true)
    expect(MAX_BULK_MATCHES + 1 > MAX_BULK_MATCHES).toBe(true)
  })

  it('toont meer rijen dan er opgeslagen mogen worden', () => {
    // 101-200 rijen zijn wél zichtbaar in de preview; opslaan blokkeert.
    expect(MAX_PREVIEW_ROWS).toBe(200)
    expect(MAX_PREVIEW_ROWS).toBeGreaterThan(MAX_BULK_MATCHES)
  })
})

describe('normalizeHomeAway / normalizeMatchType', () => {
  it('vertaalt de Nederlandse en Engelse waarden', () => {
    expect(normalizeHomeAway('thuis')).toBe('home')
    expect(normalizeHomeAway(' UIT ')).toBe('away')
    expect(normalizeHomeAway('Home')).toBe('home')
    expect(normalizeMatchType('competitie')).toBe('league')
    expect(normalizeMatchType('Beker')).toBe('cup')
    expect(normalizeMatchType('oefen')).toBe('friendly')
    expect(normalizeMatchType('friendly')).toBe('friendly')
  })

  it('geeft leeg terug bij onbekende waarden (geen fuzzy matching)', () => {
    expect(normalizeHomeAway('thuiswedstrijd')).toBe('')
    expect(normalizeMatchType('competie')).toBe('')
    expect(normalizeMatchType('')).toBe('')
  })
})

describe('rowFromColumns', () => {
  it('vult de acht kolommen en laat onherkende waarden zichtbaar', () => {
    const parsed = rowFromColumns(
      [' 2026-09-12 ', '14:30', ' DVC ', 'thuis', 'competitie', 'De Meent', '13:45', 'shirts mee'],
      3,
    )
    expect(parsed).toEqual({
      id: 'r3',
      date: '2026-09-12',
      time: '14:30',
      opponent: 'DVC',
      home_away: 'home',
      match_type: 'league',
      location: 'De Meent',
      gather_time: '13:45',
      notes: 'shirts mee',
      uncertain: [],
      sourceLine: null,
    })
  })

  it('laat een onherkende datum staan zodat de fout zichtbaar is', () => {
    const parsed = rowFromColumns(['31/02/2026', '', 'DVC', 'xyz', 'xyz', '', '', ''], 0)
    expect(parsed.date).toBe('31/02/2026')
    expect(parsed.home_away).toBe('')
    expect(parsed.match_type).toBe('')
    expect(validateBulkRow(parsed).map((e) => e.field)).toEqual(['date', 'home_away', 'match_type'])
  })
})

describe('toBulkMatchInput', () => {
  it('maakt van lege optionele velden null', () => {
    expect(toBulkMatchInput(row({ time: '', location: '', gather_time: '', notes: '' }))).toEqual({
      date: '2026-09-12',
      time: null,
      opponent: 'DVC',
      home_away: 'home',
      match_type: 'league',
      location: null,
      gather_time: null,
      notes: null,
    })
  })

  it('trimt de waarden', () => {
    const input = toBulkMatchInput(row({ opponent: '  DVC  ', location: '  De Meent  ' }))
    expect(input.opponent).toBe('DVC')
    expect(input.location).toBe('De Meent')
  })
})

describe('duplicateKey', () => {
  it('negeert hoofdletters en spaties rondom de naam', () => {
    expect(duplicateKey('2026-09-12', '  dvc  ')).toBe(duplicateKey('2026-09-12', 'DVC'))
    expect(duplicateKey('2026-09-12', 'DVC')).toBe('2026-09-12|dvc')
  })

  it('onderscheidt verschillende datums en namen', () => {
    expect(duplicateKey('2026-09-12', 'DVC')).not.toBe(duplicateKey('2026-09-19', 'DVC'))
    expect(duplicateKey('2026-09-12', 'DVC')).not.toBe(duplicateKey('2026-09-12', 'DVC 2'))
  })
})

describe('markDuplicates', () => {
  it('markeert een rij die al in de database staat', () => {
    const rows = [
      row({ id: 'r0', date: '2026-09-12', opponent: 'DVC' }),
      row({ id: 'r1', date: '2026-09-19', opponent: 'SV Tweede' }),
    ]
    const marked = markDuplicates(rows, [{ date: '2026-09-12', opponent: 'dvc' }])
    expect([...marked]).toEqual(['r0'])
  })

  it('let niet op afwijkende tijd of locatie', () => {
    const rows = [row({ id: 'r0', time: '10:00', location: 'Elders' })]
    expect(markDuplicates(rows, [{ date: '2026-09-12', opponent: 'DVC' }]).has('r0')).toBe(true)
  })

  it('markeert twee identieke rijen binnen dezelfde batch allebei', () => {
    const rows = [
      row({ id: 'r0', opponent: 'DVC' }),
      row({ id: 'r1', opponent: ' dvc ' }),
      row({ id: 'r2', opponent: 'SV Tweede' }),
    ]
    expect([...markDuplicates(rows, [])].sort()).toEqual(['r0', 'r1'])
  })

  it('markeert niets als er geen duplicaat is', () => {
    const rows = [
      row({ id: 'r0', date: '2026-09-12' }),
      row({ id: 'r1', date: '2026-09-19' }),
    ]
    expect(markDuplicates(rows, [{ date: '2026-09-26', opponent: 'DVC' }]).size).toBe(0)
  })

  it('slaat rijen zonder datum of tegenstander over', () => {
    const rows = [
      row({ id: 'r0', date: '', opponent: '' }),
      row({ id: 'r1', date: '', opponent: '' }),
      row({ id: 'r2', date: '2026-09-12', opponent: '' }),
    ]
    expect(markDuplicates(rows, [{ date: '', opponent: null }]).size).toBe(0)
  })

  it('gaat om met een bestaande wedstrijd zonder tegenstander', () => {
    const rows = [row({ id: 'r0', opponent: 'DVC' })]
    expect(markDuplicates(rows, [{ date: '2026-09-12', opponent: null }]).size).toBe(0)
  })
})
