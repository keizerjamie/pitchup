'use client'

import { useActionState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { requestPasswordReset } from '@/app/actions/auth'
import { useDict } from '@/lib/i18n-context'

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, null)
  const t = useDict()

  return (
    <div className="fixed inset-0 overflow-auto flex items-center justify-center px-4" style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #0a2e2a 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Pitchup" width={64} height={64} className="rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-white">{t.auth.forgotTitle}</h1>
          <p className="text-white/75 text-sm mt-2 text-center">{t.auth.forgotHint}</p>
        </div>

        {state?.sent ? (
          <div className="bg-accent/15 border border-accent/40 text-white text-sm px-4 py-4 rounded-xl text-center">
            {t.auth.resetSent}
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <label className="block text-white/75 text-sm font-medium mb-1.5">{t.auth.email}</label>
              <input name="email" type="email" required autoComplete="email" autoFocus
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder={t.auth.emailPlaceholder} />
            </div>

            <button type="submit" disabled={pending}
              className="w-full py-3 rounded-xl bg-accent text-white font-semibold hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-60 mt-2">
              {pending ? t.auth.sending : t.auth.sendResetLink}
            </button>
          </form>
        )}

        <p className="text-center text-white/60 text-sm mt-6">
          <Link href="/login" className="text-accent font-medium hover:text-accent/80">
            {t.auth.backToLogin}
          </Link>
        </p>
      </div>
    </div>
  )
}
