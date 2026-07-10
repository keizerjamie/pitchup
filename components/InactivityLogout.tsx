'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const IDLE_DAYS = 30
const IDLE_MS = IDLE_DAYS * 24 * 60 * 60 * 1000
const STORAGE_KEY = 'pitchup_last_active'

function stamp() {
  localStorage.setItem(STORAGE_KEY, String(Date.now()))
}

function isExpired(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return false // first open, not expired
  return Date.now() - Number(raw) > IDLE_MS
}

export default function InactivityLogout() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    async function checkAndMaybeLogout() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      if (isExpired()) {
        await supabase.auth.signOut()
        router.replace('/login')
        return
      }

      stamp()
    }

    // Check on mount (app open / tab focus)
    checkAndMaybeLogout()

    // Check again every time the app comes back to foreground
    function onVisible() {
      if (document.visibilityState === 'visible') {
        checkAndMaybeLogout()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])

  return null
}
