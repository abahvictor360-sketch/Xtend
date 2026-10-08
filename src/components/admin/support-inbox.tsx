import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  minutesWaiting,
  statusLabel,
  waitText,
  waitTone,
  type InboxThread,
  type SupportSender,
} from '@/lib/support-inbox'
import type { Assignee, PanelMessage } from '@/components/admin/support-threads'
import { cn, formatLagos, lagosDateString } from '@/lib/utils'

/*
 * The support inbox's pieces that need no browser: the figures, a thread in
 * the list and the person beside the conversation. Server-rendered.
 */

export const ROLE: Record<string, string> = {
  merchandiser: 'Merchandiser',
  marketer: 'Marketer',
  supervisor: 'Supervisor',
  admin: 'Admin',
}

export const SENDER: Record<SupportSender, string> = {
  staff: '',
  ai: 'Helper: ',
  admin: 'Office: ',
  supervisor: 'Office: ',
}

export function Figure({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

export function ThreadRow({
  t,
  me,
  now,
  today,
  active,
  href,
}: {
  t: InboxThread
  me: string
  now: Date
  today: string
  active: boolean
  href: string
}) {
  const status = statusLabel(t)
  const waited = minutesWaiting(t, now)
  const tone = waited === null ? null : waitTone(waited)
  const initials = t.staff_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  const sameDay = lagosDateString(new Date(t.last_message_at)) === today
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        'block rounded-2xl border bg-card p-3 transition-colors hover:border-brand/50',
        active ? 'border-brand ring-1 ring-brand/30' : 'border-border',
        tone === 'late' && !active && 'border-l-4 border-l-destructive',
        tone === 'warn' && !active && 'border-l-4 border-l-[#e8833a]',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-tint-foreground">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">{t.staff_name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatLagos(t.last_message_at, !sameDay)}
            </span>
          </div>
          <p className="truncate text-sm">{t.subject}</p>
          {t.last_body && (
            <p className="truncate text-xs text-muted-foreground">
              {t.last_sender ? SENDER[t.last_sender] : ''}
              {t.last_body}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            {waited !== null && (
              <Badge variant={tone === 'ok' ? 'outline' : tone === 'warn' ? 'warning' : 'destructive'}>{waitText(waited)}</Badge>
            )}
            {t.assigned_to && t.status !== 'resolved' && (
              <Badge variant="outline">{t.assigned_to === me ? 'With you' : `With ${t.assigned_name ?? 'someone'}`}</Badge>
            )}
            {t.outlet_name && <Badge variant="outline">{t.outlet_name}</Badge>}
          </div>
        </div>
      </div>
    </Link>
  )
}

export interface PanelInfo {
  messages: PanelMessage[]
  assignees: Assignee[]
  devices: number | null
  phone: string | null
  supervisorName: string | null
  storeName: string | null
  active: boolean
  attendance: { type: 'opening' | 'closing'; status: string | null; created_at: string }[]
  otherThreads: number
}

const ON_SITE: Record<string, string> = { on_site: 'at their store', off_site: 'away from their store', flagged: 'location unclear' }

export function PersonContext({ thread, info, today }: { thread: InboxThread; info: PanelInfo; today: string }) {
  const opening = info.attendance.find((a) => a.type === 'opening')
  const closing = info.attendance.find((a) => a.type === 'closing')
  const day = closing
    ? `Clocked out at ${formatLagos(closing.created_at, false)}`
    : opening
      ? `Clocked in at ${formatLagos(opening.created_at, false)}${opening.status ? `, ${ON_SITE[opening.status] ?? opening.status}` : ''}`
      : 'Not clocked in today'
  const dayTone = closing ? 'outline' : opening ? (opening.status === 'on_site' ? 'success' : 'warning') : 'warning'
  const linkCls = 'rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint'
  return (
    <div className="space-y-2 rounded-2xl bg-muted p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{ROLE[thread.staff_role] ?? thread.staff_role}</span>
        {!info.active && <Badge variant="destructive">Account off</Badge>}
        <Badge variant={dayTone}>{day}</Badge>
        {info.devices !== null && (
          <Badge variant={info.devices > 0 ? 'outline' : 'warning'}>
            {info.devices > 0 ? 'Notifications on' : 'Notifications off'}
          </Badge>
        )}
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <Fact k="Store" v={info.storeName ?? 'None set'} />
        <Fact k="Supervisor" v={info.supervisorName ?? 'None set'} />
        <Fact
          k="Phone"
          v={
            info.phone ? (
              <a href={`tel:${info.phone}`} className="font-semibold text-brand hover:underline">
                {info.phone}
              </a>
            ) : (
              'Not on file'
            )
          }
        />
        <Fact k="Other issues raised" v={String(info.otherThreads)} />
      </dl>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Link href={`/admin/tracking?person=${thread.user_id}&date=${today}`} className={linkCls}>
          Movement today
        </Link>
        <Link href={`/admin/excuses?person=${thread.user_id}`} className={linkCls}>
          Check an excuse
        </Link>
        {info.otherThreads > 0 && (
          <Link href={`/admin/support?view=all&person=${thread.user_id}`} className={linkCls}>
            All their issues
          </Link>
        )}
      </div>
    </div>
  )
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0 text-muted-foreground">{k}:</dt>
      <dd className="min-w-0 truncate font-medium">{v}</dd>
    </div>
  )
}
