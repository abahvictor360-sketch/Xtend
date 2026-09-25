import Link from 'next/link'
import { ArrowLeft, CalendarDays, LogIn, LogOut, MapPin } from 'lucide-react'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { DayStrip } from '@/components/field/day-strip'
import { TaskRow } from '@/components/field/task-row'
import { SectionHeader } from '@/components/field/screen'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatLagos, lagosDateString, longDate, metres, monthLabel } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My history — Xtend' }

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>
}) {
  const session = await requireSession(FIELD_ROLES)
  const { d } = await searchParams

  const supabase = await createServerSupabase()
  const { data: serverToday } = await supabase.rpc('business_date')
  const today = (serverToday as string) ?? lagosDateString()
  const selected = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today

  const { data } = await supabase
    .from('attendance_detail')
    .select('*')
    .eq('user_id', session.userId)
    .order('attendance_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(90)

  const rows = (data ?? []) as AttendanceDetail[]
  const marks = new Set(rows.map((row) => row.attendance_date))
  const forDay = rows.filter((row) => row.attendance_date === selected)

  const thisMonth = rows.filter((row) => row.attendance_date.slice(0, 7) === selected.slice(0, 7))
  const openings = thisMonth.filter((row) => row.type === 'opening')
  const onSite = openings.filter((row) => row.status === 'on_site').length

  return (
    <div className="space-y-5">
      <header className="safe-top flex items-center justify-between">
        <Link
          href="/field"
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card shadow-soft"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold text-muted-foreground">My attendance</span>
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tint text-brand">
          <CalendarDays className="h-5 w-5" />
        </span>
      </header>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold tracking-tight">{monthLabel(selected)}</h1>
        {selected !== today && (
          <Link href="/field/history" className={buttonVariants({ size: 'pill', variant: 'secondary' })}>
            Today
          </Link>
        )}
      </div>

      <DayStrip today={today} selected={selected} basePath="/field/history" marks={marks} />

      <section className="space-y-3">
        <SectionHeader
          title={selected === today ? 'Today' : longDate(selected)}
          action={
            <span className="text-xs font-semibold text-muted-foreground">
              {forDay.length} event{forDay.length === 1 ? '' : 's'}
            </span>
          }
        />

        {forDay.length === 0 ? (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              Nothing recorded on this day.
            </CardContent>
          </Card>
        ) : (
          forDay.map((event) => (
            <TaskRow
              key={event.id}
              icon={
                event.type === 'opening' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />
              }
              title={event.type === 'opening' ? 'Clock in' : 'Clock out'}
              meta={
                <>
                  {formatLagos(event.created_at, false)} · {metres(event.distance_m)} from outlet · ±
                  {Math.round(event.accuracy_m)} m
                  <span className="mt-0.5 flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {event.location_label}
                  </span>
                </>
              }
              trailing={
                <Badge variant={event.status === 'on_site' ? 'success' : 'destructive'}>
                  {event.status === 'on_site' ? 'On site' : event.status === 'off_site' ? 'Off site' : 'Not confirmed'}
                </Badge>
              }
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader title="This month" />
        <div className="grid grid-cols-3 gap-3">
          <div className="stat">
            <p className="stat-label">Days</p>
            <p className="stat-value">{openings.length}</p>
          </div>
          <div className="stat">
            <p className="stat-label">On site</p>
            <p className="stat-value text-success">{onSite}</p>
          </div>
          <div className="stat">
            <p className="stat-label">Not on site</p>
            <p className="stat-value text-destructive">{openings.length - onSite}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
