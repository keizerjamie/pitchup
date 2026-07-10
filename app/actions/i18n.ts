'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { LOCALES, type Locale } from '@/lib/i18n'

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) throw new Error('Ongeldige taal')
  const cookieStore = await cookies()
  cookieStore.set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  const referer = (await headers()).get('referer')
  const returnPath = referer ? new URL(referer).pathname : '/settings'
  redirect(returnPath)
}
