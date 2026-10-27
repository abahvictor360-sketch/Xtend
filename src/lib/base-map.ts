/**
 * Which base map the office maps show: Google when the browser key is set
 * and Google is working, OpenStreetMap otherwise. Pure, so the rule can be
 * checked without a browser (scripts/check-places-usage.ts); the maps apply
 * it in src/components/admin/map-base.tsx and re-ask it whenever something
 * changes (Google loads or fails, OpenStreetMap tiles fail or load).
 */

/** off: no browser key. failed: did not load in time, refused the key, or drew no tiles. */
export type GoogleStatus = 'off' | 'loading' | 'ready' | 'failed'
export type BaseChoice = 'google' | 'osm' | 'wait'
export type GoogleType = 'roadmap' | 'hybrid'

/** How long Google may take to load before the map gives up on it. */
export const GOOGLE_LOAD_TIMEOUT_MS = 6000
/** How long Google may take to draw its first tile once added. */
export const GOOGLE_TILE_TIMEOUT_MS = 8000
/** How long to wait for Google before showing OpenStreetMap meanwhile. */
export const GOOGLE_GRACE_MS = 1500
/** OpenStreetMap tiles failing in a row before it counts as unreachable. */
export const OSM_ERROR_LIMIT = 4

export interface BaseMapState {
  /** NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is set. */
  hasKey: boolean
  google: GoogleStatus
  /** OpenStreetMap tile errors since its last tile loaded. */
  osmErrors: number
  /** Time since the map opened. */
  waitedMs: number
}

export function osmUnreachable(s: Pick<BaseMapState, 'osmErrors'>) {
  return s.osmErrors >= OSM_ERROR_LIMIT
}

/**
 * Google first when it works (it names Nigerian shops and streets far
 * better); OpenStreetMap when there is no key or Google failed. While
 * Google is still loading, OpenStreetMap is shown after a short grace so
 * the map is never left blank, unless OpenStreetMap is itself failing, in
 * which case Google is still worth waiting for.
 */
export function chooseBaseMap(s: BaseMapState): BaseChoice {
  if (s.hasKey && s.google === 'ready') return 'google'
  if (s.hasKey && s.google === 'loading') {
    if (s.waitedMs < GOOGLE_GRACE_MS) return 'wait'
    if (osmUnreachable(s)) return 'wait'
  }
  return 'osm'
}

/** The small note on the map, and whether Map / Satellite is offered. */
export function baseMapLabel(choice: BaseChoice) {
  if (choice === 'google') return { note: 'Map: Google', satelliteSwitch: true }
  if (choice === 'osm') return { note: 'Map: OpenStreetMap', satelliteSwitch: false }
  return { note: null, satelliteSwitch: false }
}
