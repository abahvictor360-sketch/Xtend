import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('rounded-md border p-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-muted/50 text-foreground',
      info: 'border-primary/30 bg-primary/5 text-foreground',
      success: 'border-success/30 bg-success/10 text-foreground',
      warning: 'border-warning/40 bg-warning/10 text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
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
