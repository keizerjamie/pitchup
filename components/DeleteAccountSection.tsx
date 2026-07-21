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
        setError(err instanceof Error ? err.message : 'Verwijderen mislukt')
      }
    })
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-red-100">
        <h2 className="font-semibold text-red-800">{t.settings.dangerZone}</h2>
      </div>
      <div className="px-5 py-4">
        <h3 className="font-semibold text-gray-900 text-sm">{t.settings.deleteAccountTitle}</h3>
        <p className="text-sm text-gray-600 mt-1">{t.settings.deleteAccountHint}</p>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 active:scale-95 transition-all"
          >
            {t.settings.deleteAccountButton}
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {t.settings.deleteConfirmPrompt}
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={word}
              className="w-full px-4 py-3 rounded-xl border border-red-200 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 text-gray-900 placeholder-gray-300"
            />
            {error && (
              <div className="bg-red-100 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setConfirm(''); setError(null) }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 active:scale-95 transition-all"
              >
                {t.trainingPlan.cancel}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!armed || isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
