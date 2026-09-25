# Xtend

Field attendance and reporting for Xpel Beauty merchandisers and marketers
across Nigeria. Field staff clock in and out with a verified GPS fix and an
in-app selfie; admins manage staff and audit attendance from a web dashboard.

- **Stack:** Next.js 15 (App Router, TypeScript), Tailwind, Supabase
  (Auth, Postgres, Storage, Realtime, RLS), Vercel + Vercel Cron.
- **Surface:** installable PWA for the field, web dashboard for the office.
- **Timezone of record:** Africa/Lagos. **Scale:** 30–100 staff, one outlet each.

## The architectural rule

All business logic lives in Postgres functions, triggers and thin route
handlers. None of it lives in React. Phase 4 wraps this in Expo and the backend
must be reused untouched.

Concretely, the client sends only what it observed — type, coordinates,
accuracy, address, selfie path, device info, capture timestamp. A trigger sets
`user_id`, `distance_m`, `status` and `attendance_date` on every row, and
overwrites anything the client tried to put there. There is a test that proves
it (`supabase/tests/rules.sql`).

## Getting it running

```bash
npm install
cp .env.example .env.local     # fill in your Supabase keys
```

1. **Create a Supabase project**, then apply the migrations in order — the
   SQL editor, `supabase db push`, or `psql`:

   ```
   supabase/migrations/0001_init.sql    # tables, RLS, storage, retention
   supabase/migrations/0002_logic.sql   # heartbeat, supervisors, views, audit
   supabase/migrations/0003_harden.sql  # RPC grants: see "The RPC surface" below
   …and every later file in the folder, in number order, through
   supabase/migrations/0019_store_counts.sql    # products and store counts
   supabase/migrations/0020_count_requests.sql  # counts on request or at month end
   supabase/migrations/0021_counted_product_names.sql  # products typed while counting
   supabase/migrations/0022_integrity_checks.sql  # counts in store, selfie checks, flags
   ```

2. **Environment** (`.env.local`, and the same in Vercel):

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client |
   | `SUPABASE_SERVICE_ROLE_KEY` | Admin route handlers only, never shipped to the browser |
   | `CRON_SECRET` | Shared secret for the nightly retention job |
   | `GEOCODER_USER_AGENT` | Contact string for Nominatim's usage policy |
   | `CREDENTIALS_WEBHOOK_URL` | Optional: relay that SMS/emails temporary passwords |
   | `ANTHROPIC_API_KEY` | Optional: turns on **Ask Xtend**, the attendance assistant |

3. **Bootstrap the first admin.** There is no public signup:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     npx tsx scripts/create-admin.ts "Ngozi Eze" ngozi@xpel.ng 'a-strong-password'
   ```

4. `npm run dev`, sign in, create outlets, then create or import staff.

Geolocation needs a secure context: `localhost` or HTTPS. Testing the clock-in
flow over a plain-HTTP LAN address will fail at the location gate, correctly.

### Deployment

Vercel picks up `vercel.json`, which schedules `/api/cron/purge-selfies`
nightly at 02:20 UTC (03:20 Lagos). Set `CRON_SECRET` in the project; the route
refuses anything without the matching bearer token.

## What is where

```
src/app/field/…        Mobile PWA: clock, history, daily report, store
                       count, account
src/app/admin/…        Dashboard: overview, Ask Xtend, attendance, store
                       visits, store counts and products, alerts,
                       analytics, notifications, store allocation, staff,
                       teams, outlets, audit log
src/app/api/…          Thin route handlers (validate → call Postgres → map errors)
src/lib/assistant*     Ask Xtend: Claude answers attendance questions and
                       writes reports via read-only tools that query as the
                       signed-in user; report rows come from the database.
                       It prepares store allocations and team changes from
                       a pasted list or an attached file, as a plan the
                       person applies; it never writes on its own
