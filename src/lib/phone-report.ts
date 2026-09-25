'use client'

import { listOutbox } from '@/lib/offline/db'

/**
 * The phone quietly telling Xtend about itself: online, battery, anything
 * waiting to upload, its own clock. It is what settles "my network was
 * bad" and "my phone was off" (migration 026). Nothing is shown to staff.
 *
 * Each report that gets through is answered with an id. The latest one is
 * kept and attached to every clock-in, so one saved offline carries proof
 * of the last moment the phone was in touch.
 */

export type ReportReason = 'open' | 'visible' | 'hidden' | 'online' | 'interval'

const ANCHOR_KEY = 'xtend.anchor'
const OFFLINE_KEY = 'xtend.offline_since'

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode or storage blocked: the report still goes, without memory.
  }
}

/** The last report the server acknowledged, for a clock-in's device_info. */
export function lastAnchor(): string | null {
  return read(ANCHOR_KEY)
}

/** Remembers when the network went away, so the report after can say so. */
export function noteOffline() {
  if (!read(OFFLINE_KEY)) write(OFFLINE_KEY, new Date().toISOString())
}

type BatteryManager = { level: number; charging: boolean }

async function battery(): Promise<BatteryManager | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
  if (!nav.getBattery) return null
  try {
    return await nav.getBattery()
  } catch {
    return null
  }
}

/** A position only if location is already allowed: never a prompt from here. */
async function quietFix(): Promise<GeolocationPosition | null> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    if (status?.state !== 'granted') return null
  } catch {
    return null
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 5 * 60_000,
    })
  })
}

async function payload(reason: ReportReason, withFix: boolean) {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }
  const [power, queued, fix] = await Promise.all([
    battery(),
    listOutbox().catch(() => null),
    withFix ? quietFix() : Promise.resolve(null),
  ])
  const oldest = queued?.length
    ? queued.map((r) => r.job.client_captured_at).sort()[0]
    : null
  return {
    reason,
    connection: nav.connection?.effectiveType ?? nav.connection?.type ?? null,
    battery_pct: power ? Math.round(power.level * 100) : null,
    charging: power ? power.charging : null,
    outbox_count: queued ? queued.length : null,
    oldest_queued_at: oldest,
    device_time: new Date().toISOString(),
    offline_since: read(OFFLINE_KEY),
    lat: fix?.coords.latitude ?? null,
    lng: fix?.coords.longitude ?? null,
    accuracy_m: fix?.coords.accuracy ?? null,
  }
}

/** Sends one report. Never throws: this must never get in anybody's way. */
export async function reportPhone(reason: ReportReason) {
  if (typeof navigator === 'undefined') return
  try {
    if (reason === 'hidden') {
      // The page may be gone a moment from now: hand it to the browser.
      const body = JSON.stringify(await payload(reason, false))
      navigator.sendBeacon?.('/api/beacon', new Blob([body], { type: 'application/json' }))
      return
    }
    if (navigator.onLine === false) {
      noteOffline()
      return
    }
    const res = await fetch('/api/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await payload(reason, true)),
    })
    if (!res.ok) return
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    if (data.id) write(ANCHOR_KEY, data.id)
    write(OFFLINE_KEY, null)
  } catch {
    noteOffline()
  }
}
