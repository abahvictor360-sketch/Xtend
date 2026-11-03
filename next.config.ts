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
  // No "X-Powered-By: Next.js" on responses: no need to tell anyone what
  // Xtend is built with.
  poweredByHeader: false,
  // The Docker image (Dockerfile, for Dokploy or Coolify) runs the small
  // self-contained server; the PM2 setup (deploy/) keeps `next start`.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
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
      // Safer defaults on every page and API answer. Camera and location
      // stay allowed for Xtend itself (selfies, clock-in); nothing may frame
      // it; browsers must keep using HTTPS for two years.
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // A private staff app: no search engine may index, follow or
          // cache any page, file or answer (with robots.txt and the
          // middleware's bot check, lib/bot-guard.ts).
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
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
