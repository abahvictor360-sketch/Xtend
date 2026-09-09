import { cn } from '@/lib/utils'

/**
 * The list row from the reference: tinted icon tile, title, meta line, and
 * whatever status marker belongs on the right.
 */
export function TaskRow({
  icon,
  title,
  meta,
  trailing,
  muted,
  className,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  muted?: boolean
  className?: string
}) {
  return (
    <div className={cn('surface flex items-center gap-3 p-3', className)}>
      <span className={cn('icon-tile', muted && 'bg-muted text-muted-foreground')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-bold', muted && 'text-muted-foreground')}>{title}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}
