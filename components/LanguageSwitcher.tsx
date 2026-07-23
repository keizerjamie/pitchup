'use client'

import { useDict } from '@/lib/i18n-context'
import { setLocale } from '@/app/actions/i18n'
import type { Locale } from '@/lib/i18n'

const FLAGS: Record<Locale, string> = { nl: '🇳🇱', en: '🇬🇧', de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸' }

export default function LanguageSwitcher() {
  const t = useDict()
  const current = t.locale as Locale
  const locales: Locale[] = ['nl', 'en', 'de', 'fr', 'es']

  return (
    <div className="flex flex-wrap gap-2">
      {locales.map((locale) => (
        <form key={locale} action={setLocale.bind(null, locale) as unknown as (formData: FormData) => void}>
          <button
            type="submit"
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
              locale === current
                ? 'bg-accent/10 border-accent text-accent'
                : 'bg-surface border-[var(--border-soft)] text-muted hover:border-accent/50'
            }`}
          >
            <span>{FLAGS[locale]}</span>
            {t.settings.languages[locale]}
          </button>
        </form>
      ))}
    </div>
  )
}
