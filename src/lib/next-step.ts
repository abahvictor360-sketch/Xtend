/**
 * "Your next step" on the staff Home screen: what to do now, in order,
 * so the app guides the day. Marketers go store to store: after clocking
 * in, check in at a store; while in one, check out before leaving; then the
 * next store, the report and the clock-out. Pure, so
 * scripts/check-field-guide.ts can test every case.
 */

export interface NextStepState {
  clockedIn: boolean
  clockedOut: boolean
  offDay: boolean
  reportRequired: boolean
  reportFiled: boolean
  /** Marketers: they check in and out of stores during the day. */
  visitsStores: boolean
  /** The store they are checked in at now, if any. */
  openVisit: { store: string; since: string } | null
  /** Store visits finished today. */
  visitsDone: number
}

export type NextStepAction = 'clock' | 'check_in' | 'check_out' | 'report' | null

export interface NextStep {
  key: 'off' | 'clock_in' | 'in_store' | 'first_store' | 'next_store' | 'report' | 'on_shift' | 'done'
  title: string
  description: string
  action: NextStepAction
  actionLabel: string | null
}

export function nextStep(s: NextStepState): NextStep {
  if (s.offDay && !s.clockedIn) {
    return { key: 'off', title: 'Enjoy your time off', description: 'You are not scheduled to work today.', action: null, actionLabel: null }
  }
  if (!s.clockedIn) {
    return s.visitsStores
      ? {
          key: 'clock_in',
          title: 'Start your day at your first store',
          description:
            'At the store, tap Clock in and pick the store: clocking in checks you in there too. Your day only counts once you clock in at a store.',
          action: 'clock',
          actionLabel: 'Pick a store and clock in',
        }
      : {
          key: 'clock_in',
          title: 'Start your day: clock in',
          description: 'Clock in when you arrive at your store.',
          action: 'clock',
          actionLabel: 'Clock in',
        }
  }
  const reportDue = s.reportRequired && !s.reportFiled
  if (s.openVisit) {
    return {
      key: 'in_store',
      title: `You are in ${s.openVisit.store}`,
      description: `Checked in at ${s.openVisit.since}. Check out of ${s.openVisit.store} before you leave it.`,
      action: 'check_out',
      actionLabel: `Check out of ${s.openVisit.store}`,
    }
  }
  if (s.visitsStores && !s.clockedOut) {
    return s.visitsDone === 0
      ? {
          key: 'first_store',
          title: 'Next: check in at your first store',
          description: 'When you get to a store, check in. Check out of it before you leave.',
          action: 'check_in',
          actionLabel: 'Check in at a store',
        }
      : {
          key: 'next_store',
          title: 'Going to another store?',
          description: `${s.visitsDone} store${s.visitsDone === 1 ? '' : 's'} done today. Check in when you get to the next one${reportDue ? ', or write your report' : ''}. Clock out when your day ends.`,
          action: 'check_in',
          actionLabel: 'Check in at the next store',
        }
  }
  if (reportDue) {
    return { key: 'report', title: 'Your daily report is next', description: 'Write what you did today while it is fresh.', action: 'report', actionLabel: 'Open daily report' }
  }
  if (s.clockedOut) {
    return { key: 'done', title: 'Your day is complete', description: 'You can see today’s activity below.', action: null, actionLabel: null }
  }
  return {
    key: 'on_shift',
    title: 'You’re on shift',
    description: 'Clock out when your shift ends.',
    action: 'clock',
    actionLabel: 'Clock controls',
  }
}
