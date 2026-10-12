'use client'

import { RouteError } from '@/components/route-error'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} homeHref="/field" title="Your dashboard could not load" />
}
