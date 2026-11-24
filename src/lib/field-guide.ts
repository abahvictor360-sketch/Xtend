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
  // What the server said when it refused (problemFromMessage).
  | 'no_stores'
  | 'pick_store'
  | 'store_not_yours'
  | 'notifications_off'
  | 'selfie_refused'
  | 'name_place'
  | 'phone_clock'
  | 'already_done'
  | 'clock_in_first'

/** Every problem, in the order the staff guide lists them ("When Xtend stops you"). */
const ALL_PROBLEMS = {
  location_permission: true,
  location_off: true,
  low_accuracy: true,
  location_unsupported: true,
  phone_settings: true,
  notifications_off: true,
  selfie_refused: true,
  phone_clock: true,
  pick_store: true,
  no_stores: true,
  store_not_yours: true,
  name_place: true,
  clock_in_first: true,
  already_done: true,
} satisfies Record<GuideProblem, true>
export const GUIDE_PROBLEMS = Object.keys(ALL_PROBLEMS) as GuideProblem[]

/** What the pop-up's main button does. */
export type GuideAction = 'retry' | 'battery_settings' | 'always_location' | 'show_settings' | 'pick_store' | 'message_office' | 'close'

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

/**
 * What went wrong, read from the words the server used to refuse a clock-in,
 * clock-out or store check-in. Null when it is not one we can guide through
 * (the plain message is shown instead).
 */
export function problemFromMessage(message: string | null | undefined): GuideProblem | null {
  const m = (message ?? '').toLowerCase()
  if (!m) return null
  if (m.includes('no stores are allocated')) return 'no_stores'
  if (m.includes('pick the store')) return 'pick_store'
  if (m.includes('not on your list')) return 'store_not_yours'
  if (m.includes('notifications')) return 'notifications_off'
  if (m.includes('selfie')) return 'selfie_refused'
  if (m.includes('name the place')) return 'name_place'
  if (m.includes('capture timestamp') || m.includes('phone clock') || m.includes('time on your phone')) return 'phone_clock'
  if (m.includes('already clocked') || m.includes('duplicate key') || m.includes('already checked')) return 'already_done'
  if (m.includes('clock in first') || m.includes('not clocked in')) return 'clock_in_first'
  return null
}

/** The staff guide, where every step is explained with pictures. */
export const STAFF_GUIDE_HREF = '/field/guide'

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
    case 'no_stores':
      return {
        title: 'No stores are allocated to you yet',
        why: 'You start your day at one of your stores, so the office must add your stores first.',
        steps: [
          'Message the office the list of stores you visit (today and on your usual round).',
          'For each store, open it in Google Maps, tap Share and send the link too, so the office can pin it.',
          'When the office has added them, come back and clock in.',
        ],
        action: 'message_office',
        actionLabel: 'Message the office',
      }
    case 'pick_store':
      return {
        title: 'Pick your store first',
        why: 'You clock in at the store you are starting your day at. Clocking in also checks you in there.',
        steps: ['Tap Clock in.', 'Pick the store you are at from your list.', 'Take your selfie.'],
        action: 'pick_store',
        actionLabel: 'Pick a store',
      }
    case 'store_not_yours':
      return {
        title: 'That store is not on your list',
        why: 'You can only start your day at one of the stores allocated to you.',
        steps: [
          'Pick one of your own stores instead.',
          'Working at a new store? Message the office its name and its Google Maps link so they can add it.',
        ],
        action: 'pick_store',
        actionLabel: 'Pick another store',
      }
    case 'notifications_off':
      return {
        title: 'Turn on Xtend notifications',
        why: 'Xtend needs notifications on before you clock in, so the office can reach you during the day.',
        steps: ios
          ? ['Open Settings, then Notifications, then Xtend.', 'Turn on Allow Notifications.', 'Come back and tap Try again.']
          : ['Open Settings, then Apps, then Xtend, then Notifications.', 'Turn notifications on.', 'Come back and tap Try again.'],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'selfie_refused':
      return {
        title: 'Take your selfie again',
        why: 'The photo could not be used. It must be a live photo of your face, taken in Xtend just now.',
        steps: [
          'Face a light (a window or the shop lights), not with the light behind you.',
          'Hold the phone still at arm’s length, your whole face in the picture.',
          'Do not take a photo of a screen or a printed picture.',
          'Tap Try again and take the selfie.',
        ],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'name_place':
      return {
        title: 'Name this place first',
        why: 'Xtend does not know the place you clocked in at. Name it once, then carry on.',
        steps: ['On Home, tap Name this place.', 'Take a photo of the store sign outside and a selfie with our product.', 'Then try again.'],
        action: 'close',
        actionLabel: 'OK',
      }
    case 'phone_clock':
      return {
        title: 'Your phone’s time is wrong',
        why: 'The time on your phone does not match the real time, so Xtend cannot record this.',
        steps: [
          ios ? 'Open Settings, General, Date & Time.' : 'Open Settings, then Date & time (System).',
          'Turn on Set automatically (and Automatic time zone).',
          'Come back and tap Try again.',
        ],
        action: 'retry',
        actionLabel: 'Try again',
      }
    case 'already_done':
      return {
        title: 'This is already recorded',
        why: 'Xtend already has this for today. Pull down on Home to see it.',
        steps: ['Go back to Home and check what it says.', 'If it looks wrong, message the office.'],
        action: 'close',
        actionLabel: 'OK',
      }
    case 'clock_in_first':
      return {
        title: 'Clock in first',
        why: 'You need to be clocked in before you do this.',
        steps: ['On Home, tap Clock in and take your selfie.', 'Then try again.'],
        action: 'close',
        actionLabel: 'OK',
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
