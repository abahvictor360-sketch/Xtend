import { FlaskConical, ShieldCheck } from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FinishFiles, GoLivePanel, ResetPanel } from '@/components/admin/system-reset'
import { categoryLabel, type ResetResult } from '@/lib/system-reset'
import { formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'System — Xtend' }

interface SystemSettings {
  test_mode: boolean
  went_live_at: string | null
  went_live_by: string | null
  last_reset_at: string | null
  last_reset_by: string | null
  last_reset: ResetResult | null
}

/** Test mode, resetting the test run and going live (0066). Admins only. */
export default async function SystemPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const [{ data, error }, { data: pending }] = await Promise.all([
    supabase.from('system_settings').select('*').maybeSingle<SystemSettings>(),
    supabase.rpc('reset_files_pending'),
  ])

  const ids = [data?.went_live_by, data?.last_reset_by].filter((x): x is string => Boolean(x))
  const { data: people } = ids.length
    ? await supabase.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const name = (id: string | null | undefined) =>
    ((people ?? []) as { id: string; full_name: string }[]).find((p) => p.id === id)?.full_name ?? 'an admin'
  const left = typeof pending === 'number' ? pending : 0

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">System</h1>
        <p className="text-sm text-muted-foreground">
          Test mode lets you try Xtend out in different places, then clear the test records and start afresh. When you
          are ready for real work, turn test mode off.
        </p>
      </div>

      {(error || !data) && (
        <p className="text-sm text-destructive">
          The system settings could not be loaded. Has migration 0066 been run in Supabase?
        </p>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {data.test_mode ? (
                <FlaskConical className="h-5 w-5 text-brand" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-success" />
              )}
              {data.test_mode ? 'Test mode is on' : 'Xtend is live'}
            </CardTitle>
            <CardDescription>
              {data.test_mode
                ? 'Records can be reset. Everyone uses Xtend as normal; staff are not told it is a test.'
                : `Test mode was turned off ${data.went_live_at ? formatLagos(data.went_live_at) : ''} by ${name(data.went_live_by)}. It cannot be turned back on, and nothing can be reset.`}
            </CardDescription>
          </CardHeader>
          {data.last_reset && data.last_reset_at && (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Last reset {formatLagos(data.last_reset_at)} by {name(data.last_reset_by)}:{' '}
                {data.last_reset.everything
                  ? 'everything'
                  : data.last_reset.categories.map(categoryLabel).join(', ')}
                .
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {left > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Stored files from the last reset</CardTitle>
          </CardHeader>
          <CardContent>
            <FinishFiles left={left} />
          </CardContent>
        </Card>
      )}

      {data?.test_mode && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Reset test records</CardTitle>
              <CardDescription>
                Tick what to clear. Anything another part needs comes along and is shown. You review the list, then type
                RESET and your password. It cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResetPanel />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Go live</CardTitle>
              <CardDescription>
                When the test run is over and reset, turn test mode off. This is permanent: the reset disappears for good
                and Xtend&apos;s records are kept from then on.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoLivePanel />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
