/**
 * Telling someone that a clock-in or clock-out they made with no signal was
 * NOT recorded after all. Saved on the phone while offline, it is sent when
 * the signal returns; if the server then refuses it (for example the photo
 * had gone stale, or notifications were off), or it could not be sent in
 * time, the saved copy is deleted. Without a notice the person believes they
 * clocked in. The notice waits on this phone until Home shows it.
 *
 * Pure on purpose (no browser APIs: the store is passed in), so
 * scripts/check-clock-notices.ts can test it.
 */
export interface NoticeStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const CLOCK_NOTICES_KEY = 'xtend.clock-notices'

/** Words for one that was not recorded. `at` is the time they tapped, "08:12". */
export function clockNotice(type: string, at: string, reason: string | null): string {
  const what = type === 'closing' ? 'clock-out' : 'clock-in'
  const why = (reason ?? '').trim().replace(/[.\s]+$/, '')
  return why
    ? `Your ${what} from ${at} was NOT recorded: ${why}. ${type === 'closing' ? 'Clock out again now.' : 'Clock in again now.'}`
    : `Your ${what} from ${at} was NOT recorded: it could not be sent in time. ${type === 'closing' ? 'Clock out again now.' : 'Clock in again now.'}`
}

function read(store: NoticeStore): string[] {
  try {
    const parsed = JSON.parse(store.getItem(CLOCK_NOTICES_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** Keeps a notice (no duplicates, the latest five). Never throws. */
export function addClockNotice(store: NoticeStore | null | undefined, notice: string) {
  if (!store) return
  try {
    const all = read(store).filter((n) => n !== notice)
    all.push(notice)
    store.setItem(CLOCK_NOTICES_KEY, JSON.stringify(all.slice(-5)))
  } catch {
    // No storage on this phone: the person is not told, nothing breaks.
  }
}

/** The waiting notices, which are then cleared. Never throws. */
export function takeClockNotices(store: NoticeStore | null | undefined): string[] {
  if (!store) return []
  try {
    const all = read(store)
    if (all.length) store.removeItem(CLOCK_NOTICES_KEY)
    return all
  } catch {
    return []
  }
}
