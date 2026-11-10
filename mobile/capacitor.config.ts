import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Xtend for Android and iOS.
 *
 * The apps load the live Xtend site (XTEND_URL), so every web release
 * reaches phones at once, with no store update. What the browser cannot do
 * is added natively: location while the app is closed or the screen is
 * off, and real push notifications. See mobile/README.md.
 */
const url = process.env.XTEND_URL ?? 'https://www.withxtend.com'
const host = new URL(url).host

// The "No connection" page (www/index.html) is served from the app's own
// address (https://localhost). Its Try again button must go back to the
// site, not to "/" there: any other address opens in the phone's browser.
writeFileSync(
  join(__dirname, 'www', 'home.js'),
  `window.XTEND_HOME = ${JSON.stringify(url)}\n`,
)

const config: CapacitorConfig = {
  appId: 'ng.xpelbeauty.xtend',
  appName: 'Xtend',
  // Shown only if the site cannot be reached at all.
  webDir: 'www',
  // Lets the site tell the app from a browser before any script runs
  // (src/lib/app-agent.ts): no "Get the app" link inside the app itself.
  appendUserAgent: 'XtendApp',
  server: {
    url,
    cleartext: false,
    // Sign-in goes to Supabase; everything else stays on the Xtend site.
    // With and without "www.", in case the site redirects between them.
    allowNavigation: [host, host.startsWith('www.') ? host.slice(4) : `www.${host}`, '*.supabase.co'],
    errorPath: 'index.html',
  },
  android: {
    // Photos and the map are served over HTTPS only.
    allowMixedContent: false,
    // Keeps location updates coming after five minutes in the background
    // (capacitor-community/background-geolocation, issue 89).
    useLegacyBridge: true,
  },
  ios: {
    contentInset: 'never',
    // Keeps the session cookie and the offline queue between launches.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
