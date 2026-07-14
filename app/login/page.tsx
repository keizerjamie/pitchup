'use client'

import { useActionState } from 'react'
import { signIn } from '@/app/actions/auth'
import Image from 'next/image'
import Link from 'next/link'
import { useDict } from '@/lib/i18n-context'

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null)
  const t = useDict()

  return (
    <div className="fixed inset-0 overflow-auto flex items-center justify-center px-4" style={{ background: 'linear-gradient(160deg, #0d3d38 0%, #0a2e2a 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Pitchup" width={64} height={64} className="rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-white">Pitchup</h1>
          <p className="text-white/75 text-sm mt-1">{t.auth.loginTitle}</p>
        </div>

        <form action={action} className="space-y-4">
          {state?.error && (
            <div className="bg-red-500/20 border border-red-400/30 text-red-200 text-sm px-4 py-3 rounded-xl">
              {state.error}
            </div>
          )}

          <div>
            <label className="block text-white/70 text-sm font-medium mb-1.5">{t.auth.email}</label>
            <input name="email" type="email" required autoComplete="email"
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder={t.auth.emailPlaceholder} />
          </div>

          <div>
            <label className="block text-white/70 text-sm font-medium mb-1.5">{t.auth.password}</label>
            <input name="password" type="password" required autoComplete="current-password"
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder={t.auth.passwordPlaceholder} />
          </div>

          <button type="submit" disabled={pending}
            className="w-full py-3 rounded-xl bg-accent text-white font-semibold hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-60 mt-2">
            {pending ? t.auth.loggingIn : t.auth.login}
          </button>

          <p className="text-center">
            <Link href="/forgot-password" className="text-white/60 text-sm hover:text-accent transition-colors">
              {t.auth.forgotPassword}
            </Link>
          </p>
        </form>

        <p className="text-center text-white/60 text-sm mt-6">
          {t.auth.noAccount}{' '}
          <Link href="/register" className="text-accent font-medium hover:text-accent/80">
            {t.auth.createTeamLink}
          </Link>
        </p>
      </div>
    </div>
  )
}
