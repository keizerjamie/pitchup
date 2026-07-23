'use client'

import { useSyncExternalStore } from 'react'
import { useDict } from '@/lib/i18n-context'

type Pref = 'system' | 'light' | 'dark'

// Read the theme *preference* (system/light/dark) from a DOM attribute kept in
// sync by the init script in layout.tsx. useSyncExternalStore avoids a
// setState-in-effect and the SSR→client hydration warning.
function subscribe(onChange: () => void) {
  if (typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-pref'] })
  return () => obs.disconnect()
}
const getSnapshot = (): Pref =>
  (document.documentElement.getAttribute('data-theme-pref') as Pref) || 'system'
const getServerSnapshot = (): Pref => 'system'

function apply(pref: Pref) {
  const el = document.documentElement
  const resolved: 'light' | 'dark' = pref !== 'system'
    ? pref
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  el.setAttribute('data-theme', resolved)
  el.setAttribute('data-theme-pref', pref)
  try {
    if (pref === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', pref)
  } catch {}
}

export default function ThemeSelect() {
  const t = useDict()
  const pref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const options: { key: Pref; label: string }[] = [
    { key: 'system', label: t.settings.themeSystem },
    { key: 'light', label: t.home.themeLight },
    { key: 'dark', label: t.home.themeDark },
  ]

  return (
    <div className="flex gap-1.5">
      {options.map((o) => {
        const active = pref === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => apply(o.key)}
            aria-pressed={active}
            className="flex-1 text-center text-[13px] font-bold py-2.5 rounded-[10px] transition-colors"
            style={active
              ? { background: 'var(--brand-btn)', color: '#fff' }
              : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
