import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The brand-header screen from the reference: a coloured block carrying the
 * title and any read-only summary, with a white sheet lifted over its lower
 * edge holding the interactive part.
 */
export function SheetScreen({
  title,
  back,
  header,
  children,
  action,
}: {
  title: string
  back?: string
  header?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="-mx-4 -mt-4 min-h-full">
      <div className="bg-brand px-4 pb-14 pt-4 text-white safe-top">
        <div className="flex items-center gap-3">
          {back && (
            <Link
              href={back}
              aria-label="Back"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/25"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <h1 className="flex-1 text-center text-base font-bold">{title}</h1>
          <div className="flex h-9 w-9 items-center justify-center">{action}</div>
        </div>

        {header && <div className="mt-5 space-y-4">{header}</div>}
      </div>

      <div className="-mt-8 min-h-[40vh] rounded-t-[2rem] bg-background px-4 pb-4 pt-6">
        {children}
      </div>
    </div>
  )
}

/** A read-only label/value pair rendered on the brand header. */
export function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{label}</p>
      <p className="mt-1 text-sm font-medium text-white/95">{value}</p>
    </div>
  )
}

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {action}
    </div>
  )
}
