import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EVENT_WORDS, JOBS, JOB_WORDS, jobState, type JobRun } from '@/lib/job-health'
import { formatLagos } from '@/lib/utils'

interface Problem {
  id: number
  source: 'server' | 'client' | 'job'
  event: string
  message: string
  code: string | null
  path: string | null
  count: number
  last_at: string
}

const SOURCE = { server: 'Server', client: 'Phone or browser', job: 'Scheduled job' }

/**
 * System → Problems (0117): what went wrong lately, grouped, and how each
 * scheduled job is doing. For finding a fault quickly; nothing here changes
 * anything. Before 0117 it says to run the migration.
 */
export async function ProblemsPanel({ supabase }: { supabase: SupabaseClient }) {
  const [{ data: rows, error }, { data: summary }] = await Promise.all([
    supabase
      .from('app_errors')
      .select('id, source, event, message, code, path, count, last_at')
      .order('last_at', { ascending: false })
      .limit(30),
    supabase.rpc('error_summary'),
  ])
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Problems</CardTitle>
          <CardDescription>Run migration 0117 in Supabase to see problems here.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  const s = (summary ?? { last_hour: 0, last_day: 0, jobs: [] }) as { last_hour: number; last_day: number; jobs: JobRun[] }
  const problems = (rows ?? []) as Problem[]
  const runs = new Map(s.jobs.map((j) => [j.job, j]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {s.last_hour > 0 ? <AlertTriangle className="h-5 w-5 text-warning" /> : <CheckCircle2 className="h-5 w-5 text-success" />}
          Problems
        </CardTitle>
        <CardDescription>
          {s.last_hour} in the last hour, {s.last_day} in the last day. Xtend keeps working through these: each one is
          caught, recorded here and in the server log, and the rest carries on. The same problem again adds to its
          count. Kept 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold">Scheduled jobs</p>
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {Object.entries(JOBS).map(([job, { label, everyMinutes }]) => {
              const run = runs.get(job) ?? null
              const state = jobState(run, everyMinutes)
              return (
                <li key={job} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 font-medium">{label}</span>
                  <Badge variant={state === 'ok' ? 'success' : state === 'never' ? 'outline' : 'destructive'}>{JOB_WORDS[state]}</Badge>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto">
                    {run?.last_run_at ? `Last run ${formatLagos(run.last_run_at)}` : 'Not run yet'}
                    {state === 'failing' && run?.last_error ? `: ${run.last_error}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Recent problems</p>
          {problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has gone wrong lately.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {problems.map((p) => (
                <li key={p.id} className="space-y-0.5 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{EVENT_WORDS[p.event] ?? p.event.replace(/[._]/g, ' ')}</span>
                    <Badge variant="outline">{SOURCE[p.source]}</Badge>
                    {p.count > 1 && <Badge variant="warning">{p.count} times</Badge>}
                    {p.code && <Badge variant="outline">Code {p.code}</Badge>}
                  </div>
                  <p className="break-words text-xs text-muted-foreground">{p.message || 'No message'}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatLagos(p.last_at)}
                    {p.path ? ` · ${p.path}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
