'use client'

import { useEffect } from 'react'

const REFRESH_MS = 15 * 60_000

/**
 * Keeps the xt_loc cookie up to date with where this admin is, so the
 * audit log can record where each action was done. Silent: when the
 * browser refuses, the server falls back to the IP address.
 */
export function AdminLocation() {
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    let cancelled = false
    const read = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return
          const { latitude, longitude, accuracy } = pos.coords
          const value = [latitude.toFixed(6), longitude.toFixed(6), Math.round(accuracy), Date.now()].join(',')
          document.cookie = `xt_loc=${value}; path=/; SameSite=Lax; max-age=7200${location.protocol === 'https:' ? '; Secure' : ''}`
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5 * 60_000 },
      )
    read()
    const timer = window.setInterval(read, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return null
}
