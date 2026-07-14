'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useDict } from '@/lib/i18n-context'

// Reached via the recovery link in the reset e-mail: Supabase has then
// already established a (recovery) session, so updateUser is allowed.
export default function ResetPasswordPage() {
  const t = useDict()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setPending(false)
      return
    }

    setDone(true)
    setTimeout(() => router.replace('/'), 1500)
  }

  return (
    <div className="fixed inset-0 overflow-auto flex items-center justify-center px-4" style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #0a2e2a 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Pitchup" width={64} height={64} className="rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-white">{t.auth.resetTitle}</h1>
        </div>

        {done ? (
          <div className="bg-accent/15 border border-accent/40 text-white text-sm px-4 py-4 rounded-xl text-center">
            {t.auth.passwordUpdated}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/20 border border-red-400/30 text-red-200 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <div>
              <label className="block text-white/75 text-sm font-medium mb-1.5">{t.auth.newPassword}</label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder={t.auth.passwordMinLength}
              />
            </div>

            <button type="submit" disabled={pending}
              className="w-full py-3 rounded-xl bg-accent text-white font-semibold hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-60 mt-2">
              {pending ? t.auth.updating : t.auth.updatePassword}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
