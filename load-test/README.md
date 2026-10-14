# Xtend load test — 5,000 field staff

Can Xtend take ~5,000 merchandisers clocking in and sitting on the dashboard at
once? This folder has a [k6](https://k6.io) script that drives the real flows,
plus the mitigations already in the code and the infra checklist to size before
a real run.

> **Run it against a STAGING / preview deploy, never production.** The clock-in
> scenario writes attendance rows, a burst can blow past the free ip-api limit,
> and it all runs up Supabase and Vercel usage. Point `BASE_URL` /
> `SUPABASE_URL` at a preview project.

## What it measures

`xtend-load.js` has four scenarios (pick with `SCENARIOS`, comma-separated):

| scenario    | what it hits                                   | the limit it probes                     |
| ----------- | ---------------------------------------------- | --------------------------------------- |
| `baseline`  | `GET /api/health` (no auth)                    | Vercel edge + cold starts               |
| `dashboard` | Supabase RPCs `my_day` etc. (authed)           | Postgres + pooler under the shift poll  |
| `realtime`  | one Supabase realtime socket per VU, held open | **the connection ceiling — #1 risk**    |
| `clockin`   | inserts `attendance` via PostgREST (opt-in)    | DB write + distance/integrity triggers  |

The **realtime** scenario is the one most likely to fail first: Supabase caps
concurrent realtime connections per plan (~200 Free, ~500 Pro before add-ons),
and the dashboard opens one socket per on-shift user. Watch `realtime_failed`
and the `ws upgraded (101)` check — where they start climbing is your ceiling.

## 1. Install k6

```bash
# macOS
brew install k6
# Windows
winget install k6 --source winget
# Linux / other: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## 2. Seed test users on the staging project

The authed scenarios need real accounts. Create `TEST_USERS` of them, emailed
`loadtest+1@xpel.test` … `loadtest+N@xpel.test`, all sharing one password, each
a `merchandiser` allocated to one store (so `my_day` and the clock-in trigger
have something to resolve against). Do this on the **staging** Supabase project,
through the app's own admin "Add staff" flow or a seeding script using the
service-role key — whichever you already use. Keep the password out of git.

## 3. Run

Smoke test first (small, ~2 min) to confirm wiring:

```bash
k6 run \
  -e BASE_URL=https://xtend-staging.vercel.app \
  -e SUPABASE_URL=https://<ref>.supabase.co \
  -e SUPABASE_ANON_KEY=<anon key> \
  -e TEST_PASSWORD=<the shared password> \
  -e TEST_USERS=50 \
  -e SCENARIOS=baseline,dashboard \
  load-test/xtend-load.js
```

Then the realtime ceiling (the important one):

```bash
k6 run -e BASE_URL=... -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... \
  -e TEST_PASSWORD=... -e TEST_USERS=5000 -e SCENARIOS=realtime \
  load-test/xtend-load.js
```

Full mix at 5,000, including writes (staging only; clean up afterwards):

```bash
k6 run -e BASE_URL=... -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... \
  -e TEST_PASSWORD=... -e TEST_USERS=5000 \
  -e SCENARIOS=baseline,dashboard,realtime,clockin \
  load-test/xtend-load.js
```

After a `clockin` run, delete the rows it wrote:

```sql
delete from attendance where device_info->>'ua' = 'k6-load-test';
```

### Env vars

| var                  | default              | notes                                            |
| -------------------- | -------------------- | ------------------------------------------------ |
| `BASE_URL`           | —                    | staging app origin (for `baseline`)              |
| `SUPABASE_URL`       | — (required)         | staging project URL                              |
| `SUPABASE_ANON_KEY`  | — (required)         | staging anon key                                 |
| `TEST_PASSWORD`      | —                    | shared password for the seeded users             |
| `TEST_USERS`         | `500`                | how many seeded accounts / peak VUs              |
| `TEST_EMAIL_PREFIX`  | `loadtest+`          | `prefix{n}@domain`                               |
| `TEST_EMAIL_DOMAIN`  | `xpel.test`          |                                                  |
| `SCENARIOS`          | `baseline,dashboard,realtime` | `clockin` is opt-in                     |

## 4. Reading the result

k6 prints per-metric stats and pass/fail on these thresholds:

- `http_req_failed < 2%` — overall error rate.
- `login_failed < 2%` — if this fails, your seed/password is wrong, not the app.
- `http_req_duration{op:health} p95 < 4s` — cold-start tolerant.
- `rpc_my_day_ms p95 < 2s` — the dashboard RPC under load.

Also eyeball `realtime_connected` vs `realtime_failed` and `clockin_ok` vs
`clockin_err`. A clean pass at `TEST_USERS=5000` on staging-sized infra is the
green light.

---

## Mitigations

### Already in the code

- **Realtime degrades to polling.** `useDashboardRefresh` and the field support
  chat fall back to a poll if the socket never subscribes or errors
  (`CHANNEL_ERROR` / `TIMED_OUT`), so hitting the connection cap slows updates
  rather than breaking the app.
- **Fleet-wide realtime kill-switch.** Set `NEXT_PUBLIC_REALTIME_DISABLED=1` to
  stop every client opening a socket and ride the poll instead — the release
  valve if the `realtime` scenario shows sockets are what falls over.
- **Jittered safety poll.** The dashboard poll is spread ±30% per client, so a
  fleet does not stampede the backend on the same 45s tick. When realtime is
  off/failed the poll runs faster (20s on-shift) since it is then the live path.
- **IP ge-location is best-effort.** The clock-in path never fails because the
  IP lookup did; see `src/lib/ip-geo.ts`.

### Infra / config to size before a real 5,000 run

- **Supabase plan.** Raise the realtime concurrent-connection limit (Pro +
  add-on, or disable realtime via the kill-switch above). Size compute so the
  pooler has enough connections for the `dashboard` + `clockin` load.
- **IP provider.** ip-api free is 45 req/min — a shift-start burst blows past
  it. Set `IP_API_KEY` (ip-api pro HTTPS) or `IP_GEO_URL` to a keyed provider,
  or `IP_GEO_DISABLED=1` to skip it. See `src/lib/ip-geo.ts`.
- **Vercel plan.** Pro for the function concurrency and longer limits the
  clock-in route needs under a burst (`maxDuration` is already 60s).
