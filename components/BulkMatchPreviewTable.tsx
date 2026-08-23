'use client'

// Bewerkbare preview-tabel van "wedstrijden bulk toevoegen". Per rij dezelfde
// velden als het losse wedstrijdformulier (app/events/new/page.tsx:72-146),
// nu in tabelvorm zodat tot 100 (zichtbaar tot 200) wedstrijden in één keer
// gecontroleerd en bevestigd kunnen worden.
//
// Drie soorten markeringen per rij, nooit met elkaar verward:
// - rood veld + melding  → BulkRowError (validateBulkRow) — blokkeert opslaan
// - geel veld + hint     → 'twijfelgeval' (uncertain, alleen bij vrije tekst
//                           — nooit voorgesteld als herkend) — blokkeert opslaan
// - neutrale badge       → mogelijk duplicaat — blokkeert NIETS

import { Fragment } from 'react'
import { useDict } from '@/lib/i18n-context'
import type { BlockingReason } from '@/lib/use-bulk-match-rows'
import type { BulkField, BulkRowError, ParsedMatchRow } from '@/lib/bulk-matches'

interface Props {
  rows: ParsedMatchRow[]
  errorsByRow: Map<string, BulkRowError[]>
  duplicateIds: Set<string>
  duplicateCheckFailed: boolean
  blockingReason: BlockingReason
  setField: (id: string, field: BulkField, value: string) => void
  removeRow: (id: string) => void
  onSave: () => void
  saving: boolean
}

const DATE_FIELDS: BulkField[] = ['date']
const TIME_FIELDS: BulkField[] = ['time', 'gather_time']

