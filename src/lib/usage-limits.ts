/**
 * How much one person may use the paid services behind Xtend: the AI that
 * checks photos, the support helper, Ask Xtend, and the map lookups. Each
 * count is kept per person in the server process (lib/rate-limit.ts). The
 * numbers are far above what a working day needs, so only a runaway phone
 * or somebody misusing an account ever meets them.
 */
export const HOUR_MS = 60 * 60 * 1000

/** Photo checks (/api/photo-check) a person may ask for in an hour. */
export const PHOTO_CHECKS_PER_HOUR = 60
/** Place lookups (/api/geocode) a person may ask for in an hour. */
export const GEOCODE_LOOKUPS_PER_HOUR = 120
/** Support helper replies a person may get in an hour. */
export const SUPPORT_HELPER_REPLIES_PER_HOUR = 20
/** After this many messages in one support conversation, a person answers. */
export const SUPPORT_HELPER_THREAD_MAX = 12
/** Ask Xtend questions an admin or supervisor may ask in an hour. */
export const ASK_XTEND_PER_HOUR = 60

export const ASK_XTEND_LIMIT_MESSAGE =
  'You have asked a lot of questions in the last hour. Take a short break and try again later.'

/** What the support helper does with a new message. */
export type SupportHelperMode =
  /** The AI reads the conversation and answers. */
  | 'answer'
  /** No AI: the conversation goes to the office, which answers. */
  | 'office'

/**
 * The helper answers while the person is within their hourly allowance and
 * the conversation is still short. Past either, the member's message is kept
 * and the office answers instead.
 */
export function supportHelperMode(withinHourlyLimit: boolean, messagesInThread: number): SupportHelperMode {
  if (!withinHourlyLimit) return 'office'
  if (messagesInThread >= SUPPORT_HELPER_THREAD_MAX) return 'office'
  return 'answer'
}

/** The default most Google place requests a month when none is set. */
export const DEFAULT_GOOGLE_MONTHLY_LOOKUP_LIMIT = 20000
