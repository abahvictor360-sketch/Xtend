/**
 * "Check out of the store before you leave" (migration 0099): what the
 * reminder says while someone is checked in at a store. The database
 * decides when (every visit_reminder_minutes(), 20 since 0101); this is only the
 * words. Pure, so scripts/check-field-guide.ts can test it.
 */
export const VISIT_REMINDER_MINUTES = 20

export function visitReminderMessage(store: string | null | undefined, since: string | null | undefined) {
  const name = store?.trim() || 'the store'
  const at = since && /^\d{2}:\d{2}$/.test(since) ? ` You checked in at ${since}.` : ''
  return {
    title: `Still at ${name}?`,
    body: `Check out of ${name} before you leave.${at}`,
    url: '/field',
  }
}
