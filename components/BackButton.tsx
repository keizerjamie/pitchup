'use client'

import { useRouter } from 'next/navigation'
import { useDict } from '@/lib/i18n-context'

interface Props {
  fallback: string
  className?: string
  children: React.ReactNode
}

export default function BackButton({ fallback, className, children }: Props) {
  const router = useRouter()
  const t = useDict()

  function handleBack() {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }

  return (
    <button type="button" onClick={handleBack} className={className} aria-label={t.nav.back}>
      {children}
    </button>
  )
}
