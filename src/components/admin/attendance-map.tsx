'use client'

import { useEffect, useRef } from 'react'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'
import { MapFrame, useLeafletMap } from '@/components/admin/map-base'

/** Text safe inside the pin's HTML (names come from people, not code). */
function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** "Ada Okafor" → "AO", for someone with no photo yet. */
export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

/**
 * A pin that is the person: their profile photo (or initials) in a ring,
 * green on site and orange otherwise, with their name underneath.
 */
export function personPinHtml(name: string, photo: string | null | undefined, onSite: boolean, kind: 'in' | 'out') {
  const ring = onSite ? '#15803d' : '#c2410c'
  const face = photo
    ? `<img src="${esc(photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px" />`
    : `<span style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;border-radius:9999px;background:#fdebd8;color:#9a3412;font:700 12px/1 system-ui,sans-serif">${esc(initialsOf(name))}</span>`
  return `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
    <div style="position:relative;width:36px;height:36px;border-radius:9999px;border:3px solid ${ring};background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${face}
      <span title="${kind === 'in' ? 'Clock in' : 'Clock out'}" style="position:absolute;right:-12px;bottom:-5px;padding:0 4px;border-radius:9999px;background:${ring};color:#fff;font:700 9px/14px system-ui,sans-serif;border:1px solid #fff">${kind === 'in' ? 'IN' : 'OUT'}</span>
    </div>
    <span style="margin-top:2px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:9999px;background:rgba(255,255,255,.92);color:#1c1917;font:600 11px/1.3 system-ui,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.25)">${esc(name)}</span>
  </div>`
}

/**
 * Pins for every event in the current filter, with each outlet's geofence
 * drawn as a circle. Leaflet is fetched from a CDN only when the map tab is
 * opened, so the mobile bundle never pays for it. The map itself is made
 * once (Google's or OpenStreetMap's, see map-base.tsx); a new filter only
 * redraws the pins and fits the view to them.
 */
export function AttendanceMap({
  rows,
  people = {},
}: {
  rows: AttendanceDetail[]
  /** Each person's name and profile photo, for their pins. */
  people?: Record<string, { name: string; photo?: string | null }>
}) {
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
          .bindPopup(`<strong>${esc(row.outlet_name ?? 'Outlet')}</strong><br/>${row.outlet_radius_m ?? 150} m geofence`)
        bounds.push([row.outlet_lat, row.outlet_lng])
      }

      // The person themselves: their photo, ring by on site or not, name under it.
      const who = people[row.user_id]
      const name = who?.name ?? row.staff_name
      const icon = L.divIcon({
        className: 'xt-person-pin',
        html: personPinHtml(name, who?.photo, row.status === 'on_site', row.type === 'opening' ? 'in' : 'out'),
        iconSize: [120, 60],
        iconAnchor: [60, 22],
        popupAnchor: [0, -22],
      })
      L.marker([row.lat, row.lng], { icon, title: name, riseOnHover: true })
        .addTo(group)
        .bindPopup(
          `<strong>${esc(name)}</strong><br/>${row.type === 'opening' ? 'Clock in' : 'Clock out'} ${formatLagos(row.created_at)}<br/>${metres(row.distance_m)} from outlet · ±${Math.round(row.accuracy_m)} m`,
        )
      bounds.push([row.lat, row.lng])
    }

    if (bounds.length) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
    else m.setView([9.082, 8.6753], 6) // Nigeria
  }, [L, m, rows, people])

  return <MapFrame map={map} height="h-[520px]" className="rounded-lg" />
}
