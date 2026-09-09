'use client'

import { useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'

const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'

declare global {
  interface Window {
    L?: any
  }
}

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.L) return Promise.resolve(window.L)

  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L))
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = LEAFLET_JS
    script.async = true
    script.onload = () => resolve(window.L)
    script.onerror = () => reject(new Error('Leaflet failed to load'))
    document.head.appendChild(script)
  })
}

/**
 * Pins for every event in the current filter, with each outlet's geofence
 * drawn as a circle. Leaflet is fetched from a CDN only when the map tab is
 * opened, so the mobile bundle never pays for it.
 */
export function AttendanceMap({ rows }: { rows: AttendanceDetail[] }) {
  const container = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let map: any

    loadLeaflet()
      .then((L) => {
        if (!container.current) return
        map = L.map(container.current, { scrollWheelZoom: false })
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(map)

        const bounds: [number, number][] = []
        const drawnOutlets = new Set<string>()

        for (const row of rows) {
          if (row.outlet_id && row.outlet_lat && row.outlet_lng && !drawnOutlets.has(row.outlet_id)) {
            drawnOutlets.add(row.outlet_id)
            L.circle([row.outlet_lat, row.outlet_lng], {
              radius: row.outlet_radius_m ?? 150,
              color: '#4c1d95',
              weight: 1,
              fillOpacity: 0.08,
            })
              .addTo(map)
              .bindPopup(`<strong>${row.outlet_name ?? 'Outlet'}</strong><br/>${row.outlet_radius_m ?? 150} m geofence`)
            bounds.push([row.outlet_lat, row.outlet_lng])
          }

          const colour = row.status === 'on_site' ? '#15803d' : '#b91c1c'
          L.circleMarker([row.lat, row.lng], {
            radius: 6,
            color: colour,
            fillColor: colour,
            fillOpacity: 0.85,
            weight: 1,
          })
            .addTo(map)
            .bindPopup(
              `<strong>${row.staff_name}</strong><br/>${row.type === 'opening' ? 'Clock in' : 'Clock out'} ${formatLagos(row.created_at)}<br/>${metres(row.distance_m)} from outlet · ±${Math.round(row.accuracy_m)} m`,
            )
          bounds.push([row.lat, row.lng])
        }

        if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
        else map.setView([9.082, 8.6753], 6) // Nigeria
        setReady(true)
      })
      .catch(() => setError('The map could not load. Check your connection.'))

    return () => {
      if (map) map.remove()
    }
  }, [rows])

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      {!ready && !error && <Skeleton className="absolute inset-0 z-10" />}
      {error && (
        <p className="p-8 text-center text-sm text-muted-foreground">{error}</p>
      )}
      <div ref={container} className="h-[520px] w-full" />
    </div>
  )
}
