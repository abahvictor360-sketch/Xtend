'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function DashboardRetry() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <div className="space-y-3">
      <Alert variant="destructive">Could not load today. Check your connection and try again.</Alert>
      <Button disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? 'Trying again…' : 'Try again'}
      </Button>
      <p role="status" className="sr-only">{pending ? 'Loading your dashboard' : ''}</p>
    </div>
  )
}
