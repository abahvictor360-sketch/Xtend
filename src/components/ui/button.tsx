import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-brand text-primary-foreground shadow-lift hover:bg-brand-deep',
        deep: 'bg-brand-deep text-primary-foreground hover:bg-brand',
        destructive: 'bg-destructive text-destructive-foreground hover:brightness-95',
        outline: 'border border-input bg-card text-foreground hover:bg-tint hover:text-tint-foreground',
        secondary: 'bg-tint text-tint-foreground hover:brightness-95',
        ghost: 'text-muted-foreground hover:bg-tint hover:text-tint-foreground',
        onBrand: 'bg-white/15 text-white backdrop-blur hover:bg-white/25',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 rounded-2xl px-4 text-sm',
        sm: 'h-9 rounded-xl px-3 text-xs',
        lg: 'h-12 rounded-2xl px-6 text-sm',
        xl: 'h-14 rounded-2xl px-6 text-base',
        pill: 'h-9 rounded-full px-4 text-xs',
        icon: 'h-10 w-10 rounded-2xl',
        iconSm: 'h-9 w-9 rounded-xl',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
