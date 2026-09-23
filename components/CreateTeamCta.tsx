'use client'

// Interactieve "Team aanmaken"-knop + naamveld voor EmptyTeamState.tsx
// (server component — dit stukje moet daarom in een los, client-only bestand
// staan). Zelfde createTeam-actie en dezelfde states als het "Nieuw team
// aanmaken"-blok in components/TeamSwitcher.tsx, hier zonder omringend
// popover/sheet-chrome — dit ÍS het hele scherm.

import { useState, useTransition } from 'react'
import { createTeam } from '@/app/actions/team'
import { useDict } from '@/lib/i18n-context'

export default function CreateTeamCta() {
  const t = useDict()
  const [open, setOpen] = useState(false)
  const [naam, setNaam] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    const schoon = naam.trim()
    if (!schoon || isPending) return
    setError(null)
    startTransition(async () => {
      try {
        await createTeam(schoon)
        // createTeam eindigt in redirect(); deze regel draait bij succes niet.
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        // Nooit err.message: Next saneert server-action-fouten in productie
        // sowieso al tot een generieke Engelse tekst (validatiebevinding 8).
        setError(t.team.switchFailed)
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full max-w-xs py-3 rounded-xl font-bold text-white active:scale-[0.98] transition"
        style={{ background: 'var(--primary)' }}
      >
        {t.team.createTeam}
      </button>
    )
  }

  return (
    <div className="w-full max-w-xs flex flex-col gap-3">
      <p className="text-[13px] font-bold text-ink">{t.team.createTeamTitle}</p>
      <div className="text-left">
        <label htmlFor="empty-team-naam" className="block text-[11px] font-bold text-faint uppercase tracking-wide mb-1.5">
          {t.team.createTeamNameLabel}
        </label>
        <input
          id="empty-team-naam"
          type="text"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          maxLength={80}
          autoFocus
          className="w-full px-4 py-2.5 rounded-xl border border-[var(--border-soft)] bg-surface text-ink text-sm focus:outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20"
        />
      </div>
      {error && <p className="text-[12.5px] font-semibold text-danger text-left">{error}</p>}
      <button
        type="button"
        onClick={handleCreate}
        disabled={!naam.trim() || isPending}
        className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-50 active:scale-[0.98] transition"
        style={{ background: 'var(--primary)' }}
      >
        {isPending ? t.team.creating : t.team.createTeam}
      </button>
    </div>
  )
}