src/lib/export/…       One renderer, two datasets: attendance and store visits
src/lib/retention*     The 24-hour rule for clock photos, and the sweep
src/lib/platform.ts    Device detection, purely to pick the right help text
src/lib/stockists*     The supplied customer list and how it is searched
data/                  The customer list as CSV, as supplied
src/lib/offline/…      IndexedDB outbox and the flush loop
src/lib/geo.ts         Location gate: accuracy ceiling, block reasons
src/lib/image.ts       On-device resize to 640px/150kb plus a 200×200 thumbnail
src/components/brand/  The Xpel mark and lockup
public/brand/          The supplied logo, background removed
supabase/migrations/…  The whole of the business logic
supabase/tests/…       Local Postgres harness and 110 rule assertions
scripts/check-exports  Renders every export format and checks the bytes
```

## Roles

| Role | Surface | Clocks in/out | Files the daily report |
|---|---|---|---|
| merchandiser | Mobile PWA | Yes | No |
| marketer | Mobile PWA | Yes | Yes |
| supervisor | Web, read-only | No | No |
| admin | Web dashboard | — | Yes, for corrections |

Only marketers file the daily report. That is enforced in three places, so no
client can route around it: the `reports` insert and update policies call
`can_file_report()`, the `report_enforce` trigger raises on the way in, and
the route handler rejects the request first for a readable error. The field
app hides the Report tab for merchandisers by asking Postgres the same
question rather than guessing from the role name.

## Naming the exact place

Clock-in records the premises, not just coordinates:
`Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos 23401, Lagos`.
`src/lib/geocode.ts` resolves it from three sources, best first:

1. **The assigned outlet**, when the fix is inside its geofence. If someone
   is standing in their own store, that store's record is the most accurate
   answer available and it costs no API call. This covers the normal case
   exactly, with no key and no network dependency.
2. **Google** — Places (New) `searchNearby` for the business name, Geocoding
   for the street address. This is the only source that reliably names
   Nigerian retail premises, and it is what produces the format above.
   Set `GOOGLE_MAPS_API_KEY` with *Places API (New)* and *Geocoding API*
   enabled.
3. **OpenStreetMap** — Nominatim for the address, Overpass for a named
   business within 80 m. Free, no key, but Nigerian POI coverage is thin, so
   it usually names the street rather than the shop.

Whatever answers, `attendance.place_name` and `attendance.address` are stored
separately along with `place_source`, so the record says where the reading
came from. The `location_label` column in `attendance_detail` joins them for
display and can never be empty — coordinates are the floor.

## Telling the office nobody is in the store

Three things reach an admin or supervisor without anyone opening the
dashboard, each pushed to their phone and written to the notification log:

| When | Who is told | Sent by |
|---|---|---|
| A clock-in or clock-out lands outside the geofence, or cannot be verified | Admins + that outlet's supervisor | `/api/attendance` after the insert |
| A heartbeat puts someone more than 300 m from where they clocked in | Same | `/api/pings`, only when the trigger actually raised the alert |
| Someone has not clocked in past their outlet's shift start | Same | `/api/cron/absence-sweep`, once per person per day |

`alert_watchers()` decides who hears about whom: every active admin, plus
the supervisor of that person's own outlet, never the subject themselves.
The heartbeat path does not re-implement the 30-minute alert throttle — it
asks whether the database trigger fired for that ping and stays silent if it
did not, so a staff member sitting off-site does not generate a push every
five minutes.

The absence sweep is idempotent: `no_show_already_reported()` means running
it repeatedly cannot notify the same person twice in a day. On Vercel's
Hobby plan a cron may run once daily, so it is scheduled at 09:30 Lagos,
past the 30-minute grace for both an 08:00 and a 09:00 shift. On Pro,
change the schedule to `0 6-16 * * 1-6` and each outlet is judged close to
its own start.

## Notifications

Admins and supervisors send Web Push notifications to staff phones from
**Dashboard → Notifications**, targeted four ways: everyone, a role, an
outlet, or named people. The composer shows the live recipient count and how
many of those have a device registered, so nobody sends into the void.

Reach is decided in Postgres, not in the UI. `resolve_notification_targets()`
returns an admin everyone, and returns a supervisor only the *field staff at
their own outlet* — naming an admin explicitly resolves to nobody. Every send
writes an `audit_log` row and one `notification_deliveries` row per person,
recording `sent`, `failed`, or `no_device`.

Staff turn notifications on per device from **You → Notifications**, which
stores a subscription keyed by endpoint. Dead subscriptions (a 404 or 410
from the push service) are deactivated automatically on the next send.

Needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
Without them the app runs normally and the send endpoint returns a clear 503.

## Design

One saturated colour on a warm off-white canvas. The palette is sampled from
the Xpel Beauty logo — terracotta `#C1572A` through to gold `#C49420` — with
the terracotta doing the UI work and the gold kept as an accent, because white
text on gold fails contrast and so it never becomes a surface. Tints of the
brand carry every inactive state, so the interface never needs a second hue.

The layout language is the same on every screen: rounded white cards on a soft
shadow, pill chips for filters and switches, brand-filled cards for the things
that matter, and a floating four-target bottom bar. Form-heavy screens use the
sheet pattern — a brand header carrying the read-only context, with a white
sheet lifted over its lower edge holding the inputs.

**The app mark** is not the printed lockup. The logo's X and wordmark overlap,
so no crop separates them, and the full lockup turns to mush at tab-icon size.
`src/components/brand/logo.tsx` redraws the X as two bowed strokes in the
logo's own gradient: inline SVG for the interface, rasterised into the PWA
icons. The real lockup still appears at full size on the login and account
screens, where there is room to read it.