export default function BulkMatchPreviewTable({
  rows, errorsByRow, duplicateIds, duplicateCheckFailed, blockingReason,
  setField, removeRow, onSave, saving,
}: Props) {
  const t = useDict()
  const b = t.event.bulk

  const columns: BulkField[] = ['date', 'time', 'opponent', 'home_away', 'match_type', 'location', 'gather_time', 'notes']

  function fieldError(row: ParsedMatchRow, field: BulkField): BulkRowError | undefined {
    return errorsByRow.get(row.id)?.find((e) => e.field === field)
  }

  function fieldErrorText(err: BulkRowError | undefined): string | null {
    if (!err) return null
    if (err.code === 'required') return b.fieldRequired
    if (err.code === 'too_long') return b.fieldTooLong
    return b.fieldInvalid
  }

  const blockingMessages: string[] = []
  if (blockingReason.isEmpty) blockingMessages.push(b.errorNoMatches)
  if (blockingReason.errorRowCount > 0 || blockingReason.uncertainRowCount > 0) blockingMessages.push(b.errorBlocked)
  if (blockingReason.tooMany) {
    blockingMessages.push(
      b.errorTooMany.replace('{count}', String(blockingReason.rowCount)).replace('{max}', String(blockingReason.max)),
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-ink">{b.previewTitle}</h2>

      <div className="bg-surface rounded-2xl border border-[var(--border-soft)] overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-soft)]">
              {columns.map((field) => (
                <th key={field} className="text-left font-semibold text-muted px-2 py-2 whitespace-nowrap">
                  {b.columnHeaders[field]}
                </th>
              ))}
              <th className="text-left font-semibold text-muted px-2 py-2 whitespace-nowrap">{b.duplicateColumn}</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr className="border-b border-[var(--border-soft)] align-top">
                  {columns.map((field) => (
                    <td key={field} className="px-2 py-2">
                      <RowField
                        row={row}
                        field={field}
                        error={fieldError(row, field)}
                        errorText={fieldErrorText(fieldError(row, field))}
                        onChange={(value) => setField(row.id, field, value)}
                        t={t}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    {duplicateIds.has(row.id) && (
                      <span className="inline-block text-[11px] font-semibold text-panel-amber-ink bg-panel-amber border border-panel-amber-edge rounded-full px-2 py-0.5 whitespace-nowrap">
                        {b.duplicate}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={b.remove}
                      className="text-faint hover:text-panel-red-ink transition-colors"
                    >
                      ×
                    </button>
                  </td>
                </tr>
                {row.uncertain.length > 0 && row.sourceLine && (
                  <tr className="border-b border-[var(--border-soft)]">
                    <td colSpan={columns.length + 2} className="px-2 pb-2 text-[12px] text-panel-amber-ink bg-panel-amber/50">
                      {b.uncertain}: “{row.sourceLine}”
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{b.rowCount.replace('{count}', String(rows.length))}</span>
          <span className={blockingReason.tooMany ? 'text-panel-red-ink font-semibold' : ''}>
            {b.limitCount.replace('{count}', String(rows.length)).replace('{max}', String(blockingReason.max))}
          </span>
        </div>

        {duplicateCheckFailed && (
          <p className="text-xs text-panel-amber-ink bg-panel-amber border border-panel-amber-edge rounded-lg px-3 py-2">
            {b.errorDuplicateCheck}
          </p>
        )}

        {blockingMessages.length > 0 && (
          <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-4 py-3 rounded-xl space-y-1">
            {blockingMessages.map((message, i) => <p key={i}>{message}</p>)}
          </div>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={saving || blockingReason.blocked}
          className="w-full py-3 rounded-xl font-semibold text-white bg-event-match hover:bg-event-match/90 transition active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? b.saving : b.save}
        </button>
      </div>
    </div>
  )
}

interface RowFieldProps {
  row: ParsedMatchRow
  field: BulkField
  error: BulkRowError | undefined
  errorText: string | null
  onChange: (value: string) => void
  t: ReturnType<typeof useDict>
}

function RowField({ row, field, error, errorText, onChange, t }: RowFieldProps) {
  const uncertain = row.uncertain.includes(field)
  const label = t.event.bulk.columnHeaders[field]
  const value = row[field] as string
  // Een 'invalid' date/time-waarde uit een bestand (bv. '31/02/2026' of '25:99')
  // past niet in het native date/time-formaat: de browser zou 'm stilzwijgend
  // naar leeg saneren. In dat geval tonen we de ruwe waarde in een tekstveld,
  // zodat de trainer ziet wát er mis is (lib/bulk-matches.ts:112-114) en hem kan
  // corrigeren. Bij lege of geldige waarden blijft het native input (met picker).
  const showAsRawText = error?.code === 'invalid' && value.trim() !== ''

  const borderClass = errorText
    ? 'border-panel-red-edge focus:border-panel-red-ink focus:ring-panel-red-ink/30'
    : uncertain
    ? 'border-panel-amber-edge focus:border-panel-amber-ink focus:ring-panel-amber-ink/30'
    : 'border-[var(--border-soft)] focus:border-brand-accent focus:ring-brand-accent/30'

  const baseInputClass = `w-full px-2 py-1.5 rounded-lg border ${borderClass} focus:outline-none focus:ring-2 text-ink text-sm`

  let control: React.ReactNode

  if (field === 'home_away') {
    control = (
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      >
        <option value=""></option>
        <option value="home">{t.event.home}</option>
        <option value="away">{t.event.away}</option>
      </select>
    )
  } else if (field === 'match_type') {
    control = (
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      >
        <option value=""></option>
        <option value="friendly">{t.event.matchTypes.friendly}</option>
        <option value="league">{t.event.matchTypes.league}</option>
        <option value="cup">{t.event.matchTypes.cup}</option>
      </select>
    )
  } else if (DATE_FIELDS.includes(field)) {
    control = showAsRawText ? (
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} tabular-nums`}
      />
    ) : (
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} tabular-nums`}
      />
    )
  } else if (TIME_FIELDS.includes(field)) {
    control = showAsRawText ? (
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} tabular-nums`}
      />
    ) : (
      <input
        type="time"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} tabular-nums`}
      />
    )
  } else {
    control = (
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseInputClass} min-w-[120px]`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {control}
      {errorText && <span className="text-[11px] text-panel-red-ink">{errorText}</span>}
    </div>
  )
}
