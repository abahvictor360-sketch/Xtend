'use client'

/**
 * Enough of the user agent to give someone the right instructions. This is
 * used only to pick which set of steps to show, never to gate behaviour, so
 * a wrong guess costs a slightly-off help screen and nothing else.
 */
export type MobileOs = 'ios' | 'android' | 'other'
export type Browser = 'safari' | 'chrome' | 'firefox' | 'samsung' | 'edge' | 'opera' | 'other'

export interface Platform {
  os: MobileOs
  browser: Browser
  /** Running from the home screen rather than inside a browser tab. */
  installed: boolean
  label: string
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') {
    return { os: 'other', browser: 'other', installed: false, label: 'this device' }
  }

  const ua = navigator.userAgent
  const isIpad =
    /iPad/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)

  const os: MobileOs = /iPhone|iPod/.test(ua) || isIpad ? 'ios' : /Android/.test(ua) ? 'android' : 'other'

  // Order matters: most of these also claim to be Safari or Chrome.
  const browser: Browser = /SamsungBrowser/.test(ua)
    ? 'samsung'
    : /EdgA?|Edg\//.test(ua)
      ? 'edge'
      : /OPR|Opera/.test(ua)
        ? 'opera'
        : /FxiOS|Firefox/.test(ua)
          ? 'firefox'
          : /CriOS|Chrome/.test(ua)
            ? 'chrome'
            : /Safari/.test(ua)
              ? 'safari'
              : 'other'

  const installed =
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(display-mode: standalone)').matches === true) ||
    // iOS uses its own flag rather than the display-mode query.
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  const names: Record<Browser, string> = {
    safari: 'Safari',
    chrome: 'Chrome',
    firefox: 'Firefox',
    samsung: 'Samsung Internet',
    edge: 'Edge',
    opera: 'Opera',
    other: 'your browser',
  }

  const label = installed
    ? os === 'ios'
      ? 'Xtend on your Home Screen'
      : 'the Xtend app'
    : `${names[browser]}${os === 'ios' ? ' on iPhone' : os === 'android' ? ' on Android' : ''}`

  return { os, browser, installed, label }
}

/**
 * The exact taps that turn location back on, for this device. A web page
 * cannot open the system settings app itself — no browser exposes that —
 * so the next best thing is to name the screens precisely enough that
 * nobody has to go hunting.
 */
export function locationSteps(platform: Platform): { title: string; steps: string[] }[] {
  const { os, browser, installed } = platform

  if (os === 'ios') {
    const site: { title: string; steps: string[] }[] = installed
      ? [
          {
            title: 'iPhone Settings',
            steps: [
              'Open the Settings app',
              'Scroll down and tap Xtend',
              'Tap Location',
              'Choose While Using the App',
              'Turn Precise Location on',
              'Come back here and tap Try again',
            ],
          },
        ]
      : [
          {
            title: `In ${browser === 'chrome' ? 'Chrome' : 'Safari'}`,
            steps:
              browser === 'chrome'
                ? [
                    'Tap the ••• menu, then Settings',
                    'Tap Content Settings, then Location',
                    'Set it to Ask first, then reload this page',
                  ]
                : [
                    'Tap the ᴀA icon on the left of the address bar',
                    'Tap Website Settings',
                    'Set Location to Allow, then reload this page',
                  ],
          },
          {
            title: 'Then check iPhone Settings',
            steps: [
              'Open the Settings app, then Privacy & Security',
              'Tap Location Services and make sure it is on',
              `Scroll to ${browser === 'chrome' ? 'Chrome' : 'Safari'} and set it to While Using the App`,
              'Turn Precise Location on',
            ],
          },
        ]
    return site
  }

  if (os === 'android') {
    if (installed) {
      return [
        {
          title: 'Android Settings',
          steps: [
            'Press and hold the Xtend icon on your home screen',
            'Tap App info (the ⓘ)',
            'Tap Permissions, then Location',
            'Choose Allow only while using the app',
            'Come back here and tap Try again',
          ],
        },
      ]
    }
    return [
      {
        title: `In ${browser === 'samsung' ? 'Samsung Internet' : browser === 'firefox' ? 'Firefox' : 'Chrome'}`,
        steps: [
          'Tap the icon just left of the web address (a padlock or sliders)',
          'Tap Permissions, or Site settings',
          'Set Location to Allow',
          'Reload this page',
        ],
      },
      {
        title: 'If it is still blocked',
        steps: [
          'Open Android Settings, then Apps',
          `Tap ${browser === 'samsung' ? 'Samsung Internet' : browser === 'firefox' ? 'Firefox' : 'Chrome'}, then Permissions, then Location`,
          'Choose Allow only while using the app',
          'Also check Location is switched on in the phone’s quick settings',
        ],
      },
    ]
  }

  return [
    {
      title: 'In your browser',
      steps: [
        'Click the icon just left of the web address',
        'Set Location to Allow',
        'Reload this page',
      ],
    },
  ]
}
