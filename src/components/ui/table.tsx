import * as React from 'react'
import { cn } from '@/lib/utils'

// Each part keeps its own padding and alignment and adds the caller's
// classes on top: the caller's className is merged, never a replacement
// (props spread first, className last).

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export const TableHeader = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead {...p} className={cn('[&_tr]:border-b', className)} />
)
export const TableBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody {...p} className={cn('[&_tr:last-child]:border-0', className)} />
)
export const TableRow = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr {...p} className={cn('border-b border-border transition-colors hover:bg-muted/40', className)} />
)
export const TableHead = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    {...p}
    className={cn(
      'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
      className,
    )}
  />
)
export const TableCell = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...p} className={cn('px-3 py-2.5 align-middle', className)} />
)
