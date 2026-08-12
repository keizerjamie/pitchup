import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseMatchesFromCsv, splitCsv } from '@/lib/bulk-matches-csv'
import { MAX_BULK_MATCHES, MAX_PREVIEW_ROWS, validateBulkRow } from '@/lib/bulk-matches'

const HEADER = 'datum;tijd;tegenstander;thuis_uit;wedstrijdtype;locatie;verzameltijd;notities'
const ROW = '2026-09-12;14:30;FC Voorbeeld;thuis;competitie;Sportpark de Meent;13:45;Shirts mee'

function rowsOf(result: ReturnType<typeof parseMatchesFromCsv>) {
  if (!result.ok) throw new Error(`verwachtte ok:true, kreeg: ${result.error}`)
  return result.rows
}

function errorOf(result: ReturnType<typeof parseMatchesFromCsv>) {
  if (result.ok) throw new Error('verwachtte ok:false')
  return result.error
}

// Bouwt een bestand met n identieke datarijen, elk met een eigen datum.
function withRows(n: number, delimiter = ';'): string {
  const lines = [HEADER.split(';').join(delimiter)]
  for (let i = 0; i < n; i++) {
    const day = String((i % 28) + 1).padStart(2, '0')
    lines.push(['2026-09-' + day, '14:30', `Club ${i}`, 'thuis', 'competitie', '', '', ''].join(delimiter))
  }
  return lines.join('\n')
}

describe('parseMatchesFromCsv — kopregel', () => {
  it('leest een bestand met puntkomma als scheidingsteken', () => {
    const rows = rowsOf(parseMatchesFromCsv(`${HEADER}\n${ROW}`))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'r0',
      date: '2026-09-12',
      time: '14:30',
      opponent: 'FC Voorbeeld',
      home_away: 'home',
      match_type: 'league',
      location: 'Sportpark de Meent',
      gather_time: '13:45',
      notes: 'Shirts mee',
      uncertain: [],
    })
    expect(validateBulkRow(rows[0])).toEqual([])
  })

  it('leest een bestand met komma als scheidingsteken', () => {
    const rows = rowsOf(parseMatchesFromCsv(
      `${HEADER.split(';').join(',')}\n2026-09-12,14:30,FC Voorbeeld,uit,beker,,,`,
    ))
    expect(rows[0]).toMatchObject({ opponent: 'FC Voorbeeld', home_away: 'away', match_type: 'cup' })
  })

  it('strippt de BOM die Excel voor UTF-8 schrijft', () => {
    const rows = rowsOf(parseMatchesFromCsv(`﻿${HEADER}\n${ROW}`))
    expect(rows[0].date).toBe('2026-09-12')
  })

  it('accepteert \\r\\n als regeleinde', () => {
    const rows = rowsOf(parseMatchesFromCsv(`${HEADER}\r\n${ROW}\r\n`))
    expect(rows).toHaveLength(1)
    expect(rows[0].notes).toBe('Shirts mee')
  })

  it('accepteert \\r als regeleinde', () => {
    expect(rowsOf(parseMatchesFromCsv(`${HEADER}\r${ROW}`))).toHaveLength(1)
  })

  it('weigert een afwijkende kopregel zonder alsnog te raden', () => {
    const anders = 'datum;tijd;tegenstander;thuis;wedstrijdtype;locatie;verzameltijd;notities'
    expect(errorOf(parseMatchesFromCsv(`${anders}\n${ROW}`))).toContain('kopregel')
  })

  it('weigert een kopregel in een andere volgorde', () => {
    const omgedraaid = 'tijd;datum;tegenstander;thuis_uit;wedstrijdtype;locatie;verzameltijd;notities'
    expect(errorOf(parseMatchesFromCsv(`${omgedraaid}\n${ROW}`))).toContain('kopregel')
  })

  it('weigert een kopregel met een kolom te weinig of te veel', () => {
    const teWeinig = 'datum;tijd;tegenstander;thuis_uit;wedstrijdtype;locatie;verzameltijd'
    const teVeel = `${HEADER};extra`
    expect(errorOf(parseMatchesFromCsv(`${teWeinig}\n${ROW}`))).toContain('kopregel')
    expect(errorOf(parseMatchesFromCsv(`${teVeel}\n${ROW};x`))).toContain('kopregel')
  })

  it('weigert een bestand met alleen een kopregel', () => {
    expect(errorOf(parseMatchesFromCsv(HEADER))).toContain('geen wedstrijden')
    expect(errorOf(parseMatchesFromCsv(`${HEADER}\n\n\n`))).toContain('geen wedstrijden')
  })

  it('weigert een leeg bestand', () => {
    expect(errorOf(parseMatchesFromCsv(''))).toContain('kopregel')
  })
})

