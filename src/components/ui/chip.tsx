'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The pill from the reference: solid brand when selected, brand tint when
 * not. Used for the home filters and the report category picker.
 */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition-all active:scale-95',
        active
          ? 'bg-brand text-primary-foreground shadow-lift'
          : 'bg-tint text-tint-foreground hover:brightness-95',
        className,
      )}
      {...props}
    />
  )
}

export function ChipLink({
  active,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { active?: boolean }) {
  return (
    <a
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-full px-4 text-xs font-semibold transition-all',
        active ? 'bg-brand text-primary-foreground shadow-lift' : 'bg-tint text-tint-foreground',
        className,
      )}
      {...props}
    />
  )
}
