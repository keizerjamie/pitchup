'use client'

import { useState } from 'react'
import { useDict } from '@/lib/i18n-context'
import { formatTime } from '@/lib/utils'

interface Props {
  value: string | null
  onChange: (v: string | null) => void
  isPending: boolean
  error: string | null
}

// "Dom" invoerveld: houdt alleen de invoer-in-bewerking (draft) bij, de
// bevestigde waarde/opslaan/rollback zit in MatchSquadEditor (zie
// gatherTime-state daar). Stijl spiegelt het bestaande tijdveld in
// app/events/new/page.tsx. Draagt zelf `print:hidden` (zelfde precedent als
// PrintButton.tsx) zodat dit veld nooit op de afdruk verschijnt, ongeacht
// waar het geplaatst wordt.
export default function GatherTimeField({ value, onChange, isPending, error }: Props) {
  const t = useDict()
  // formatTime() normaliseert hier naar "HH:MM" (en levert '' voor null, exact
  // zoals de oude `value ?? ''` deed) — dit is de plek waar de waarde het
  // bewerkveld ingaat. Nodig omdat Postgres TIME-kolommen (event.gather_time)
  // "HH:MM:SS" opleveren; zonder normalisatie zou een bestaande verzameltijd
  // ongewijzigd (met seconden) teruggestuurd worden bij opslaan, wat de server
  // (isTimeString(), geen seconden toegestaan) altijd zou weigeren. Door hier —
  // in plaats van in MatchSquadEditor/page.tsx — te normaliseren blijft dit
  // component zelfvoorzienend: het geneest ook een niet-genormaliseerde waarde
  // die via een mislukte-save-rollback terugkomt (lastConfirmedGatherRef in
  // MatchSquadEditor bewaart de oorspronkelijke, rauwe prop-waarde).
  const [draft, setDraft] = useState(formatTime(value))
  // Volgt de bevestigde waarde van de ouder (o.a. na een rollback of een
  // geslaagde save elders). State tijdens het renderen aanpassen i.p.v. via
  // een effect — zelfde patroon en motivatie als TeamLogo.tsx.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(formatTime(value))
  }

  return (
    <div className="print:hidden flex flex-col gap-2">
      <label htmlFor="gather-time-input" className="block text-[13px] font-semibold text-faint">{t.matchSquad.gatherTimeEditLabel}</label>
      <div className="flex items-center gap-2">
        <input
          id="gather-time-input"
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          className="px-3 py-2 rounded-xl border text-[14px] text-ink disabled:opacity-60"
          style={{ borderColor: 'var(--border-soft)' }}
        />
        <button
          type="button"
          onClick={() => onChange(draft || null)}
          disabled={isPending}
          className="py-2 px-3 rounded-xl font-bold text-white text-[13px] disabled:opacity-60"
          style={{ background: 'var(--primary)' }}
        >
          {t.matchSquad.gatherTimeSave}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft('')
            onChange(null)
          }}
          disabled={isPending || !value}
          className="py-2 px-3 rounded-xl font-semibold text-[13px] text-muted disabled:opacity-60"
          style={{ border: '1px solid var(--border-soft)' }}
        >
          {t.matchSquad.gatherTimeClear}
        </button>
      </div>
      {error && (
        <p className="text-xs text-panel-red-ink bg-panel-red border border-panel-red-edge rounded-lg px-2 py-1">{error}</p>
      )}
    </div>
  )
}
