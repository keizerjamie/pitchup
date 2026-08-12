// @vitest-environment node
//
// Node-omgeving (geen jsdom): exceljs is een Node-library en de fixtures worden
// hier met exceljs zélf gegenereerd — geen binair bestand in git.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import ExcelJS from 'exceljs'
import {
  cellToString,
  parseMatchesFromXlsx,
  MAX_XLSX_SCAN_ROWS,
  XLSX_NO_SHEET_ERROR,
  XLSX_TOO_MANY_SCAN_ROWS_ERROR,
} from '@/lib/bulk-matches-xlsx'
import { BULK_HEADERS, MAX_PREVIEW_ROWS, type BulkParseResult } from '@/lib/bulk-matches'

// De hele suite draait in een tijdzone áchter UTC. Zou het inlezen lokale
// datum-getters gebruiken, dan schuift 2026-09-12T00:00Z naar 2026-09-11 en
// 14:30 naar 07:30 — precies de drift die lib/season-dates.ts ooit moest
// repareren.
const ORIGINAL_TZ = process.env.TZ

beforeAll(() => { process.env.TZ = 'America/Los_Angeles' })
afterAll(() => { process.env.TZ = ORIGINAL_TZ })

const DATA_ROW = ['2026-09-12', '14:30', 'FC Voorbeeld', 'thuis', 'competitie', 'De Meent', '13:45', 'Shirts mee']

type CellValue = ExcelJS.CellValue

async function toBuffer(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

// Werkblad met de standaard kopregel en de meegegeven datarijen.
async function sheetWith(rows: CellValue[][], sheetName = 'Blad1'): Promise<Uint8Array> {
  return toBuffer((workbook) => {
    const sheet = workbook.addWorksheet(sheetName)
    sheet.addRow([...BULK_HEADERS])
    for (const row of rows) sheet.addRow(row)
  })
}

function rowsOf(result: BulkParseResult) {
  if (!result.ok) throw new Error(`verwachtte ok:true, kreeg: ${result.error}`)
  return result.rows
}

function errorOf(result: BulkParseResult) {
  if (result.ok) throw new Error('verwachtte ok:false')
  return result.error
}

describe('de testtijdzone staat echt aan', () => {
  it('draait in een tijdzone achter UTC', () => {
    // Zonder deze controle zou de tijdzone-regressietest hieronder vals
    // geruststellend zijn.
    expect(new Date(Date.UTC(2026, 8, 12)).getDate()).toBe(11)
  })
})

describe('parseMatchesFromXlsx — inlezen', () => {
  it('leest een werkblad met de vaste kopregel', async () => {
    const rows = rowsOf(await parseMatchesFromXlsx(await sheetWith([DATA_ROW])))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'r0',
      date: '2026-09-12',
      time: '14:30',
      opponent: 'FC Voorbeeld',
      home_away: 'home',
      match_type: 'league',
      location: 'De Meent',
      gather_time: '13:45',
      notes: 'Shirts mee',
      uncertain: [],
    })
  })

  it('slaat lege rijen tussen de wedstrijden over', async () => {
    const rows = rowsOf(await parseMatchesFromXlsx(await sheetWith([DATA_ROW, [], DATA_ROW])))
    expect(rows.map((r) => r.id)).toEqual(['r0', 'r1'])
  })

  it('weigert een afwijkende kopregel', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow(['datum', 'tijd', 'tegenstander', 'thuis', 'wedstrijdtype', 'locatie', 'verzameltijd', 'notities'])
      sheet.addRow(DATA_ROW)
    })
    expect(errorOf(await parseMatchesFromXlsx(buffer))).toContain('kopregel')
  })

  it('weigert een kopregel met een extra kolom', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS, 'extra'])
      sheet.addRow(DATA_ROW)
    })
    expect(errorOf(await parseMatchesFromXlsx(buffer))).toContain('kopregel')
  })

  it('weigert een bestand met alleen een kopregel', async () => {
    expect(errorOf(await parseMatchesFromXlsx(await sheetWith([])))).toContain('geen wedstrijden')
  })

  it('weigert een werkmap zonder werkbladen', async () => {
    const buffer = await toBuffer(() => {})
    expect(errorOf(await parseMatchesFromXlsx(buffer))).toBe(XLSX_NO_SHEET_ERROR)
  })

  it('weigert meer dan 200 wedstrijden', async () => {
    const veel = Array.from({ length: MAX_PREVIEW_ROWS + 1 }, () => DATA_ROW as CellValue[])
    expect(errorOf(await parseMatchesFromXlsx(await sheetWith(veel)))).toContain('meer dan 200')
  })

  it('meldt bij een enorm werkblad dat het te veel RIJEN heeft, niet te veel wedstrijden', async () => {
    // Eén cel ver onder de kopregel blaast rowCount op terwijl er geen enkele
    // wedstrijd in staat — het typische ooit-opgemaakte sjabloon. De melding
    // over "meer dan 200 wedstrijden" zou hier pertinent onwaar zijn.
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS])
      sheet.addRow(DATA_ROW)
      sheet.getRow(MAX_XLSX_SCAN_ROWS + 2).getCell(1).value = 'x'
    })

    const error = errorOf(await parseMatchesFromXlsx(buffer))
    expect(error).toBe(XLSX_TOO_MANY_SCAN_ROWS_ERROR)
    expect(error).not.toContain('wedstrijden')
    expect(error).not.toContain(String(MAX_PREVIEW_ROWS))
  })

  it('leest precies 200 wedstrijden', async () => {
    const grens = Array.from({ length: MAX_PREVIEW_ROWS }, () => DATA_ROW as CellValue[])
    expect(rowsOf(await parseMatchesFromXlsx(await sheetWith(grens)))).toHaveLength(MAX_PREVIEW_ROWS)
  })

  it('accepteert een ArrayBuffer net zo goed als een Uint8Array', async () => {
    const bytes = await sheetWith([DATA_ROW])
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    expect(rowsOf(await parseMatchesFromXlsx(arrayBuffer))).toHaveLength(1)
  })
})

