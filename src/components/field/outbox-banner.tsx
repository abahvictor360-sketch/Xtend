'use client'

import { useCallback, useEffect, useState } from 'react'
import { CloudUpload, WifiOff } from 'lucide-react'
import { listOutbox } from '@/lib/offline/db'
import { flushOutbox } from '@/lib/offline/sync'
import { Button } from '@/components/ui/button'

/** Shows what is still sitting on the phone, and drains it on reconnect. */
export function OutboxBanner({ onFlushed }: { onFlushed?: () => void }) {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // What the person saved themselves: clock-ins and reports. Positions
      // kept while offline go quietly with them and are not counted.
      setPending((await listOutbox()).filter((r) => r.kind !== 'ping').length)
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
    <div
      className={`flex animate-fade-up items-center gap-3 rounded-2xl p-3 ${
        online ? 'bg-tint text-tint-foreground' : 'bg-warning/12 text-foreground'
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
        {online ? (
          <CloudUpload className="h-4 w-4 text-brand" />
        ) : (
          <WifiOff className="h-4 w-4 text-warning" />
        )}
      </span>
      <span className="flex-1 text-xs font-medium leading-snug">
        {pending > 0
          ? `${pending} item${pending > 1 ? 's' : ''} waiting to send.`
          : 'You are offline. Anything you save is kept on this phone.'}
      </span>
      {pending > 0 && online && (
        <Button size="sm" variant="outline" onClick={flush} disabled={busy}>
          {busy ? 'Sending…' : 'Send now'}
        </Button>
      )}
    </div>
  )
}