## The RPC surface

Supabase publishes every function in `public` at `/rest/v1/rpc/<name>`, so a
`SECURITY DEFINER` function is reachable by anyone holding the anon key unless
`EXECUTE` is revoked. Migration 0003 closes that. Two of the seventeen actually
mattered:

- `purge_old_selfies()` — anyone could have triggered the image deletion.
  Now service-role only (and since migration 0012 it is
  `purge_expired_selfies()`, on a 24-hour rule).
- `write_audit(...)` — any signed-in user could have written an audit row
  naming themselves as the actor of anything. Now guarded by `is_admin()`.

The rest are either trigger functions (not an API; `EXECUTE` revoked) or
already decide internally what the caller may see, and are granted to
`authenticated` only. Supabase's linter still lists those ten as
"signed-in users can execute", which is correct and intended.

One advisory is left open deliberately: **leaked password protection** is off.
It is an Auth setting, not SQL — turn it on under Authentication → Policies if
you want passwords checked against HaveIBeenPwned.

## Phase coverage

| Phase | Status |
|---|---|
| 1 — auth, forced password change, location gate, clock in/out with selfie and server-side distance, staff management, CSV import, outlets, attendance table | Built |
| 2 — daily reports with photos, XLSX/DOCX/PDF (and CSV) export, IndexedDB offline queue, retention cron | Built |
| 3 — heartbeat pings, geofence alerts, realtime dashboard, punctuality and coverage analytics, map view | Built |
| Store rounds — check in anywhere with no allocation, the day as in/stores/out, reports in PDF/Word/Excel/CSV | Built |
| Stores in bulk — load the supplied customer list or paste your own, geocoded server-side in chunks, reviewed before saving | Built |
| Location help — per-device instructions for turning location back on, clearing itself when the permission changes | Built |
| Photo retention — clock and store-visit selfies deleted 24 hours after capture | Built |
| 4 — Expo wrapper, background tracking, mock-location detection | Not started; the backend is designed to be reused unchanged |

## Things worth knowing

**Fraud, stated plainly.** Browser geolocation can be spoofed with a fake GPS
app and the web platform gives no way to detect it. What is here is layered,
not absolute: a mandatory live selfie, a 100 m accuracy ceiling, server-set
timestamps, geofence distance computed in the database, and an admin review
queue. Real mock-location detection arrives in Phase 4 with Expo's
`isFromMockProvider`. Do not promise the client tamper-proof attendance before
then.

**Tracking is foreground only.** The heartbeat runs every 5 minutes while the
app is open and a shift is running. It stops when the tab is backgrounded. The
field UI says so in those words rather than implying background tracking the
web cannot deliver.

**Attendance is append-only.** There is no UPDATE or DELETE policy on the
table, by design — not even for an admin. Deactivating a user is a soft delete
and the foreign key is `on delete restrict`, so history cannot be destroyed by
deleting a person.

**Off-site clocking is shown to the user.** If someone clocks in 400 m out,
the app tells them the distance and tells them the admin was notified. Silent
flagging breeds distrust and deters nothing.

**Temporary passwords.** Xpel has no SMS or email provider wired up, so a new
account's password is shown to the admin once, to hand over. Point
`CREDENTIALS_WEBHOOK_URL` at a Termii or SendGrid relay and the same code path
delivers it automatically.

### Two corrections to the supplied migration

`0001_init.sql` is the schema as supplied, with three changes that were needed
for it to apply and to work:

1. `public.current_role()` is renamed `public.current_user_role()`.
   `CURRENT_ROLE` is a reserved SQL keyword and Postgres rejects it as a
   function name.
2. The role helpers are declared after `public.profiles` rather than before it.
   A `LANGUAGE SQL` body is parsed at creation time, so the original order
   fails with "relation public.profiles does not exist".
3. `profiles_self_update`'s `WITH CHECK` used a subquery on `public.profiles`
   inside a policy on `public.profiles`, which recurses. It now calls the
   `SECURITY DEFINER` helper, which is what that helper exists for.

## Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm run build         # production build

# SQL rules, against a throwaway Postgres 16 (not your project):
PGURL=postgres://postgres@localhost:5432/postgres ./scripts/test-sql.sh
```

`scripts/test-sql.sh` stubs the Supabase-specific schemas and roles, applies
every migration and runs its assertions covering distance and status computation,
the one-per-day constraint, timestamp rejection, geofence alerts and their
throttles, report rules, store visits and store allocation, the read models,
admin-only alert resolution with its audit row, and the 24-hour photo purge. It does not exercise RLS: a superuser
session bypasses policies, so those are verified against the project itself.

RLS was verified on the live project by running the same query while
impersonating each role — an admin sees 5 profiles, a merchandiser sees 1, a
supervisor sees the 2 at their own outlet.
