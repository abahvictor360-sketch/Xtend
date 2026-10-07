import { cronAuthorized } from '@/lib/cron'
import { flushFlagAlerts } from '@/lib/flag-alerts'
import { runMetricsSweep } from '@/lib/metrics/server'

export const maxDuration = 60

/**
 * Sends any integrity flag nobody has been told about yet. Flags are
 * usually sent the moment the clock-in, ping or photo that raised them
 * arrives; this catches the rest (a flag raised by a database job, or a
 * send that failed). Run it every five minutes from the server's crontab:
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
  return Response.json({ sent, metrics, ran_at: new Date().toISOString() })
}
