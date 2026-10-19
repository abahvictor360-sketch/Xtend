# Xtend build guide

How to build Xtend from nothing to where it is today, how to run and deploy
it, and how to change it safely. Keep it current: **every change to the
project updates this guide in the same commit** (see
[Keeping this guide current](#13-keeping-this-guide-current)).

_Last updated: 2026-10-19, after category tabs on the Schedules page._

---

## Contents

1. [What Xtend is](#1-what-xtend-is)
2. [The rules everything follows](#2-the-rules-everything-follows)
3. [What you need](#3-what-you-need)
4. [Set up from zero](#4-set-up-from-zero)
5. [How it was built, stage by stage](#5-how-it-was-built-stage-by-stage)
6. [The database: every migration](#6-the-database-every-migration)
7. [Environment variables](#7-environment-variables)
8. [Scheduled jobs](#8-scheduled-jobs)
9. [The phone apps](#9-the-phone-apps)
10. [Testing and checks](#10-testing-and-checks)
11. [Where things are](#11-where-things-are)
12. [Making a change](#12-making-a-change)
13. [Keeping this guide current](#13-keeping-this-guide-current)
14. [Change log](#14-change-log)
15. [Open items](#15-open-items)

---

## 1. What Xtend is

Field attendance, stock and reporting for Xpel Beauty's merchandisers and
marketers across Nigeria.

| Who | Uses | Does |
|---|---|---|
| Merchandisers, marketers | The Xtend app (Android, iPhone) or Chrome | Clock in and out with a GPS fix and an in-app selfie, check in at stores (marketers), stock counts, daily reports, X Metrics sales, support messages |
| Supervisors | Web dashboard (`/admin`) | Their own team only: attendance, movement, visits, alerts, support, stock counts, notifications, integrity, excuses |
| Admins | Web dashboard (`/admin`) | Everything, plus stores, places, teams, roles, X Metrics setup, audit log, updates |

Three guides exist, one per audience: staff at `/guide` (and in the app),
supervisors at `/admin/supervisor-guide`, admins at `/admin/guide`.

**Stack:** Next.js 15 (App Router, TypeScript, React 19), Tailwind 3,
Supabase (Postgres, Auth, Storage, Realtime, RLS), Vercel (hosting and
cron), Capacitor 8 for the Android and iOS shells, Claude (Anthropic API)
for Ask Xtend, the support helper and invoice reading. Time zone of record:
Africa/Lagos.

## 2. The rules everything follows

These are deliberate. Breaking one is a bug, even if the code works.

1. **Business logic lives in Postgres.** Triggers and `SECURITY DEFINER`
   functions decide status, distance, who may do what, and write audit rows.
   Route handlers are thin: validate with zod, call the database, return.
   React only displays. The client sends only what it observed (coordinates,
   accuracy, photo path, device info, capture time); triggers overwrite
   anything else it tries to set.
2. **RLS decides what anyone sees.** Pages and routes read through the
   caller's own Supabase client (`createServerSupabase()`), so a supervisor
   only ever sees their team. The service-role client
   (`createAdminSupabase()`) is for writes the database cannot do as the user
   (other people's push devices, delivery logs) and is never sent to the browser.
3. **Every admin or supervisor change is audited** with where and on what
   device it was made (`audit()` in `src/lib/audit.ts`; direct inserts carry
   `meta._context`; SQL functions read the `x-xt-audit` header).
4. **Staff are not told how they are monitored.** The staff app and guide
   cover clocking in and out, stock counts, using the app and reporting a
   problem. How location, integrity checks, alerts and excuses work is in the
   admin guide only. The supervisor guide leaves it out too.
5. **Plain English** for Nigerian office and field staff. No jargon, no
   internal ids on screen.
6. **Brand orange only** in charts and accents: `#d1511a` (brand), `#9b3517`
   (deep), `#e8833a` (light), `#52281a` (dark), `#f2b48a`, track `#f6e4d8`.
   Tokens are in `src/app/globals.css`.
7. **Lagos time** for every date and day boundary (`formatLagos`,
   `lagosDateString`, `addDays` in `src/lib/utils.ts`).
8. **Works at 390 px wide** (a phone) with no sideways page scroll.
9. **Nothing is edited or deleted that is a record**: attendance, counts,
   supplies (voided with a reason), audit rows.

## 3. What you need

| Thing | Why |
|---|---|
| Node 22 and npm | Build and run the site (the mobile workflow uses Node 22) |
| A Supabase project | Database, sign-in, photo storage, realtime |
| A Vercel project linked to the GitHub repo | Hosting and scheduled jobs |
| GitHub repo `abahvictor360-sketch/Xtend` | Code, Actions builds the phone apps, the `android` release hosts the APK |
| Anthropic API key | Ask Xtend, the support helper, supply invoice reading (optional; pages show a setup notice without it) |
| Google Maps key (Places API (New), Geocoding API) | Naming the exact shop at clock-in (optional; falls back to OpenStreetMap) |
| VAPID key pair | Web push notifications |
| Firebase project | Android app notifications |
| Apple Developer account (US$99/yr) and a Mac | iPhone app |
| Postgres 16 locally | Running the database tests |
| Java 21 and Android SDK, or just GitHub Actions | Building the Android app |

## 4. Set up from zero

### 4.1 The site

```bash
git clone https://github.com/abahvictor360-sketch/Xtend.git
cd Xtend
npm install
cp .env.example .env.local      # fill in the values (section 7)
```

### 4.2 The database

1. Create a Supabase project.
2. Run every file in `supabase/migrations/` **in number order** in the SQL
   editor (or `psql`, or `supabase db push`). There is no `0051`. Several
   files check that the one before ran and stop with a message if not.
3. Each file ends with a line such as `Audit context (049) installed`; that
   means it worked.

### 4.3 The first admin

There is no public sign-up.

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npx tsx scripts/create-admin.ts "Full Name" admin@example.com 'a-strong-password'
```

### 4.4 Run it

```bash
npm run dev          # http://localhost:3000
```

Location needs a secure context: `localhost` or HTTPS. Sign in as the admin,
then follow the admin guide's "Your first week": outlets, staff, store
allocation, teams.

### 4.5 Deploy

1. Import the repo into Vercel; set the environment variables (section 7)
   for Production.
2. `vercel.json` schedules the jobs (section 8) and pins the functions to
   `dub1` (Dublin), the same region as the Supabase project (`eu-west-1`).
   Every page makes several serial Supabase round-trips, so keeping the
   functions next to the database is what keeps pages fast — a mismatched
   region adds a cross-region hop (~150 ms) to each of those trips. If the
   Supabase project is ever moved, change this region to match.
3. Run any new migrations in Supabase **before or right after** the deploy
   that needs them. A page that needs a missing migration says which one.

### 4.6 Phone apps

See [section 9](#9-the-phone-apps). The short version: set the Android
signing secrets and `GOOGLE_SERVICES_JSON` in GitHub, and every push to
`mobile/` builds the APK and publishes it for `/download`.

## 5. How it was built, stage by stage

Follow these stages in order to rebuild Xtend, or read them to understand why
something is the way it is. Each lists what it adds, its migrations and where
the code lives.

### Stage 1 — Clock in and out (2026-09-09)

- Next.js app with `/field` (staff PWA) and `/admin` (dashboard), sign-in via
  Supabase Auth, middleware that sends signed-out people to `/login`.
- Clock-in and clock-out: a GPS fix plus a selfie taken in the app; a trigger
  sets the person, the day, the distance from their store and the status
  (on site, off site, flagged). Late means after the store's shift start.
- Locked-down RPC surface (0003), the Xpel orange design, the logo.
- Marketer role and tracking coverage (0004–0005); web push with targeting
  (0006); telling the office when staff are not in the store (0007); naming
  the place (0008).
- Migrations 0001–0008. Code: `src/app/field`, `src/components/field/clock-panel.tsx`,
  `src/app/admin`, `public/sw.js` (service worker: offline shell and push).

### Stage 2 — Where people are (2026-09-10 → 09-11)

- Exact premises name from Google Places, with a free fallback (0008, 0015).
- Live map of who is where (0009); store visits for marketers (0010, 0014,
  0016); allocating stores (0011); clock photos deleted after 24 hours (0012).
- Supervisors and their teams; reporting lines kept consistent (0017, 0018).
- Migrations 0009–0018.

### Stage 3 — Ask Xtend and stock counts (2026-09-24)

- **Ask Xtend** (`src/lib/assistant*.ts`): Claude with read-only tools that
  query through the caller's RLS; downloadable reports; store allocation from
  a pasted list or file.
- Store counts, requested by a supervisor or at month end (0019–0021).
- Cheaper map lookups.

### Stage 4 — Making cheating hard (2026-09-25)

- Integrity flags (0022), photo checks for screens, faces and shelves (0023).
- Xtend learns places itself (0024) and refuses houses passed off as shops
  (0025).
- "My network was bad / my phone was off" evidence (0026); no clock-in
  without notifications (0027).
- Movement trail on a map (0028); positions kept offline and sent later with
  checked times (0029).
- Dashboard restyle with a side menu; stores without a location pinned from
  clock-ins (0034 came later in this line of work).

### Stage 5 — Phone apps, VPN checks, support (2026-10-05)

- VPN and fake-location checks (0030); in-app support with the Xtend helper
  (0031).
- Capacitor shells in `mobile/` loading the live site, with native location
  integrity (mock GPS, rooted phone; 0032) and native push (0033).
- `/download` page; GitHub Actions builds the APK and publishes it on the
  `android` release.

### Stage 6 — Guides, onboarding, counts on paper, security (2026-10-06)

- Staff and admin guides; profile photos and first-run onboarding (0037).
- Paper count sheets (0035); supervisors told about late, early and suspicious
  activity (0036).
- Push only to real push services (0038); a forged caller IP no longer
  trusted.

### Stage 7 — Forms, roles, X Metrics (2026-10-07 → 10-08)

- Every form field checked for what it asks for (0039).
- The Xpel stock count sheet (0040); staff login sheet as Word (0041); roles
  an admin adds (0042).
- **X Metrics** (0043–0044): supplies, batch counts, daily sales,
  reconciliation, expiry alerts, monthly grades, scoring policy. Code:
  `src/lib/metrics`, `src/app/admin/metrics`, `src/components/admin/xm`,
  `src/components/field/xm-*.tsx`, `/api/cron/metrics`.
- Naming an unknown place is mandatory, with a sign photo and a selfie with a
  product, and locations locked from several GPS readings (0045).
- Roles that take stock counts (0046); supplies in cartons and imported from
  invoices (0047).

### Stage 8 — Advanced dashboard pages (2026-10-08)

- Check an excuse (0048), Audit log with location and device (0049), Movement
  over several days, Ask Xtend proposing actions you approve.
- Location for the whole shift even with the app closed (0050, 0055): a
  native tracker with per-phone tokens (`/api/track/*`,
  `mobile/android/.../ShiftTracker*.java`, `mobile/ios/App/App/ShiftTracker.swift`).
- Attendance, Analytics, Store visits, Alerts (0052), Support, Notifications
  (0053), Integrity, Ask Xtend saved chats (0054).

### Stage 9 — Speed, updates, audiences (2026-10-12 → 10-14)

- Faster dashboard and field loading; the field dashboard live-updates with
  Supabase realtime (0056), carried by per-user Broadcast from database
  triggers (0058) so the connection count scales to thousands on shift.
- Store clock-in and clock-out times set by admins (and Ask Xtend).
- **Updates** (0057): pages notice a new deploy and offer to reload; phone
  apps are offered the new build or required to install it; admins publish
  "What's new" (`src/components/update-manager.tsx`, `/admin/updates`).
- Guides split by audience: staff (clock in/out, stock count, using the app,
  reporting a problem), supervisors, admins (everything, including how
  tracking works).

### Stage 10 — Schedules, leave, marketer reports (2026-10-16)

- **Work schedules and leave** (0059): each person has a weekly pattern
  (Mon–Sat unless changed) and one-off changes; staff ask for leave in the app
  (`/field/leave`) and the office decides it (`/admin/leave`, `/admin/schedules`).
  Approved leave, then a one-off change, then the pattern decide whether a day
  is a working day (`day_kind`). Missed working days show red on the staff
  calendar, days off grey, leave soft orange. Attendance, Analytics, the
  absence sweep (now daily) and Ask Xtend never count days off or leave as
  absent (`src/lib/schedule.ts`, `schedule-server.ts`).
- **Marketer stores and reports** (0060): once someone has allocated stores
  they can only check in at those (`my_visit_stores`, `store_visit_enforce`);
  the daily report shows and keeps the day's store visits
  (`reports.store_visits`, set by the database); `/admin/marketer-reports`
  downloads each person's day or month report as a designed PDF, Word or Excel
  (`src/lib/marketer-report*.ts`, `src/lib/export/marketer-report*.ts`).
- **Clock-out reminders** (0061): at the end of the shift the alerts job
  pushes "Time to clock out", and again an hour later; the home screen shows a
  **Clock out** prompt (`src/lib/clock-out-reminder*.ts`,
  `src/components/field/clock-out-prompt.tsx`).

## 6. The database: every migration

Run in this order. Tests run them the same way (`scripts/test-sql.sh`).

| # | What it adds |
|---|---|
| 0001 | Tables, RLS, storage buckets, retention |
| 0002 | Heartbeat, supervisors, views, audit |
| 0003 | RPC grants locked down |
| 0004 | How much of a shift was tracked |
| 0005 | Marketer role |
| 0006 | Push notifications |
| 0007 | Telling the office without being asked (no-show) |
| 0008 | The name of the place |
| 0009 | Live locations |
| 0010 | Store visits |
| 0011 | Store allocation |
| 0012 | Clock photos kept 24 hours |
| 0013 | Trigger hardening |
| 0014 | Check in without naming the store |
| 0015 | The map names the store |
| 0016 | A marketer's day without allocation |
| 0017 | Supervisors manage their own staff |
| 0018 | Reporting line upkeep |
| 0019 | Store counts |
| 0020 | Counts on request or at month end |
| 0021 | Products typed while counting |
| 0022 | Integrity checks and flags |
| 0023 | Photo checks |
| 0024 | Known places Xtend learns |
| 0025 | No houses passed off as shops |
| 0026 | Phone evidence for excuses |
| 0027 | No clock-in without notifications |
| 0028 | Movement trail |
| 0029 | Offline positions |
| 0030 | VPN and location manipulation |
| 0031 | Support messages |
| 0032 | Native integrity flags |
| 0033 | Native push |
| 0034 | Stores pinned from clock-ins |
| 0035 | Paper count sheets |
| 0036 | Supervisor alerts |
| 0037 | Profile photos and onboarding |
| 0038 | Push endpoint guard |
| 0039 | Field rules (what each field accepts) |
| 0040 | Xpel stock count sheet |
| 0041 | Staff login sheet |
| 0042 | Roles an admin adds |
| 0043 | X Metrics |
| 0044 | X Metrics scoring policy |
| 0045 | Mandatory place naming |
| 0046 | Which roles take stock counts |
| 0047 | Supplies in cartons and imported |
| 0048 | Check an excuse, advanced |
| 0049 | Audit context: location, device, IP, VPN |
| 0050 | Background tracking tokens |
| 0051 | _(none — skipped)_ |
| 0052 | Store visits and alerts, advanced |
| 0053 | Support inbox and notifications, advanced (also fixes office replies) |
| 0054 | Integrity bulk review, Ask Xtend chats |
| 0055 | Positions after clock-out refused |
| 0056 | Realtime for the field dashboard |
| 0057 | Updates: releases, installs |
| 0058 | Realtime via per-user Broadcast triggers (scale) |
| 0059 | Work schedules, one-off changes, leave requests; absence skips days off and leave |
| 0060 | Marketers check in only at their own stores; visits kept with the daily report |
| 0061 | Clock-out reminders at the end of the shift |

## 7. Environment variables

Set in `.env.local` for development and in Vercel for production.

| Variable | Needed | What for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser and server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only writes; never in the browser |
| `CRON_SECRET` | Yes | Bearer token the scheduled jobs must send |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Yes for web push | Generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `ANTHROPIC_API_KEY` | Optional | Ask Xtend, support helper, invoice reading |
| `GOOGLE_MAPS_API_KEY` | Optional | Shop names at clock-in |
| `GEOCODER_USER_AGENT` | Recommended | Contact string for OpenStreetMap's policy |
| `FIREBASE_SERVICE_ACCOUNT` | For Android push | Firebase service account JSON |
| `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` (`APNS_BUNDLE_ID`, `APNS_SANDBOX`) | For iPhone push | Apple push key |
| `IOS_APP_URL`, `IOS_LATEST_BUILD` | When the iPhone app is out | Download link and newest build for update prompts |
| `ANDROID_APK_URL`, `ANDROID_LATEST_BUILD` | Optional | Override the GitHub-hosted APK (e.g. Play Store) |
| `APP_VERSION`, `APP_RELEASE_REPO` | Optional | Version shown on `/download`; repo whose `android` release holds the APK |
| `CREDENTIALS_WEBHOOK_URL`, `CREDENTIALS_WEBHOOK_TOKEN` | Optional | Relay that sends temporary passwords by SMS or email |
| `TRUSTED_PROXY_HOPS` | Optional | 1 behind Vercel/Nginx, 2 with Cloudflare in front |
| `IP_API_KEY`, `IP_GEO_URL`, `IP_GEO_DISABLED` | Optional | IP lookup for VPN checks and the audit log |
| `XTEND_BUILD_ID` | Optional | Build id outside Vercel (Vercel sets `VERCEL_DEPLOYMENT_ID`) |
| `NEXT_PUBLIC_REALTIME_DISABLED` | Optional | Set `1` to turn the client realtime sockets off fleet-wide and ride the safety poll instead — the release valve when Supabase's concurrent-connection cap is the bottleneck under heavy load |

## 8. Scheduled jobs

All need `Authorization: Bearer $CRON_SECRET`.

| Path | When | Does |
|---|---|---|
| `/api/cron/purge-selfies` | 02:20 UTC daily | Deletes clock photos older than 24 hours |
| `/api/cron/absence-sweep` | 08:30 UTC daily | Tells the office who has not clocked in (skips anyone on a day off or on leave, 0059) |
| `/api/cron/alerts` | Every 5 minutes | Sends unsent integrity flags, scheduled notifications, clock-out reminders (at shift end and an hour later, 0061), and hourly the X Metrics checks |
| `/api/cron/metrics` | Optional, hourly | X Metrics checks on their own schedule |

The two daily jobs are in `vercel.json`. The Vercel Hobby plan only allows
once-a-day crons, so the five-minute `alerts` job is **not** in `vercel.json`
(it would make every deploy fail with `cron_jobs_limits_reached`); instead it
runs from `.github/workflows/alerts-cron.yml` (a GitHub Actions schedule that
curls the endpoint with `CRON_SECRET`, set as a repo secret). On Vercel Pro you
can move it back into `vercel.json` and delete that workflow. On a VPS, run it
from the server's crontab instead:

```
0-59/5 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/alerts
```

## 9. The phone apps

`mobile/` is a Capacitor 8 project. The apps load the live site, so a web
deploy reaches phones at once; a new app build is needed only when something
in `mobile/` changes.

- **Native code:** `LocationIntegrity` (one fix plus mock-GPS and root
  checks) and `ShiftTracker` (location for the whole shift, with the app
  closed) in `mobile/android/app/src/main/java/ng/xpelbeauty/xtend/` and
  `mobile/ios/App/App/`. Registered in `MainActivity.java` and
  `XtendViewController.swift`. A new iOS Swift file must also be added to
  `App.xcodeproj/project.pbxproj`.
- **Builds:** `.github/workflows/mobile.yml` runs on **every push to every
  branch**: a debug APK always, a signed APK and Play bundle when the
  secrets are set, and an iOS simulator build (downloadable as a zip from the
  run). On the default branch it publishes `xtend.apk` on the `android`
  release, which `/download` links to.
- **Version numbers** go up only when the phone app itself changes: the
  version code is 100 + the number of commits that changed `mobile/` or the
  workflow (`1.0.<code>`). A website-only change rebuilds the APK with the
  same version, so the app's update prompt does not ask staff to reinstall.
- **GitHub secrets:** `GOOGLE_SERVICES_JSON`, `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **iPhone:** needs the Apple steps in `mobile/README.md` (Xcode archive →
  TestFlight), then `IOS_APP_URL` and `IOS_LATEST_BUILD` in Vercel.
- Full details: `mobile/README.md`.

## 10. Testing and checks

Run all of these before pushing. CI builds the phone apps; the rest is on you.

```bash
npx tsc --noEmit -p .
npx eslint src scripts --quiet
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build
```

**Database tests** need a throwaway Postgres 16 (the script wipes it):

```bash
PGURL=postgres://postgres@localhost:5433/postgres bash scripts/test-sql.sh
```

It loads `supabase/tests/supabase_stub.sql` (a stand-in for Supabase's auth,
storage and realtime), every registered migration, then
`supabase/tests/rules.sql` (rules, as superuser) and
`supabase/tests/rls_counts.sql` (row-level security, as the `authenticated`
role). It must end with `ALL RULES PASSED` and `ALL RLS CHECKS PASSED`.
Migrations 0056 and 0058 run in the harness too: the stub includes a minimal
realtime schema (`realtime.send` records each broadcast in
`realtime.messages`, `realtime.topic()` reads the subscriber's topic), so the
tests check that each change is announced only on its owner's
`field:<uid>` topic, carries no row data, and that nobody can read another
member's topic.

**Logic checks** (no database). Each ends with an "ALL … PASSED/OK" line, except
`check-push-endpoints`, which lists each case it checked (any `FAIL` line is a
failure):

```bash
for s in check-allocate check-assistant-actions check-attendance check-audit \
         check-excuses check-exports check-fields check-geo check-integrity-ask \
         check-movement check-push-endpoints check-supply-import \
         check-support-notifications check-updates check-visits-alerts check-xm-exports \
         check-schedules-leave check-marketer-reports check-clock-out-reminder; do
  npx tsx --tsconfig tsconfig.scripts.json scripts/$s.ts | tail -1
done
```

**Looking at a page** without a database: put a temporary page under
`src/app/guide/<name>/page.tsx` (public) with sample data, run
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next dev`,
screenshot it at 1280 px and 390 px (Playwright), then delete the page and
`.next` before committing.

## 11. Where things are

```
src/app/field/…           Staff app pages (home, count, report, metrics, history, account, support, guide)
src/app/admin/…           Dashboard pages, one folder per menu item
src/app/api/…             Route handlers (field, admin, cron, track, version, push, support)
src/app/guide, download   Public staff guide and app download page
src/components/field/…    Staff app components (clock panel, heartbeat, shift tracker, forms)
src/components/admin/…    Dashboard components
src/components/ui/…       Buttons, cards, inputs, badges, tables
src/lib/…                 Shared logic: auth, audit, geo, integrity, movement, assistant,
                          exports (export/), X Metrics (metrics/), offline outbox (offline/)
src/middleware.ts         Session refresh and sign-in redirects
public/sw.js              Service worker: offline shell, web push
supabase/migrations/      The database, in order
supabase/tests/           Database tests and the Supabase stand-in
scripts/                  Admin bootstrap, logic checks, SQL test runner
mobile/                   Capacitor Android and iOS apps
docs/                     This guide, LOCATION-INTEGRITY.md, and rebuild/ (the rebuild pack)
.github/workflows/        Phone app builds
```

## 12. Making a change

1. **Branch** from the main branch (`claude/new-session-sgmxdg`).
2. **Database change?** Add the next numbered file in `supabase/migrations/`
   (never edit one that has run in production), register it in
   `scripts/test-sql.sh`, add assertions to `supabase/tests/rules.sql`
   (before the final `end;` that precedes `ALL RULES PASSED`) and RLS checks
   to `rls_counts.sql` for new tables. End the file with a
   `select '… (0NN) installed' as result;` line.
3. **New table?** Enable RLS and write policies: admins all, supervisors
   their team (`supervises_user`), staff their own or nothing.
4. **New write route?** `requireApiSession([...])`, zod, the database decides
   permissions, `audit(...)` the change.
5. **New logic?** Put it in `src/lib/` as plain functions and add a check
   script in `scripts/`.
6. **New page?** Add it to `src/components/admin/admin-nav.tsx` (`adminOnly`
   or `supervisorOnly` as needed) and to the right guide.
7. **Words staff see:** only what they need to do. Never explain monitoring.
8. Run the checks in section 10.
9. **Update the docs in the same commit:** this guide (section 14 at least),
   the README migration list for a migration, and the admin, supervisor or
   staff guide for anything people see.
10. Open a PR into the main branch and merge it once the checks pass (the
    owner asked for every change to be merged and pushed straight away);
    then run any new migrations in Supabase.

## 13. Keeping this guide current

This guide is part of the code. Any change that adds or changes a feature,
a migration, an environment variable, a scheduled job, a page, a check
script or a setup step must update it **in the same commit or PR**:

- add a line to the [change log](#14-change-log) (date, what changed,
  migration);
- update the section it touches (5 for a new stage or feature, 6 for a
  migration, 7 for a variable, 8 for a job, 9 for the apps, 10 for a check,
  11 for a new folder, 15 for anything left to do);
- change the "Last updated" line at the top;
- keep the **rebuild pack** current: update the spec in `docs/rebuild/` the
  change touches and rerun `scripts/rebuild-pack.ts` (see
  `docs/rebuild/00-START-HERE.md` §7).

`CLAUDE.md` at the root repeats this rule for anyone (or any AI assistant)
working on the project.

## 14. Change log

Newest first. Dates are when the work landed on the main branch.

| Date | Change | Migration |
|---|---|---|
| 2026-10-19 | Schedules page: category tabs (All, Merchandisers, Marketers) and chips for the usual Mon–Sat week or their own week | — |
| 2026-10-16 | Clock-out reminders: a push at the end of the shift ("Time to clock out") and one an hour later, from the alerts job, plus a **Clock out** prompt at the top of the home screen (check out of the store first) | 0061 |
| 2026-10-16 | Marketers: the store list shows only their allocated stores and check-ins elsewhere are refused once they have any; the daily report shows and keeps the day's visits; new **Marketer reports** page with day and month PDF, Word and Excel downloads | 0060 |
| 2026-10-16 | Work schedules and leave: weekly patterns and one-off changes (`/admin/schedules`), leave requests in the app and decisions on `/admin/leave`; missed working days red on the staff calendar; absence everywhere follows schedules and leave; absence sweep now daily | 0059 |
| 2026-10-16 | Alerts cron names its failure (401 means `CRON_SECRET` differs between GitHub and Vercel) | — |
| 2026-10-16 | Moved the every-5-minute `alerts` cron out of `vercel.json` (the Hobby plan rejects sub-daily crons, which was blocking all deploys) into a GitHub Actions schedule (`.github/workflows/alerts-cron.yml`) hitting the endpoint with `CRON_SECRET`; the two daily crons stay on Vercel | — |
| 2026-10-16 | Location agreement floor raised 30 m → 50 m (`fixesAgree`), so normal standing-still GPS jitter no longer trips the "your location jumped" block when adding a place; spoof detection is unaffected (a real spoof is far larger) | — |
| 2026-10-15 | PWA push parity: if a browser drops the push subscription while permission is still granted, the app re-subscribes silently on load (as the native app re-registers each start), so web alerts do not quietly lapse | — |
| 2026-10-15 | Admins can delete a staff account (DELETE `/api/admin/users/<id>`): removes the auth account, cascading the profile; refused with 409 when they have attendance (or other ON DELETE RESTRICT) history, and no self-delete. Supervisors cannot delete | — |
| 2026-10-15 | Notifications card: a blocked device gets concrete steps to re-allow it in browser settings and a **Check again** button to pick up the change (the app cannot re-ask once blocked) | — |
| 2026-10-15 | Speed: Vercel functions pinned to `dub1` (Dublin), co-located with the Supabase project (`eu-west-1`), so each page's serial DB round-trips no longer cross the Atlantic | — |
| 2026-10-14 | Admins can delete an outlet (trash icon → confirm → DELETE `/api/admin/outlets/<id>`; refused with 409 when it has visit/count/metrics history) and search the outlet list | — |
| 2026-10-14 | Tests and rebuild pack cover realtime (0056, 0058): the Supabase stub has a minimal realtime schema; the pack's database now includes 0058 and the realtime access rule | — |
| 2026-10-14 | Realtime scale fix: the field dashboard and support chat now ride per-user Broadcast (`field:<uid>`) from database triggers instead of Postgres Changes, so Supabase compute holds far more connections. Only on-shift members hold a socket | 0058 |
| 2026-10-14 | Load test (`load-test/`): k6 script for ~5,000 field staff (edge baseline, dashboard RPC poll, realtime connection ceiling, opt-in clock-in write burst) plus run and infra-sizing notes. Scale mitigations: fleet-wide realtime kill-switch (`NEXT_PUBLIC_REALTIME_DISABLED`), jittered safety poll, faster poll when realtime is off or has failed | — |
| 2026-10-14 | Both phone apps build on every push; Android version only goes up when the app itself changes; iOS simulator build kept as a download | — |
| 2026-10-14 | Fix: supervisors can download X Metrics reports for their team (the links were shown but refused) | — |
| 2026-10-14 | Fix: merchandisers with more than one store can check in at store visits (the visit routes now leave the decision to the database) | — |
| 2026-10-14 | Rebuild pack (`docs/rebuild/`): a complete spec any AI can rebuild Xtend from, with the exact database generated from the migrations and verified against the tests | — |
| 2026-10-14 | Supervisor guide; admin guide admins-only and page by page; this build guide | — |
| 2026-10-14 | Staff app and guide cut to what staff need | — |
| 2026-10-14 | Updates: new-version banner, required updates, What's new, Updates page | 0057 |
| 2026-10-14 | Store clock-in/out times set by admins and Ask Xtend; onboarding and chart polish; one Export menu on Attendance | — |
| 2026-10-13 | Field dashboard live via Supabase realtime; faster navigation; profile photo from gallery | 0056 |
| 2026-10-12 | Faster dashboard and mobile loading | — |
| 2026-10-08 | Positions after clock-out refused | 0055 |
| 2026-10-08 | Advanced Attendance, Analytics, Store visits, Alerts, Support, Notifications, Integrity, Ask Xtend | 0052–0054 |
| 2026-10-08 | Location for the whole shift with the app closed | 0050 |
| 2026-10-08 | Ask Xtend proposes actions; Movement over several days; Audit log with location and device; Check an excuse advanced | 0048–0049 |
| 2026-10-08 | Supplies in cartons and imported; stock counts by role or team; X Metrics dashboard | 0046–0047 |
| 2026-10-08 | Mandatory place naming; GPS locked from several readings | 0045 |
| 2026-10-07 → 08 | X Metrics and its scoring policy | 0043–0044 |
| 2026-10-07 | Field rules, Xpel count sheet, staff login sheet, custom roles | 0039–0042 |
| 2026-10-06 | Guides, onboarding and profile photos, paper count sheets, supervisor alerts, push and IP hardening | 0035–0038 |
| 2026-10-05 | VPN checks, support messages, Android and iOS apps, download page | 0030–0033 |
| 2026-09-25 | Integrity flags, photo checks, learned places, excuse evidence, notifications required, movement trail, offline positions, stores pinned from clock-ins | 0022–0029, 0034 |
| 2026-09-24 | Ask Xtend, store counts and count requests | 0019–0021 |
| 2026-09-10 → 11 | Live locations, store visits, allocation, photo retention, supervisors and teams | 0009–0018 |
| 2026-09-09 | First build: clock in and out, dashboard, marketer role, push, no-show alerts, place names | 0001–0008 |

## 15. Open items

- **iPhone app** is not yet on TestFlight or the App Store (needs the Apple
  account steps); until then iPhone staff use Chrome/Safari and get site
  updates only.
- **Five-minute job** (`/api/cron/alerts`): runs from GitHub Actions and needs
  the `CRON_SECRET` repo secret to match Vercel's exactly (a 401 means they
  differ). Until it runs, scheduled notifications show as "Late" and
  clock-out reminders are not sent. GitHub's schedule is best-effort.
- **Clock-out reminders** ignore schedules: they go to anyone clocked in and
  not out, which covers someone working on a day off.
- **Android signing secrets**: until they are set, the published APK is a
  debug build and each update needs the old app uninstalled first.
- Migrations to run in production after each merge: check the change log
  above against what has been run in Supabase.
