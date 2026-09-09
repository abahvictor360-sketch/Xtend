'use client'

import { useEffect } from 'react'

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration costs offline shell caching, nothing more.
    })
  }, [])
  return null
}
