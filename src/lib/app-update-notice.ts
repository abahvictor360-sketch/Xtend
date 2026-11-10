/**
 * The phone notification that tells someone a new Xtend app is out
 * (migration 0082). Pure: shared by the alerts job and
 * scripts/check-updates.ts.
 */

/** Lagos hours (inclusive start, exclusive end) when it may be sent: not at night. */
export const NOTICE_HOURS = { from: 7, to: 20 } as const

/** The hour in Lagos (UTC+1, no daylight saving). */
export function lagosHour(at: Date = new Date()) {
  return (at.getUTCHours() + 1) % 24
}

export function noticeHour(at: Date = new Date()) {
  const h = lagosHour(at)
  return h >= NOTICE_HOURS.from && h < NOTICE_HOURS.to
}

export function updateNoticeMessage(platform: 'android' | 'ios', version: string | null, times: number) {
  const name = version ? `Xtend ${version}` : 'A new Xtend app'
  const where =
    platform === 'android'
      ? 'Open Xtend and tap Get it, or download it from the Xtend download page.'
      : 'Open TestFlight and tap Update.'
  return {
    title: times > 1 ? 'Please update Xtend' : 'A new Xtend app is ready',
    body: `${name} is ready to install. ${where} Your account and anything waiting to send are kept.`,
  }
}
