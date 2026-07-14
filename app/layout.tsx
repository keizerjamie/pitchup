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
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
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