describe('parseMatchesFromCsv — velden', () => {
  it('laat lege optionele kolommen leeg', () => {
    const rows = rowsOf(parseMatchesFromCsv(`${HEADER}\n2026-09-26;;VV Derde;thuis;beker;;;`))
    expect(rows[0]).toMatchObject({
      date: '2026-09-26', time: '', location: '', gather_time: '', notes: '',
    })
    expect(validateBulkRow(rows[0])).toEqual([])
  })

  it('leest een gequote veld met het scheidingsteken erin', () => {
    const rows = rowsOf(parseMatchesFromCsv(
      `${HEADER}\n2026-09-12;14:30;"Ajax; de echte";thuis;competitie;;;`,
    ))
    expect(rows[0].opponent).toBe('Ajax; de echte')
  })

  it('leest een gequote veld met een regeleinde erin', () => {
    const rows = rowsOf(parseMatchesFromCsv(
      `${HEADER}\n2026-09-12;14:30;DVC;thuis;competitie;;;"regel 1\nregel 2"`,
    ))
    expect(rows).toHaveLength(1)
    expect(rows[0].notes).toBe('regel 1\nregel 2')
  })

  it('leest "" als een letterlijk aanhalingsteken', () => {
    const rows = rowsOf(parseMatchesFromCsv(
      `${HEADER}\n2026-09-12;14:30;"VV ""De Kanjers""";thuis;competitie;;;`,
    ))
    expect(rows[0].opponent).toBe('VV "De Kanjers"')
  })

  it('geeft elke rij een eigen, stabiele id', () => {
    const rows = rowsOf(parseMatchesFromCsv(withRows(3)))
    expect(rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2'])
  })

  it('negeert lege regels tussen de wedstrijden', () => {
    const rows = rowsOf(parseMatchesFromCsv(`${HEADER}\n${ROW}\n\n${ROW}\n`))
    expect(rows).toHaveLength(2)
  })

  it('weigert een regel met een afwijkend aantal kolommen, met regelnummer', () => {
    const kort = '2026-09-12;14:30;DVC;thuis;competitie'
    expect(errorOf(parseMatchesFromCsv(`${HEADER}\n${ROW}\n${kort}`))).toBe(
      'Regel 3 heeft 5 kolommen; er zijn er 8 nodig.',
    )
  })

  it('markeert onherkende waarden als rijfout in plaats van ze te raden', () => {
    const rows = rowsOf(parseMatchesFromCsv(
      `${HEADER}\n12-09-2026;14u30;DVC;thuiswedstrijd;competie;;;`,
    ))
    expect(rows[0].date).toBe('12-09-2026')
    expect(rows[0].home_away).toBe('')
    expect(rows[0].match_type).toBe('')
    expect(validateBulkRow(rows[0]).map((e) => `${e.field}:${e.code}`)).toEqual([
      'date:invalid', 'time:invalid', 'home_away:required', 'match_type:required',
    ])
  })
})

describe('parseMatchesFromCsv — aantallen', () => {
  it('leest precies 100 rijen', () => {
    expect(rowsOf(parseMatchesFromCsv(withRows(MAX_BULK_MATCHES)))).toHaveLength(MAX_BULK_MATCHES)
  })

  it('toont 101 rijen wél in de preview (de blokkade zit bij opslaan)', () => {
    const result = parseMatchesFromCsv(withRows(MAX_BULK_MATCHES + 1))
    expect(result.ok).toBe(true)
    expect(rowsOf(result)).toHaveLength(MAX_BULK_MATCHES + 1)
  })

  it('leest precies 200 rijen', () => {
    expect(rowsOf(parseMatchesFromCsv(withRows(MAX_PREVIEW_ROWS)))).toHaveLength(MAX_PREVIEW_ROWS)
  })

  it('weigert een bestand met 201 rijen', () => {
    expect(errorOf(parseMatchesFromCsv(withRows(MAX_PREVIEW_ROWS + 1)))).toContain('meer dan 200')
  })
})

describe('het voorbeeldbestand', () => {
  it('is met dezelfde parser te lezen en levert alleen geldige rijen', () => {
    // public/voorbeeld-wedstrijden.csv is wat de trainer downloadt; als dat
    // bestand ooit uit de pas loopt met de parser, faalt deze test.
    const csv = readFileSync(path.join(process.cwd(), 'public/voorbeeld-wedstrijden.csv'), 'utf8')
    const rows = rowsOf(parseMatchesFromCsv(csv))

    expect(rows).toHaveLength(3)
    for (const row of rows) expect(validateBulkRow(row)).toEqual([])
    expect(rows[0]).toMatchObject({
      date: '2026-09-12', time: '14:30', opponent: 'FC Voorbeeld',
      home_away: 'home', match_type: 'league', gather_time: '13:45',
    })
    expect(rows[2]).toMatchObject({ date: '2026-09-26', time: '', match_type: 'cup' })
  })
})

describe('splitCsv', () => {
  it('splitst een eenvoudige tabel', () => {
    expect(splitCsv('a;b\nc;d', ';')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('houdt lege velden aan het einde van een regel', () => {
    expect(splitCsv('a;;\n', ';')).toEqual([['a', '', '']])
  })
})
