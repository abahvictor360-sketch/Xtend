'use client'

import { useCallback, useEffect, useState } from 'react'
import { CloudUpload, WifiOff } from 'lucide-react'
import { countOutbox } from '@/lib/offline/db'
import { flushOutbox } from '@/lib/offline/sync'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/** Shows what is still sitting on the phone, and drains it on reconnect. */
export function OutboxBanner({ onFlushed }: { onFlushed?: () => void }) {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setPending(await countOutbox())
    } catch {
      // IndexedDB unavailable (private mode). Nothing queued, nothing to show.
    }
  }, [])

  const flush = useCallback(async () => {
    setBusy(true)
    try {
      const result = await flushOutbox()
      if (result.sent > 0) onFlushed?.()
    } finally {
      setBusy(false)
      void refresh()
    }
  }, [onFlushed, refresh])

  useEffect(() => {
    setOnline(navigator.onLine)
    void refresh()

    const goOnline = () => {
      setOnline(true)
      void flush()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    if (navigator.onLine) void flush()

    const timer = setInterval(refresh, 15000)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      clearInterval(timer)
    }
  }, [flush, refresh])

  if (!pending && online) return null

  return (
    <Alert variant={online ? 'info' : 'warning'} className="flex items-center gap-2">
      {online ? <CloudUpload className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0" />}
      <span className="flex-1 text-sm">
        {pending > 0
          ? `${pending} item${pending > 1 ? 's' : ''} waiting to send.`
          : 'You are offline. Anything you save is kept on this phone.'}
      </span>
      {pending > 0 && online && (
        <Button size="sm" variant="outline" onClick={flush} disabled={busy}>
          {busy ? 'Sending…' : 'Send now'}
        </Button>
      )}
    </Alert>
  )
}
