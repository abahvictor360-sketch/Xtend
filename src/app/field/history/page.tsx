import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My history — Xtend' }

export default async function HistoryPage() {
  const session = await requireSession(['merchandiser', 'admin'])
  const supabase = await createServerSupabase()

  const { data } = await supabase
    .from('attendance_detail')
    .select('*')
    .eq('user_id', session.userId)
    .order('attendance_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60)

  const rows = (data ?? []) as AttendanceDetail[]
  const byDate = new Map<string, AttendanceDetail[]>()
  for (const row of rows) {
    byDate.set(row.attendance_date, [...(byDate.get(row.attendance_date) ?? []), row])
  }

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">My history</h1>
      <p className="text-sm text-muted-foreground">
        The last 60 events. Attendance records cannot be edited or deleted, by you or by an admin.
      </p>

      {Array.from(byDate.entries()).map(([date, events]) => (
        <Card key={date}>
          <CardContent className="space-y-2 p-4 pt-4">
            <p className="text-sm font-medium">{date}</p>
            {events.map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {event.type === 'opening' ? 'Clock in' : 'Clock out'} ·{' '}
                    <span className="tabular-nums">{formatLagos(event.created_at, false)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.address ?? `${event.lat.toFixed(5)}, ${event.lng.toFixed(5)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metres(event.distance_m)} from outlet · fix ±{Math.round(event.accuracy_m)} m
                  </p>
                </div>
                <Badge variant={event.status === 'on_site' ? 'success' : 'destructive'}>
                  {event.status === 'on_site' ? 'On site' : event.status === 'off_site' ? 'Off site' : 'Flagged'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
