'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { diagnoseAppError } from '@/lib/app-error'
import { reloadFresh, reportAppError } from '@/lib/app-recover'

/**
 * A screen that crashed: what happened in plain words (lib/app-error.ts),
 * what to do, and the buttons to do it. Never the browser's bare
 * "Application error".
 */
export function RouteError({
  error,
  reset,
  homeHref,
  title,
}: {
  error?: (Error & { digest?: string }) | null
  reset: () => void
  homeHref: string
  title?: string
}) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const info = diagnoseAppError(error, online)
  useEffect(() => {
    reportAppError({ kind: info.kind, code: info.code, message: error?.message, digest: error?.digest, where: homeHref })
    // Once per error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  const Icon = info.kind === 'offline' ? WifiOff : AlertTriangle
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <span className="icon-tile h-14 w-14 rounded-full text-destructive">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-lg font-bold">{info.kind === 'unknown' && title ? title : info.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{info.message}</p>
      </div>
      <ol className="w-full space-y-2 text-left">
        {info.steps.map((step, i) => (
          <li key={step} className="flex gap-3 rounded-2xl bg-tint p-3 text-sm text-tint-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-primary-foreground">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex w-full flex-wrap gap-2">
        {info.primary === 'reload_fresh' ? (
          <Button className="flex-1" onClick={() => void reloadFresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Load the new version
          </Button>
        ) : (
          <Button className="flex-1" onClick={reset}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        )}
        <Link href={homeHref} className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}>
          Go back
        </Link>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">Code {info.code}</p>
    </main>
  )
}
