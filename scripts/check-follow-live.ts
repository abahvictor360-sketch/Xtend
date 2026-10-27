/**
 * Checks follow live (src/lib/follow-live.ts, migration 0070): the smooth
 * glide between positions, the heading arrow, the speed, the session's
 * timing on the page (30 minutes, "Keep following", clock-out), the
 * interval a phone sends at, and that the staff app says nothing about it.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-follow-live.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FAST_HOLD_MS,
  FAST_INTERVAL_MS,
  FOLLOW_GRACE_MS,
  FOLLOW_HEARTBEAT_MS,
  FOLLOW_MINUTES,
  bearing,
  distanceM,
  endedText,
  fastHoldUntil,
  followTiming,
  glideMs,
  glideProgress,
  headingFor,
  interpolate,
  isMoving,
  nextInterval,
  speedKmh,
  timeLeft,
  trimTrail,
  updatedAgo,
  type LivePoint,
} from '@/lib/follow-live'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

// --- Distance and direction (Lagos, Ikeja).
const A = { lat: 6.6, lng: 3.35 }
const north = { lat: 6.601, lng: 3.35 } // ~111 m north
const east = { lat: 6.6, lng: 3.351 } // ~110 m east
check(near(distanceM(A, north), 111.2, 1), 'about 111 m for 0.001° of latitude', distanceM(A, north))
check(near(bearing(A, north), 0, 0.5) || near(bearing(A, north), 360, 0.5), 'north is 0°', bearing(A, north))
check(near(bearing(A, east), 90, 0.5), 'east is 90°', bearing(A, east))
check(near(bearing(north, A), 180, 0.5), 'south is 180°', bearing(north, A))
check(near(bearing(east, A), 270, 0.5), 'west is 270°', bearing(east, A))

// --- The glide.
const mid = interpolate(A, north, 0.5)
check(near(mid.lat, 6.6005, 1e-9) && mid.lng === 3.35, 'half way is half way', mid)
check(interpolate(A, north, 0).lat === A.lat && interpolate(A, north, 1).lat === north.lat, 'starts and ends on the points')
check(interpolate(A, north, 2).lat === north.lat && interpolate(A, north, -1).lat === A.lat, 'never overshoots or goes back')
check(interpolate(A, north, Number.NaN).lat === north.lat, 'a broken fraction lands on the new point')
check(glideMs(null, north) === 0, 'the first position appears at once (no glide)')
check(glideMs(A, north, FAST_INTERVAL_MS) === FAST_INTERVAL_MS, 'a glide takes about one interval', glideMs(A, north))
check(glideMs(A, north, 60_000) === FAST_INTERVAL_MS * 1.5, 'a late position does not crawl (1.5 intervals at most)')
check(glideMs(A, north, 200) === 1000, 'nor rush (1 s at least)')
check(glideMs(A, { lat: 6.7, lng: 3.35 }) === 0, 'a jump of over 2 km is not slid across')
check(glideProgress(1000, 8000, 5000) === 0.5 && glideProgress(1000, 8000, 99_999) === 1 && glideProgress(1000, 8000, 0) === 0,
  'progress runs 0 to 1 over the glide')
check(glideProgress(1000, 0, 1000) === 1, 'no glide is already there')

// --- Speed.
const p0: LivePoint = { ...A, at: 0 }
const p1: LivePoint = { ...north, at: 8000 } // 111 m in 8 s = 50 km/h
check(near(speedKmh(p0, p1)!, 50, 0.5), 'speed from two positions', speedKmh(p0, p1))
check(speedKmh(p0, { ...p1, speed_mps: 5 }) === 18, 'the phone’s own speed wins (5 m/s = 18 km/h)')
check(speedKmh(null, p1) === null, 'one position has no speed')
check(speedKmh(p1, { ...north, at: 8000 }) === null, 'two at the same moment have no speed')
check(speedKmh(p0, { ...p1, speed_mps: -1 }) !== null && near(speedKmh(p0, { ...p1, speed_mps: -1 })!, 50, 0.5),
  'an unknown phone speed (negative) falls back to the positions')
check(isMoving(15) && !isMoving(1) && !isMoving(null), 'under 2 km/h is standing still')

// --- Heading.
check(headingFor(p0, { ...p1, heading: 45 }, 50) === 45, 'the phone’s heading while moving')
check(near(headingFor(p0, p1, 50)!, 0, 0.5), 'else the way between the last two positions')
check(headingFor(p0, p1, 1) === null, 'no arrow when standing still')
check(headingFor(p0, { ...A, lat: 6.60002, at: 8000 }, 5) === null, 'no arrow for a move smaller than 5 m')
check(headingFor(p0, { ...p1, accuracy_m: 300 }, 50) === null, 'nor smaller than the reading’s accuracy')
check(headingFor(null, p1, 50) === null, 'nor from a single position without one')
check(headingFor(p0, { ...p1, heading: 720 }, 50) !== 720, 'a nonsense heading is not used')

// --- The trail.
const now = 10 * 60_000
const pts = [0, 4, 6, 9].map((m) => ({ at: m * 60_000 }))
check(trimTrail(pts, now).map((p) => p.at / 60_000).join() === '6,9', 'the trail keeps the last 5 minutes', trimTrail(pts, now))
check(trimTrail([{ at: 9 }, { at: 3 }], 10, 5).map((p) => p.at).join() === '3,9', 'oldest first')

// --- Words that tick.
check(updatedAgo(null, now) === 'Waiting for their position…', 'before any position')
check(updatedAgo(now - 5000, now) === 'Updated 5 s ago', 'seconds')
check(updatedAgo(now - 125_000, now) === 'Updated 2 min ago', 'minutes')
check(updatedAgo(now + 3000, now) === 'Updated 0 s ago', 'a phone clock ahead never shows a negative')
check(timeLeft(now + 29 * 60_000 + 5000, now) === '29:05' && timeLeft(now - 1, now) === '0:00', 'time left as m:ss')

// --- The session on the page.
const exp = now + FOLLOW_MINUTES * 60_000
const on = { active: true, end_reason: null, expires_at: exp, clocked_out: false }
check(JSON.stringify(followTiming(on, now)) === JSON.stringify({ live: true, offerExtend: false, ended: null }),
  'following, with time to spare')
check(followTiming(on, exp - 4 * 60_000).offerExtend && followTiming(on, exp - 4 * 60_000).live,
  '"Keep following" is offered in the last 5 minutes')
check(followTiming(on, exp + 1).ended === 'expired' && followTiming(on, exp + 1).offerExtend && !followTiming(on, exp + 1).live,
  'after 30 minutes it stops, and offers "Keep following" (even before the server says so)')
check(followTiming({ ...on, active: false, end_reason: 'expired' }, now).offerExtend, 'run out on the server: offer it too')
check(JSON.stringify(followTiming({ ...on, clocked_out: true }, now)) === JSON.stringify({ live: false, offerExtend: false, ended: 'clocked_out' }),
  'clock-out stops it, with nothing to extend')
check(followTiming({ ...on, active: false, end_reason: 'stopped' }, now).ended === 'stopped'
      && !followTiming({ ...on, active: false, end_reason: 'stopped' }, now).offerExtend, 'Stop stops it')
check(followTiming({ ...on, active: false, end_reason: 'closed' }, now).ended === 'closed', 'and a closed page')
check(endedText('clocked_out', '17:32') === 'Clocked out at 17:32. Following has stopped.', 'says when they clocked out')
check(endedText('expired', null).includes('30 minutes'), 'says why it stopped')
check(FOLLOW_HEARTBEAT_MS * 2 < FOLLOW_GRACE_MS, 'the page checks in at least twice within the 60-second grace')

// --- The interval a phone sends at.
const NORMAL = 300_000
check(nextInterval({ interval_ms: 8000 }, NORMAL) === 8000, 'while followed: the fast interval')
check(nextInterval({}, NORMAL) === NORMAL && nextInterval(null, NORMAL) === NORMAL, 'no interval in the answer: back to normal')
check(nextInterval({ interval_ms: 500 }, NORMAL) === NORMAL && nextInterval({ interval_ms: 600_000 }, NORMAL) === NORMAL,
  'a silly interval is ignored (2-60 s only)')
check(nextInterval({ interval_ms: '8000' }, NORMAL) === NORMAL, 'and so is one that is not a number')
check(fastHoldUntil({ interval_ms: 8000 }, now, NORMAL) === now + FAST_HOLD_MS, 'fast mode holds a minute after each answer')
check(fastHoldUntil({}, now, NORMAL) === 0, 'and ends with an answer that has no interval')
check(FAST_INTERVAL_MS === 8000, 'the fast interval matches the database (follow_fast_interval_ms = 8000)')
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '0070_follow_live.sql'), 'utf8')
check(/follow_fast_interval_ms\(\)\s*returns integer language sql immutable as \$\$ select 8000 \$\$/.test(sql)
      && /interval '30 minutes'/.test(sql) && /interval '60 seconds'/.test(sql),
  'and the 30 minutes and 60 seconds match too')

// --- Staff are never told.
const staffFiles = ['src/components/field/heartbeat.ts', 'src/components/staff-guide.tsx', 'src/components/field/shift-tracker.tsx']
const staffText = staffFiles.map((f) => readFileSync(join(__dirname, '..', f), 'utf8')).join('\n')
const shown = [...staffText.matchAll(/set(?:LastError|SavedOffline|Problem)\(\s*'([^']*)'/g)].map((m) => m[1]).join(' ')
check(!/follow/i.test(shown), 'nothing the staff app shows mentions following', shown)
check(!/follow/i.test(readFileSync(join(__dirname, '..', 'src/components/staff-guide.tsx'), 'utf8')), 'nor the staff guide')
const native = readFileSync(join(__dirname, '..', 'src/lib/native.ts'), 'utf8')
check(/text: 'On shift'/.test(native), 'the Android notification still just says "On shift"')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL FOLLOW LIVE CHECKS PASSED')
