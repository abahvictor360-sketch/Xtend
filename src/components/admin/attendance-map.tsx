'use client'

import { useEffect, useRef } from 'react'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'
import { MapFrame, useLeafletMap } from '@/components/admin/map-base'

/**
 * Pins for every event in the current filter, with each outlet's geofence
 * drawn as a circle. Leaflet is fetched from a CDN only when the map tab is
 * opened, so the mobile bundle never pays for it. The map itself is made
 * once (Google's or OpenStreetMap's, see map-base.tsx); a new filter only
 * redraws the pins and fits the view to them.
 */
export function AttendanceMap({ rows }: { rows: AttendanceDetail[] }) {
  const map = useLeafletMap()
  const layer = useRef<any>(null)
  const { L, map: m } = map

  useEffect(() => {
    if (!L || !m) return
    if (!layer.current) layer.current = L.layerGroup().addTo(m)
    const group = layer.current
    group.clearLayers()

    const bounds: [number, number][] = []
    const drawnOutlets = new Set<string>()

    for (const row of rows) {
      if (row.outlet_id && row.outlet_lat && row.outlet_lng && !drawnOutlets.has(row.outlet_id)) {
        drawnOutlets.add(row.outlet_id)
        L.circle([row.outlet_lat, row.outlet_lng], {
          radius: row.outlet_radius_m ?? 150,
          color: '#c1572a',
          weight: 1,
          fillOpacity: 0.08,
        })
          .addTo(group)
          .bindPopup(`<strong>${row.outlet_name ?? 'Outlet'}</strong><br/>${row.outlet_radius_m ?? 150} m geofence`)
        bounds.push([row.outlet_lat, row.outlet_lng])
      }

      const colour = row.status === 'on_site' ? '#15803d' : '#c2410c'
      L.circleMarker([row.lat, row.lng], {
        radius: 6,
        color: colour,
        fillColor: colour,
        fillOpacity: 0.85,
        weight: 1,
      })
        .addTo(group)
        .bindPopup(
          `<strong>${row.staff_name}</strong><br/>${row.type === 'opening' ? 'Clock in' : 'Clock out'} ${formatLagos(row.created_at)}<br/>${metres(row.distance_m)} from outlet · ±${Math.round(row.accuracy_m)} m`,
        )
      bounds.push([row.lat, row.lng])
    }

    if (bounds.length) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
    else m.setView([9.082, 8.6753], 6) // Nigeria
  }, [L, m, rows])

  return <MapFrame map={map} height="h-[520px]" className="rounded-lg" />
}
