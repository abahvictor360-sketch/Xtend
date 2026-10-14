/**
 * Xtend load test (k6) — can the app handle ~5,000 field staff?
 *
 * Run this against a STAGING / preview deploy, never production: the write
 * scenario inserts attendance rows, and a burst can exhaust the free
 * ip-api limit and run up Supabase/Vercel usage. See load-test/README.md.
 *
 *   k6 run \
 *     -e BASE_URL=https://<your-staging>.vercel.app \
 *     -e SUPABASE_URL=https://<ref>.supabase.co \
 *     -e SUPABASE_ANON_KEY=<anon key> \
 *     -e TEST_PASSWORD=<shared password for the seeded load-test users> \
 *     -e TEST_USERS=5000 \
 *     load-test/xtend-load.js
 *
 * Seed the users first (see README): accounts emailed
 *   loadtest+1@xpel.test … loadtest+<TEST_USERS>@xpel.test
 * all sharing TEST_PASSWORD, role merchandiser, each allocated a store.
 *
 * Scenarios (enable/disable with the SCENARIOS env, comma-separated):
 *   baseline   unauthenticated /api/health — Vercel edge + cold starts
 *   dashboard  authed Supabase RPC reads — the per-shift dashboard poll
 *   realtime   one Supabase realtime socket per VU — the connection ceiling
 *   clockin    writes attendance via PostgREST — the shift-start burst
 *              (opt-in: only runs when 'clockin' is in SCENARIOS)
 */

import http from 'k6/http'
import ws from 'k6/ws'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js'

