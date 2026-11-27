import { cronAuthorized } from '@/lib/cron'
import { runJob } from '@/lib/log'
import { runMetricsSweep } from '@/lib/metrics/server'

export const maxDuration = 60

/**
 * X Metrics: reconciles counts whose day has ended, raises expiry alerts by
 * batch, and pushes both to the office. /api/cron/alerts runs it too, so a
 * server that only calls that one still gets it; or run it on its own:
 *
 *   15 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/metrics
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { results, failed } = await runJob('metrics', { sweep: () => runMetricsSweep() })
  return Response.json({ ...(results.sweep as object), failed, ran_at: new Date().toISOString() }, { status: failed.length ? 500 : 200 })
}
