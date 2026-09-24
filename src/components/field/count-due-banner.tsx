import Link from 'next/link'
import { ChevronRight, ClipboardList } from 'lucide-react'
import type { CountStatus } from '@/lib/store-count-status'
import { longDate } from '@/lib/utils'

/** A reminder on the home screen while a store count is due. */
export function CountDueBanner({ status }: { status: Extract<CountStatus, { open: true }> }) {
  return (
    <Link
      href="/field/count"
      className="brand-surface mb-4 flex items-center gap-3 p-4 shadow-lift transition-transform active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
        <ClipboardList className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">
          {status.reason === 'request' ? 'Store count requested' : 'Month-end store count'}
        </span>
        <span className="block text-xs text-white/85">
          {status.reason === 'request' ? `By ${status.requested_by} · ` : ''}
          due {longDate(status.due_date)}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0" />
    </Link>
  )
}
