'use client'

import { useEffect, useRef, useState } from 'react'
import { Signal, Wifi, WifiOff } from 'lucide-react'
import { currentNetwork, type NetworkQuality } from '@/lib/field-guide'

/**
 * Tells staff straight away when their network is off or weak, and what
 * that means for clocking in, store check-ins and finding their location,
 * then says when it is back. Reads the browser's own connection signals
 * (lib/field-guide.ts networkQuality), checked on every change and every
 * 10 seconds.
 */
export function NetworkNotice() {
  const [net, setNet] = useState<NetworkQuality>('ok')
  const [back, setBack] = useState(false)
  const last = useRef<NetworkQuality>('ok')

  useEffect(() => {
    let backTimer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      const now = currentNetwork()
      if (now === 'ok' && last.current === 'offline') {
        setBack(true)
        clearTimeout(backTimer)
        backTimer = setTimeout(() => setBack(false), 5000)
      }
      if (now !== 'ok') setBack(false)
      last.current = now
      setNet(now)
    }
    read()
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    connection?.addEventListener?.('change', read)
    const timer = setInterval(read, 10_000)
    return () => {
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
      connection?.removeEventListener?.('change', read)
      clearInterval(timer)
      clearTimeout(backTimer)
    }
  }, [])

  if (net === 'ok' && !back) return null

  if (back) {
    return (
      <div role="status" className="flex animate-fade-up items-center gap-3 rounded-2xl bg-success/12 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
          <Wifi className="h-4 w-4 text-success" />
        </span>
        <span className="flex-1 text-xs font-medium leading-snug">Your network is back. Anything waiting is sending now.</span>
      </div>
    )
  }

  const offline = net === 'offline'
  return (
    <div role="alert" className="flex animate-fade-up items-start gap-3 rounded-2xl bg-warning/12 p-3 text-foreground">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70">
        {offline ? <WifiOff className="h-4 w-4 text-warning" /> : <Signal className="h-4 w-4 text-warning" />}
      </span>
      <span className="flex-1 space-y-1 text-xs leading-snug">
        <span className="block text-sm font-semibold">{offline ? 'No network' : 'Your network is weak'}</span>
        <span className="block">
          {offline
            ? 'Your clock-in or clock-out is kept on this phone and only counts once it sends. Store check-ins and check-outs need network. Your location may also be slow to find.'
            : 'Clocking in, store check-ins and finding your location may be slow or fail.'}
        </span>
        <span className="block font-medium">
          Turn on Mobile data, check you have data, and move near the door or a window, or step outside.
        </span>
      </span>
    </div>
  )
}
