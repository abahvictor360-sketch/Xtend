import { cronAuthorized } from '@/lib/cron'
import { flushClockOutReminders } from '@/lib/clock-out-reminders'
import { flushShiftSoonReminders } from '@/lib/shift-reminders'
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
 * (migration 0061), and gives a heads-up five minutes before each shift
 * starts and ends (migration 0069; it only sends inside those five minutes,
 * so it depends on this job running on time). It runs every five minutes from
 * .github/workflows/alerts-cron.yml, or from a server's crontab:
 *
 *   0-59/5 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/alerts
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // First, as they only count inside their five minutes: "Time to clock
  // in" / "Your shift ends at" five minutes before the start and end (0069).
  const shift_heads_ups = await flushShiftSoonReminders()
  // X Metrics reconciliation and expiry checks, once an hour.
  const metrics = new Date().getUTCMinutes() < 5 ? await runMetricsSweep() : null
  const sent = await flushFlagAlerts()
  // Notifications the office scheduled for now or earlier (migration 053).
  const scheduled = await flushScheduledNotifications()
  // "Time to clock out" at the shift end, and once more an hour later.
  const clock_out_reminders = await flushClockOutReminders()
  return Response.json({ sent, metrics, scheduled, shift_heads_ups, clock_out_reminders, ran_at: new Date().toISOString() })
}
