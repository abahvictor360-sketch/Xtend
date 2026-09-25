'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { loadLeaflet } from '@/lib/leaflet'
import { formatLagos, metres } from '@/lib/utils'
import { GAP_MINUTES, KIND_LABEL, ROUGH_M, storeAt, type Trail } from '@/lib/movement'
import type { LiveLocation } from '@/components/admin/live-locations'

// The brand's orange family, as on the Overview charts: inside a store,
// outside every store. A gap in the trail is a dashed grey line.
const INSIDE = '#d1511a'
const OUTSIDE = '#8a3a12'
const STALE = '#9a8f88'
const GAP = '#9a8f88'

const escape = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function pin(L: any, text: string, colour: string) {
  return L.divIcon({
    className: '',
    html: `<span style="display:flex;align-items:center;justify-content:center;min-width:34px;height:22px;padding:0 6px;border-radius:11px;background:${colour};color:#fff;font:700 11px system-ui;box-shadow:0 0 0 2px #fff,0 4px 10px rgb(0 0 0/.25)">${text}</span>`,
    iconSize: [34, 22],
    iconAnchor: [17, 11],
  })
}

function baseMap(L: any, el: HTMLElement) {
  const map = L.map(el, { scrollWheelZoom: false })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map)
  return map
}

function useMap(draw: (L: any, map: any) => [number, number][], deps: unknown[]) {
  const container = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let map: any
    loadLeaflet()
      .then((L) => {
        if (!container.current) return
        map = baseMap(L, container.current)
        const bounds = draw(L, map)
        if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 })
        else map.setView([9.082, 8.6753], 6) // Nigeria
        setReady(true)
      })
      .catch(() => setError('The map could not load. Check your connection.'))
    return () => {
      if (map) map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { container, error, ready }
}

function Frame({
  map,
  height = 'h-[460px] lg:h-[560px]',
}: {
  map: ReturnType<typeof useMap>
  height?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-muted">
      {!map.ready && !map.error && <Skeleton className="absolute inset-0 z-10" />}
      {map.error && <p className="p-8 text-center text-sm text-muted-foreground">{map.error}</p>}
      <div ref={map.container} className={`${height} w-full`} />
    </div>
  )
}

/** Everyone on shift, where the app last placed them. */
export function LiveMap({ rows }: { rows: LiveLocation[] }) {
  const map = useMap(
    (L, m) => {
      const bounds: [number, number][] = []
      const stores = new Set<string>()
      for (const r of rows) {
        if (
          r.outlet_lat != null &&
          r.outlet_lng != null &&
          !stores.has(`${r.outlet_lat},${r.outlet_lng}`)
        ) {
          stores.add(`${r.outlet_lat},${r.outlet_lng}`)
          L.circle([r.outlet_lat, r.outlet_lng], {
            radius: r.outlet_radius_m ?? 150,
            color: INSIDE,
            weight: 1,
            fillOpacity: 0.06,
          })
            .addTo(m)
            .bindTooltip(escape(r.outlet_name ?? 'Store'))
        }
        if (r.last_lat == null || r.last_lng == null) continue
        const stale = (r.minutes_since_ping ?? 999) > 15
        const colour = stale ? STALE : r.inside_geofence === false ? OUTSIDE : INSIDE
        const initials = r.full_name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase())
          .join('')
        L.marker([r.last_lat, r.last_lng], { icon: pin(L, initials, colour) })
          .addTo(m)
          .bindPopup(
            `<strong>${escape(r.full_name)}</strong><br/>` +
              `${escape(r.last_place_name ?? 'Last position')} · ${formatLagos(r.last_ping_at, false)}` +
              (r.minutes_since_ping != null ? ` (${r.minutes_since_ping} min ago)` : '') +
              `<br/>${r.distance_from_outlet_m != null ? `${metres(r.distance_from_outlet_m)} from ${escape(r.outlet_name ?? 'their store')}` : ''}` +
              `<br/><a href="/admin/tracking?person=${r.user_id}">Follow ${escape(r.full_name.split(' ')[0])}'s day →</a>`,
          )
        bounds.push([r.last_lat, r.last_lng])
      }
      return bounds
    },
    [rows],
  )
  return <Frame map={map} />
}

/** One person's day as a route: where they went, in order, and the gaps. */
export function TrailMap({ trail }: { trail: Trail }) {
  const map = useMap(
    (L, m) => {
      const bounds: [number, number][] = []
      for (const s of trail.stores) {
        L.circle([s.lat, s.lng], {
          radius: s.radius_m,
          color: INSIDE,
          weight: 1.5,
          fillOpacity: 0.08,
        })
          .addTo(m)
          .bindTooltip(`${escape(s.name)} · ${s.radius_m} m`)
        bounds.push([s.lat, s.lng])
      }

      const points = trail.points
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        const gap = (new Date(b.at).getTime() - new Date(a.at).getTime()) / 60000 >= GAP_MINUTES
        L.polyline(
          [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          gap
            ? { color: GAP, weight: 2, dashArray: '6 6', opacity: 0.9 }
            : { color: storeAt(a, trail.stores) ? INSIDE : OUTSIDE, weight: 3, opacity: 0.85 },
        ).addTo(m)
      }

      points.forEach((p, i) => {
        const inside = storeAt(p, trail.stores)
        const colour = inside ? INSIDE : OUTSIDE
        const rough = (p.accuracy_m ?? 0) > ROUGH_M
        const popup =
          `<strong>${KIND_LABEL[p.kind]}</strong> · ${formatLagos(p.at, false)}<br/>` +
          `${escape(p.place ?? (inside ? inside.name : 'Outside every store'))}` +
          (p.accuracy_m != null
            ? `<br/>±${Math.round(p.accuracy_m)} m${rough ? ' (rough reading)' : ''}`
            : '')
        if (p.kind === 'clock_in' || p.kind === 'clock_out') {
          L.marker([p.lat, p.lng], {
            icon: pin(
              L,
              p.kind === 'clock_in' ? 'IN' : 'OUT',
              p.kind === 'clock_in' ? INSIDE : OUTSIDE,
            ),
            zIndexOffset: 1000,
          })
            .addTo(m)
            .bindPopup(popup)
        } else {
          // Saved offline: a ring, so it reads as "sent later" at a glance.
          const offline = p.kind === 'location_offline'
          L.circleMarker([p.lat, p.lng], {
            radius: i === points.length - 1 ? 7 : 5,
            color: offline ? (rough ? STALE : colour) : '#fff',
            weight: offline ? 2.5 : 2,
            fillColor: offline ? '#fff' : rough ? STALE : colour,
            fillOpacity: 1,
          })
            .addTo(m)
            .bindPopup(popup)
        }
        bounds.push([p.lat, p.lng])
      })
      return bounds
    },
    [trail],
  )
  return <Frame map={map} />
}

/** Refreshes the page's data on a timer, for today's live view. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])
  return null
}
