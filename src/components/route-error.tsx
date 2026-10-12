'use client'

import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function RouteError({
  reset,
  homeHref,
  title = 'This page could not load',
}: {
  reset: () => void
  homeHref: string
  title?: string
}) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="icon-tile h-14 w-14 rounded-full text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your connection and try again. Your saved offline work is safe.
        </p>
      </div>
      <div className="flex w-full gap-2">
        <Button className="flex-1" onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
        <Link href={homeHref} className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}>
          Go back
        </Link>
      </div>
    </main>
  )
}
