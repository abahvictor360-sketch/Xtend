/**
 * How each scheduled job is doing, for System → Problems (0117). Pure, so
 * scripts/check-error-handling.ts can test it.
 */

export const JOBS: Record<string, { label: string; everyMinutes: number }> = {
  alerts: { label: 'Five-minute alerts and reminders', everyMinutes: 5 },
  absence_sweep: { label: 'Morning no-show check', everyMinutes: 24 * 60 },
  nightly: { label: 'Night clean-up', everyMinutes: 24 * 60 },
  metrics: { label: 'X Metrics checks', everyMinutes: 24 * 60 },
}

export type JobState = 'ok' | 'failing' | 'late' | 'never'

export interface JobRun {
  job: string
  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  last_error_at: string | null
}

/**
 * Late: no run for four times its interval (20 minutes for the alerts, a
 * little over a day for the daily ones). Failing: its last run failed.
 */
export function jobState(run: JobRun | null, everyMinutes: number, now = Date.now()): JobState {
  if (!run?.last_run_at) return 'never'
  const lateAfter = (everyMinutes <= 60 ? Math.max(everyMinutes * 4, 20) : everyMinutes + 120) * 60_000
  if (now - Date.parse(run.last_run_at) > lateAfter) return 'late'
  if (run.last_error_at && (!run.last_ok_at || Date.parse(run.last_error_at) >= Date.parse(run.last_ok_at))) return 'failing'
  return 'ok'
}

export const JOB_WORDS: Record<JobState, string> = {
  ok: 'Running',
  failing: 'Last run failed',
  late: 'Has not run on time',
  never: 'No run recorded yet',
}

/** "api.unexpected" → words an admin reads. */
export const EVENT_WORDS: Record<string, string> = {
  'api.unexpected': 'A request failed on the server',
  'db.error': 'The database refused something',
  'client.screen_crash': 'A screen crashed on someone’s phone',
  'client.background_error': 'An error in the background of a page',
  'job.step_failed': 'A scheduled job step failed',
  'api.redirect_route_failed': 'Signing out failed (they were sent to the login page)',
}
