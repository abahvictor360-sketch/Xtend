import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ServiceWorker } from '@/components/service-worker'
import { UpdateManager } from '@/components/update-manager'

export const metadata: Metadata = {
  title: 'Xtend — Xpel Beauty field attendance',
  applicationName: 'Xtend',
  description: 'Clock in, clock out and report from the field.',
  manifest: '/manifest.webmanifest',
  // A private staff app: never indexed, followed or cached by search
  // engines (with robots.txt and the X-Robots-Tag header, next.config.ts).
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Xtend' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
  icons: {
    icon: [
      { url: '/icons/icon-64.png', sizes: '64x64', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately no maximumScale: pinch-zoom stays available. Locking it
  // buys a marginally more "app-like" feel and fails WCAG 1.4.4.
  viewportFit: 'cover',
  themeColor: '#d1531b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
        <UpdateManager />
      </body>
    </html>
  )
}