// ---------------------------------------------------------------- config
const APP = (__ENV.BASE_URL || '').replace(/\/$/, '')
const SB = (__ENV.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = __ENV.SUPABASE_ANON_KEY || ''
const PASSWORD = __ENV.TEST_PASSWORD || ''
const EMAIL_PREFIX = __ENV.TEST_EMAIL_PREFIX || 'loadtest+'
const EMAIL_DOMAIN = __ENV.TEST_EMAIL_DOMAIN || 'xpel.test'
const USERS = Number(__ENV.TEST_USERS || 500)
const ON = (__ENV.SCENARIOS || 'baseline,dashboard,realtime').split(',').map((s) => s.trim())

if (!SB || !ANON) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY.')

// ------------------------------------------------------------- metrics
const loginFail = new Rate('login_failed')
const myDay = new Trend('rpc_my_day_ms', true)
const rtOpen = new Counter('realtime_connected')
const rtFail = new Counter('realtime_failed')
const clockOk = new Counter('clockin_ok')
const clockErr = new Counter('clockin_err')

// ------------------------------------------------- auth (per-VU token)
const email = (vu) => `${EMAIL_PREFIX}${vu}@${EMAIL_DOMAIN}`
function login(vu) {
  const r = http.post(
    `${SB}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: email(vu), password: PASSWORD }),
    { headers: { apikey: ANON, 'Content-Type': 'application/json' }, tags: { op: 'login' } },
  )
  const ok = r.status === 200
  loginFail.add(!ok)
  if (!ok) return null
  const body = r.json()
  return { token: body.access_token, uid: body.user && body.user.id }
}
let session = null
function auth(vu) {
  if (!session) session = login(vu)
  return session
}
const bearer = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

// ----------------------------------------------------------- scenarios
function stages(target) {
  return [
    { duration: '2m', target: Math.min(target, 500) },
    { duration: '3m', target },
    { duration: '3m', target }, // hold at peak
    { duration: '1m', target: 0 },
  ]
}
const scenarios = {}
if (ON.includes('baseline'))
  scenarios.baseline = { executor: 'constant-vus', vus: 20, duration: '9m', exec: 'baseline' }
if (ON.includes('dashboard'))
  scenarios.dashboard = { executor: 'ramping-vus', exec: 'dashboard', startTime: '5s', stages: stages(USERS) }
if (ON.includes('realtime'))
  scenarios.realtime = { executor: 'ramping-vus', exec: 'realtime', startTime: '5s', stages: stages(USERS) }
if (ON.includes('clockin'))
  // a sharp burst, as at shift start: everyone clocks in within a few minutes
  scenarios.clockin = {
    executor: 'ramping-arrival-rate',
    exec: 'clockin',
    startTime: '5s',
    startRate: 5,
    timeUnit: '1s',
    preAllocatedVUs: Math.min(USERS, 1000),
    maxVUs: Math.min(USERS, 2000),
    stages: [
      { duration: '2m', target: Math.ceil(USERS / 600) }, // ramp
      { duration: '5m', target: Math.ceil(USERS / 300) }, // sustained burst (~USERS over the window)
      { duration: '1m', target: 0 },
    ],
  }

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.02'],
    login_failed: ['rate<0.02'],
    'http_req_duration{op:health}': ['p(95)<4000'],
    rpc_my_day_ms: ['p(95)<2000'],
  },
  // Don't let one slow DB hold a VU forever.
  noConnectionReuse: false,
}

// 1) Unauthenticated edge baseline — cold starts + middleware.
export function baseline() {
  const r = http.get(`${APP}/api/health`, { tags: { op: 'health' } })
  check(r, { 'health 200': (x) => x.status === 200 })
  sleep(randomIntBetween(1, 3))
}

// 2) Dashboard DB poll — the RPCs the field home runs, ~every 45s on shift.
export function dashboard() {
  const s = auth(__VU)
  if (!s) {
    sleep(5)
    return
  }
  const h = bearer(s.token)
  const t0 = Date.now()
  const r = http.post(`${SB}/rest/v1/rpc/my_day`, '{}', { headers: h, tags: { op: 'my_day' } })
  myDay.add(Date.now() - t0)
  check(r, { 'my_day ok': (x) => x.status < 400 })
  http.post(`${SB}/rest/v1/rpc/my_store_visits`, '{}', { headers: h, tags: { op: 'my_store_visits' } })
  http.post(`${SB}/rest/v1/rpc/can_visit_stores`, '{}', { headers: h, tags: { op: 'can_visit_stores' } })
  sleep(randomIntBetween(40, 50)) // the dashboard's on-shift safety poll
}

// 3) Realtime ceiling — one Supabase realtime socket per VU, held open.
//    This is the limit most likely to bite at 5,000; watch realtime_failed.
export function realtime() {
  const s = auth(__VU)
  if (!s) {
    sleep(5)
    return
  }
  const host = SB.replace(/^https?:\/\//, '')
  const url = `wss://${host}/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`
  const res = ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      rtOpen.add(1)
      // Join the same channel the field dashboard opens, with the user's token
      // so RLS applies (the app subscribes to attendance/store_visits/etc.).
      socket.send(
        JSON.stringify({
          topic: 'realtime:field-dashboard',
          event: 'phx_join',
          payload: {
            config: {
              postgres_changes: [{ event: '*', schema: 'public', table: 'attendance' }],
            },
            access_token: s.token,
          },
          ref: '1',
        }),
      )
      socket.setInterval(
        () => socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })),
        25000,
      )
      // Hold the connection ~60s (a shift would hold it far longer; this is
      // enough to stack VUs and find the concurrent-connection ceiling).
      socket.setTimeout(() => socket.close(), 60000)
    })
    socket.on('error', () => rtFail.add(1))
  })
  check(res, { 'ws upgraded (101)': (r) => r && r.status === 101 })
}

// 4) Clock-in burst (opt-in). Inserts attendance via PostgREST so the
//    distance/status/integrity triggers run — the real write cost. STAGING
//    ONLY; delete the rows afterwards (see README). This does NOT exercise
//    the /api/attendance IP-lookup/notify path (that needs the app's cookie
//    session); it measures the database write + triggers, which is the part
//    that must not fall over under a shift-start burst.
export function clockin() {
  const s = auth(__VU)
  if (!s || !s.uid) {
    clockErr.add(1)
    return
  }
  const h = { ...bearer(s.token), Prefer: 'return=minimal' }
  // A fix near the Lagos Trade Fair Complex; the trigger measures it against
  // the user's allocated store.
  const body = {
    type: 'opening',
    lat: 6.4693 + (Math.random() - 0.5) * 0.002,
    lng: 3.2536 + (Math.random() - 0.5) * 0.002,
    accuracy_m: randomIntBetween(8, 40),
    selfie_path: `${s.uid}/loadtest-${Date.now()}.jpg`,
    client_captured_at: new Date().toISOString(),
    device_info: { ua: 'k6-load-test' },
  }
  const r = http.post(`${SB}/rest/v1/attendance`, JSON.stringify(body), { headers: h, tags: { op: 'clockin' } })
  if (r.status < 400) clockOk.add(1)
  else clockErr.add(1)
  check(r, { 'clock-in accepted': (x) => x.status < 400 || x.status === 409 /* already clocked in */ })
}
