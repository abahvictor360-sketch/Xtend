import Link from 'next/link'
import { ResendButton } from '@/components/admin/notification-tools'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { deliveryGroups, notReached, percent, type Delivery, type LogRow } from '@/lib/notification-log'
import { cn } from '@/lib/utils'

/*
 * The notification page's pieces that need no browser: the figures, how far
 * one notification reached, and who got it. Server-rendered.
 */

export function Figure({
  label,
  value,
  note,
  warn,
  className,
}: {
  label: string
  value: string
  note?: string
  warn?: boolean
  className?: string
}) {
  return (
    <div className={cn('surface p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-extrabold tabular-nums', warn && 'text-destructive')}>{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

export function Reach({ row }: { row: LogRow }) {
  const rate = percent(row.delivered, row.recipients)
  return (
    <div className="w-full space-y-1 sm:w-48">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span>
          <strong className="tabular-nums">{row.delivered}</strong> of {row.recipients} got it
        </span>
        <span className="tabular-nums text-muted-foreground">{rate === null ? '' : `${rate}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f6e4d8]">
        <div className="h-full rounded-full bg-[#d1511a]" style={{ width: `${rate ?? 0}%` }} />
      </div>
      <div className="flex flex-wrap gap-1">
        {row.read_count > 0 && <Badge variant="success">{row.read_count} read</Badge>}
        {row.failed > 0 && <Badge variant="destructive">{row.failed} failed</Badge>}
        {row.no_device > 0 && <Badge variant="warning">{row.no_device} off</Badge>}
      </div>
    </div>
  )
}

export function Detail({
  row,
  deliveries,
  nameOf,
  canResend,
  reuseHref,
}: {
  row: LogRow
  deliveries: Delivery[]
  nameOf: (id: string) => string
  canResend: boolean
  reuseHref: string
}) {
  const g = deliveryGroups(deliveries)
  const missed = notReached(deliveries)
  const groups = [
    { label: 'Read it in the app', items: g.read, tone: 'text-success' },
    { label: 'Got it, not opened yet', items: g.unread, tone: '' },
    { label: 'Failed to deliver', items: g.failed, tone: 'text-destructive' },
    { label: 'Notifications off', items: g.off, tone: 'text-warning' },
  ]
  return (
    <div className="space-y-3 border-t border-border p-3 text-sm">
      <p className="whitespace-pre-wrap break-words">{row.body}</p>
      {deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No delivery record is visible to you for this one.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups
            .filter((x) => x.items.length > 0)
            .map((x) => (
              <div key={x.label}>
                <p className={cn('text-xs font-semibold', x.tone)}>
                  {x.label} ({x.items.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  {x.items
                    .map((d) => nameOf(d.user_id))
                    .sort((a, b) => a.localeCompare(b))
                    .join(', ')}
                </p>
              </div>
            ))}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {canResend && missed.length > 0 && (
          <ResendButton notificationId={row.id} title={row.title} body={row.body} url={row.url} userIds={missed} />
        )}
        {row.kind === 'message' && (
          <Link href={reuseHref} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            Use again
          </Link>
        )}
      </div>
    </div>
  )
}
