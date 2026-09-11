'use client'

import type { TrainingsType } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'

interface Props {
  waarde: TrainingsType
  onChange: (next: TrainingsType) => void
  disabled?: boolean
  error?: string | null
}

// Bewust gecontroleerd en presentational: geen server-call, geen eigen state.
// De waarde en de save wonen in TrainingPlanEditor, want dezelfde waarde
// stuurt daar ook de zichtbaarheid van elk stapveld aan — twee
// state-eigenaren zouden het scherm laten spreken met twee monden.
export default function TrainingstypeSchakelaar({ waarde, onChange, disabled, error }: Props) {
  const t = useDict()

  return (
    <div className="print:hidden bg-surface rounded-2xl border border-[var(--border-soft)] p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <span className="text-sm font-semibold text-muted">{t.event.trainingstype}</span>
        <div className="bg-surface-sunken rounded-xl p-1 border border-[var(--border-soft)] flex gap-1">
          <button
            type="button"
            disabled={disabled}
            aria-pressed={waarde === 'vct'}
            onClick={() => onChange('vct')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition duration-[160ms] ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light disabled:opacity-50 ${
              waarde === 'vct' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {t.event.trainingstypeVct}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={waarde === 'teamtactisch'}
            onClick={() => onChange('teamtactisch')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition duration-[160ms] ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light disabled:opacity-50 ${
              waarde === 'teamtactisch' ? 'bg-event-training text-white shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {t.event.trainingstypeTeamtactisch}
          </button>
        </div>
      </div>
      <p className="text-xs text-faint mt-2">{t.event.trainingstypeHint}</p>
      {error && (
        <p className="text-xs text-panel-red-ink bg-panel-red border border-panel-red-edge rounded-lg px-2 py-1 mt-2">
          {error}
        </p>
      )}
    </div>
  )
}
