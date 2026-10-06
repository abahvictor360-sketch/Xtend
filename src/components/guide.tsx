import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Building blocks for the two user guides: /guide for field staff and
 * /admin/guide for admins and supervisors.
 */

export interface GuideTopic {
  id: string
  title: string
  icon: LucideIcon
}

/** Jump links to each section, as chips that wrap. */
export function GuideContents({ topics }: { topics: GuideTopic[] }) {
  return (
    <nav aria-label="In this guide" className="flex flex-wrap gap-2">
      {topics.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-brand/40 hover:bg-tint"
        >
          <t.icon className="h-3.5 w-3.5 text-brand" />
          {t.title}
        </a>
      ))}
    </nav>
  )
}

export function GuideSection({
  topic,
  intro,
  children,
  className,
}: {
  topic: GuideTopic
  intro?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={topic.id} className={cn('surface scroll-mt-24 p-5 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <span className="icon-tile">
          <topic.icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-lg font-bold leading-tight">{topic.title}</h2>
          {intro && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{intro}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-4 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

/** Numbered steps. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums">
            {i + 1}
          </span>
          <span className="pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  )
}

/** A short highlighted note. */
export function Tip({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">{children}</p>
}

/** Questions that open to show their answer. */
export function Questions({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <details key={item.q} className="group py-3 first:pt-0 last:pb-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
            {item.q}
            <span
              aria-hidden
              className="text-lg leading-none text-brand transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="mt-2 text-muted-foreground">{item.a}</div>
        </details>
      ))}
    </div>
  )
}

/** A term in bold, as it appears on screen. */
export function Ui({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>
}
