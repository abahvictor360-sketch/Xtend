/**
 * The office fixing someone's day (0090): the actions, what each is
 * called, and what the person is told. Pure, so
 * scripts/check-field-corrections.ts can test it.
 */

export const CORRECTION_ACTIONS = [
  'office_clock_in',
  'office_clock_out',
  'office_check_in',
  'office_check_out',
  'redo_clock_in',
  'redo_clock_out',
  'redo_check_in',
  'redo_check_out',
] as const

export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number]

/** How each shows on the office's screen and in the history. */
export const CORRECTION_LABELS: Record<CorrectionAction, string> = {
  office_clock_in: 'Clocked in by the office',
  office_clock_out: 'Clocked out by the office',
  office_check_in: 'Checked in by the office',
  office_check_out: 'Checked out by the office',
  redo_clock_in: 'Asked to clock in again',
  redo_clock_out: 'Asked to clock out again',
  redo_check_in: 'Asked to check in again',
  redo_check_out: 'Asked to check out again',
}

/** What the person is told: plain words, with the office's reason. */
export function correctionNotice(
  action: CorrectionAction,
  d: { by: string; store: string | null; time: string; reason: string },
): { title: string; body: string } {
  const at = d.store ? ` at ${d.store}` : ''
  const why = d.reason.trim()
  switch (action) {
    case 'office_clock_in':
      return { title: 'You were clocked in', body: `${d.by} clocked you in${at} at ${d.time}. ${why}` }
    case 'office_clock_out':
      return { title: 'You were clocked out', body: `${d.by} clocked you out${at} at ${d.time}. ${why}` }
    case 'office_check_in':
      return { title: 'You were checked in', body: `${d.by} checked you in${at}. ${why}` }
    case 'office_check_out':
      return { title: 'You were checked out', body: `${d.by} checked you out of the store. ${why}` }
    case 'redo_clock_in':
      return { title: 'Please clock in again', body: `${d.by} asked you to clock in again: ${why}` }
    case 'redo_clock_out':
      return { title: 'Please clock out again', body: `${d.by} asked you to clock out again: ${why}` }
    case 'redo_check_in':
      return { title: 'Please check in again', body: `${d.by} asked you to check in at the store again: ${why}` }
    case 'redo_check_out':
      return { title: 'Please check out again', body: `${d.by} asked you to check out of the store again: ${why}` }
  }
}

/** The words on Home for a request still to be done. */
export function redoBanner(action: string): string | null {
  if (action === 'redo_clock_in') return 'The office asked you to clock in again.'
  if (action === 'redo_clock_out') return 'The office asked you to clock out again.'
  return null
}
