import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The dashboard's page parts, in the Attendance page's look, shared by every
 * page: a header with chips and actions, figure cards with a coloured icon
 * and a thin bar, section headings and panels. Presentation only.
 */

export type Tone = 'brand' | 'good' | 'warn' | 'bad' | 'muted'

export const TONE: Record<Tone, { tile: string; bar: string; value: string }> = {
  brand: { tile: 'bg-tint text-brand', bar: 'bg-brand', value: '' },
  good: { tile: 'bg-success/10 text-success', bar: 'bg-success', value: '' },
  warn: { tile: 'bg-warning/15 text-warning', bar: 'bg-warning', value: 'text-warning' },
  bad: { tile: 'bg-destructive/10 text-destructive', bar: 'bg-destructive', value: 'text-destructive' },
  muted: { tile: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground', value: '' },
}

/** A rounded square with an icon in a tone's colours. */
export function IconTile({ icon: Icon, tone = 'brand', className }: { icon: LucideIcon; tone?: Tone; className?: string }) {
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONE[tone].tile, className)}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  )
}

/** The top of a page: an eyebrow, the title, a line under it, chips and actions on the right. */
export function PageHeader({
  title,
  note,
  eyebrow,
  chips,
  actions,
}: {
  title: React.ReactNode
  note?: React.ReactNode
  eyebrow?: string
  chips?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {note && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      </div>
      {(chips || actions) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips}
          {actions}
        </div>
      )}
    </header>
  )
}

/** A small rounded label for the header: the date range, how many people. */
export function Chip({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold">
      {Icon && <Icon className="h-4 w-4 text-brand" />}
      {children}
    </span>
  )
}

/** A figure card: label, icon, big number, an optional bar (0–100) and a note. A link when `href` is given. */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'brand',
  bar,
  href,
}: {
  icon: LucideIcon
  label: string
  value: string
  note?: string
  tone?: Tone
  bar?: number | null
  href?: string
}) {
  const t = TONE[tone]
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className={cn('text-3xl font-extrabold leading-none tabular-nums', t.value)}>{value}</p>
      {bar != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn('h-full rounded-full', t.bar)} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      {(note || href) && (
        <p className="flex items-center justify-between gap-2 text-xs leading-snug text-muted-foreground">
          <span>{note}</span>
          {href && <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-brand" />}
        </p>
      )}
    </>
  )
  const cls = 'surface flex min-w-0 flex-col gap-3 p-4 sm:p-5'
  return href ? (
    <Link href={href} className={cn(cls, 'group border border-transparent transition-colors hover:border-brand/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Two figure cards a row on a phone, four on a wide screen. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>
}

/** A section heading with an icon, a line under it and room on the right. */
export function SectionTitle({
  icon: Icon,
  title,
  note,
  children,
  id,
  tone = 'brand',
}: {
  icon: LucideIcon
  title: string
  note?: React.ReactNode
  children?: React.ReactNode
  id?: string
  tone?: Tone
}) {
  return (
    <div id={id} className="flex scroll-mt-4 flex-wrap items-end justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile icon={Icon} tone={tone} />
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/** A white card section with a heading. */
export function Panel({
  icon,
  title,
  note,
  aside,
  id,
  tone,
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  note?: React.ReactNode
  aside?: React.ReactNode
  id?: string
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('surface min-w-0 space-y-4 p-4 sm:p-5', className)}>
      <SectionTitle id={id} icon={icon} title={title} note={note} tone={tone}>
        {aside}
      </SectionTitle>
      {children}
    </section>
  )
}

/** Nothing to show, said kindly. */
export function EmptyState({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
      {Icon && <Icon className="h-6 w-6 text-muted-foreground/70" />}
      {children}
    </div>
  )
}

/** Tabs as links (so they can be bookmarked), in the app's chip style. */
export function TabLinks({ tabs }: { tabs: { href: string; label: React.ReactNode; active: boolean }[] }) {
  return (
    <nav className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-muted p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors',
            t.active ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
