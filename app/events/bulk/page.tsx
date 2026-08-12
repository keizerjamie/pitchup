'use client'

// Orkestrator voor "wedstrijden bulk toevoegen" — statemachine invoer →
// preview → opgeslagen. Opgezet als app/events/new/page.tsx: zelfde
// BackButton/container/foutkader-stijl. De feitelijke rij-state en afgeleide
// validatie/duplicaten zitten in useBulkMatchRows (lib/use-bulk-match-rows.ts);
// deze pagina koppelt dat aan de server actions.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import BackButton from '@/components/BackButton'
import BulkMatchInput from '@/components/BulkMatchInput'
import BulkMatchPreviewTable from '@/components/BulkMatchPreviewTable'
import { createBulkMatches } from '@/app/actions/events-bulk'
import { toBulkMatchInput, type ParsedMatchRow } from '@/lib/bulk-matches'
import { useBulkMatchRows } from '@/lib/use-bulk-match-rows'
import { useDict } from '@/lib/i18n-context'

type Phase = 'invoer' | 'preview' | 'opgeslagen'

export default function BulkMatchesPage() {
  const t = useDict()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('invoer')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [attendanceFailed, setAttendanceFailed] = useState(false)
  const [isPending, startTransition] = useTransition()

  const {
    rows, setField, removeRow, reset,
    errorsByRow, duplicateIds, duplicateCheckFailed, blockingReason,
  } = useBulkMatchRows()

  function handleParsed(parsedRows: ParsedMatchRow[]) {
    setSaveError(null)
    reset(parsedRows)
    setPhase('preview')
  }

  function handleBackToInput() {
    reset([])
    setSaveError(null)
    setPhase('invoer')
  }

  function handleSave() {
    if (blockingReason.blocked) return
    setSaveError(null)
    startTransition(async () => {
      try {
        const inputs = rows.map(toBulkMatchInput)
        const result = await createBulkMatches(inputs)
        setSavedCount(result.created)
        setAttendanceFailed(result.attendanceFailed)
        setPhase('opgeslagen')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : t.event.bulk.saveGenericError)
      }
    })
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback="/events" className="text-gray-400 hover:text-gray-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </BackButton>
        <h1 className="text-2xl font-bold text-gray-900">{t.event.bulk.title}</h1>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-5">
          {saveError}
        </div>
      )}

      {phase === 'opgeslagen' && (
        <div className="space-y-3 mb-5">
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">
            {t.event.bulk.savedCount.replace('{count}', String(savedCount))}
          </div>
          {attendanceFailed && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3 rounded-xl">
              {t.event.bulk.attendanceWarning}
            </div>
          )}
          <button
            type="button"
            onClick={() => router.push('/events')}
            className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-95"
          >
            {t.event.bulk.backToEvents}
          </button>
        </div>
      )}

      {phase === 'invoer' && <BulkMatchInput onParsed={handleParsed} />}

      {phase === 'preview' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBackToInput}
            className="text-[13px] font-semibold text-gray-500 hover:text-gray-700"
          >
            &larr; {t.event.bulk.pasteLabel} / {t.event.bulk.fileLabel}
          </button>
          <BulkMatchPreviewTable
            rows={rows}
            errorsByRow={errorsByRow}
            duplicateIds={duplicateIds}
            duplicateCheckFailed={duplicateCheckFailed}
            blockingReason={blockingReason}
            setField={setField}
            removeRow={removeRow}
            onSave={handleSave}
            saving={isPending}
          />
        </div>
      )}
    </div>
  )
}
