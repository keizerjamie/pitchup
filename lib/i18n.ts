import { cookies } from 'next/headers'
import { cache } from 'react'
import type { Dict } from '@/messages/nl'

export type Locale = 'nl' | 'en' | 'de' | 'fr' | 'es'

export const LOCALES: Locale[] = ['nl', 'en', 'de', 'fr', 'es']

async function loadDict(locale: Locale): Promise<Dict> {
  switch (locale) {
    case 'en': return (await import('@/messages/en')).en
    case 'de': return (await import('@/messages/de')).de
    case 'fr': return (await import('@/messages/fr')).fr
    case 'es': return (await import('@/messages/es')).es
    default:   return (await import('@/messages/nl')).nl
  }
}

export const getDict = cache(async (): Promise<Dict> => {
  const locale = ((await cookies()).get('locale')?.value ?? 'nl') as Locale
  return loadDict(locale)
})
