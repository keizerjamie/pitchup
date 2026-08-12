'use client'

// Invoerstap van "wedstrijden bulk toevoegen": vrije tekst plakken (client-side
// geparsed, geen serverronde) of een .csv-/.xlsx-bestand kiezen (serverronde
// via parseBulkMatchFile). De client-precheck op extensie/grootte is puur UX
// (zelfde precedent als components/TeamLogoSection.tsx:41-50) — de server is
// de echte poortwachter.

import { useRef, useState, useTransition } from 'react'
import { parseBulkMatchFile } from '@/app/actions/events-bulk'
import { parseMatchesFromText } from '@/lib/bulk-matches-text'
import { MAX_BULK_FILE_BYTES, type ParsedMatchRow } from '@/lib/bulk-matches'
import { useDict } from '@/lib/i18n-context'

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx']

interface Props {
  onParsed: (rows: ParsedMatchRow[]) => void
}

export default function BulkMatchInput({ onParsed }: Props) {
  const t = useDict()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function resetFile() {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setError(null)
    if (!selected) {
      resetFile()
      return
    }
    const name = selected.name.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      setError(t.event.bulk.errorFileType)
      resetFile()
      return
    }
    if (selected.size > MAX_BULK_FILE_BYTES) {
      setError(t.event.bulk.errorFileSize)
      resetFile()
      return
    }
    setFile(selected)
  }

  // Bestand wint altijd van geplakte tekst (handleProcess:58) — dat blijft zo,
  // maar moet zichtbaar zijn zodra beide tegelijk aanwezig zijn, in plaats van
  // stil te negeren.
  const textIgnored = file !== null && text.trim() !== ''

  function handleProcess() {
    setError(null)

    if (file) {
      const formData = new FormData()
      formData.set('file', file)
      startTransition(async () => {
        try {
          const result = await parseBulkMatchFile(formData)
          if (!result.ok) {
            setError(result.error)
            return
          }
          onParsed(result.rows)
        } catch {
          // Vangnet: parseBulkMatchFile throwt volgens contract nooit, maar een
          // netwerk-/JS-fout tijdens de aanroep zelf moet toch iets tonen.
          setError(t.event.bulk.errorFileUnreadable)
        }
      })
      return
    }

    const trimmed = text.trim()
    if (trimmed === '') {
      setError(t.event.bulk.errorEmpty)
      return
    }
    const result = parseMatchesFromText(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onParsed(result.rows)
  }

  const canProcess = !isPending && (file !== null || text.trim() !== '')

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="bulk-paste">
          {t.event.bulk.pasteLabel}
        </label>
        <textarea
          id="bulk-paste"
          rows={6}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          placeholder={t.event.bulk.pastePlaceholder}
          disabled={isPending}
          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-accent focus:ring-2 focus:ring-brand-light text-gray-900 placeholder-gray-400 resize-none font-mono text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5" htmlFor="bulk-file">
          {t.event.bulk.fileLabel}
        </label>
        <input
          ref={inputRef}
          id="bulk-file"
          type="file"
          accept=".csv,.xlsx"
          onChange={handleFileChange}
          disabled={isPending}
          className="text-[13px] text-gray-600"
        />
        {textIgnored && (
          <p className="text-[13px] text-amber-700 mt-1.5">{t.event.bulk.fileOverridesText}</p>
        )}
      </div>

      <div className="text-xs text-gray-500 space-y-2">
        <p>{t.event.bulk.formatHint}</p>
        <a href="/voorbeeld-wedstrijden.csv" download className="inline-block text-accent font-semibold hover:underline">
          {t.event.bulk.downloadExample}
        </a>
      </div>

      <button
        type="button"
        onClick={handleProcess}
        disabled={!canProcess}
        className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-60"
      >
        {isPending ? t.event.bulk.processing : t.event.bulk.process}
      </button>
    </div>
  )
}
