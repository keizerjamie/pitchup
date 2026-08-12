'use client'

import { useState, useTransition, type TransitionStartFunction } from 'react'
import { saveTeamColor, resetTeamColor } from '@/app/actions/team-colors'
import { CLUB_COLOR_FALLBACK, normalizeHexColor, type ClubColorSlot } from '@/lib/club-colors'
import { useDict } from '@/lib/i18n-context'

interface Props {
  initialPrimary: string | null
  initialSecondary: string | null
}

// Eén rij per kleur (primary/secondary). Elke rij houdt zijn eigen
// draft/opgeslagen/fout-state strikt gescheiden — een mislukte save van de
// ene kleur mag de andere rij nooit raken. De gedeelde `useTransition` regelt
// alleen de disabled-state tijdens pending, niet de fout-/waardestate.
function ColorRow({
  slot,
  label,
  initial,
  isPending,
  startTransition,
}: {
  slot: ClubColorSlot
  label: string
  initial: string | null
  isPending: boolean
  startTransition: TransitionStartFunction
}) {
  const t = useDict()
  // Bron van waarheid is het tekstveld (draft), niet de colorpicker: die valt
  // bij een ongeldige waarde stilzwijgend terug op #000000. `saved` is de
  // laatst bevestigde waarde (ingesteld óf null = fallback); `draft` is wat
  // de gebruiker aan het typen is.
  const [saved, setSaved] = useState<string | null>(initial)
  const [draft, setDraft] = useState<string>(initial ?? CLUB_COLOR_FALLBACK[slot])
  const [error, setError] = useState<string | null>(null)

  // Het colorpicker-veld krijgt alleen een al-geldige '#rrggbb' te zien —
  // nooit de ruwe draft (die kan tijdelijk ongeldig zijn tijdens het typen) en
  // ook nooit een rauwe `saved`-waarde: die komt normaal altijd genormaliseerd
  // uit de database (saveTeamColor normaliseert vóór opslag), maar een
  // handmatige DB-edit zou anders alsnog het colorpicker-veld met een
  // ongeldige string voeden en de browser stil op #000000 laten terugvallen.
  const pickerValue = normalizeHexColor(draft) ?? normalizeHexColor(saved) ?? CLUB_COLOR_FALLBACK[slot]

  function handleSave() {
    const normalized = normalizeHexColor(draft)
    if (!normalized) {
      setError(t.settings.clubColorErrorInvalid)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveTeamColor(slot, normalized)
        if (result.error) {
          setError(result.error)
          return
        }
        // Toon de genormaliseerde waarde uit de respons, niet de ruwe invoer.
        setSaved(result.value ?? normalized)
        setDraft(result.value ?? normalized)
      } catch {
        setError(t.settings.clubColorErrorGeneric)
      }
    })
  }

  function handleReset() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await resetTeamColor(slot)
        if (result.error) {
          setError(result.error)
          return
        }
        setSaved(null)
        setDraft(CLUB_COLOR_FALLBACK[slot])
      } catch {
        setError(t.settings.clubColorErrorGeneric)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span
          className="w-8 h-8 rounded-full flex-shrink-0"
          style={{ background: pickerValue, border: '1px solid var(--border-soft)' }}
          aria-hidden="true"
        />
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[13px] font-bold text-ink">{label}</span>
          {saved === null && (
            <span className="text-[11.5px] font-semibold text-faint">{t.settings.clubColorDefaultLabel}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          disabled={isPending}
          aria-label={`${label} — ${t.settings.clubColorPickerLabel}`}
          className="w-9 h-9 rounded-lg border border-[var(--border-soft)] p-0.5 disabled:opacity-60"
        />
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          disabled={isPending}
          aria-label={`${label} — ${t.settings.clubColorHexLabel}`}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-surface text-[13px] text-ink disabled:opacity-60"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="py-2 px-3.5 rounded-xl font-bold text-white text-[12.5px] active:scale-95 transition-all disabled:opacity-60"
          style={{ background: 'var(--primary)' }}
        >
          {isPending ? t.settings.clubColorSaving : t.settings.clubColorSave}
        </button>
        {saved !== null && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending}
            className="py-2 px-3.5 rounded-xl font-semibold text-[12.5px] active:scale-95 transition-all disabled:opacity-60"
            style={{ color: 'var(--muted)', border: '1px solid var(--border-soft)', background: 'var(--surface-sunken)' }}
          >
            {t.settings.clubColorReset}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{error}</p>
      )}
    </div>
  )
}

export default function ClubColorsSection({ initialPrimary, initialSecondary }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-faint -mt-1">{t.settings.clubColorsHint}</p>
      <ColorRow
        slot="primary"
        label={t.settings.clubColorPrimaryLabel}
        initial={initialPrimary}
        isPending={isPending}
        startTransition={startTransition}
      />
      <ColorRow
        slot="secondary"
        label={t.settings.clubColorSecondaryLabel}
        initial={initialSecondary}
        isPending={isPending}
        startTransition={startTransition}
      />
    </div>
  )
}
