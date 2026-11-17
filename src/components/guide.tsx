import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Building blocks for the two user guides: /guide for field staff and
 * /admin/guide for admins only.
 */

export interface GuideTopic {
  id: string
  title: string
  icon: LucideIcon
}

/**
 * Jump links to each section: chips that wrap (the staff guide), or a card of
 * tiles with an icon each (the admin and supervisor guides).
 */
export function GuideContents({ topics, layout = 'chips' }: { topics: GuideTopic[]; layout?: 'chips' | 'cards' }) {
  if (layout === 'cards') {
    return (
      <nav aria-label="In this guide" className="surface p-4 sm:p-5">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">In this guide</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map((t, i) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="group flex min-h-12 items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-colors hover:border-brand/40 hover:bg-tint"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tint text-brand">
                <t.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 leading-snug">{t.title}</span>
              <span className="text-xs tabular-nums text-muted-foreground group-hover:text-brand">{i + 1}</span>
            </a>
          ))}
        </div>
      </nav>
    )
  }
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

/**
 * A picture of the screen being described. Pictures live in /public/guide
 * and show placeholder names ("Your name", "Your store"), not real people.
 */
export function GuideShot({
  src,
  alt,
  width,
  height,
  caption,
  phone,
}: {
  src: string
  alt: string
  width: number
  height: number
  caption?: string
  /** Narrow phone screenshots sit centred at phone width. */
  phone?: boolean
}) {
  return (
    <figure className={cn('mx-auto', phone ? 'max-w-[320px]' : 'w-full')}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="h-auto w-full rounded-2xl border border-border bg-muted"
      />
      {caption && <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  )
}
