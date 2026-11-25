'use client'

import { useEffect, useRef } from 'react'
import { MapFrame, useLeafletMap } from '@/components/admin/map-base'

export interface Spot {
  lat: number
  lng: number
}

/**
 * Tap the map to say where the person is (0112): the store and where their
 * phone last reported are drawn; the pin can be dragged. Opens on the
 * store, or on the phone's last spot.
 */
export function SpotPicker({
  store,
  phone,
  value,
  onPick,
}: {
  store: (Spot & { name: string; radius_m?: number | null }) | null
  phone: (Spot & { label: string }) | null
  value: Spot | null
  onPick: (spot: Spot) => void
}) {
  const map = useLeafletMap()
  const { L, map: m } = map
  const layer = useRef<any>(null)
  const pin = useRef<any>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const centred = useRef(false)

  // The store, the phone's last spot, and tapping to pick.
  useEffect(() => {
    if (!L || !m) return
    if (!layer.current) layer.current = L.layerGroup().addTo(m)
    const group = layer.current
    group.clearLayers()
    const bounds: [number, number][] = []
    if (store) {
      L.circle([store.lat, store.lng], { radius: store.radius_m ?? 150, color: '#c1572a', weight: 1, fillOpacity: 0.1 })
        .addTo(group)
        .bindTooltip(store.name)
      bounds.push([store.lat, store.lng])
    }
    if (phone) {
      L.circleMarker([phone.lat, phone.lng], { radius: 7, color: '#1d4ed8', weight: 2, fillOpacity: 0.6 })
        .addTo(group)
        .bindTooltip(phone.label)
      bounds.push([phone.lat, phone.lng])
    }
    if (!centred.current) {
      centred.current = true
      if (bounds.length > 1) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 })
      else if (bounds.length === 1) m.setView(bounds[0], 17)
      else m.setView([6.5244, 3.3792], 12) // Lagos
    }
    const onClick = (e: any) => pick.current({ lat: e.latlng.lat, lng: e.latlng.lng })
    m.on('click', onClick)
    return () => {
      m.off('click', onClick)
    }
  }, [L, m, store, phone])

  // The chosen spot: a pin that can be dragged.
  useEffect(() => {
    if (!L || !m) return
    if (!value) {
      if (pin.current) {
        pin.current.remove()
        pin.current = null
      }
      return
    }
    if (!pin.current) {
      pin.current = L.marker([value.lat, value.lng], { draggable: true, title: 'Where they are' }).addTo(m)
      pin.current.on('dragend', () => {
        const p = pin.current.getLatLng()
        pick.current({ lat: p.lat, lng: p.lng })
      })
    } else {
      pin.current.setLatLng([value.lat, value.lng])
    }
  }, [L, m, value])

  return <MapFrame map={map} height="h-[280px]" className="rounded-2xl bg-muted" />
}
