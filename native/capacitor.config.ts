import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Xtend ships as one web app. These native apps are thin shells: they load
 * the live site in a native WebView and add the LocationIntegrity plugin
 * (Android mock-location flag, root / jailbreak check). A Vercel deploy
 * updates both apps instantly, with no new store submission, because the
 * content is loaded from `server.url`, not bundled.
 *
 * Point XTEND_URL at a different build (staging, a PR preview) when testing;
 * it defaults to production.
 */
const config: CapacitorConfig = {
  appId: 'com.xpelbeauty.xtend',
  appName: 'Xtend',
  // Capacitor still needs a web directory on disk; www/ holds only the
  // splash shown for the moment before the live site loads.
  webDir: 'www',
  server: {
    url: process.env.XTEND_URL || 'https://xtend-brown.vercel.app',
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
    // Only Xtend's own origin opens in the app; any other link (a map, a
    // help page) opens in the system browser instead.
    allowNavigation: ['xtend-brown.vercel.app'],
  },
  android: {
    backgroundColor: '#0e1a14',
  },
  ios: {
    backgroundColor: '#0e1a14',
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0e1a14',
      showSpinner: false,
    },
  },
}

export default config
