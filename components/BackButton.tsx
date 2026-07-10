'use client'

import { useRouter } from 'next/navigation'

interface Props {
  fallback: string
  className?: string
  children: React.ReactNode
}

export default function BackButton({ fallback, className, children }: Props) {
  const router = useRouter()

  function handleBack() {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }

  return (
    <button type="button" onClick={handleBack} className={className}>
      {children}
    </button>
  )
}
