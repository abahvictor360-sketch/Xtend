import 'server-only'
import { after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { describe, dueToRecord, fingerprintOf, redact, type ErrorSource } from '@/lib/log-core'

/**
 * Xtend's error logging (2026-11-27, migration 0117). Every problem is
 * written to the server's log as one JSON line (level, time, event, the
 * error and its context, secrets hidden), and recorded in app_errors so
 * admins see it on System → Problems. The same problem is recorded at most
 * once a minute from one server; the database adds repeats to its count.
 * Nothing here ever throws: logging must not cause a second failure.
 */

const seen = new Map<string, number>()

export interface LogContext {
  /** The page or route it happened on. */
  path?: string | null
  /** A short code people can read out (e.g. a crash screen's code). */
  code?: string | null
  [key: string]: unknown
}

export function logError(event: string, error: unknown, context: LogContext = {}, source: ErrorSource = 'server') {
  write('error', event, error, context, source, true)
}

/** A problem worth recording that was handled (a fallback was used). */
export function logWarn(event: string, error: unknown, context: LogContext = {}, source: ErrorSource = 'server') {
  write('warn', event, error, context, source, true)
}

function write(level: 'error' | 'warn', event: string, error: unknown, context: LogContext, source: ErrorSource, record: boolean) {
  try {
    const d = describe(error)
    const safe = redact(context)
    const line = JSON.stringify({ level, at: new Date().toISOString(), source, event, error: d, ...safe })
    if (level === 'error') console.error(line)
    else console.warn(line)
    if (!record) return
    const path = typeof context.path === 'string' ? context.path : null
    const fp = fingerprintOf(source, event, d.message, path)
    if (!dueToRecord(seen, fp)) return
    const { path: _p, code, ...rest } = safe
    const task = async () => {
      try {
        await createAdminSupabase().rpc('record_app_error', {
          p_source: source,
          p_event: event.slice(0, 80),
          p_message: d.message,
          p_code: typeof code === 'string' ? code : null,
          p_path: path,
          p_detail: rest,
        })
      } catch {
        // The log line above is the record; the database may be the problem.
      }
    }
    try {
      after(task)
    } catch {
      // Outside a request (a script): send it now, without waiting.
      void task()
    }
  } catch {
    // Never let logging throw.
  }
}

/**
 * A scheduled job made of steps (2026-11-27): each step runs on its own, so
 * one failing never stops the ones after it. A failed step is logged and
 * gives its fallback; the run is recorded in job_runs with the first error.
 */
export async function runJob<T extends Record<string, () => Promise<unknown>>>(
  job: string,
  steps: T,
): Promise<{ results: { [K in keyof T]: unknown }; failed: string[] }> {
  const results = {} as { [K in keyof T]: unknown }
  const failed: string[] = []
  let firstError: string | null = null
  for (const [name, step] of Object.entries(steps) as [keyof T & string, () => Promise<unknown>][]) {
    try {
      results[name] = await step()
    } catch (error) {
      failed.push(name)
      results[name] = { error: 'failed' }
      const d = describe(error)
      firstError ??= `${name}: ${d.message}`
      logError('job.step_failed', error, { job, step: name }, 'job')
    }
  }
  try {
    await createAdminSupabase().rpc('record_job_run', {
      p_job: job,
      p_ok: failed.length === 0,
      p_result: { failed, ran_at: new Date().toISOString() },
      p_error: firstError,
    })
  } catch {
    // Before 0117, or the database is down: the log has it.
  }
  return { results, failed }
}

/**
 * A drop-in for console.error('what happened', error, …) in server code:
 * the same line in the log, and recorded for System → Problems. The first
 * text names the problem; the first error-like value is the error; other
 * short values go in the detail.
 */
export function logProblem(...args: unknown[]) {
  try {
    const [first, ...rest] = args
    const label = typeof first === 'string' ? first : 'problem'
    const err =
      rest.find((a) => a instanceof Error || (a !== null && typeof a === 'object' && 'message' in (a as object))) ??
      (rest.length ? rest.map(String).join(' ') : label)
    const extra = rest.filter((a) => a !== err && (typeof a === 'string' || typeof a === 'number'))
    logError(eventName(label), err, extra.length ? { detail: extra.join(' ').slice(0, 300) } : {})
  } catch {
    // Never let logging throw.
  }
}

/** "flag alerts failed" → "flag_alerts_failed". */
export function eventName(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'problem'
  )
}
