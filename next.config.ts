import type { NextConfig } from 'next'

// One id per deploy, baked into both the server and the pages it serves. A
// page compares its own with what /api/version says now: when they differ,
// a newer version is live and the page offers to update (UpdateManager).
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.XTEND_BUILD_ID ||
  `local-${Date.now().toString(36)}`

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, '-'),
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
