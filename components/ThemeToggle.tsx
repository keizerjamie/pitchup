'use client'

import { useSyncExternalStore } from 'react'
import { useDict } from '@/lib/i18n-context'

type Theme = 'light' | 'dark'

// Read the current theme straight from the DOM attribute (set before paint by
// the init script in layout.tsx). useSyncExternalStore keeps it in sync without
// a setState-in-effect and handles the SSR→client handoff without a warning.
function subscribe(onChange: () => void) {
  if (typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => obs.disconnect()
}
const getSnapshot = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
const getServerSnapshot = (): Theme => 'light'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useDict()
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const el = document.documentElement
    el.setAttribute('data-theme', next)
    el.setAttribute('data-theme-pref', next)
    try { localStorage.setItem('theme', next) } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={t.home.themeToggle}
      aria-label={t.home.themeToggle}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink hover:bg-surface transition-colors ${className}`}
    >
      <span className="ms text-[20px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
    </button>
  )
}
