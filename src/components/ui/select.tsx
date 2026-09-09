import * as React from 'react'
import { cn } from '@/lib/utils'

/** Native select. A JS combobox is dead weight on a 3G feature-grade phone. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-12 w-full appearance-none rounded-2xl border border-input bg-card bg-[length:1rem] bg-[right_0.9rem_center] bg-no-repeat px-4 pr-9 text-base focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50',
      className,
    )}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23997b6b' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    }}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'
