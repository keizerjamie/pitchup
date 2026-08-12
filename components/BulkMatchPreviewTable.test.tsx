import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import BulkMatchPreviewTable from '@/components/BulkMatchPreviewTable'
import type { BlockingReason } from '@/lib/use-bulk-match-rows'
import type { BulkRowError, ParsedMatchRow } from '@/lib/bulk-matches'

function makeRow(overrides: Partial<ParsedMatchRow> = {}): ParsedMatchRow {
  return {
    id: 'r0',
    date: '2026-09-12',
    time: '14:30',
    opponent: 'FC Voorbeeld',
    home_away: 'home',
    match_type: 'league',
    location: 'Sportpark de Meent',
    gather_time: '13:45',
    notes: '',
    uncertain: [],
    sourceLine: null,
    ...overrides,
  }
}

const noBlocking: BlockingReason = {
  blocked: false,
  isEmpty: false,
  errorRowCount: 0,
  uncertainRowCount: 0,
  tooMany: false,
  rowCount: 1,
  max: 100,
}

function renderTable(rows: ParsedMatchRow[], errorsByRow: Map<string, BulkRowError[]>) {
  return render(
    <DictProvider dict={nl}>
      <BulkMatchPreviewTable
        rows={rows}
        errorsByRow={errorsByRow}
        duplicateIds={new Set()}
        duplicateCheckFailed={false}
        blockingReason={{ ...noBlocking, rowCount: rows.length }}
        setField={vi.fn()}
        removeRow={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    </DictProvider>,
  )
}

describe('BulkMatchPreviewTable — ongeldige datum/tijd uit een bestand blijft leesbaar (Bevinding 2)', () => {
  it('een ongeldige datumstring uit een bestand ("31/02/2026") blijft zichtbaar in het datumveld in plaats van leeg te worden gesaneerd', () => {
    const row = makeRow({ date: '31/02/2026' })
    const errorsByRow = new Map<string, BulkRowError[]>([
      ['r0', [{ field: 'date', code: 'invalid' }]],
    ])
    renderTable([row], errorsByRow)

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    // Native date-inputs saneren een niet-passende waarde stilzwijgend naar
    // leeg; hier moet het een tekstveld zijn dat de rauwe waarde toont.
    expect(dateInput.type).toBe('text')
    expect(dateInput.value).toBe('31/02/2026')
  })

  it('een ongeldige tijdstring uit een bestand ("25:99") blijft zichtbaar in het tijdveld', () => {
    const row = makeRow({ time: '25:99' })
    const errorsByRow = new Map<string, BulkRowError[]>([
      ['r0', [{ field: 'time', code: 'invalid' }]],
    ])
    renderTable([row], errorsByRow)

    const timeInput = screen.getByLabelText(nl.event.bulk.columnHeaders.time) as HTMLInputElement
    expect(timeInput.type).toBe('text')
    expect(timeInput.value).toBe('25:99')
  })

  it('een geldige datum blijft een native date-input met picker', () => {
    const row = makeRow({ date: '2026-09-12' })
    renderTable([row], new Map())

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    expect(dateInput.type).toBe('date')
    expect(dateInput.value).toBe('2026-09-12')
  })

  it('een leeg, verplicht datumveld (code "required") blijft een native date-input, niet tekst', () => {
    const row = makeRow({ date: '' })
    const errorsByRow = new Map<string, BulkRowError[]>([
      ['r0', [{ field: 'date', code: 'required' }]],
    ])
    renderTable([row], errorsByRow)

    const dateInput = screen.getByLabelText(nl.event.bulk.columnHeaders.date) as HTMLInputElement
    expect(dateInput.type).toBe('date')
    expect(dateInput.value).toBe('')
  })
})
