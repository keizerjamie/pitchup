'use client'

// Hook voor de bewerkbare preview-tabel van "wedstrijden bulk toevoegen".
// Naamgeving/locatie volgen lib/use-reduced-motion.ts. Houdt de rijen bij en
// levert de afgeleide validatie-/duplicaat-/blokkade-informatie die zowel de
// preview-tabel als de orkestrator-pagina nodig hebben.
//
// De duplicaatcontrole (getExistingMatchKeys) is gedebouncet en draait alleen
// opnieuw als de SET unieke datums in de preview verandert — niet bij elke
// toetsaanslag in een ander veld. Mislukt de aanroep (bv. sessie verlopen),
// dan wordt dat een niet-blokkerende `duplicateCheckFailed`-vlag: de oude
// (mogelijk verouderde) duplicaatinformatie blijft staan, er wordt nooit
// stilzwijgend "geen duplicaten" gesuggereerd.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getExistingMatchKeys } from '@/app/actions/events-bulk'
import {
  MAX_BULK_MATCHES,
  markDuplicates,
  validateBulkRow,
  type BulkField,
  type BulkRowError,
  type ParsedMatchRow,
} from '@/lib/bulk-matches'

const DEBOUNCE_MS = 400

export interface BlockingReason {
  blocked: boolean
  isEmpty: boolean
  errorRowCount: number
  uncertainRowCount: number
  tooMany: boolean
  rowCount: number
  max: number
}

export interface UseBulkMatchRowsResult {
  rows: ParsedMatchRow[]
  setField: (id: string, field: BulkField, value: string) => void
  removeRow: (id: string) => void
  reset: (rows: ParsedMatchRow[]) => void
  errorsByRow: Map<string, BulkRowError[]>
  duplicateIds: Set<string>
  duplicateCheckFailed: boolean
  blockingReason: BlockingReason
}

export function useBulkMatchRows(): UseBulkMatchRowsResult {
  const [rows, setRows] = useState<ParsedMatchRow[]>([])
  const [existing, setExisting] = useState<{ date: string; opponent: string | null }[]>([])
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setField = useCallback((id: string, field: BulkField, value: string) => {
    setRows((prev) => prev.map((row) => {
      if (row.id !== id) return row
      // Zodra de trainer een twijfelgeval-veld zelf bewerkt, is het niet langer
      // een gok van de parser — de gele markering voor dát veld verdwijnt.
      const uncertain = row.uncertain.includes(field)
        ? row.uncertain.filter((f) => f !== field)
        : row.uncertain
      return { ...row, [field]: value, uncertain }
    }))
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }, [])

  const reset = useCallback((next: ParsedMatchRow[]) => {
    setRows(next)
    setExisting([])
    setDuplicateCheckFailed(false)
  }, [])

  const errorsByRow = useMemo(() => {
    const map = new Map<string, BulkRowError[]>()
    for (const row of rows) {
      const errors = validateBulkRow({
        date: row.date,
        time: row.time,
        opponent: row.opponent,
        home_away: row.home_away,
        match_type: row.match_type,
        location: row.location,
        gather_time: row.gather_time,
        notes: row.notes,
      })
      if (errors.length > 0) map.set(row.id, errors)
    }
    return map
  }, [rows])

  const duplicateIds = useMemo(() => markDuplicates(rows, existing), [rows, existing])

  const uniqueDatesKey = useMemo(() => {
    const dates = [...new Set(rows.map((r) => r.date.trim()).filter((d) => d !== ''))]
    return dates.sort().join(',')
  }, [rows])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    // Alle setState-aanroepen lopen bewust via de (gedebouncete) timeout-
    // callback, ook het "geen datums meer"-pad: rechtstreeks setState in het
    // effect-lichaam zelf veroorzaakt cascaderende renders.
    timerRef.current = setTimeout(() => {
      if (uniqueDatesKey === '') {
        setExisting([])
        setDuplicateCheckFailed(false)
        return
      }

      const dates = uniqueDatesKey.split(',')
      getExistingMatchKeys(dates)
        .then((result) => {
          setExisting(result)
          setDuplicateCheckFailed(false)
        })
        .catch(() => {
          setDuplicateCheckFailed(true)
        })
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [uniqueDatesKey])

  const blockingReason = useMemo<BlockingReason>(() => {
    const isEmpty = rows.length === 0
    const errorRowCount = errorsByRow.size
    const uncertainRowCount = rows.filter((r) => r.uncertain.length > 0).length
    const tooMany = rows.length > MAX_BULK_MATCHES
    return {
      blocked: isEmpty || errorRowCount > 0 || uncertainRowCount > 0 || tooMany,
      isEmpty,
      errorRowCount,
      uncertainRowCount,
      tooMany,
      rowCount: rows.length,
      max: MAX_BULK_MATCHES,
    }
  }, [rows, errorsByRow])

  return { rows, setField, removeRow, reset, errorsByRow, duplicateIds, duplicateCheckFailed, blockingReason }
}
