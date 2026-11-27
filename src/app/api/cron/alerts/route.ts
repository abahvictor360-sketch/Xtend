import { cronAuthorized } from '@/lib/cron'
import { runJob } from '@/lib/log'
import { flushClockOutReminders } from '@/lib/clock-out-reminders'
import { flushShiftSoonReminders } from '@/lib/shift-reminders'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { runMetricsSweep } from '@/lib/metrics/server'
import { flushScheduledNotifications } from '@/lib/notification-send'
import { flushAppUpdateNotices } from '@/lib/app-update-notices'
import { flushVisitCheckoutReminders } from '@/lib/visit-reminders'
import { flushLocationOffAlerts } from '@/lib/location-off'

export const maxDuration = 60

/**
 * Sends any integrity flag nobody has been told about yet. Flags are
 * usually sent the moment the clock-in, ping or photo that raised them
 * arrives; this catches the rest (a flag raised by a database job, or a
 * send that failed). It also sends scheduled notifications that are due,
 * and asks anyone still clocked in after their shift end to clock out
 * (migration 0061), and gives a heads-up five minutes before each shift
 * starts and ends (migration 0069; it only sends inside those five minutes,
 * so it depends on this job running on time), and tells anyone on an older
 * phone app that a new one is out (0082), and reminds anyone still checked
 * in at a store to check out before they leave, every 25 minutes (0099), and
 * tells the supervisor when someone's location has been off on shift (0115). It runs every five minutes from
 * .github/workflows/alerts-cron.yml, or from a server's crontab:
 *
 *   0-59/5 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/alerts
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Each step on its own (2026-11-27): one failing is logged and recorded
  // (System → Problems, and the job's last run) and the others still run.
  const { results, failed } = await runJob('alerts', {
    // First, as they only count inside their five minutes: "Time to clock
    // in" / "Your shift ends at" five minutes before the start and end (0069).
    shift_heads_ups: () => flushShiftSoonReminders(),
    // X Metrics reconciliation and expiry checks, once an hour.
    metrics: async () => (new Date().getUTCMinutes() < 5 ? await runMetricsSweep() : null),
    sent: () => flushFlagAlerts(),
    // Notifications the office scheduled for now or earlier (migration 053).
    scheduled: () => flushScheduledNotifications(),
    // "Time to clock out" at the shift end, and once more an hour later.
    clock_out_reminders: () => flushClockOutReminders(),
    // "Check out of the store before you leave", every 25 minutes in a store (0099).
    store_check_out_reminders: () => flushVisitCheckoutReminders(),
    // "A new Xtend app is ready" for anyone on an older phone app (0082).
    app_updates: () => flushAppUpdateNotices(),
    // "<name>'s location is off" to their supervisor, after 15 minutes off on shift (0115).
    location_off: () => flushLocationOffAlerts(),
  })
  return Response.json({ ...results, failed, ran_at: new Date().toISOString() }, { status: failed.length === 8 ? 500 : 200 })
}
