'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { hasGoogleMapsKey, loadGoogleMutant, loadLeaflet, onGoogleAuthFailure } from '@/lib/leaflet'
import {
  GOOGLE_GRACE_MS,
  GOOGLE_LOAD_TIMEOUT_MS,
  GOOGLE_TILE_TIMEOUT_MS,
  baseMapLabel,
  chooseBaseMap,
  type BaseChoice,
  type GoogleStatus,
  type GoogleType,
} from '@/lib/base-map'
import { cn } from '@/lib/utils'

// Nigeria, south-west and north-east corners. The Movement maps open on the
// whole country and cannot be panned or zoomed out beyond it.
export const NIGERIA: [[number, number], [number, number]] = [
  [4.0, 2.6],
  [13.95, 14.7],
]
const NIGERIA_EDGE: [[number, number], [number, number]] = [
  [3.0, 1.6],
  [14.9, 15.7],
]

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const MAX_ZOOM = 19

/** Never let the map zoom out past the whole of Nigeria. */
function holdToNigeria(map: any) {
  const fit = () => map.setMinZoom(map.getBoundsZoom(NIGERIA, false))
  fit()
  map.on('resize', fit)
}

export interface LeafletMap {
  container: React.MutableRefObject<HTMLDivElement | null>
  error: string | null
  ready: boolean
  /** Leaflet and the map, once loaded. The map is made once per page view. */
  L: any
  map: any
  base: BaseChoice
  googleType: GoogleType
  setGoogleType: (t: GoogleType) => void
}

/**
 * One Leaflet map for the life of the component: data changes redraw what
 * is on it, never the map itself, so a refresh keeps the zoom and Google
 * bills one map load per page view.
 *
 * The base map is Google's when the browser key is set and Google answers,
 * and OpenStreetMap otherwise, switching by itself (src/lib/base-map.ts):
 * Google that does not load in time, refuses the key or draws no tiles
 * gives way to OpenStreetMap, without reloading the page.
 */
