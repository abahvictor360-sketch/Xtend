import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorker } from '@/components/service-worker'

export const metadata: Metadata = {
  title: 'Xtend — Xpel Beauty field attendance',
  description: 'Clock in, clock out and report from the field.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Xtend' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#4c1d95',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
