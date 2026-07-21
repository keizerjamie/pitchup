import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import InactivityLogout from '@/components/InactivityLogout'
import { getDict } from '@/lib/i18n'
import { DictProvider } from '@/lib/i18n-context'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Pitchup',
  description: 'Aanwezigheid, opstellingen en trainingen voor jouw team',
  manifest: '/manifest.json',
  // Favicon/apple-icon are handled by app/icon.png and app/apple-icon.png
  // (file convention); manifest keeps the 192/512 PWA icons.
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Pitchup' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d3d38',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = await getDict()

  return (
    <html lang={t.locale}>
      <body className={geist.className}>
        <DictProvider dict={t}>
          <AppShell>{children}</AppShell>
          <InactivityLogout />
        </DictProvider>
      </body>
    </html>
  )
}
