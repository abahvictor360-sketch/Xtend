import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { NotificationComposer } from '@/components/admin/notification-composer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notifications — Xtend' }

interface SentRow {
  id: string
  title: string
  body: string
  audience: string
  recipients: number
  delivered: number
  failed: number
  created_at: string
}

export default async function NotificationsPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const supabase = await createServerSupabase()

  const [{ data: staff }, { data: outlets }, { data: sent }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role, outlet_id').eq('is_active', true).order('full_name'),
    supabase.from('outlets').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('notifications')
      .select('id, title, body, audience, recipients, delivered, failed, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const history = (sent ?? []) as SentRow[]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Send a push notification to staff phones.{' '}
          {session.profile.role === 'supervisor'
            ? 'As a supervisor you can reach the staff at your own outlet.'
            : 'You can reach everyone, a role, an outlet, or named people.'}
        </p>
      </div>

      <NotificationComposer
        staff={(staff ?? []) as { id: string; full_name: string; role: string; outlet_id: string | null }[]}
        outlets={(outlets ?? []) as { id: string; name: string }[]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Recently sent</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{row.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.body}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatLagos(row.created_at)} · to {row.audience}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge variant="success">{row.delivered} delivered</Badge>
                    {row.failed > 0 && <Badge variant="destructive">{row.failed} failed</Badge>}
                    <Badge variant="outline">{row.recipients} targeted</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
