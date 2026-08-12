// Excel-parser (.xlsx) voor "wedstrijden bulk toevoegen".
//
// Anders dan bij CSV is een eigen parser hier geen optie: .xlsx is een
// ZIP-container met XML. Daarvoor draait exceljs (productie-dependency).
// De import is dynamisch, zodat het CSV-pad de library niet meelaadt.
//
// TIJDZONES — de belangrijkste valkuil van dit bestand: exceljs geeft een als
// datum/tijd geformatteerde cel terug als JS `Date`, opgebouwd uit
// UTC-componenten (14:30 in de cel → 1899-12-30T14:30:00.000Z). Formatteren met
// lokale getters zou de waarde dus met de servertijdzone verschuiven: op een
// UTC-8-server wordt 2026-09-12 dan 2026-09-11. We lezen daarom UITSLUITEND met
// getUTC*(), net als lib/season-dates.ts.

import {
  BULK_HEADERS,
  MAX_PREVIEW_ROWS,
  rowFromColumns,
  type BulkParseResult,
  type ParsedMatchRow,
} from '@/lib/bulk-matches'
import { CSV_EMPTY_ERROR, CSV_HEADER_ERROR, CSV_TOO_MANY_ERROR } from '@/lib/bulk-matches-csv'

export const XLSX_NO_SHEET_ERROR = 'Het Excel-bestand bevat geen werkblad.'

// Bovengrens op het aantal rijen dat we überhaupt aflopen. Een klein .xlsx-
// bestand kan enorm veel (lege, opgemaakte) rijen bevatten; zonder deze grens
// bepaalt het bestand hoe lang de lus draait.
export const MAX_XLSX_SCAN_ROWS = 10_000

// Eigen melding voor die noodrem. Bewust géén woord over "wedstrijden": op dit
// punt is nog geen enkele rij ingelezen, dus we weten niet of het er 200+ zijn.
// Meestal gaat het om lege, ooit opgemaakte cellen onder het programma.
export const XLSX_TOO_MANY_SCAN_ROWS_ERROR =
  `Dit werkblad heeft te veel rijen om te verwerken (meer dan ${MAX_XLSX_SCAN_ROWS}). ` +
  'Verwijder de lege rijen onderaan het blad, of splits het bestand op.'

type CellKind = 'date' | 'time' | 'text'

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

// Zet een celwaarde om naar tekst. `kind` bepaalt hoe een Date-cel wordt
// geformatteerd; altijd via getUTC*() (zie kopcommentaar).
export function cellToString(value: unknown, kind: CellKind = 'text'): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    if (kind === 'time') return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`
    return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }

  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return String(value)

  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>
    // Foutcel (#REF!, #N/A) levert geen bruikbare waarde op.
    if ('error' in cell) return ''
    // Formulecel: de doorgerekende uitkomst, niet de formule zelf.
    if ('result' in cell) return cellToString(cell.result, kind)
    if (Array.isArray(cell.richText)) {
      // Losse fragmenten worden aan elkaar geplakt zonder ze eerst te trimmen:
      // de spatie in "FC " + "Vet" hoort bij de naam.
      return cell.richText
        .map((part) => {
          const text = (part as { text?: unknown })?.text
          return typeof text === 'string' ? text : ''
        })
        .join('')
        .trim()
    }
    // Hyperlinkcel: { text, hyperlink }.
    if ('text' in cell) return cellToString(cell.text, kind)
  }

  return ''
}

// Per kolom hoe een Date-cel gelezen moet worden (kolom 1 = datum,
// 2 = tijd, 7 = verzameltijd).
const COLUMN_KINDS: CellKind[] = ['date', 'time', 'text', 'text', 'text', 'text', 'time', 'text']

type ExcelJsNamespace = typeof import('exceljs')

async function loadExcelJs(): Promise<ExcelJsNamespace> {
  // exceljs is CommonJS: afhankelijk van de bundler zit de export op `default`
  // of direct op de namespace.
  const mod = (await import('exceljs')) as unknown as ExcelJsNamespace & { default?: ExcelJsNamespace }
  return mod.default ?? mod
}

// Leest een .xlsx-bestand naar previewrijen. Alleen het EERSTE werkblad telt;
// overige bladen worden genegeerd. Wijkt de kopregel van blad 1 af, dan wordt
// het hele bestand geweigerd — er wordt niet in andere bladen gezocht.
export async function parseMatchesFromXlsx(input: Uint8Array | ArrayBuffer): Promise<BulkParseResult> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  // De typing van exceljs eist een Node-Buffer; load() accepteert in de praktijk
  // elke ArrayBufferView. We geven bewust geen Buffer door, zodat dit bestand
  // ook buiten Node bruikbaar blijft.
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])

  const sheet = workbook.worksheets[0]
  if (!sheet) return { ok: false, error: XLSX_NO_SHEET_ERROR }

  const headerRow = sheet.getRow(1)
  const header = BULK_HEADERS.map((_, i) => cellToString(headerRow.getCell(i + 1).value).toLowerCase())
  const extraHeader = cellToString(headerRow.getCell(BULK_HEADERS.length + 1).value)
  if (extraHeader !== '' || BULK_HEADERS.some((name, i) => header[i] !== name)) {
    return { ok: false, error: CSV_HEADER_ERROR }
  }

  const lastRow = sheet.rowCount
  // Noodrem op de scan zelf — een ander geval dan "meer dan 200 herkende
  // wedstrijden" hieronder, en dus een andere melding.
  if (lastRow - 1 > MAX_XLSX_SCAN_ROWS) return { ok: false, error: XLSX_TOO_MANY_SCAN_ROWS_ERROR }

  const rows: ParsedMatchRow[] = []
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    const cells = COLUMN_KINDS.map((kind, i) => cellToString(row.getCell(i + 1).value, kind))
    if (cells.every((cell) => cell === '')) continue
    if (rows.length >= MAX_PREVIEW_ROWS) return { ok: false, error: CSV_TOO_MANY_ERROR }
    rows.push(rowFromColumns(cells, rows.length))
  }

  if (rows.length === 0) return { ok: false, error: CSV_EMPTY_ERROR }

  return { ok: true, rows }
}
