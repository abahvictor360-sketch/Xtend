import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Xtend for Android and iOS.
 *
 * The apps load the live Xtend site (XTEND_URL), so every web release
 * reaches phones at once, with no store update. What the browser cannot do
 * is added natively: location while the app is closed or the screen is
 * off, and real push notifications. See mobile/README.md.
 */
const url = process.env.XTEND_URL ?? 'https://xtend-brown.vercel.app'

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
    allowNavigation: [new URL(url).host, '*.supabase.co'],
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