export function useLeafletMap({ nigeria = false }: { nigeria?: boolean } = {}): LeafletMap {
  const container = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ L: any; map: any } | null>(null)
  const [base, setBase] = useState<BaseChoice>('wait')
  const [googleType, setType] = useState<GoogleType>('roadmap')
  const googleLayer = useRef<any>(null)

  useEffect(() => {
    let disposed = false
    let map: any
    const timers: ReturnType<typeof setTimeout>[] = []
    let stopAuth: () => void = () => undefined

    loadLeaflet()
      .then((L) => {
        if (disposed || !container.current) return
        map = L.map(container.current, {
          scrollWheelZoom: false,
          ...(nigeria ? { maxBounds: NIGERIA_EDGE, maxBoundsViscosity: 1, worldCopyJump: false } : {}),
        })
        if (nigeria) {
          map.fitBounds(NIGERIA)
          holdToNigeria(map)
        } else {
          map.setView([9.082, 8.6753], 6) // Nigeria
        }
        const tileOptions = nigeria ? { noWrap: true, bounds: NIGERIA_EDGE } : {}

        // --- The base map.
        const started = Date.now()
        const hasKey = hasGoogleMapsKey()
        const state: { google: GoogleStatus; osmErrors: number } = {
          google: hasKey ? 'loading' : 'off',
          osmErrors: 0,
        }
        let osm: any = null
        let current: BaseChoice = 'wait'
        let tileWatch: ReturnType<typeof setTimeout> | null = null

        const decide = () => {
          if (disposed) return
          const choice = chooseBaseMap({ hasKey, ...state, waitedMs: Date.now() - started })
          if (choice === current) return
          if (current === 'google' && googleLayer.current) map.removeLayer(googleLayer.current)
          if (current === 'osm' && osm) map.removeLayer(osm)
          if (choice === 'osm') {
            if (!osm) {
              osm = L.tileLayer(OSM_TILES, {
                maxZoom: MAX_ZOOM,
                attribution: '© OpenStreetMap contributors',
                ...tileOptions,
              })
              osm.on('tileerror', () => {
                state.osmErrors += 1
                decide()
              })
              osm.on('tileload', () => {
                state.osmErrors = 0
              })
            }
            osm.addTo(map)
          } else if (choice === 'google' && googleLayer.current) {
            googleLayer.current.addTo(map)
            // Google that draws nothing (a key that only fails on tiles,
            // a blocked tile server) is treated as not working.
            if (tileWatch) clearTimeout(tileWatch)
            tileWatch = setTimeout(googleFailed, GOOGLE_TILE_TIMEOUT_MS)
            timers.push(tileWatch)
          }
          current = choice
          setBase(choice)
        }

        function googleFailed() {
          if (state.google === 'failed') return
          state.google = 'failed'
          decide()
        }

        if (hasKey) {
          timers.push(
            setTimeout(() => {
              if (state.google === 'loading') googleFailed()
            }, GOOGLE_LOAD_TIMEOUT_MS),
          )
          timers.push(setTimeout(decide, GOOGLE_GRACE_MS))
          stopAuth = onGoogleAuthFailure(googleFailed)
          loadGoogleMutant()
            .then(() => {
              if (disposed || state.google !== 'loading') return
              const layer = L.gridLayer.googleMutant({ type: 'roadmap', maxZoom: MAX_ZOOM, ...tileOptions })
              layer.on('tileload', () => {
                if (tileWatch) clearTimeout(tileWatch)
                tileWatch = null
              })
              googleLayer.current = layer
              state.google = 'ready'
              decide()
            })
            .catch(googleFailed)
        }
        decide()

        setLoaded({ L, map })
      })
      .catch(() => setError('The map could not load. Check your connection.'))

    return () => {
      disposed = true
      timers.forEach(clearTimeout)
      stopAuth()
      googleLayer.current = null
      if (map) map.remove()
    }
    // The map is made once; `nigeria` never changes for a given map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Map or Satellite, on the same Google map (no second map load). */
  const setGoogleType = useCallback((t: GoogleType) => {
    setType(t)
    const layer = googleLayer.current
    if (!layer) return
    layer.options.type = t
    layer.whenReady(() => {
      layer._mutant?.setMapTypeId(t)
      layer._lru?.clear?.()
      layer.redraw()
    })
  }, [])

  return {
    container,
    error,
    ready: loaded !== null,
    L: loaded?.L ?? null,
    map: loaded?.map ?? null,
    base,
    googleType,
    setGoogleType,
  }
}

/** The map, its loading state, which map is in use and Map / Satellite. */
export function MapFrame({
  map,
  height = 'h-[460px] lg:h-[560px]',
  className = 'rounded-3xl bg-muted',
}: {
  map: LeafletMap
  height?: string
  className?: string
}) {
  const label = baseMapLabel(map.base)
  return (
    <div className={cn('relative overflow-hidden border border-border', className)}>
      {!map.ready && !map.error && <Skeleton className="absolute inset-0 z-10" />}
      {map.error && <p className="p-8 text-center text-sm text-muted-foreground">{map.error}</p>}
      <div ref={map.container} className={`${height} w-full`} />
      {map.ready && label.note && (
        <div className="pointer-events-none absolute right-2 top-2 z-[1000] flex flex-col items-end gap-1.5">
          {label.satelliteSwitch && (
            <div
              role="group"
              aria-label="Map style"
              className="pointer-events-auto flex overflow-hidden rounded-full border border-border bg-white text-xs font-semibold shadow"
            >
              {(['roadmap', 'hybrid'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={map.googleType === t}
                  onClick={() => map.setGoogleType(t)}
                  className={cn(
                    'min-h-8 px-3 py-1.5',
                    map.googleType === t ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                  )}
                >
                  {t === 'roadmap' ? 'Map' : 'Satellite'}
                </button>
              ))}
            </div>
          )}
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
            {label.note}
          </span>
        </div>
      )}
    </div>
  )
}