describe('parseMatchesFromXlsx — meerdere tabbladen', () => {
  it('leest alleen het eerste werkblad en negeert de rest', async () => {
    const buffer = await toBuffer((workbook) => {
      const eerste = workbook.addWorksheet('Wedstrijden')
      eerste.addRow([...BULK_HEADERS])
      eerste.addRow(DATA_ROW)

      const tweede = workbook.addWorksheet('Trainingen')
      tweede.addRow([...BULK_HEADERS])
      tweede.addRow(['2026-10-01', '19:00', 'Blad twee', 'uit', 'beker', '', '', ''])
    })

    const rows = rowsOf(await parseMatchesFromXlsx(buffer))
    expect(rows).toHaveLength(1)
    expect(rows[0].opponent).toBe('FC Voorbeeld')
  })

  it('weigert het hele bestand als de kopregel op blad 1 afwijkt, ook als blad 2 klopt', async () => {
    const buffer = await toBuffer((workbook) => {
      const eerste = workbook.addWorksheet('Leeswijzer')
      eerste.addRow(['Vul de volgende tab in'])

      const tweede = workbook.addWorksheet('Wedstrijden')
      tweede.addRow([...BULK_HEADERS])
      tweede.addRow(DATA_ROW)
    })

    expect(errorOf(await parseMatchesFromXlsx(buffer))).toContain('kopregel')
  })
})

describe('parseMatchesFromXlsx — celtypes', () => {
  it('leest een echte datumcel als 2026-09-12 (tijdzone-regressie)', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS])
      const row = sheet.addRow([
        new Date(Date.UTC(2026, 8, 12)),
        new Date(Date.UTC(1899, 11, 30, 14, 30)),
        'FC Voorbeeld', 'thuis', 'competitie', '',
        new Date(Date.UTC(1899, 11, 30, 13, 45)),
        '',
      ])
      row.getCell(1).numFmt = 'yyyy-mm-dd'
      row.getCell(2).numFmt = 'hh:mm'
      row.getCell(7).numFmt = 'hh:mm'
    })

    const rows = rowsOf(await parseMatchesFromXlsx(buffer))
    expect(rows[0].date).toBe('2026-09-12')
    expect(rows[0].time).toBe('14:30')
    expect(rows[0].gather_time).toBe('13:45')
  })

  it('leest een datum-tijdcel in de datumkolom als kale datum', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS])
      sheet.addRow([new Date(Date.UTC(2026, 8, 12, 14, 30)), '14:30', 'DVC', 'thuis', 'competitie', '', '', ''])
    })
    expect(rowsOf(await parseMatchesFromXlsx(buffer))[0].date).toBe('2026-09-12')
  })

  it('gebruikt de uitkomst van een formulecel, niet de formule', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS])
      const row = sheet.addRow([])
      row.getCell(1).value = { formula: 'A1', result: '2026-09-12' }
      row.getCell(2).value = ''
      row.getCell(3).value = { formula: 'C1', result: 'FC Formule' }
      row.getCell(4).value = 'thuis'
      row.getCell(5).value = 'competitie'
    })

    const rows = rowsOf(await parseMatchesFromXlsx(buffer))
    expect(rows[0].date).toBe('2026-09-12')
    expect(rows[0].opponent).toBe('FC Formule')
  })

  it('leest opgemaakte tekst (richText) als platte tekst', async () => {
    const buffer = await toBuffer((workbook) => {
      const sheet = workbook.addWorksheet('Blad1')
      sheet.addRow([...BULK_HEADERS])
      const row = sheet.addRow(['2026-09-12', '', '', 'thuis', 'competitie', '', '', ''])
      row.getCell(3).value = { richText: [{ text: 'FC ' }, { text: 'Vet' }] }
    })
    expect(rowsOf(await parseMatchesFromXlsx(buffer))[0].opponent).toBe('FC Vet')
  })
})

describe('cellToString', () => {
  it('formatteert Date-cellen met UTC-componenten', () => {
    const date = new Date(Date.UTC(2026, 0, 5, 23, 30))
    expect(cellToString(date, 'date')).toBe('2026-01-05')
    expect(cellToString(date, 'time')).toBe('23:30')
  })

  it('geeft lege tekst bij lege, ongeldige en foutcellen', () => {
    expect(cellToString(null)).toBe('')
    expect(cellToString(undefined)).toBe('')
    expect(cellToString({ error: '#REF!' })).toBe('')
    expect(cellToString(new Date(NaN), 'date')).toBe('')
  })

  it('leest getallen, hyperlinks en losse tekst', () => {
    expect(cellToString(42)).toBe('42')
    expect(cellToString('  DVC  ')).toBe('DVC')
    expect(cellToString({ text: 'DVC', hyperlink: 'https://example.com' })).toBe('DVC')
  })
})
