/**
 * The staff app as a guide: when something stops a clock-in, a store
 * check-in or a check-out, a pop-up says what is wrong in plain words and
 * what to do, step by step, with a button that opens the right setting
 * where the phone allows it. Pure, so scripts/check-field-guide.ts can test
 * it. Staff are told what to do, never how they are monitored.
 */
import type { GeoBlockReason } from '@/lib/geo'

export type GuideProblem =
  | 'location_permission'
  | 'location_off'
  | 'low_accuracy'
  | 'location_unsupported'
  | 'phone_settings'

/** What the pop-up's main button does. */
export type GuideAction = 'retry' | 'battery_settings' | 'always_location' | 'show_settings'

export interface Guide {
  title: string
  /** One line: what is wrong. */
  why: string
  /** Numbered steps, in order. */
  steps: string[]
  action: GuideAction
  actionLabel: string
}

export type GuidePlatform = 'android' | 'ios' | null

export function problemFromGeo(reason: GeoBlockReason): GuideProblem {
  switch (reason) {
    case 'permission_denied':
      return 'location_permission'
    case 'position_unavailable':
      return 'location_off'
    case 'low_accuracy':
      return 'low_accuracy'
    default:
      return 'location_unsupported'
  }
}

/** The steps for one problem, worded for the phone in hand. */
export function guideFor(problem: GuideProblem, platform: GuidePlatform, task = 'clock in'): Guide {
  const ios = platform === 'ios'
  switch (problem) {
    case 'location_permission':
      return {
        title: 'Allow location for Xtend',
        why: `Xtend cannot ${task} without your location, and location is not allowed for Xtend.`,
        steps: ios
          ? ['Open Settings on your iPhone.', 'Scroll down and tap Xtend, then Location.', 'Choose "Always" (or "While Using the App") and turn on Precise Location.', `Come back to Xtend and tap Try again.`]
          : platform === 'android'
            ? ['Open Settings, then Apps, then Xtend.', 'Tap Permissions, then Location.', 'Choose "Allow all the time" and turn on "Use precise location".', 'Come back to Xtend and tap Try again.']
            : ['Tap the lock or settings icon next to the web address at the top.', 'Set Location to Allow.', 'Reload the page and tap Try again.'],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'location_off':
      return {
        title: 'Turn on Location',
        why: 'Your phone could not find where you are. Location may be off, or the signal is weak indoors.',
        steps: ios
          ? ['Open Control Centre or Settings, then Privacy & Security, then Location Services, and turn it on.', 'Move near the door or a window, or step outside for a moment.', 'Tap Try again.']
          : ['Pull down from the top of the screen and turn on Location.', 'Press and hold Location, and turn on "Improve accuracy" (Google Location Accuracy) and Wi-Fi scanning.', 'Move near the door or a window, or step outside for a moment.', 'Tap Try again.'],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'low_accuracy':
      return {
        title: 'Your location is too rough',
        why: 'Your phone only knows roughly where you are. Xtend needs it to within 100 m.',
        steps: [
          ios ? 'In Settings, Xtend, Location, turn on Precise Location.' : 'Pull down from the top, press and hold Location, and turn on "Improve accuracy".',
          'Turn on Wi-Fi (you do not need to connect to a network).',
          'Move near the door or a window, or step outside, and wait a few seconds.',
          'Tap Try again.',
        ],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'phone_settings':
      return {
        title: `Finish setting up Xtend to ${task}`,
        why: `Some phone settings Xtend needs are still off, so you cannot ${task} yet.`,
        steps: ios
          ? ['In Settings, tap Xtend, then Location, and choose "Always".', 'Come back to Xtend. The card on Home clears by itself when it is done.']
          : ['Set Location for Xtend to "Allow all the time".', 'Set Battery for Xtend to "Unrestricted" (or turn off battery saving for Xtend).', 'Come back to Xtend. The card on Home clears by itself when it is done.'],
        action: 'show_settings',
        actionLabel: 'Show me the settings',
      }
    default:
      return {
        title: 'Open Xtend in the app or in Chrome',
        why: 'This browser cannot tell Xtend where you are.',
        steps: ['Open the Xtend app on your phone, or open Xtend in Chrome.', 'Sign in and try again.'],
        action: 'retry',
        actionLabel: 'Try again',
      }
  }
}
