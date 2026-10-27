'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { MapFrame, useLeafletMap } from '@/components/admin/map-base'
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

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/**
 * A round photo pin with a ring in the status colour, and the first name
 * under it. Without a photo (or if its link has expired) the circle shows
 * their initials instead.
 */
function photoPin(L: any, url: string | null | undefined, name: string, colour: string) {
  const letters = escape(initialsOf(name))
  const circle = `width:40px;height:40px;border-radius:9999px;border:3px solid ${colour};box-shadow:0 0 0 2px #fff,0 6px 14px rgb(0 0 0/.3)`
  const fallback = `<span style="${circle};display:flex;align-items:center;justify-content:center;background:${colour};color:#fff;font:700 13px system-ui">${letters}</span>`
  const face = url
    ? `<img src="${escape(url)}" alt="" style="${circle};object-fit:cover;background:#eee" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${escape(fallback)}"/>`
    : fallback
  return L.divIcon({
    className: '',
    html:
      `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">` +
      face +
      `<span style="padding:1px 6px;border-radius:8px;background:#fff;color:#2b211c;font:700 10px system-ui;box-shadow:0 2px 6px rgb(0 0 0/.2);white-space:nowrap">${escape(name.split(/\s+/)[0])}</span>` +
      `</span>`,
    iconSize: [60, 60],
    iconAnchor: [30, 22],
    popupAnchor: [0, -20],
  })
}

/**
 * The map is made once (useLeafletMap); each refresh only redraws what is
 * on it, so the zoom stays where the viewer left it. The view is fitted to
 * what is drawn the first time, and again only when `fitKey` changes (a
 * different person or day). A null `fitKey` keeps the whole of Nigeria.
 */
function useDrawnMap(
  draw: (L: any, layer: any) => [number, number][],
  deps: unknown[],
  fitKey: string | null,
) {
  const map = useLeafletMap({ nigeria: true })
  const layer = useRef<any>(null)
  const fitted = useRef<string | null>(null)
  const { L, map: m } = map

  useEffect(() => {
    if (!L || !m) return
    if (!layer.current) layer.current = L.layerGroup().addTo(m)
    layer.current.clearLayers()
    const bounds = draw(L, layer.current)
    if (fitKey != null && fitted.current !== fitKey && bounds.length) {
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 })
      fitted.current = fitKey
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, m, fitKey, ...deps])

  return map
}

/**
 * Everyone on shift, where the app last placed them, as their profile photo.
 * Clicking a photo opens that person's movement for the day.
 */
export function LiveMap({ rows, date }: { rows: LiveLocation[]; date: string }) {
  const router = useRouter()
  const map = useDrawnMap(
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
        const href = `/admin/tracking?person=${encodeURIComponent(r.user_id)}&date=${encodeURIComponent(date)}`
        L.marker([r.last_lat, r.last_lng], {
          icon: photoPin(L, r.avatar_url, r.full_name, colour),
          title: `${r.full_name}: see their movement`,
          riseOnHover: true,
          keyboard: true,
        })
          .addTo(m)
          .bindTooltip(
            `<strong>${escape(r.full_name)}</strong><br/>` +
              `${escape(r.last_place_name ?? 'Last position')} · ${formatLagos(r.last_ping_at, false)}` +
              (r.minutes_since_ping != null ? ` (${r.minutes_since_ping} min ago)` : '') +
              (r.distance_from_outlet_m != null
                ? `<br/>${metres(r.distance_from_outlet_m)} from ${escape(r.outlet_name ?? 'their store')}`
                : '') +
              `<br/><em>Click to see their movement</em>`,
            { direction: 'top', offset: [0, -24] },
          )
          .on('click', () => router.push(href))
        bounds.push([r.last_lat, r.last_lng])
      }
      return bounds
    },
    [rows, date],
    null,
  )
  return <MapFrame map={map} />
}

/** One person's day as a route: where they went, in order, and the gaps. */
export function TrailMap({
  trail,
  name,
  photo,
}: {
  trail: Trail
  /** Shown as their photo on the latest point. */
  name?: string
  photo?: string | null
}) {
  // Fitted again only for another person or another stretch of days.
  const fitKey = `${trail.person?.id ?? name ?? ''}|${trail.date}|${trail.points[0]?.at ?? ''}`
  const map = useDrawnMap(
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
      const last = points[points.length - 1]
      if (last && name) {
        L.marker([last.lat, last.lng], {
          icon: photoPin(L, photo, name, storeAt(last, trail.stores) ? INSIDE : OUTSIDE),
          zIndexOffset: 2000,
        })
          .addTo(m)
          .bindTooltip(`<strong>${escape(name)}</strong><br/>Latest: ${formatLagos(last.at, false)}`, {
            direction: 'top',
            offset: [0, -24],
          })
      }
      return bounds
    },
    [trail, name, photo],
    fitKey,
  )
  return <MapFrame map={map} />
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
