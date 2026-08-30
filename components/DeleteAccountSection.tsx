'use client'

import { useState, useTransition } from 'react'
import { deleteAccount } from '@/app/actions/auth'
import { useDict } from '@/lib/i18n-context'

export default function DeleteAccountSection() {
  const t = useDict()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const word = t.settings.deleteConfirmWord
  const armed = confirm.trim().toUpperCase() === word.toUpperCase()

  function handleDelete() {
    if (!armed) return
    setError(null)
    startTransition(async () => {
      try {
        await deleteAccount()
      } catch (err) {
        // redirect() throws internally on success; only real failures surface here
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        setError(t.settings.deleteAccountError)
      }
    })
  }

  return (
    <div className="rounded-2xl border border-panel-red-edge bg-panel-red/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-panel-red-edge">
        <h2 className="font-semibold text-panel-red-ink">{t.settings.dangerZone}</h2>
      </div>
      <div className="px-5 py-4">
        <h3 className="font-semibold text-ink text-sm">{t.settings.deleteAccountTitle}</h3>
        <p className="text-sm text-muted mt-1">{t.settings.deleteAccountHint}</p>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold text-panel-red-ink border border-panel-red-edge hover:bg-panel-red active:scale-95 transition"
          >
            {t.settings.deleteAccountButton}
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-muted">
              {t.settings.deleteConfirmPrompt}
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={word}
              className="w-full px-4 py-3 rounded-xl border border-panel-red-edge focus:outline-none focus:border-panel-red-ink focus:ring-2 focus:ring-panel-red-ink/30 text-ink placeholder:text-faint"
            />
            {error && (
              <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-sm px-3 py-2 rounded-lg">{error}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setConfirm(''); setError(null) }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-muted border border-[var(--border-soft)] hover:text-ink active:scale-95 transition"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!armed || isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-danger/90 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? t.settings.deleting : t.settings.deleteConfirmFinal}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
