import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['exceljs'],
  // Keep a just-visited dynamic route in the client router cache for a short
  // window so switching between the phone's tabs reuses what was already
  // loaded instead of re-fetching the whole layout and page from the server
  // every time. The dashboard's realtime refresh (use-dashboard-refresh) and
  // any router.refresh() still bust this cache the moment data changes, so
  // the screen stays current; this only removes the dead round-trip on a
  // plain back-and-forth between tabs.
  experimental: {
    staleTimes: {
      dynamic: 15,
      static: 180,
    },
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
