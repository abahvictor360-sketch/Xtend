import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { XmHeader } from '@/components/admin/xm/widgets'
import { PolicyEditor } from '@/components/admin/xm/policy-editor'
import { PolicyText, ScoringSummary, type XmPolicy } from '@/components/metrics/policy'
import type { XmSettings } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scoring policy — X Metrics' }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })

export default async function PolicyPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role !== 'admin'
  const supabase = await createServerSupabase()

  const [{ data: versions }, { data: settings }, { data: staff }] = await Promise.all([
    supabase
      .from('xm_policy_versions')
      .select('id, title, body, change_note, published_at, profiles:published_by(full_name)')
      .order('published_at', { ascending: false })
      .limit(50),
    supabase.from('xm_settings').select('*').maybeSingle<XmSettings>(),
    supabase.from('profiles').select('id, full_name').in('role', ['merchandiser', 'marketer']).eq('is_active', true).order('full_name'),
  ])
  const all = (versions ?? []) as unknown as (XmPolicy & { profiles: { full_name: string } | { full_name: string }[] | null })[]
  const current = all[0]
  const { data: reads } = current
    ? await supabase.from('xm_policy_reads').select('user_id, read_at').eq('policy_id', current.id)
    : { data: [] }
  const readAt = new Map(((reads ?? []) as { user_id: string; read_at: string }[]).map((r) => [r.user_id, r.read_at]))
  const people = (staff ?? []) as { id: string; full_name: string }[]
  const readCount = people.filter((p) => readAt.has(p.id)).length
  const by = (p: (typeof all)[number]) => (Array.isArray(p.profiles) ? p.profiles[0]?.full_name : p.profiles?.full_name) ?? 'Xtend'

  return (
    <div className="space-y-5">
      <XmHeader
        title="Scoring policy"
        intro="The policy and guidelines staff are scored by. Staff read it in the Metrics tab on their phone, next to their own score, and mark it read. Each publish is kept as a version."
        readOnly={readOnly}
      />
      {!current ? (
        <Alert variant="destructive">The policy could not be read. Has migration 044 been run?</Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardHeader>
              <CardTitle>{readOnly ? current.title : 'Write the next version'}</CardTitle>
              <CardDescription>
                Current version published {when(current.published_at)} by {by(current)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {readOnly ? <PolicyText body={current.body} /> : <PolicyEditor title={current.title} body={current.body} />}
            </CardContent>
          </Card>

          <div className="space-y-5">
            {settings && (
              <Card>
                <CardHeader>
                  <CardTitle>Scoring as set now</CardTitle>
                  <CardDescription>Shown to staff with the policy. Change it in Settings.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScoringSummary settings={settings} />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Who has read it</CardTitle>
                <CardDescription>
                  {readCount} of {people.length} merchandisers and marketers have read the current version.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">
                  {people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-1.5">
                      <span>{p.full_name}</span>
                      {readAt.has(p.id) ? (
                        <Badge variant="success">Read {when(readAt.get(p.id)!)}</Badge>
                      ) : (
                        <Badge variant="outline">Not yet</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Earlier versions</CardTitle>
              </CardHeader>
              <CardContent>
                {all.length < 2 ? (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {all.slice(1).map((v) => (
                      <li key={v.id}>
                        <details className="rounded-xl border border-border p-3 text-sm">
                          <summary className="cursor-pointer">
                            <span className="font-semibold">{v.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {when(v.published_at)} · {by(v)}
                              {v.change_note ? ` · ${v.change_note}` : ''}
                            </span>
                          </summary>
                          <div className="mt-3">
                            <PolicyText body={v.body} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
