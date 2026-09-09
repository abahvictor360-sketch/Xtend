import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('rounded-2xl border p-4 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-foreground',
      info: 'border-brand/20 bg-tint text-tint-foreground',
      success: 'border-success/25 bg-success/10 text-foreground',
      warning: 'border-warning/30 bg-warning/12 text-foreground',
      destructive: 'border-destructive/25 bg-destructive/10 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="status" className={cn(alertVariants({ variant }), className)} {...props} />
}
