'use client'

import { useEffect } from 'react'

// The inline <head> script applies the theme before paint, but React can strip
// the data-theme attributes off <html> during hydration (suppressHydrationWarning
// only hides the warning). Re-apply after mount so the stored/system theme
// survives a full page load. setAttribute (not setState) keeps this lint-clean.
export default function ThemeInit() {
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme')
      const pref = stored || 'system'
      const resolved = pref !== 'system'
        ? pref
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      const el = document.documentElement
      if (el.getAttribute('data-theme') !== resolved) el.setAttribute('data-theme', resolved)
      if (el.getAttribute('data-theme-pref') !== pref) el.setAttribute('data-theme-pref', pref)
    } catch {}
  }, [])
  return null
}
