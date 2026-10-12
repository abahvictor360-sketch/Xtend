import { Skeleton } from '@/components/ui/skeleton'

export default function FieldLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <p className="sr-only">Loading your dashboard…</p>
      <div aria-hidden="true" className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <Skeleton aria-hidden="true" className="h-16 rounded-full" />
      <div aria-hidden="true" className="flex gap-2">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
      </div>
      <Skeleton aria-hidden="true" className="h-20 rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-44 rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-32 rounded-2xl" />
    </div>
  )
}
