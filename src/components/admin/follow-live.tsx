'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Crosshair, Phone, Square } from 'lucide-react'
import { MapFrame, useLeafletMap } from '@/components/admin/map-base'
import { Button, buttonVariants } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import {
  FAST_INTERVAL_MS,
  FOLLOW_HEARTBEAT_MS,
  distanceM,
  endedText,
  followTiming,
  glideMs,
  glideProgress,
  headingFor,
  interpolate,
  isMoving,
  speedKmh,
  timeLeft,
  trimTrail,
  updatedAgo,
  type FollowEnd,
  type LivePoint,
} from '@/lib/follow-live'
import { cn, formatLagos, metres } from '@/lib/utils'

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_REALTIME_DISABLED === '1'
const BRAND = '#d1511a'
const DEEP = '#9b3517'

export interface FollowPerson {
  id: string
  name: string
  phone: string | null
  photo: string | null
}

export interface FollowStore {
  name: string
  lat: number
  lng: number
  radius_m: number
}

/** What the server says about the session (follow_state, migration 0070). */
interface SessionState {
  id: string
  active: boolean
  expires_at: string
  end_reason: FollowEnd | null
  interval_ms: number
  clocked_out_at: string | null
  live: { lat: number; lng: number; accuracy_m: number | null; heading: number | null; speed_mps: number | null; at: string } | null
  last_ping: { lat: number; lng: number; accuracy_m: number | null; at: string; place_name: string | null } | null
  last_place: string | null
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** Their photo in an orange ring, with an arrow round it showing the way they are going. */
function riderIcon(L: any, photo: string | null, name: string) {
  const circle = `width:46px;height:46px;border-radius:9999px;border:3px solid ${BRAND};box-shadow:0 0 0 2px #fff,0 6px 16px rgb(0 0 0/.35)`
  const fallback = `<span style="${circle};display:flex;align-items:center;justify-content:center;background:${BRAND};color:#fff;font:700 14px system-ui">${escape(initialsOf(name))}</span>`
  const face = photo
    ? `<img src="${escape(photo)}" alt="" style="${circle};object-fit:cover;background:#eee;display:block" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${escape(fallback)}"/>`
    : fallback
  return L.divIcon({
    className: '',
    html:
      `<span style="position:relative;display:block;width:70px;height:70px">` +
      `<span data-arrow style="position:absolute;inset:0;display:none;transition:transform .6s linear">` +
      `<span style="position:absolute;left:50%;top:-1px;margin-left:-9px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:14px solid ${DEEP};filter:drop-shadow(0 1px 1px rgb(0 0 0/.3))"></span>` +
      `</span>` +
      `<span style="position:absolute;left:12px;top:12px">${face}</span>` +
      `</span>`,
    iconSize: [70, 70],
    iconAnchor: [35, 35],
  })
}

const toPoint = (p: { lat: number; lng: number; accuracy_m?: number | null; heading?: number | null; speed_mps?: number | null; at: string }): LivePoint => ({
  lat: p.lat,
  lng: p.lng,
  at: Date.parse(p.at),
  accuracy_m: p.accuracy_m ?? null,
  heading: p.heading ?? null,
  speed_mps: p.speed_mps ?? null,
})

/**
 * Follow live: one person who is clocked in, moving on the map a few
 * seconds behind, like a delivery app's rider. Positions come over
 * Realtime (`follow:<session>`); without it, the page asks every 8 s.
 */
export function FollowLive({
  person,
  store,
  initial,
}: {
  person: FollowPerson
  store: FollowStore | null
  /** Their last stored position, to show something at once. */
  initial: { lat: number; lng: number; at: string; accuracy_m: number | null; place: string | null } | null
}) {
  const map = useLeafletMap({ nigeria: true })
  const [session, setSession] = useState<SessionState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [startKey, setStartKey] = useState(0)
  const [realtime, setRealtime] = useState<'connecting' | 'live' | 'off'>(REALTIME_DISABLED ? 'off' : 'connecting')
  const [follow, setFollow] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [latest, setLatest] = useState<LivePoint | null>(initial ? toPoint({ ...initial }) : null)
  const [kmh, setKmh] = useState<number | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [place, setPlace] = useState<string | null>(initial?.place ?? null)
  const [stored, setStored] = useState(true)

  const trail = useRef<LivePoint[]>(initial ? [toPoint(initial)] : [])
  const glide = useRef<{ from: { lat: number; lng: number } | null; to: LivePoint | null; started: number; ms: number }>({
    from: null,
    to: null,
    started: 0,
    ms: 0,
  })
  const followRef = useRef(follow)
  followRef.current = follow
  const layers = useRef<{ marker: any; accuracy: any; line: any } | null>(null)
  const frame = useRef<number | null>(null)
  const sessionId = session?.id ?? null

  // ---- Positions in.
  const addPoint = useCallback((p: LivePoint, fromStore = false) => {
    const prev = trail.current[trail.current.length - 1] ?? null
    if (prev && p.at <= prev.at) return
    const speed = speedKmh(prev, p)
    trail.current = trimTrail([...trail.current, p], Date.now())
    const drawn = glide.current.to ? currentPosition() : prev
    glide.current = {
      from: drawn ? { lat: drawn.lat, lng: drawn.lng } : null,
      to: p,
      started: performance.now(),
      ms: glideMs(drawn, p, prev ? Math.min(p.at - prev.at, FAST_INTERVAL_MS * 1.5) : FAST_INTERVAL_MS),
    }
    setLatest(p)
    setKmh(speed)
    setHeading(headingFor(prev, p, speed))
    setStored(fromStore)
    startAnimation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentPosition = () => {
    const g = glide.current
    if (!g.to) return null
    if (!g.from) return { lat: g.to.lat, lng: g.to.lng }
    return interpolate(g.from, g.to, glideProgress(g.started, g.ms, performance.now()))
  }

  // ---- The map: drawn once, then moved.
  const { L, map: m } = map
  useEffect(() => {
    if (!L || !m || layers.current) return
    if (store) {
      L.circle([store.lat, store.lng], { radius: store.radius_m, color: BRAND, weight: 1.5, fillOpacity: 0.08 })
        .addTo(m)
        .bindTooltip(`${escape(store.name)} · ${store.radius_m} m`)
    }
    const line = L.polyline([], { color: BRAND, weight: 4, opacity: 0.55, lineJoin: 'round' }).addTo(m)
    const accuracy = L.circle([0, 0], { radius: 1, color: BRAND, weight: 1, opacity: 0.4, fillOpacity: 0.1, interactive: false })
    const marker = L.marker([0, 0], { icon: riderIcon(L, person.photo, person.name), zIndexOffset: 2000, keyboard: false })
    layers.current = { marker, accuracy, line }
    m.on('dragstart', () => setFollow(false))
    const first = trail.current[trail.current.length - 1]
    if (first) {
      glide.current = { from: null, to: first, started: performance.now(), ms: 0 }
      m.setView([first.lat, first.lng], 17)
      startAnimation()
    } else if (store) {
      m.setView([store.lat, store.lng], 16)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, m])

  const draw = useCallback(() => {
    frame.current = null
    const l = layers.current
    const pos = currentPosition()
    if (!l || !pos || !m) return
    if (!m.hasLayer(l.marker)) {
      l.accuracy.addTo(m)
      l.marker.addTo(m)
    }
    l.marker.setLatLng([pos.lat, pos.lng])
    l.accuracy.setLatLng([pos.lat, pos.lng])
    l.accuracy.setRadius(Math.max(glide.current.to?.accuracy_m ?? 0, 3))
    l.line.setLatLngs([...trail.current.slice(0, -1).map((p) => [p.lat, p.lng]), [pos.lat, pos.lng]])
    if (followRef.current) m.setView([pos.lat, pos.lng], m.getZoom(), { animate: false })
    const g = glide.current
    if (g.ms > 0 && performance.now() - g.started < g.ms) frame.current = requestAnimationFrame(draw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m])

  const startAnimation = () => {
    if (frame.current == null && typeof window !== 'undefined') frame.current = requestAnimationFrame(() => drawRef.current())
  }
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current)
  }, [])

  // The arrow follows the heading (or hides when standing still).
  useEffect(() => {
    const el: HTMLElement | null = layers.current?.marker?.getElement?.()?.querySelector('[data-arrow]') ?? null
    if (!el) return
    el.style.display = heading == null ? 'none' : 'block'
    if (heading != null) el.style.transform = `rotate(${Math.round(heading)}deg)`
  }, [heading, latest])

  // Back to "Follow on map": centre at once.
  useEffect(() => {
    if (follow) startAnimation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow])

  // ---- The session.
  const apply = useCallback(
    (s: SessionState) => {
      setSession(s)
      if (s.last_place) setPlace(s.last_place)
      else if (s.last_ping?.place_name) setPlace(s.last_ping.place_name)
      const live = s.live ? toPoint(s.live) : null
      const ping = s.last_ping ? toPoint(s.last_ping) : null
      const newest = live && (!ping || live.at >= ping.at) ? live : ping
      if (newest) addPoint(newest, newest === ping)
    },
    [addPoint],
  )

  const act = useCallback(
    async (action: 'heartbeat' | 'extend' | 'stop') => {
      if (!sessionId) return
      if (action !== 'heartbeat') setBusy(true)
      try {
        const res = await fetch(`/api/admin/follow/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const got = (await res.json().catch(() => ({}))) as { session?: SessionState; error?: string }
        if (!res.ok || !got.session) {
          if (action !== 'heartbeat') setProblem(got.error ?? 'That did not work. Try again.')
          return
        }
        setProblem(null)
        apply(got.session)
      } catch {
        if (action !== 'heartbeat') setProblem('No connection. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [sessionId, apply],
  )

  // Start (and "Start again").
  useEffect(() => {
    let cancelled = false
    setProblem(null)
    void (async () => {
      try {
        const res = await fetch('/api/admin/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: person.id }),
        })
        const got = (await res.json().catch(() => ({}))) as { session?: SessionState; error?: string }
        if (cancelled) return
        if (!res.ok || !got.session) setProblem(got.error ?? 'Following could not start. Try again.')
        else apply(got.session)
      } catch {
        if (!cancelled) setProblem('No connection. Following could not start.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [person.id, startKey, apply])

  const timing = session
    ? followTiming(
        {
          active: session.active,
          end_reason: session.end_reason,
          expires_at: Date.parse(session.expires_at),
          clocked_out: Boolean(session.clocked_out_at),
        },
        now,
      )
    : null
  const live = Boolean(timing?.live)

  // Realtime: positions and the end, as they happen.
  useEffect(() => {
    if (!sessionId || REALTIME_DISABLED) return
    let channel: ReturnType<ReturnType<typeof supabase>['channel']> | null = null
    setRealtime('connecting')
    const giveUp = setTimeout(() => setRealtime((r) => (r === 'live' ? r : 'off')), 10_000)
    try {
      channel = supabase()
        .channel(`follow:${sessionId}`, { config: { private: true } })
        .on('broadcast', { event: 'position' }, ({ payload }) => {
          const p = payload as SessionState['live']
          if (p && typeof p.lat === 'number' && typeof p.lng === 'number') addPoint(toPoint(p))
        })
        .on('broadcast', { event: 'ended' }, () => void act('heartbeat'))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setRealtime('live')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtime('off')
        })
    } catch {
      setRealtime('off')
    }
    return () => {
      clearTimeout(giveUp)
      if (channel) void supabase().removeChannel(channel)
    }
  }, [sessionId, addPoint, act])

  // Check in: every 20 s with Realtime, every 8 s without (it also brings
  // the latest position then).
  useEffect(() => {
    if (!sessionId || !live) return
    const t = setInterval(() => void act('heartbeat'), realtime === 'live' ? FOLLOW_HEARTBEAT_MS : FAST_INTERVAL_MS)
    return () => clearInterval(t)
  }, [sessionId, live, realtime, act])

  // Closing the page ends the session at once (otherwise after 60 s).
  useEffect(() => {
    if (!sessionId) return
    const close = () => {
      try {
        navigator.sendBeacon(`/api/admin/follow/${sessionId}`, JSON.stringify({ action: 'close' }))
      } catch {
        // The 60-second rule ends it.
      }
    }
    window.addEventListener('pagehide', close)
    return () => {
      window.removeEventListener('pagehide', close)
      close()
    }
  }, [sessionId])

  // The clock for "Updated N s ago" and the time left.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const fromStore = latest && store ? distanceM(latest, store) : null
  const clockedOutAt = session?.clocked_out_at ? formatLagos(session.clocked_out_at, false) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/admin/tracking?person=${person.id}`}
          className={buttonVariants({ variant: 'ghost', size: 'iconSm' })}
          aria-label="Back to Movement"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {person.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photo} alt="" className="h-11 w-11 rounded-2xl object-cover ring-2 ring-brand/30" />
        ) : (
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-tint text-sm font-bold text-tint-foreground">
            {initialsOf(person.name)}
          </span>
        )}
        <div className="min-w-0 flex-1 basis-44">
          <h1 className="truncate text-lg font-extrabold leading-tight">{person.name}</h1>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
                </span>
                <span className="font-semibold text-brand">Following live</span>
                {session && <span className="whitespace-nowrap">· {timeLeft(Date.parse(session.expires_at), now)} left</span>}
              </>
            ) : session ? (
              <span>Not following</span>
            ) : (
              <span>Starting…</span>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {person.phone && (
            <a href={`tel:${person.phone.replace(/[^\d+]/g, '')}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
          {live && (
            <Button size="sm" variant="deep" disabled={busy} onClick={() => void act('stop')}>
              <Square className="h-3.5 w-3.5 fill-current" /> Stop
            </Button>
          )}
        </div>
      </div>

      {problem && <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{problem}</p>}

      {timing && timing.ended && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-tint px-4 py-3 text-sm">
          <p className="flex-1 font-semibold text-tint-foreground">{endedText(timing.ended, clockedOutAt)}</p>
          {timing.ended === 'expired' && (
            <Button size="sm" disabled={busy} onClick={() => void act('extend')}>
              Keep following
            </Button>
          )}
          {(timing.ended === 'stopped' || timing.ended === 'closed') && (
            <Button size="sm" disabled={busy} onClick={() => setStartKey((k) => k + 1)}>
              Start again
            </Button>
          )}
          <Link href={`/admin/tracking?person=${person.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Their route today
          </Link>
        </div>
      )}
      {timing?.live && timing.offerExtend && session && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-tint px-4 py-3 text-sm">
          <p className="flex-1 text-tint-foreground">
            Following stops in {timeLeft(Date.parse(session.expires_at), now)}.
          </p>
          <Button size="sm" disabled={busy} onClick={() => void act('extend')}>
            Keep following
          </Button>
        </div>
      )}

      <div className="relative">
        <MapFrame map={map} height="h-[calc(100dvh-15rem)] min-h-[380px]" />
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[1000] flex flex-wrap items-end justify-between gap-2">
          <div className="pointer-events-auto max-w-full rounded-2xl bg-white/95 px-3 py-2 text-xs shadow-lg sm:max-w-sm">
            <p className="font-bold text-foreground">
              {updatedAgo(latest?.at ?? null, now)}
              {isMoving(kmh) && <span className="ml-1.5 text-brand">· {Math.round(kmh!)} km/h</span>}
              {latest && !isMoving(kmh) && kmh != null && <span className="ml-1.5 font-semibold text-muted-foreground">· not moving</span>}
            </p>
            {place && <p className="truncate text-muted-foreground">Last named place: {place}</p>}
            {fromStore != null && store && (
              <p className="truncate text-muted-foreground">
                {fromStore <= store.radius_m ? `In ${store.name}` : `${metres(fromStore)} from ${store.name}`}
              </p>
            )}
            {latest?.accuracy_m != null && <p className="text-muted-foreground">Accurate to about {Math.round(latest.accuracy_m)} m</p>}
          </div>
          <button
            type="button"
            aria-pressed={follow}
            onClick={() => setFollow((f) => !f)}
            className={cn(
              'pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold shadow-lg',
              follow ? 'border-brand bg-brand text-primary-foreground' : 'border-border bg-white text-foreground',
            )}
          >
            <Crosshair className="h-4 w-4" />
            {follow ? 'Following on map' : 'Follow on map'}
          </button>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {live && realtime === 'off' && (
          <p className="font-semibold text-foreground">
            Live updates are not reaching this page, so their position is checked every 8 seconds instead.
          </p>
        )}
        {live && stored && (
          <p>
            Showing their last saved position. Quick positions start within seconds when the Xtend app is open on
            their phone, or within about 2½ minutes otherwise.
          </p>
        )}
        <p>
          Their phone sends a position about every {FAST_INTERVAL_MS / 1000} seconds while you follow, for 30 minutes at a
          time. Following stops by itself at clock-out, after 30 minutes, or when you close this page. The line shows the
          last few minutes.
        </p>
      </div>
    </div>
  )
}
