'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GeoBlocked, requireFix, type Fix, type GeoBlockReason } from '@/lib/geo'

export type GateStatus = 'checking' | 'ready' | 'blocked'

interface GateState {
  status: GateStatus
  fix: Fix | null
  reason: GeoBlockReason | null
  message: string | null
}

/**
 * The location gate. A user who cannot produce a live, accurate fix never
 * reaches the clock-in screen, and every block is reported to the server so
 * the admin sees it.
 */
export function useLocationGate() {
  const [state, setState] = useState<GateState>({
    status: 'checking',
    fix: null,
    reason: null,
    message: null,
  })
  const reported = useRef<string | null>(null)

  const report = useCallback(async (reason: GeoBlockReason, accuracy?: number) => {
    // One report per reason per mount. The server also throttles.
    if (reported.current === reason) return
    reported.current = reason
    try {
      await fetch('/api/location-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, accuracy_m: accuracy ?? null }),
      })
    } catch {
      // Offline. The block still stands; we simply cannot log it yet.
    }
  }, [])

  const check = useCallback(async () => {
    setState((s) => ({ ...s, status: 'checking' }))
    try {
      const fix = await requireFix()
      reported.current = null
      setState({ status: 'ready', fix, reason: null, message: null })
      return fix
    } catch (error) {
      const blocked =
        error instanceof GeoBlocked
          ? error
          : new GeoBlocked('position_unavailable', 'Location is unavailable right now.')
      void report(blocked.reason, blocked.accuracy_m)
      setState({
        status: 'blocked',
        fix: null,
        reason: blocked.reason,
        message: blocked.message,
      })
      return null
    }
  }, [report])

  useEffect(() => {
    void check()
  }, [check])

  return { ...state, retry: check }
}
