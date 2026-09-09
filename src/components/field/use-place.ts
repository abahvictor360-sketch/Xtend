'use client'

import { useEffect, useState } from 'react'
import type { Fix } from '@/lib/geo'

export interface Place {
  address: string | null
  place: string | null
}

/**
 * Names where the user is standing, so the app can say "you are at Ikeja
 * City Mall" rather than only "6.60185, 3.35155". Re-runs only when the fix
 * moves enough to matter, because the geocoder is a shared public service.
 */
export function usePlace(fix: Fix | null) {
  const [place, setPlace] = useState<Place | null>(null)
  const [loading, setLoading] = useState(false)

  // Round to ~11 m so tiny GPS jitter does not trigger a new lookup.
  const key = fix ? `${fix.lat.toFixed(4)},${fix.lng.toFixed(4)}` : null

  useEffect(() => {
    if (!key) {
      setPlace(null)
      return
    }

    let cancelled = false
    const [lat, lng] = key.split(',')

    setLoading(true)
    fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Place | null) => {
        if (!cancelled) setPlace(data ?? null)
      })
      .catch(() => {
        if (!cancelled) setPlace(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [key])

  return { place, loading }
}
