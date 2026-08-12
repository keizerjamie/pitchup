// CSV-parser voor "wedstrijden bulk toevoegen".
//
// Bewust géén library: het formaat ligt volledig vast (acht kolommen, twee
// mogelijke scheidingstekens) en een eigen mini-parser is hier kleiner én
// beter te testen dan een afhankelijkheid. Voor .xlsx kan dat niet — dat is een
// ZIP met XML, zie lib/bulk-matches-xlsx.ts.

import {
  BULK_HEADERS,
  BULK_HEADER_LINE,
  MAX_PREVIEW_ROWS,
  rowFromColumns,
  type BulkParseResult,
  type ParsedMatchRow,
} from '@/lib/bulk-matches'

const DELIMITERS = [';', ','] as const

export const CSV_HEADER_ERROR =
  `De kopregel klopt niet. Gebruik exact deze acht kolommen: ${BULK_HEADER_LINE}`
export const CSV_EMPTY_ERROR = 'Het bestand bevat geen wedstrijden onder de kopregel.'
export const CSV_TOO_MANY_ERROR =
  `Het bestand bevat meer dan ${MAX_PREVIEW_ROWS} wedstrijden. Splits het op in kleinere bestanden.`

// Splitst CSV-tekst in rijen van velden. Ondersteunt gequote velden ("): daarin
// mogen scheidingstekens en regeleinden staan, en "" is een letterlijk
// aanhalingsteken. Regeleinden: \r\n, \n en \r.
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') { inQuotes = true; continue }
    if (char === delimiter) { row.push(field); field = ''; continue }
    if (char === '\r' || char === '\n') {
      // \r\n telt als één regeleinde.
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }

  // Laatste regel zonder afsluitend regeleinde.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function headerMatches(cells: string[] | undefined): boolean {
  if (!cells || cells.length !== BULK_HEADERS.length) return false
  return BULK_HEADERS.every((name, i) => cells[i].trim().toLowerCase() === name)
}

function isEmptyRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === '')
}

// Parseert een volledig CSV-bestand (als tekst) naar previewrijen.
// Weigert het hele bestand bij een afwijkende kopregel — er wordt bewust geen
// poging gedaan om afwijkende kolommen alsnog te herkennen.
export function parseMatchesFromCsv(text: string): BulkParseResult {
  // BOM strippen: Excel schrijft die standaard voor UTF-8 en hij zou anders in
  // de eerste kopnaam blijven plakken.
  const clean = text.replace(/^﻿/, '')

  // Eerst ';', dan ',': geaccepteerd wordt alleen de variant waarmee de kopregel
  // exact overeenkomt.
  let table: string[][] | null = null
  for (const delimiter of DELIMITERS) {
    const candidate = splitCsv(clean, delimiter)
    if (headerMatches(candidate[0])) { table = candidate; break }
  }
  if (!table) return { ok: false, error: CSV_HEADER_ERROR }

  // Lege regels (ook halverwege) tellen niet mee; het regelnummer uit het
  // bestand houden we vast voor de foutmelding.
  const dataRows = table
    .map((cells, index) => ({ cells, lineNo: index + 1 }))
    .slice(1)
    .filter(({ cells }) => !isEmptyRow(cells))

  if (dataRows.length === 0) return { ok: false, error: CSV_EMPTY_ERROR }
  if (dataRows.length > MAX_PREVIEW_ROWS) return { ok: false, error: CSV_TOO_MANY_ERROR }

  const rows: ParsedMatchRow[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const { cells, lineNo } = dataRows[i]
    if (cells.length !== BULK_HEADERS.length) {
      // Regelnummer zoals de trainer het in zijn bestand ziet: kopregel = 1.
      return {
        ok: false,
        error: `Regel ${lineNo} heeft ${cells.length} kolommen; er zijn er ${BULK_HEADERS.length} nodig.`,
      }
    }
    rows.push(rowFromColumns(cells, i))
  }

  return { ok: true, rows }
}
