'use client'

/**
 * Leaflet, fetched from a CDN only when a map is opened, so pages without a
 * map (and the phone app) never pay for it.
 */
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'

/**
 * Google's base map inside the same Leaflet maps (markers, trails and
 * circles stay Leaflet's): the GoogleMutant plugin, pinned, and Google's
 * Maps JavaScript API with the browser key. Each map opened creates one
 * Google map, which Google bills as one map load.
 */
const GOOGLE_MUTANT_JS =
  'https://unpkg.com/leaflet.gridlayer.googlemutant@0.15.0/dist/Leaflet.GoogleMutant.js'
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ''

declare global {
  interface Window {
    L?: any
    google?: any
    gm_authFailure?: () => void
    __xtendGoogleReady?: () => void
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(`${src} failed to load`)))
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.loaded = '1'
      resolve()
    }
    script.onerror = () => reject(new Error(`${src} failed to load`))
    document.head.appendChild(script)
  })
}

export function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.L) return Promise.resolve(window.L)

  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }

  return loadScript(LEAFLET_JS).then(() => {
    if (!window.L) throw new Error('Leaflet failed to load')
    return window.L
  })
}

/** Whether this build has a browser key for Google's map. */
export const hasGoogleMapsKey = () => GOOGLE_KEY.length > 0

// Google calls window.gm_authFailure when the key is refused (wrong site,
// API not enabled, billing off). Every open map listens.
const authFailureListeners = new Set<() => void>()
let authFailed = false

/** Runs `fn` if Google refuses the key; returns how to stop listening. */
export function onGoogleAuthFailure(fn: () => void): () => void {
  if (authFailed) {
    fn()
    return () => undefined
  }
  authFailureListeners.add(fn)
  return () => authFailureListeners.delete(fn)
}

let googlePromise: Promise<void> | null = null

/**
 * Google's Maps JavaScript API and the GoogleMutant plugin, once per page.
 * Rejects when there is no key, the key was refused, or either script
 * fails; the caller adds its own time limit.
 */
export function loadGoogleMutant(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (!GOOGLE_KEY) return Promise.reject(new Error('no Google key'))
  if (authFailed) return Promise.reject(new Error('Google refused the key'))
  if (googlePromise) return googlePromise

  window.gm_authFailure = () => {
    authFailed = true
    for (const fn of authFailureListeners) fn()
    authFailureListeners.clear()
  }

  const api = new Promise<void>((resolve, reject) => {
    if (window.google?.maps?.Map) return resolve()
    window.__xtendGoogleReady = () => {
      // With loading=async the classes arrive through importLibrary.
      const maps = window.google?.maps
      if (maps?.importLibrary) {
        maps.importLibrary('maps').then(() => resolve(), reject)
      } else if (maps?.Map) {
        resolve()
      } else {
        reject(new Error('Google Maps did not start'))
      }
    }
    const src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}` +
      `&v=weekly&loading=async&callback=__xtendGoogleReady`
    loadScript(src).catch(reject)
  })

  googlePromise = Promise.all([api, loadScript(GOOGLE_MUTANT_JS)])
    .then(() => {
      if (!window.L?.gridLayer?.googleMutant) throw new Error('GoogleMutant did not start')
    })
    .catch((error) => {
      // A later map on the same page may try again.
      googlePromise = null
      throw error
    })
  return googlePromise
}
