import { cronAuthorized } from '@/lib/cron'
import { flushClockOutReminders } from '@/lib/clock-out-reminders'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { runMetricsSweep } from '@/lib/metrics/server'
import { flushScheduledNotifications } from '@/lib/notification-send'

export const maxDuration = 60

/**
 * Sends any integrity flag nobody has been told about yet. Flags are
 * usually sent the moment the clock-in, ping or photo that raised them
 * arrives; this catches the rest (a flag raised by a database job, or a
 * send that failed). It also sends scheduled notifications that are due,
 * and asks anyone still clocked in after their shift end to clock out
 * (migration 0061). It runs every five minutes from
 * .github/workflows/alerts-cron.yml, or from a server's crontab:
 *
 *   0-59/5 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/alerts
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // X Metrics reconciliation and expiry checks, once an hour.
  const metrics = new Date().getUTCMinutes() < 5 ? await runMetricsSweep() : null
  const sent = await flushFlagAlerts()
  // Notifications the office scheduled for now or earlier (migration 053).
  const scheduled = await flushScheduledNotifications()
  // "Time to clock out" at the shift end, and once more an hour later.
  const clock_out_reminders = await flushClockOutReminders()
  return Response.json({ sent, metrics, scheduled, clock_out_reminders, ran_at: new Date().toISOString() })
}
