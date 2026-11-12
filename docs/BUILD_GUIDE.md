# Xtend build guide

How to build Xtend from nothing to where it is today, how to run and deploy
it, and how to change it safely. Keep it current: **every change to the
project updates this guide in the same commit** (see
[Keeping this guide current](#13-keeping-this-guide-current)).

_Last updated: 2026-11-11, after the app-only page no longer showing inside the app, movement saved with no signal being kept when it arrives after the clock-out (0085), marketers needing to clock in before a store check-in and store visits being confirmed, a clock-in or out only being called done once the database has it, admins being able to require the phone app instead of the web (0084), supervisors, HR and admins being able to open photos and review unchecked ones (0083), the phone app being required to run in the background before a clock in or out, resets keeping places and new-app notices (0081, 0082), downloads in the Android app, Google first again with every event saving its place, OpenStreetMap first for new places, location required for store visits, a forgiving VAPID_SUBJECT (a typo no longer stops all push or the alerts job), the alerts job message, the staff guide's install questions, the move to www.withxtend.com, the phone app's No connection page fix, the Android signing key check, the Android install help on the download page and zero trust: two-step sign-in for admins and HR, office sign-in limits, the origin check on changes, the password again before risky Staff actions and new-device alerts (0080); see earlier entries for 2026-11-08 and before._

---

## Contents

1. [What Xtend is](#1-what-xtend-is)
2. [The rules everything follows](#2-the-rules-everything-follows)
3. [What you need](#3-what-you-need)
4. [Set up from zero](#4-set-up-from-zero) (bots: [4.8](#48-bots), security: [4.9](#49-security))
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
| Merchandisers, marketers | The Xtend app (Android, iPhone) or Chrome | Clock in and out with a GPS fix and an in-app selfie, check in at stores (marketers), stock counts, daily reports, X Metrics sales, messages to their supervisor, support messages |
| Supervisors | Web dashboard (`/admin`) | Their own team only: attendance, movement, visits, alerts, messages, support, stock counts, notifications, integrity, excuses |
| HR | Web dashboard (`/admin`) | Every staff member but admins: staff details, attendance and lateness, analytics, leave (decide), schedules, exports, messages; adds and deactivates merchandisers and marketers. No settings, stores, X Metrics, movement, alerts or integrity |
| Admins | Web dashboard (`/admin`) | Everything, plus stores, places, teams, roles, X Metrics setup, audit log, activity log, updates |

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
| Apple Developer account (US$99/yr); a Mac only for building by hand | iPhone app |
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

**On a Hostinger VPS with Dokploy or Coolify** (Docker): follow
`deploy/DOCKER.md`: server hardening first, then the repository's
`Dockerfile` (standalone Next.js server, non-root, its own health check),
build arguments for the `NEXT_PUBLIC_*` values, runtime environment for
secrets, and the scheduled jobs as the panel's scheduled tasks
(`node run-job.mjs alerts` and so on, `docker/run-job.mjs`).

**On a Hostinger VPS with PM2 and Nginx** (no panel): follow `deploy/README.md`.
In short:

- `deploy/setup-server.sh` sets up a fresh Ubuntu server once: Node 22, PM2,
  Nginx with HTTPS, firewall, automatic updates, swap, UTC clock, the
  `xtend` user, and the scheduled jobs in its crontab.
- Settings live in `/var/www/xtend/shared/.env.production`.
- `.github/workflows/deploy-vps.yml` deploys every push to the main branch
  over SSH with `deploy/deploy.sh`. That script builds the commit in its own
  `releases/<build>` folder, switches the `current` symlink and reloads PM2
  one process at a time. It rolls back if `/api/version` does not answer
  with the new build id.
- Choose a European data centre near the Supabase database in Ireland.
- Set the repository variables `APP_URL` (the site the phone apps open) and
  `JOBS_ON_VPS=true`, so the GitHub alerts job stands down.
- `vercel.json` is ignored there.

### 4.6 Test run and reset

Migration 0066 starts Xtend in **test mode** (a dark orange strip across the
admin dashboard: "Test mode: records can be reset"). For the test run:

1. Run 0066 in Supabase. Set up stores and staff and use Xtend in the places
   you want to try, as for real.
2. To start again, an admin opens **Setup → System**, ticks what to clear (or
   **Select everything (start completely fresh)**), clicks **Review what will
   be deleted**, types `RESET` and their own password, and clicks **Reset now**.
   Choices bring their dependencies (Staff accounts → everything they
   recorded; Stores → their visits, counts, X Metrics records, allocations).
   If many photos were stored, click **Finish removing files** until none are left.
3. When the test run is over, click **We are live — turn off test mode** and
   type `WE ARE LIVE`. This is permanent: the database refuses turning test
   mode back on, and the reset is gone.

Always kept: admin accounts (with their sign-ins and profile photos), the
product list and the set-up tables (see 0066 in section 6 and
`docs/rebuild/30-rules.md` §16b for every table). The audit log gains one
`system.reset` row per reset; clearing the audit log leaves only that row.

### 4.7 Phone apps

See [section 9](#9-the-phone-apps). The short version: set the Android
signing secrets and `GOOGLE_SERVICES_JSON` in GitHub, and every push to
`mobile/` builds the APK and publishes it for `/download`.

### 4.8 Bots

Xtend is a private staff app, so no bot may use it. In layers:

1. **Never indexed**: `/robots.txt` (`src/app/robots.ts`) disallows
   everything for every agent; every response carries
   `X-Robots-Tag: noindex, nofollow, noarchive` (`next.config.ts`); every
   page has `<meta name="robots" content="noindex, nofollow">` (root layout).
   `/download` still opens for people, it is just never listed.
2. **Bot user agents refused** (`src/lib/bot-guard.ts`, run first in
   `src/middleware.ts`, production only so `next dev` screenshots keep
   working): an empty user agent, search engines, SEO and AI crawlers, link
   previewers (WhatsApp, Facebook…), scripting tools (curl, wget,
   python-requests, Go, Java, okhttp, axios, Postman…) and browser
   automation (HeadlessChrome, Puppeteer, Playwright, Selenium), plus
   anything calling itself a bot, crawler, spider or scraper, get a 403
   with a one-line plain-text answer. **Always allowed**: real browsers, the
   Xtend apps (`XtendApp` in the agent, Android WebView and iPhone),
   Vercel's own `vercel-*` requests, and, whatever the agent,
   `/api/cron/*` (CRON_SECRET), `/api/track/*` (the background tracker's
   token; old app builds send Java's and iOS's default agents),
   `/api/health`, `/api/version` (Docker HEALTHCHECK, `deploy.sh`,
   monitors: point uptime monitors at `/api/health`), `robots.txt`, the
   service worker, manifest and static files. "Cubot" (a phone brand) is not
   mistaken for a bot. A user agent can be faked, so this only stops the
   honest and the lazy; the rest is below.
3. **Human check on sign-in** (optional): with `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   and `TURNSTILE_SECRET_KEY` set, `/login` shows Cloudflare Turnstile
   (managed mode, interaction only: most people see nothing) and
   `/api/auth/sign-in` confirms the token with Cloudflare
   (`src/lib/turnstile.ts`) before the password is checked; a missing or bad
   token gets "Please confirm you are not a robot and try again." If the
   widget cannot load, the form shows **Try again**. Without both keys
   sign-in works as before. The sign-in lockout (0077) still applies.
   Get the keys free at Cloudflare → Turnstile → Add site (the site's
   domain, Managed); on Docker the site key is also a build argument.
   Change-password needs a session already, so it has no check.
4. **At the platform** (settings, no code): on Vercel, Firewall → Bot
   Management: turn on **Bot Protection** and **AI Bots** (block); during an
   attack, **Attack Challenge Mode**. On the Hostinger VPS, put Cloudflare's
   proxy (orange cloud) in front and turn on **Security → Bots → Bot Fight
   Mode**; then set `TRUSTED_PROXY_HOPS=2` (and on Traefik, trust
   Cloudflare's addresses first, `deploy/DOCKER.md`). Bot Fight Mode may
   challenge the scheduled jobs' curl calls from GitHub Actions: if a job
   starts failing with 403, add a Cloudflare WAF skip rule for
   `/api/cron/` and `/api/track/` (or run the jobs on the server).

### 4.9 Security

What protects Xtend beyond sign-in and RLS (each has a test: `rules.sql`,
`rls_counts.sql` or `scripts/check-security-fixes.ts`):

- **Who edits whom**: admin, supervisor and HR changes to an account ask
  Postgres first (`can_edit_staff`, `can_create_staff`, 0017) as the caller,
  and a supervisor only ever reaches merchandisers and marketers on their
  team. Only field staff have a supervisor: promoting somebody to
  supervisor, HR or admin clears the link (0079 trigger), so nobody keeps
  power over a person promoted above them.
- **Files**: message attachments open only for their sender and whoever may
  read the message (0079 `message_file_readable`); report documents follow
  the same idea (0064). Photos in the `reports` bucket are never
  overwritten (no update policy). Every storage path a phone sends is
  checked with `isOwnStoragePath` (`src/lib/storage-path.ts`): the caller's
  own folder, plain names only, no `..`.
- **Usage limits** (`src/lib/usage-limits.ts`, per person per hour, kept in
  the server process): 60 photo checks, 120 place lookups (`/api/geocode`,
  field roles only), 20 support helper replies (after that, or after 12
  messages in one conversation, the office answers), 60 Ask Xtend
  questions. Google place requests stop at `GOOGLE_MONTHLY_LOOKUP_LIMIT`,
  20,000 a month unless set.
- **Passwords**: changing a password needs the current one, except the
  first change after the office set a temporary one; until that change,
  every API call but the change itself (and sign-out, push and version
  calls) answers 403 `change_password`. Sign-in takes as long for an unknown
  phone number as for a wrong password.
- **What callers are told**: database and account-service errors are put in
  plain words (`dbErrorMessage`, `authAdminError`); `/api/health` publicly
  says only `{ ok, checked_at }` (the configuration list needs
  `Authorization: Bearer <CRON_SECRET>`); downloads check the format before
  anything is audited; CSV cells that would run as a formula start with `'`.
- **Secrets**: `.env` and `.env.*` are ignored by git (except
  `.env.example`, which lists every setting blank) and by AI tools
  (`.claudeignore`, `.cursorignore`, `.aiexclude`); `CLAUDE.md` tells any
  assistant never to read or print them.

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
  0016); allocating stores (0011); clock photos deleted after 24 hours (0012; 14 days since 0067).
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
- **Five-minute heads-ups** (0069): five minutes before the shift starts the
  alerts job pushes "Time to clock in" ("Your shift at <store> starts at
  HH:MM. Clock in with a selfie when you arrive.") to field staff with a
  working day who have not clocked in; five minutes before it ends, "Your
  shift ends at HH:MM. Get ready to clock out with a selfie." to those
  clocked in. Each at most once a day, only inside its five minutes (a late
  job skips it; the at-end reminder covers clock-out), never on a day off or
  leave, never for admins or supervisors. The home screen shows a gentle
  "Your shift starts at HH:MM. Clock in when you arrive." card with a
  **Clock in** button, and a heads-up line before the end
  (`src/lib/shift-reminder*.ts`, `src/components/field/shift-soon-prompt.tsx`).
- **Activity log** (0062, admins only, `/admin/activity`): what everyone does
  in Xtend with time, device, platform and IP. Sign-ins (`/api/auth/sign-in`),
  sign-outs and app opens (`POST /api/activity`, `ActivityPing` in the field
  and admin layouts; one app open per person and platform per 30 minutes),
  password changes (`POST /api/auth/password`) and profile photos
  (`set_my_avatar`) go in `user_activity`; `activity_feed()` adds clock-ins,
  visits, reports, counts, leave and support messages from their own tables.
  Recorded silently: staff are never told. Downloads in four formats, audited
  as `export.activity.<fmt>` (`src/lib/activity-*.ts`,
  `src/components/admin/activity-view.tsx`).
- **X Metrics feature switches** (0063, admins, the **Features** card at the
  top of `/admin/metrics/settings`): the whole module and four parts, each on
  or off, saved through `xm_set_features` (history kept, audited
  `xm.features.update`). **Expiry** (expiry date box, alerts and pushes,
  Expiry page, expiry in grades), **Supplies** (Supplies page, imports),
  **Grading** (Grades and Scoring policy pages, finalising, staff score),
  **Sales** (staff sales form, sales figures, targets, Targets page).
  Reconciliation needs Supplies and Sales; when both come back on it restarts
  from that day (`xm_settings.reconcile_from`) so nobody is flagged for the gap.
  Off hides the part (sub-navigation, overview tiles, staff tabs, downloads,
  Ask Xtend tools, marketer report sales) and the database refuses or skips
  its work (`xm_feature_on`, `xm_feature_guard` triggers); nothing is
  deleted. With the module off, X Metrics leaves supervisors' menus and the
  staff app; admins keep a menu item marked "off" that opens Settings. A
  switched-off page reached by a link says so (`src/lib/metrics/features.ts`,
  `features-server.ts`, `src/components/admin/xm/features-form.tsx`,
  `switched-off.tsx`, `src/app/admin/metrics/layout.tsx`).
- **Stock count sheet on the You page** (0064): anyone whose role takes stock
  counts and who has a store (merchandisers, and marketers whose role counts)
  sees a **Stock count sheet** section on `/field/account` at any time: download
  this month's Xpel sheet for their store as Excel, fill it, upload it back as
  the Excel file, a PDF or a photo, and see what they sent this month with what
  it was for. It reuses `CountSheetPanel` and the same routes
  (`/api/store-counts/template`, `/api/store-counts/sheets`). `submit_count_sheet`
  no longer needs a count to be due: a sheet sent while one is open still counts
  towards it; one sent at another time is kept with `count_was_due = false` and
  counts towards nothing. Not tied to the X Metrics switches (store counts are
  not X Metrics). Office: Stock count → Count sheets has a **For** column
  (Requested count, Month-end count, Sent any time).
- **Documents on the daily report** (0064): an **Attach documents** area on
  `/field/report` (`src/components/field/report-files.tsx`, rules in
  `src/lib/report-files.ts`): PDF, Word, Excel, CSV or pictures, up to 5, 10 MB
  each, listed with name and size, removable before saving and afterwards until
  the report locks at midnight Lagos. They travel with the report through the
  offline outbox into the private `report-files` bucket and are registered by
  `add_report_file` (limits, type allowlist, own folder, today's report only);
  `remove_report_file` takes one off on the day (`DELETE /api/report-files/<id>`).
  Office: Marketer reports has a **Documents attached** card with Download links
  (`GET /api/report-files/<id>`: RLS-checked, 5-minute signed link, audited
  `report_file.download`); the day/month PDF, Word and Excel and Ask Xtend's
  field reports list them by name.
- **Report documents offline** (0065): removing a saved document works with
  no signal: it is queued in the outbox (`report_file_remove`), reads
  **Removing…** at once and is sent when the phone is back online. A removal
  that arrives after midnight is refused (`remove_report_file` hint
  `report_locked`, `DELETE /api/report-files/<id>` 409 `locked`), dropped
  from the queue, and the report page says "This document could not be
  removed because the report closed at midnight." next time it is open
  (kept in `localStorage`; nothing stays stuck). Each picked document gets an
  id when picked and is uploaded to `<uid>/report-<id>.<ext>`; the queued
  report records which are up (`uploaded_path`), a retry skips them and
  treats storage's "already exists" as done, and `add_report_file` answers a
  document already on today's report with the same row and accepts uploads
  up to 24 hours old (was 30 minutes) so a report kept on the phone still
  finds its copies (`src/lib/report-file-queue.ts`). The nightly
  `/api/cron/purge-selfies` deletes `report-files` objects older than 24
  hours that no report points at (`report_file_orphans`, service role only;
  Storage API; `purgeOrphanReportFiles`); 14 days and announced since 0067.

- **Test mode and reset** (0066, admins only, **Setup → System**,
  `/admin/system`): `system_settings` holds `test_mode` (on after the
  migration; one-way off, enforced by a trigger). While it is on, an admin
  resets chosen parts of the test run: 14 categories (clock-ins and
  locations, store visits and places, daily reports, stock counts and count
  sheets, X Metrics records, leave and schedules, support chats,
  notifications, activity log, Ask Xtend chats, teams and allocations,
  stores, staff accounts, audit log) or everything. Typed `RESET` plus the
  admin's password (checked by a throwaway sign-in); `reset_test_data`
  clears the choice and its dependencies in one transaction, deletes
  non-admin sign-ins from `auth.users`, queues stored files in
  `system_reset_files` and writes one `system.reset` audit row; the route
  removes the files with the Storage API (`POST /api/admin/system/reset`,
  `/reset/files`, `/go-live`; `src/lib/system-reset*.ts`,
  `src/components/admin/system-reset.tsx`). The admin dashboard shows a
  "Test mode: records can be reset" strip to admins until they go live.
- **Report photos offline** (0067): the 0065 fix, for photos. Each photo
  gets an id when it is taken or picked and is uploaded to
  `reports/<uid>/report-photo-<id>.jpg` (same bucket and storage rules); the
  queued report keeps its photos as `{ blob, client_id, uploaded_path }`, a
  retry skips those already up and treats "already exists" as done, and a job
  queued before 0067 (bare pictures) gets its ids on its first try
  (`src/lib/report-photo-queue.ts`). `POST /api/reports` now puts each photo on
  the report through `add_report_photo` (own folder, uploaded within 24 hours,
  an image, on no other report, today's report only, five at most), which
  answers a photo already on today's report with the same row, so a re-post
  after a lost answer adds nothing and is never refused by the limit.
- **Files kept 14 days, announced the day before** (0067): nothing is deleted
  automatically before it is 14 days old (`retention_days()`, the floor in
  every listing whatever is asked; `RETENTION_DAYS` in `src/lib/retention.ts`)
  and nothing that was not announced the night before. Reports, and the
  photos and documents on a report, are never deleted automatically. The
  nightly `/api/cron/purge-selfies` deletes clock-in and store-visit photos
  (was 24 hours; the ping-driven sweep is gone), report documents on no
  report (`report_file_orphans`, was 24 hours) and report photos on no report
  (`report_photo_orphans`: `report-photo-<id>.jpg` and the plain
  `<uid>/<uuid>.jpg` names older versions used, never another photo in the
  bucket); then it announces what goes next night (`retention_announce`:
  older than 13 days; listings only reach back to an announcement at least
  20 hours old) and notifies (`retention_notice_due`, `notifyUsers`, kind
  `retention_notice`, `system: true`) every admin of all of it and each
  supervisor of their own team's, linking to Attendance or Marketer reports;
  one notice a person a day; staff are never told. What went is kept on
  `job_runs` (`retention_purge`, the Overview footnote) and audited
  `retention.purge` (`record_retention_purge`). Selfie rows forget only the
  paths actually removed (`forget_selfie_paths`).
- **Google only for places Xtend has never seen** (0068): a spot is named,
  best first, by the person's own store, any store, a learned place, an
  address Google gave before (`place_addresses`, 40 m), Google (server
  cache 30 days per ~11 m spot), then OpenStreetMap
  (`PLACE_LOOKUP_ORDER=osm-first` asks OpenStreetMap first instead); a clock
  or visit event that arrives with no place is named and saved on the server
  (`placeForEvent`); the order lives in
  `src/lib/place-resolve.ts` (pure) and `src/lib/geocode.ts` supplies the
  providers. The phone's background tracker now learns the "left the store"
  spots it names, for the person (`learn_place_for`, `note_place_visit_for`,
  service role only), and an address Google gives with no shop is kept on its
  own (not as a named place, so place naming (0045) and the audit log still
  treat the spot as unknown). Every lookup is counted per Lagos month by what
  answered it, with every request actually sent to Google
  (`place_lookup_stats`, `count_place_lookups` after the response via
  `after()`), shown on the Places page; `GOOGLE_MONTHLY_LOOKUP_LIMIT` (20,000
  when unset since 0079's security pass) switches to OpenStreetMap for the
  rest of the month once reached (also for the store
  importer's searches).
- **Google's map on Movement and Attendance**: with
  `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, the Leaflet maps show Google's base
  map through the GoogleMutant plugin (`leaflet.gridlayer.googlemutant@0.15.0`
  from unpkg, Maps JavaScript API `v=weekly&loading=async`), with a **Map /
  Satellite** switch and a small "Map: Google" / "Map: OpenStreetMap" note.
  The base map is chosen at run time (`src/lib/base-map.ts`): Google when it
  loads (6 s), accepts the key (`gm_authFailure`) and draws tiles (8 s);
  otherwise OpenStreetMap, switching without a reload; OpenStreetMap is shown
  after 1.5 s while Google is still loading, so the map is never blank. The
  map is made once per page view (`useLeafletMap` in
  `src/components/admin/map-base.tsx`): the 60-second refresh redraws pins
  in place, keeps the zoom, and costs no new Google map load; Satellite
  reuses the same Google map.

- **Follow live** (0070, admins and supervisors, `/admin/follow/<person>`):
  like a delivery app's rider, one person who is clocked in moves on the
  map a few seconds behind. Opened from Movement: **Follow live** beside each
  name in "On shift now" and on the person's header (only while they are
  clocked in and not clocked out). Admins follow anyone, supervisors their
  own team; the database refuses anyone else, anyone not on shift, and more
  than `system_settings.follow_max_sessions` (20) live views at once
  ("Too many people are being followed live right now…"). A session
  (`follow_sessions`) lasts 30 minutes (**Keep following** adds 30 more,
  offered in the last 5), ends at clock-out (trigger; the page says "Clocked
  out at HH:MM"), at **Stop**, or when the page closes (`sendBeacon`; or no
  check-in for 60 s; the page checks in every 20 s). Audited `follow.start`,
  `follow.extend`, `follow.stop`. **Only the followed phone speeds up**:
  `follow_interval_for(user)` gives 8 s while a session is live, and the
  location routes add it to their answer as `interval_ms` (`POST /api/pings`,
  `POST /api/track/device`); the phone then sends a quick position every 8 s
  (`POST /api/pings/live` from the open app page, or a `live` field on the
  native tracker's `/api/track/device` request) and drops back when the
  answer stops carrying it. Quick positions are **never stored as pings**:
  `follow_live_position_for` keeps only the latest on the session row and
  broadcasts it on the private Realtime topic `follow:<session>`, which only
  the follower may read (RLS on `realtime.messages`, `can_hear_follow`);
  fake-location, nonsense or stale (over 2 minutes) readings are not shown;
  a second sender within 3 s is ignored. Stored pings keep their usual pace
  and every integrity check; nothing is accepted after clock-out (0055).
  Starting sends a silent `sync` event (no payload) on the person's own
  `field:<uid>` topic so an open app sends a position at once. The page
  (`src/components/admin/follow-live.tsx`, shared base map) glides the photo
  pin between positions over one interval, points an arrow the way they are
  going, draws the accuracy circle, a 5-minute breadcrumb line and their
  store's circle, ticks "Updated N s ago", shows km/h while moving, the last
  named place and the distance from their store, a **Follow on map** /
  free-pan toggle (dragging the map turns it off), a **Call** button when a
  phone number is on file, and **Stop**. Without Realtime it checks every 8 s
  (the check-in returns the latest quick and stored positions) and says so.
  Staff are never told; the Android "On shift" notification is unchanged
  (`src/lib/follow-live.ts`, `follow-live-server.ts`,
  `src/app/api/admin/follow/*`).

- **HR role** (0071, 0072): a fifth account type, `hr`, for people
  work rather than stock or locations. HR signs in to the dashboard and
  lands on Attendance; the menu shows Guide, Attendance, Analytics,
  Messages, Staff, Schedules and Leave only (`HR_LINKS` in
  `admin-nav.tsx`), with no alerts bell. `is_hr()` and `hr_sees(target)`
  (anyone but admins) open new read policies beside the existing ones on
  profiles, attendance, leave requests, work patterns, schedule overrides
  and staff stores; `my_staff`, `staff_analytics`, `available_supervisors`,
  `can_manage_schedule`, `schedule_guard`, `is_working_day` and
  `decide_leave` let HR in; `write_audit` accepts HR so every HR change is
  audited. In the app HR adds merchandisers and marketers (any store, any
  active supervisor), edits their store and supervisor, and deactivates
  them, but never creates or changes admins, supervisors or HR, and never
  changes a role, email or the notification exemption (`/api/admin/users`).
  Nothing about settings, stores, X Metrics, movement, alerts, integrity or
  excuses names HR, so it stays closed. The enum value is its own file
  (0071) because Postgres needs it committed before 0072 uses it.

- **Messages** (0073): every merchandiser and marketer has one
  conversation (`message_threads`, `messages`, `message_reads`) with
  whoever supervises them; admins and HR can read and reply in any of them
  (`can_message`). Staff open it from **You → Messages** (unread count) or
  the orange "You have a new message" banner on Home (`/field/messages`);
  the office from **Messages** in the menu (`/admin/messages`: inbox with
  unread counts, search, people with no conversation yet under "Start a
  conversation"; `/admin/messages/<person>`). `send_message` is the only
  way in (staff always write in their own; 2,000 characters; never edited
  or deleted); `read_messages`, `unread_messages`, `conversation`,
  `message_inbox`, `my_supervisor_name`. `POST /api/messages` sends the
  push: a staff message to their supervisor (or every admin when they have
  none), an office reply to the staff member. New messages show at once:
  the staff member's own Realtime topic hears a `messages` change, the
  office pages follow the table; a minute's poll covers a dropped
  connection. Support (020) stays for problems with the app.

- **Sign-in lockout** (0077): Wrong passwords pause the **phone or computer making them, not the
  account**. A device that has signed in to the account before carries a
  random `xt_dev` cookie (httpOnly, path `/api/auth`, 180 days, a new token
  every sign-in; only its SHA-256 reaches the database in
  `sign_in_trusted_devices`), and is counted on its own; a cookie the server
  never gave this account counts for nothing, so any other device is counted
  by its address. Five wrong in a row within 15 minutes pause that device or
  address for that account for 15 minutes (even the right password is
  refused there; tries while paused do not extend it). Across unknown
  devices together, 20 wrong within 15 minutes pause every unknown device for
  that account; the person's known phone still signs in. A right password
  clears that device's count. An identifier matching nobody is counted the
  same way, so the answer never shows whether an account exists.
  `/api/auth/sign-in` asks `sign_in_lock_status(account, address, device)`
  first and answers a pause with HTTP 423 "Too many wrong passwords, so
  signing in here is paused until HH:MM. Try again then, or ask your
  supervisor to unlock it."; a wrong password calls `sign_in_failed`, a
  right one `sign_in_succeeded` (which makes the device known). The attempt
  limits (shared through Redis when set) are 30 per address and 10 per identifier *per address*, so
  neither can lock a person out from elsewhere. Staff shows **Sign-in paused
  until HH:MM** from `locked_accounts()` and an **Unlock** button (PATCH
  `{unlock: true}` → `unlock_sign_in`, audited `user.unlock`, lifts every
  pause on the account); **Reset password** lifts them too
  (`sign_in_clear`). A test reset keeps both tables.

- **Zero trust** (0080): every request proves who it is, whatever network
  it came over. Five parts:
  - **Two-step sign-in**: a 6-digit code from an authenticator app (Google
    Authenticator, Microsoft Authenticator, any TOTP app; Supabase Auth
    MFA). Needed by the roles in `system_settings.mfa_roles` (admin and HR
    to begin with), offered to supervisors, never to field staff.
    `requireSession` sends a person to `/mfa` (enter the code) or
    `/mfa/setup` (scan the QR code, type the first code) from
    `mfaStep()`; API routes answer 401 `mfa` or 403 `mfa_setup` until then.
    In Postgres, `is_admin()` and `is_hr()` only count a session that
    passed the code (`aal2`) and an active account, so a stolen password
    gets no admin or HR power even if the app were bypassed. The sidebar's
    **Two-step sign-in** link opens `/mfa/setup`. An admin's **Reset
    two-step sign-in** on Staff (PATCH `{reset_mfa: true}`, audited
    `user.mfa_reset`) removes a lost phone's app.
  - **Office sign-in limits**: a supervisor, admin or HR sign-in lasts 12
    hours at most and ends after 60 minutes with no request
    (`officeRelogin()`; the middleware keeps the `xt_seen` cookie with the
    time of the last request and hands the previous one to the app as
    `x-xt-last-seen`; requests marked `x-xt-background: 1`, the version
    check, do not count). Login then says why.
  - **The password again for risky actions**: changing a role, staff role
    or email, resetting two-step sign-in, deleting an account, a new
    password or (de)activation for an office account, the login sheet
    download and the CSV import need the password (and code) confirmed in
    the last 10 minutes (`requireRecentAuth`, table `recent_auth`). The
    server answers 403 `reconfirm`; the dashboard's `confirmedFetch` opens
    the **Confirm it is you** box, checks through `/api/auth/reconfirm`
    (10 tries per 15 minutes, audited `auth.reconfirm`) and sends the
    action again once.
  - **Origin check**: a change (`POST`, `PATCH`, `PUT`, `DELETE`) to
    `/api/…` from another site's page is refused with 403 `origin`
    (`originAllowed()`, in the middleware): the `Origin` host must be the
    request's host, and with no `Origin`, `Sec-Fetch-Site` must not say
    cross-site or same-site. The scheduled jobs and the native tracker
    (`/api/cron/`, `/api/track/`) carry no cookies and are left out.
  - **New-device alerts**: when an office account signs in on a phone or
    computer it has never used while it already has a known one
    (`sign_in_device_status`), the person and every other active admin are
    notified and it is audited `auth.new_device` (`alertNewOfficeDevice`).
    Never for field staff.

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
| 0012 | Clock photos kept 24 hours (14 days, announced, since 0067) |
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
| 0062 | Activity log: sign-ins, sign-outs, app opens, password and photo changes (`user_activity`), the admin-only `activity_feed`, 180-day purge |
| 0063 | X Metrics feature switches on `xm_settings` (`enabled`, `expiry_enabled`, `supplies_enabled`, `grading_enabled`, `sales_enabled`, all on; `reconcile_from`), `xm_feature_on`, admin-only `xm_set_features`, guards refusing switched-off writes, and the sweep, reconciliation, expiry and grading skipping what is off |
| 0064 | Count sheets sent any time (`store_count_sheets.count_was_due`, `submit_count_sheet` without a due count); documents on the daily report: private `report-files` bucket and its storage rules, `report_files` with `add_report_file` / `remove_report_file`, the five-file trigger, `report_file_detail` |
| 0065 | Report documents offline: `add_report_file` returns the existing row for a document already on today's report and accepts uploads up to 24 hours old; `remove_report_file` refusals carry hints (`report_file_gone`, `report_locked`); `report_file_orphans()` (service role only) lists `report-files` objects over 24 hours old on no report |
| 0067 | Report photos offline and the 14-day rule: `add_report_photo(path)` (idempotent by path on today's report, own folder, uploaded within 24 h, image, on no other report; the 5-photo trigger still applies) and an index on `report_photos.storage_path`; `retention_days()` (14), `retention_delete_before`, `retention_cutoff`, `retention_announce` (job_runs `retention_notice`), `report_photo_orphans(hours, limit)` / `report_photo_orphans_before`, `report_file_orphans` (now 14 days and announced) / `report_file_orphans_before`, `expired_selfie_paths` and `forget_expired_selfies` on the same rule, `forget_selfie_paths(paths)`, `supervisor_covers`, `retention_notice_due(through)`, `record_retention_purge(result)` (job_runs `retention_purge`, audit `retention.purge`), `selfie_retention_status` (14 days); all service role only except `add_report_photo` and `retention_days` |
| 0066 | Test mode and reset: `system_settings` (one row, `test_mode` on, one-way off by trigger, admins read), `system_reset_files` (files a reset queued), `reset_category_keys/tables`, `reset_resolve_categories`, `reset_test_data(actor, categories)` (service role), `system_go_live(actor)`, `reset_files_next/done/pending`. WIPE: attendance, location_pings, location_alerts, integrity_flags, excuse_checks, phone_checks, photo_checks, device_beacons, clock_out_reminders, tracking_tokens, store_visits, known_places, place_naming_due, reports, report_photos, report_files, store_counts, count_requests, count_request_targets, store_count_sheets, all xm_ record tables (counts, count lines, sales, sale lines, supplies, supply imports, reconciliations, monthly grades, expiry alerts, targets, policy reads), leave_requests, schedule_overrides, work_patterns, support_threads, support_messages, notifications, notification_deliveries, scheduled_notifications, user_activity, assistant_conversations, staff_outlets, outlets, xm_stores, audit_log. Admins kept: profiles, push_subscriptions, app_installs, staff_temp_passwords. KEEP: products, staff_roles, role_store_counts, count_sheet_templates, notification_templates, support_quick_replies, xm_settings, xm_settings_history, xm_policy_versions, app_releases, job_runs, system_settings, system_reset_files. |
| 0068 | Google only for new spots: `learn_place_for(person, …)` and `note_place_visit_for(person, place)` (service role only; map names only, same name rules, nothing inside a store; `note_place_visit` now calls the latter for the signed-in caller), `place_addresses` with `address_at` / `remember_address` (service role; admins read; 40 m; nothing saved inside a store or learned place), `place_lookup_stats` (month, source, lookups; admins read) with `place_lookup_sources()`, `count_place_lookups(sources)` and `google_calls_this_month()` (service role). Both tables are kept by a test-mode reset |
| 0070 | Follow live: `system_settings.follow_max_sessions` (20); `follow_sessions` (watcher, subject, started/expires/last seen/ended with `end_reason` stopped, closed, expired or clocked_out, `extended`, the latest live position; RLS: admins all, supervisors their team's, staff none, no direct writes); `follow_start(subject)`, `follow_heartbeat(session)`, `follow_extend(session)`, `follow_stop(session, reason)` (the follower only; audited `follow.start` / `follow.extend` / `follow.stop`); `follow_interval_for(user)` and `follow_live_position_for(user, …)` (service role only; 8 s while live; broadcast on `follow:<session>`, never a ping row); `follow_on_shift`, `follow_tidy`, `follow_state`; trigger `trg_follow_end_at_clock_out` on attendance; realtime policy "Followers read their own follow topic" (`can_hear_follow`); `reset_category_tables()` redefined with `follow_sessions` under clock-ins and locations |
| 0071 | HR role value: `alter type user_role add value 'hr'` (alone, so it is committed before 0072) |
| 0072 | HR role: `is_hr()`, `hr_sees(target)`; read policies `profiles_hr_select`, `attendance_hr_select`, `leave_requests_hr_read`, `work_patterns_hr_read`, `schedule_overrides_hr_read`, `staff_outlets_hr_select`; `my_staff`, `available_supervisors`, `staff_analytics`, `can_manage_schedule`, `schedule_guard`, `is_working_day`, `decide_leave` and `write_audit` replaced to let HR in ("Only admins, HR and supervisors …", "Admins, HR and supervisors only") |
| 0076 | `my_supervisor()` (id, full_name, avatar_path): the staff member's own supervisor, name and photo only, for the Messages page header (SECURITY DEFINER; staff cannot read the office's profiles) |
| 0077 | Sign-in lockout that pauses the guessing device, not the account: `sign_in_lockouts` (lock_key, account, scope device/address/account, counts, locked_until; RLS on, no grants) and `sign_in_trusted_devices` (account, SHA-256 of the device token; forgotten after 180 days unused); service-role only `sign_in_lock_status(account, address, device)`, `sign_in_failed(…)` (5 per device or address, 20 per account from unknown devices, within 15 minutes → 15-minute pause), `sign_in_succeeded(…, new_device)`, `sign_in_clear(account)`; `can_unlock_sign_in(user)`, `unlock_sign_in(user)` (admins anyone, supervisors their team, HR anyone but admins; audited `user.unlock`); `locked_accounts()` for the Staff page |
| 0079 | Security fixes: trigger `trg_profiles_zz_field_only_reporting` (`profiles_field_only_reporting()`, BEFORE insert or update, named to fire after the 0042 role sync) clears `supervisor_id` on anyone who is not a merchandiser or marketer, plus a one-off clear of existing links; `message_file_readable(name)` (uploader, or anyone `can_message` lets read a message carrying it) and policy `message_files_read` rewritten to use it, with index `messages_by_attachment_path`; `outlets_for_user(target)` now answers only for the caller, their team, admins, HR (not for admins) and the server (no signed-in user); storage policy `reports_update_own` dropped (photos in `reports` are never overwritten). No new table |
| 0080 | Zero trust: `system_settings.mfa_roles` (default `{admin,hr}`); `session_aal()`, `mfa_required_for(role)`, `mfa_satisfied()`, `my_mfa_required()`; `is_admin()` and `is_hr()` now also need an active account and, for a role in `mfa_roles`, a session that passed the code step (`aal2`); table `recent_auth` (server only) with `confirm_recent_auth(user)` and `recent_auth_ok(user, minutes)` (service role only); `sign_in_device_status(account, device)` → `{known, any_known}` (service role only). Turn the code off for a role: `update public.system_settings set mfa_roles = '{hr}';` |
| 0081 | A test-run reset keeps every learned place: `reset_category_tables()` no longer lists `known_places` (**Store visits and places** becomes **Store visits**), and `reset_test_data()` never queues a learned place's `photo_path`/`selfie_path`, also when its namer is removed or everything is reset. `place_addresses` were already kept |
| 0082 | New phone app notices: table `app_update_notices (user_id, platform, build, times, first_at, last_at)` (admins read; server only writes); `claim_app_update_notices(p_android, p_ios, p_max_times = 3, p_every = 2 days)` (service role only) records and returns the active people seen in 30 days whose app build is older, once per build and again every 2 days up to 3 times; cleared by a reset's **Notifications** |
| 0083 | Team photo access: storage read policies `selfies_read`, `reports_read` and `avatars_read` (signed-in people only) now also let a photo be opened by the person's supervisor (`supervises_user`, own team), HR (`hr_sees`, anyone but admins) and admins, as well as the owner; folders are read through `safe_uuid()` so a stray path cannot break a listing. Storage policies are checked on the project, not in the SQL harness |
| 0084 | App only: `profiles.app_only boolean not null default false`; `profiles_self_guard()` (0042) now also keeps `app_only` from being changed by the person themselves; read by the Staff page through `my_staff()` |
| 0085 | Late tracking points: `record_background_pings` (0055) now keeps positions taken during a shift that has since ended (for a token issued before the closing; 24 h after the token ended), stored as offline positions at their own time, ignores anything after the closing, retires the token, and returns `late: true` |
| 0078 | Function grants: revokes EXECUTE from `public`, `anon` and `authenticated` on every trigger and event-trigger function in `public` (they fire without it) and on `place_is_recognised(lat, lng)` (only other database functions call it), after Supabase's security advisor found them callable signed out |
| 0075 | Message attachments: `messages.attachment_path/name/mime/size_bytes/kind`; `messages_body_check` relaxed (words **or** an attachment); `messages_attachment_check` (all five columns together, picture or PDF ≤ 10 MB); private `message-files` bucket with `message_files_insert_own` + `message_files_read`; `send_message(uuid, text, jsonb)` (drops the 2-arg form, validates and stores the attachment); `conversation` returns the attachment columns; `message_inbox` preview shows "Attachment" for a file-only message |
| 0074 | Office stock count: `xm_counts.source` (`'field'`/`'office'`, default `'field'`); `lat`, `lng`, `accuracy_m`, `photo_path` made nullable; the `photo_path` UNIQUE constraint replaced by a partial unique index (`xm_counts_photo_path_uniq`, where not null); check `xm_counts_source_shape_check` (field counts keep GPS + photo, office counts carry neither); `xm_office_count(outlet, lines)` (admin only, no GPS/photo, same line checks as `xm_submit_count`, recorded under `auth.uid()`) |
| 0073 | Messages: `message_threads` (one per staff member), `messages` (never edited, `clock_timestamp()`), `message_reads`; RLS through `can_message(staff)` (the person, their supervisor, admins, HR), no direct writes; `send_message(staff, body)`, `read_messages(staff)`, `unread_messages()`, `conversation(staff)`, `my_supervisor_name()`, `message_inbox()`; trigger `realtime_broadcast` on messages (staff topic); `messages` in the `supabase_realtime` publication; `reset_category_tables()` redefined with the three tables under support |
| 0069 | Five-minute heads-ups: `clock_out_reminders` takes stages 3 (`clock_in_soon`) and 4 (`clock_out_soon`) with a generated `stage_name`; `shift_start_for(user)` (home store's start, else 08:00); `claim_shift_soon_reminders(p_now)` (service role only: Lagos time, working days only for clock-in, merchandisers and marketers, active accounts, only inside [time − 5 min, time), once per stage per day); `claim_clock_out_reminders` redefined so the new stages never block the at-end reminder |

## 7. Environment variables

Set in `.env.local` for development, and for production in Vercel or, on the VPS, in `/var/www/xtend/shared/.env.production` (a `NEXT_PUBLIC_…` change needs a deploy; others `pm2 reload xtend --update-env`).

| Variable | Needed | What for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser and server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only writes; never in the browser |
| `CRON_SECRET` | Yes | Bearer token the scheduled jobs must send |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Yes for web push | Generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `ANTHROPIC_API_KEY` | Optional | Ask Xtend, support helper, invoice reading |
| `ASSISTANT_MODEL` | Optional | The model Ask Xtend uses (default `claude-opus-5`). `claude-sonnet-5-5` costs far less per question; set it and redeploy |
| `GOOGLE_MAPS_API_KEY` | Optional | Shop names at clock-in (server only: Places API (New), Geocoding API) |
| `GOOGLE_MONTHLY_LOOKUP_LIMIT` | Optional | Most Google place requests a month (Lagos time); once reached, OpenStreetMap until the next month, logged once. Unset (or not a whole number) = 20,000; `0` or `none` = no limit. Shown on the Places page |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Optional | Google's map (Map / Satellite) on Movement and Attendance. A **separate** key, visible in the browser: restrict it to HTTP referrers (the site's addresses, e.g. `https://your-domain/*`) and to the **Maps JavaScript API** only. Without it, or whenever Google fails, the maps use OpenStreetMap. Needs a deploy. No CSP is set, so no header change is needed; if one is added, allow `maps.googleapis.com`, `maps.gstatic.com`, `*.googleapis.com`, `unpkg.com` (scripts) and `*.googleusercontent.com`, `*.gstatic.com`, `*.google.com` (images) |
| `GEOCODER_USER_AGENT` | Recommended | Contact string for OpenStreetMap's policy |
| `PLACE_LOOKUP_ORDER` | Optional | Which map names a spot Xtend has never seen. Unset: Google first (shop names), OpenStreetMap after. `osm-first`: OpenStreetMap (free) first, Google only when it names no business |
| `FIREBASE_SERVICE_ACCOUNT` | For Android push | Firebase service account JSON |
| `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` (`APNS_BUNDLE_ID`, `APNS_SANDBOX`) | For iPhone push | Apple push key |
| `IOS_APP_URL`, `IOS_LATEST_BUILD` | When the iPhone app is out | Download link and newest build for update prompts |
| `ANDROID_APK_URL`, `ANDROID_LATEST_BUILD` | Optional | Override the GitHub-hosted APK (e.g. Play Store) |
| `APP_VERSION`, `APP_RELEASE_REPO` | Optional | Version shown on `/download`; repo whose `android` release holds the APK |
| `CREDENTIALS_WEBHOOK_URL`, `CREDENTIALS_WEBHOOK_TOKEN` | Optional | Relay that sends temporary passwords by SMS or email |
| `TRUSTED_PROXY_HOPS` | Optional | 1 behind Vercel, Nginx or Traefik (Dokploy, Coolify); 2 with Cloudflare's proxy in front (behind Traefik only once Traefik trusts Cloudflare's addresses, `deploy/DOCKER.md`) |
| `REDIS_URL` | Optional | A Redis shared by several app containers (`redis://user:password@host:6379/0`): attempt limits and cached answers are counted and kept once for all of them (`src/lib/redis.ts`). Without it, or while it is down, each container uses its own memory, as before |
| `REDIS_PASSWORD`, `APP_REPLICAS` | Compose only | For `docker-compose.yml`: the password of the Redis it starts (required there) and how many app containers to run (default 2) |
| `IP_API_KEY`, `IP_GEO_URL`, `IP_GEO_DISABLED` | Optional | IP lookup for VPN checks and the audit log |
| `XTEND_BUILD_ID` | Optional | Build id outside Vercel (Vercel sets `VERCEL_DEPLOYMENT_ID`); `deploy/deploy.sh` sets it to the commit's first 12 characters |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile site key: the human check on `/login` (section 4.8). On only together with `TURNSTILE_SECRET_KEY`. A Docker build argument too |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile secret key (server only): `/api/auth/sign-in` confirms the check with Cloudflare before the password. Without both keys sign-in has no human check |
| `NEXT_PUBLIC_REALTIME_DISABLED` | Optional | Set `1` to turn the client realtime sockets off fleet-wide and ride the safety poll instead — the release valve when Supabase's concurrent-connection cap is the bottleneck under heavy load |

## 8. Scheduled jobs

All need `Authorization: Bearer $CRON_SECRET`.

| Path | When | Does |
|---|---|---|
| `/api/cron/purge-selfies` | 02:20 UTC daily | The only place files are deleted automatically (0067). Deletes, through the Storage API in batches of 100, what was announced the night before and is at least 14 days old: clock-in and store-visit photos, report photos on no report, report documents on no report. Logs and returns the counts (`photos_deleted`, `report_photos_deleted` / `report_photos_failed`, `report_files_deleted` / `report_files_failed`, `failed`), keeps them on `job_runs` and audits `retention.purge`; then announces the next night's deletions and notifies admins (all) and supervisors (their team) once (`notices_sent`, `next_deletion_before`). Also: device reports and phone checks older than 60 days, activity log rows older than 180 days (0062), yesterday's open visits closed as abandoned. Reports and anything on a report are never deleted |
| `/api/cron/absence-sweep` | 08:30 UTC daily | Tells the office who has not clocked in (skips anyone on a day off or on leave, 0059) |
| `/api/cron/alerts` | Every 5 minutes | Sends unsent integrity flags, scheduled notifications, five-minute heads-ups before the shift starts and ends (0069, sent first and only inside those five minutes, so they depend on the job running on time), clock-out reminders (at shift end and an hour later, 0061), new phone app notices (0082: 07:00–19:59 Lagos, `flushAppUpdateNotices`), and hourly the X Metrics checks |
| `/api/cron/metrics` | Optional, hourly | X Metrics checks on their own schedule |

The two daily jobs are in `vercel.json`. The Vercel Hobby plan only allows
once-a-day crons, so the five-minute `alerts` job is **not** in `vercel.json`
(it would make every deploy fail with `cron_jobs_limits_reached`); instead it
runs from `.github/workflows/alerts-cron.yml` (a GitHub Actions schedule that
curls the endpoint with `CRON_SECRET`, set as a repo secret). On Vercel Pro you
can move it back into `vercel.json` and delete that workflow. On the Hostinger
VPS all three jobs run from the server's crontab (`deploy/crontab`, installed by
`deploy/setup-server.sh`, calling `deploy/cron.sh` on `127.0.0.1`; failures in
`shared/logs/cron.log`); set the repository variable `JOBS_ON_VPS=true` so the
GitHub workflow stands down. The plain crontab equivalent:

```
0-59/5 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/alerts
```

## 9. The phone apps

Home now leads with Your next step (clock in, open visit, report, on shift or complete).
Clock controls remain above the detail tabs; My day groups progress and recent days.
Office Overview leads with follow-up actions, four linked summary cards and attendance.
Live locations and coverage expand below; alerts keep filters and notifications in disclosures.


Admin and supervisor headers wrap at constrained desktop widths. Mobile dashboard
navigation is a disclosure with normal links, closes on selection/outside press/Escape,
and restores trigger focus on Escape. User account menus also dismiss outside and
on Escape. Attendance notes wrap, and narrow screens stack summary figures.
Verified with local sample data at 390, 1024 and 1280px; no live attendance was changed.

Mobile usability: clock controls sit directly below shift status; every bottom navigation
item has a visible label. Filters and the password visibility button have 44px targets.
Failed dashboard reads offer Try again. Place naming times out after 2.5 seconds
and falls back to coordinates; required GPS and selfie checks remain unchanged.
Home and Account sign the session profile photo directly; History fetches attendance
and the business date together. Account skips outlet lookup when none is assigned.
Document controls stay disabled during removal and refresh, with accessible
status and errors. Office attachment names wrap fully on phones; activity
filters and report downloads provide at least 44px touch targets.

`mobile/` is a Capacitor 8 project. The apps load the live site, so a web
deploy reaches phones at once; a new app build is needed only when something
in `mobile/` changes.

- **Native code:** `LocationIntegrity` (one fix plus mock-GPS and root
  checks) and `ShiftTracker` (location for the whole shift, with the app
  closed) in `mobile/android/app/src/main/java/ng/xpelbeauty/xtend/` and
  `mobile/ios/App/App/`. Registered in `MainActivity.java` and
  `XtendViewController.swift`. A new iOS Swift file must also be added to
  `App.xcodeproj/project.pbxproj`.
- **Downloads (Android):** `XtendDownloads.java` hands every download link to
  Android's download manager with the session cookie, so exports, the login
  sheet, the count template, report documents and message attachments land
  in Downloads with a notification. Files a page builds itself go through
  `saveBlob` (`src/lib/save-file.ts`), which uses the app's `window.XtendFiles`
  bridge; never a `blob:`/`data:` link, which the app cannot save
  (`scripts/check-downloads.ts`).
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
- **iPhone:** with the GitHub secrets `APPSTORE_API_KEY_P8`, `APPSTORE_KEY_ID`,
  `APPSTORE_ISSUER_ID` and `APPLE_TEAM_ID` (an App Store Connect API key,
  App Manager), every production build archives with automatic signing and
  uploads to TestFlight, no Mac needed (steps in `mobile/README.md`). Then set
  `IOS_APP_URL` (TestFlight public link) and `IOS_LATEST_BUILD` in Vercel.
- **Follow live** (0070): when the server's answer to the native tracker
  carries `interval_ms`, the tracker asks for positions that often (Android:
  the foreground service re-registers its location updates at 8 s; iPhone:
  best accuracy, every movement, while the app is open or in the background)
  and sends the latest with each request as `live`; it drops back to normal
  when an answer comes without it, or a minute after the last one that had
  it. The plugin's new `follow({ intervalMs })` method lets the open page
  start it at once. With the app **closed**, iOS only wakes Xtend on
  significant changes (about 500 m), so following an iPhone is coarse then;
  Android keeps sending every 8 s. A tracker not yet told catches up at its
  next check-in (Android: within 2½ minutes; iPhone: its next
  movement-triggered request, at least 2½ minutes apart when nothing else is
  sent). App builds from before 0070 ignore `interval_ms`: the open app page
  then sends the quick positions itself, and with the app closed they stay
  on the normal pace. Needs a new app build to reach phones.
- Full details: `mobile/README.md`.

## 10. Testing and checks

Regression checks added 2026-10-21: run `npx tsx --tsconfig tsconfig.scripts.json
scripts/check-login-destination.ts`, `scripts/check-photo-retry.ts` and
`scripts/check-deploy.ts` (use the same command prefix for each). The deploy check
requires Bash and mocks PM2/network/symlink commands; it never contacts a server.
Set BASH_BIN if Bash is not at the usual Git for Windows path.

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
         check-schedules-leave check-marketer-reports check-clock-out-reminder check-activity \
         check-xm-features check-report-files check-system-reset check-report-photos check-retention \
         check-places-usage check-shift-reminders check-follow-live check-bot-guard \
         check-security-fixes check-assistant-cache check-redis check-zero-trust \
         check-location-required check-downloads check-background-required check-app-only check-clock-notices; do
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
src/app/field/…           Staff app pages (home, count, report, metrics, history, account, messages, support, guide)
src/app/admin/…           Dashboard pages, one folder per menu item
src/app/api/…             Route handlers (field, admin, cron, track, version, push, support, messages)
src/app/guide, download   Public staff guide and app download page
src/app/mfa/…             Two-step sign-in: enter the code, set it up (office roles)
src/components/field/…    Staff app components (clock panel, heartbeat, shift tracker, forms)
src/components/admin/…    Dashboard components
src/components/messages/  The staff ↔ supervisor conversation, shared by app and dashboard
src/components/ui/…       Buttons, cards, inputs, badges, tables
src/lib/…                 Shared logic: auth, audit, geo, integrity, movement, assistant,
                          exports (export/), X Metrics (metrics/), offline outbox (offline/)
src/middleware.ts         Session refresh, sign-in redirects, origin check, last-request cookie
public/sw.js              Service worker: offline shell, web push
supabase/migrations/      The database, in order
supabase/tests/           Database tests and the Supabase stand-in
scripts/                  Admin bootstrap, logic checks, SQL test runner
mobile/                   Capacitor Android and iOS apps
docs/                     This guide, LOCATION-INTEGRITY.md, and rebuild/ (the rebuild pack)
.github/workflows/        Phone app builds, the 5-minute alerts job, deploy to the VPS
deploy/                   Hostinger VPS: setup, deploy with rollback, PM2, Nginx, crontab; DOCKER.md for Dokploy/Coolify
Dockerfile, .dockerignore The container for Dokploy or Coolify (standalone server, non-root)
docker-compose.yml        Several app containers behind the panel's Traefik, with a private Redis
docker/run-job.mjs        Runs a scheduled job inside the container
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
| 2026-11-11 | **"Use the Xtend app" inside the app fixed**: app-only accounts (0084) saw the "Use the Xtend app" page in the app itself, because Android's WebView sends the page loads made by the service worker (`public/sw.js`) without the app's `XtendApp` user agent. The middleware now leaves an `xt_app` cookie (a year, renewed on every app request) whenever the mark is present, and the app-only rule, sign-in, the login and download pages accept either (`isAppRequest`, `appOnlyHere`). Someone already on that page inside the app is moved on automatically (`AppOnlyRecheck`). New cases in `scripts/check-app-only.ts`. Not a security signal, as before | — |
| 2026-11-12 | Phone tracking address now uses the public site address: `/api/track/token` gave the phone `http://localhost:3000/api/track/device` behind the proxy, so no background movement was ever delivered | none |
| 2026-11-11 | Two-step sign-in set-up passes `issuer: 'Xtend'`, so the authenticator app shows Xtend and not the server address; self-hosted Auth needs SITE_URL and API_EXTERNAL_URL set to the real addresses | none |
| 2026-11-11 | Android app: `adjustMarginsForEdgeToEdge: 'force'` so the bottom menu sits above the phone's navigation buttons (needs a new APK) | none |
| 2026-11-11 | Splash screen (`src/components/splash-screen.tsx`): drawn with the first page so there is no white gap after the phone's launch screen, fades out after 0.7 s, once per session; matches `mobile/assets/splash.png` | none |
| 2026-11-11 | Location fix is quicker: stops at 30 m (was 20 m), waits at most 4 s after the first reading (was 8 s), and takes a 50 m reading after 1.5 s; the 100 m ceiling is unchanged | none |
| 2026-11-11 | Attendance: a staff name opens a one-page overview of their day (`/admin/attendance/day?person=&date=`): clock records, store visits, day report, movement count, alerts, flags | none |
| 2026-11-11 | Sign-out redirects use the public address (`src/lib/origin.ts`) instead of the container's `localhost:3000`; field pages keep clear of the bottom bar and never scroll sideways; camera opens at 960x720 so it starts faster | none |
| 2026-11-11 | **Movement saved offline is no longer lost at clock-out**: with no signal the Android app saves positions on the phone, but if the clock-out reached the server first (both made offline, the usual order) the server refused the whole queue and the phone deleted it, so an offline day's trail was lost. Now (0085) positions taken during the shift are accepted for 24 h after the clock-out as offline positions (no alerts; anything after the clock-out is ignored); the route does not tell the phone to stop after a full 500-position batch, so a longer queue is sent in full; and at clock-out the app leaves the tracker running while positions are still waiting (it stops by itself once the server says so) instead of stopping it and stranding them. Checked in the same pass: downloads (9 checks pass; Android needs the current app build), uploads (reports with photos and documents, stock counts and sales queue offline; message attachments and count sheets need signal). Apply 0085 to the database, then redeploy | 0085 |
| 2026-11-10 | **Marketers' store check-in and check-out**: (1) a store check-in now needs a clock-in first (nothing required it before, so a marketer could visit stores all day with no attendance and look absent on the dashboard): the Stores tab holds the buttons back with "Clock in first…" until Home shows them clocked in, and `POST /api/visits` refuses without an opening for today (409 `clock_in_first`) or after the closing (409 `clocked_out`); checking out of a visit stays possible after clock-out; (2) "Checked in" and "Checked out" are shown only after the visit is read back from `store_visits`, else "not confirmed"; (3) a request that never reached the server reads "No signal. Your check-in was NOT recorded" instead of "Failed to fetch". Check-in and check-out remain online-only: there is no offline queue for visits (clock-in and clock-out have one). The rule is in the route and the screen, not a trigger, so the SQL harness is untouched | — |
| 2026-11-10 | **A clock-in or clock-out is called done only once the database has it**: (1) after the server answers that it saved the clock event, the phone reads that row back (people read their own `attendance` rows) before showing "Clocked in / Clocked out"; if the server said saved but the row is not there it says "not confirmed" and tells the person to check Home (an unreadable answer is not doubted, since the server's own answer already came from the insert); (2) with no signal the screen no longer says "Saved on your phone" but **"Not recorded yet"**, in warning colour, and that it is NOT recorded until Home says so; (3) a clock-in or clock-out saved offline that the server later **refuses** (for example the photo had gone stale, or notifications were off) or that could not be sent in time was deleted from the phone with no word, so the person believed they had clocked in. It now leaves a notice (`src/lib/clock-notices.ts`, kept in the phone's storage, up to five) that Home shows in red with the reason and "Clock in again now" until dismissed. New check `scripts/check-clock-notices.ts` | — |
| 2026-11-10 | **An admin can require someone to use the phone app, not the web**: Staff → a person's row has an **App only** button (and an "App only" badge), and the page has **Require the app for all field staff / Allow the web again** for every active merchandiser and marketer (`POST /api/admin/app-only`, audited). A person marked app-only cannot sign in from a browser (the sign-in route signs them back out and says to download the app) and any open browser session lands on a new `/app-only` page with a Download button (checked in `requireSession` and `requireApiSession`, so every page and API is covered; the apps are recognised by `XtendApp` in their user agent, a convenience rather than a security control). Office accounts (admin, supervisor, HR) are never held to it; staff cannot change their own flag. New `src/lib/app-only.ts`, `profiles.app_only` (0084), check `scripts/check-app-only.ts`, SQL test in `rules.sql`. Apply 0084 to the database, then redeploy | 0084 |
| 2026-11-10 | **Supervisors, HR and admins can open photos, and review ones the AI could not check**: when the automatic photo check is unavailable a clock-in photo is still let through and raises a "Photo not checked" flag; the flag now has a **Show photo** button (the flag already carried the photo's path, the page never showed it) so the supervisor looks at it and marks the flag reviewed. Storage only let the owner and admins open selfies, so migration 0083 lets a supervisor open their own team's selfies, shelf photos and profile photos, and HR everyone's except admins'. Admin and supervisor guides updated. Apply 0083 to the database; then redeploy | 0083 |
| 2026-11-10 | **The phone app must be allowed to run in the background before a clock in or out**: in the Android and iPhone apps, the clock button is replaced by a "Finish setting up Xtend to clock in/out" card until location is "Allow all the time" (iPhone: "Always") and, on Android, battery saving is off for Xtend. Each missing setting has plain steps and a button that opens the right phone screen (the existing `askAlwaysLocation` and `openBatterySettings`); the card re-checks when the app returns to the screen and every 3 s while something is missing, and clears itself. The "Clock out now" prompt on Home is held back too. Only a setting the app clearly reports as OFF is demanded: a browser, an old app build, or one that does not report a setting is never locked out (rule in `src/lib/background-gate.ts`, gate in `src/components/field/background-gate.tsx`, wired in `clock-panel.tsx`). No new app build is needed: the app already reported `always` and `batteryUnrestricted`. New check `scripts/check-background-required.ts`. Staff guide and admin guide updated | — |
| 2026-11-10 | **Resets keep places; everyone is told about updates**: a test-run reset never removes the places Xtend learned (shop name, address, position, photos), whatever is ticked (0081; **Store visits and places** is now **Store visits**). When a new phone app is published, the five-minute alerts job sends a phone notification to everyone active on an older one (07:00–19:59 Lagos), then every two days while they stay behind, three times per build (0082, `src/lib/app-update-notices.ts`, `src/lib/app-update-notice.ts`). In Xtend, **Later** on the update bar hides it only until Xtend is opened or returns to the screen (15 minutes at most), instead of 30 minutes (site) or 24 hours (app) kept across opens. Checks: `rules.sql`, `rls_counts.sql`, `check-system-reset.ts`, `check-updates.ts`. Admin guide updated | 0081, 0082 |
| 2026-11-10 | **Downloads work in the Android app**: the app's WebView dropped every download, so the login sheet (Word), exports, the count template, report documents and message attachments did nothing when tapped in the app. `XtendDownloads.java` now hands them to Android's download manager with the session cookie (Downloads folder, notification); files a page builds (bulk-import CSV template and temporary passwords) save through the app's `XtendFiles` bridge (`saveBlob`, `src/lib/save-file.ts`). The login sheet is now confirmed first (`/api/admin/staff-logins?check=1`, 204) and then downloaded as a plain link, and its links use the address the admin is on (`x-forwarded-host`), not the container's. New check `scripts/check-downloads.ts`. Needs the new Android app build | — |
| 2026-11-10 | **Google first again, and every event saves its place**: by the owner's choice (shop names matter), Google names a spot Xtend has never seen again, OpenStreetMap after (`PLACE_LOOKUP_ORDER=osm-first` keeps the cheaper order). Every clock-in, clock-out, store check-in and check-out already saved what was found with its position, so the next event within the learned radius asks no map; now one sent with no place (made offline, or the phone's lookup timed out) is named and saved on the server too (`placeForEvent`, `/api/attendance`, `/api/visits`, `/api/visits/<id>/end`). New cases in `scripts/check-places-usage.ts`; admin guide updated | — |
| 2026-11-10 | **OpenStreetMap first for new places**: a spot Xtend has never seen (no store, learned place or saved address) is now named by OpenStreetMap, which is free; Google is asked only when OpenStreetMap names no business, and whatever either finds is saved as before, so the next clock-in there asks no map. `PLACE_LOOKUP_ORDER=google-first` restores the old order. Home-screen previews stay OpenStreetMap only. New cases in `scripts/check-places-usage.ts`; admin guide (Places) updated | — |
| 2026-11-10 | **Location required for store visits too**: the Stores tab now sits inside the same location gate as the clock button, so with location off (permission, the phone's GPS, or no fix within 100 m) marketers see **Location required** instead of the Check in / Check out buttons; the gate re-checks by itself when Xtend comes back to the screen. Clock in/out, check-in and check-out each still read a fresh fix at the tap (and again if the camera stayed open over 90 s), and the server refuses any of them without lat, lng and accuracy. New check `scripts/check-location-required.ts`. Staff guide: keep location on all day | — |
| 2026-11-10 | **A mistyped `VAPID_SUBJECT` no longer stops every push**: the Dokploy setting was `mailto: <address>` (a space and angle brackets), the push library refused it (`Vapid subject is not a valid URL`), and `/api/cron/alerts` answered 500 on every run, so no push went out. `cleanVapidSubject()` (`src/lib/push-endpoint.ts`, used by `push.ts` for sending and for the Setup check) trims, drops quotes, angle brackets and spaces, adds `mailto:` to a bare address, and falls back to `mailto:ops@xpelbeauty.ng` when nothing usable is left; 10 cases added to `scripts/check-push-endpoints.ts`. Also: on a Nixpacks-built container the scheduled-job file is `docker/run-job.mjs` (not `run-job.mjs`), so Dokploy Schedules run `node docker/run-job.mjs <job>` there | — |
| 2026-11-10 | **Alerts job message**: a 401 from the GitHub alerts job now says the `CRON_SECRET` secret does not match the one on the server at `APP_URL` (it named Vercel) | — |
| 2026-11-10 | **Staff guide**: two new questions under problems: "App not installed" / "package appears to be invalid" (uninstall the old Xtend, then install again) and "No connection" (check data or Wi-Fi, tap Try again). The staff training deck was updated to match (download from www.withxtend.com/download, the same two problems, current password to change it) | — |
| 2026-11-10 | **Live address is now `https://www.withxtend.com`** (Hostinger): the default for the phone apps (`XTEND_URL` in `mobile/capacitor.config.ts` and `.github/workflows/mobile.yml`), the GitHub alerts job and the download page, used when the repository variable `APP_URL` is not set. The apps also allow the address with or without `www.`. Phones need the next app build | — |
| 2026-11-10 | **Phone app "No connection" page**: its **Try again** button went to `/` on the app's own address (`https://localhost`), which the app opened in Chrome ("localhost refused to connect"). It now goes back to the site: `mobile/capacitor.config.ts` writes `www/home.js` (`window.XTEND_HOME` = `XTEND_URL`) on every `cap sync`. Needs the new app build | — |
| 2026-11-10 | **Android signing key check**: the mobile workflow removes spaces and line breaks from `ANDROID_KEYSTORE_BASE64` (they creep in when the key is copied on a phone), and stops with a plain error if the key is not complete base64 or cannot be opened with `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` | — |
| 2026-11-10 | **Android install help**: the download page's Android steps add what to do when the phone says "App not installed" or "package appears to be invalid" (uninstall the old Xtend, then install again). Cause: until the Android signing secrets are set, each published APK is a debug build signed with a new key, so it cannot replace the copy already on the phone (section 15) | — |
| 2026-11-10 | **Zero trust** (section 5): two-step sign-in (authenticator app code, Supabase MFA) needed for admins and HR, offered to supervisors (`/mfa`, `/mfa/setup`, sidebar link, Staff **Reset two-step sign-in**); `is_admin()`/`is_hr()` need the code step and an active account; office sign-ins last 12 hours and end after 60 minutes idle (`xt_seen` cookie); changes to `/api/…` from another site refused (403 `origin`); risky Staff actions (role, email, delete, office password or (de)activation, two-step reset, login sheet, CSV import) need the password confirmed in the last 10 minutes (**Confirm it is you** box, `/api/auth/reconfirm`); office sign-ins from a new device notify the person and the admins. New check `scripts/check-zero-trust.ts`. Deploy the code first, then run 0080; TOTP must be on in Supabase → Authentication → Multi-Factor | 0080 |
| 2026-11-08 | **Several containers and Redis**: the panel's Traefik is the load balancer for 2 or more app containers (Dokploy: application replicas, replaced one by one; or the new `docker-compose.yml` with `APP_REPLICAS` and a private Redis: password required, no port, nothing on disk, 256 MB, oldest dropped first). With `REDIS_URL` set, every attempt limit (`src/lib/rate-limit.ts`: sign-in, password change, photo checks, place lookups, support helper, Ask Xtend) is counted once for all containers, and the shared caches (`src/lib/ttl-cache.ts` `shared`: Ask Xtend answers and lookups, the version rows and roles, the app-release lookup, the X Metrics switches) are kept once in Redis under `xt:`. Redis is never required: commands give up after 300 ms, nothing queues while it is down, the first command after a start waits at most 500 ms once for the first connection, and every caller falls back to memory. `/api/health` with the job secret shows `redis` and `redis_reachable`. `allowAttempt` is now async (every caller awaits it). New check `scripts/check-redis.ts` (starts a throwaway `redis-server` if installed) | — |
| 2026-11-05 | **Security fixes** (section 4.9): a supervisor can no longer reset the password of or deactivate somebody promoted above them (`/api/admin/users/<id>` asks `can_edit_staff` as the caller, `/api/admin/users` asks `can_create_staff`; only field staff keep a supervisor); message attachments readable only by the sender and whoever may read the message; `outlets_for_user` limited to the caller's reach; photos in `reports` never overwritten (the X Metrics shelf photo upload no longer upserts); every phone-sent storage path checked by `src/lib/storage-path.ts`; per-person hourly limits on photo checks (60), place lookups (120, field roles only), support helper replies (20; after 12 messages a conversation goes to the office) and Ask Xtend (60) (`src/lib/usage-limits.ts`); `GOOGLE_MONTHLY_LOOKUP_LIMIT` defaults to 20,000; API calls refused with 403 `change_password` until a forced password change is done; changing a password needs the current one (new field on the form, not on the first change); sign-in for an unknown phone takes as long as a wrong password; raw database and account-service errors replaced by plain words; every `[format]` download refuses an unknown format before auditing; CSV cells that start like a formula get a leading `'`; `/api/health` public answer is `{ ok, checked_at }` (details with the job secret); `/api/version/seen` uses the usual session checks; `.env.*` ignored, `.env.example` lists every setting, `.claudeignore`/`.cursorignore`/`.aiexclude`, a Secrets rule in `CLAUDE.md`. New check `scripts/check-security-fixes.ts` | 0079 |
| 2026-11-03 | **Bots blocked** (section 4.8): `src/app/robots.ts` disallows everything; `X-Robots-Tag: noindex, nofollow, noarchive` on every response and a robots meta tag on every page; the middleware refuses empty and bot user agents (crawlers, AI bots, link previewers, curl/wget/scripting libraries, headless browsers) with a 403 via `src/lib/bot-guard.ts`, never the apps, browsers, `/api/cron/*`, `/api/track/*`, `/api/health`, `/api/version` or static files. Optional Cloudflare Turnstile on `/login` (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; `src/lib/turnstile.ts`, `src/components/human-check.tsx`), confirmed in `/api/auth/sign-in` before the password. Docker build argument for the site key. New check `scripts/check-bot-guard.ts` | — |
| 2026-10-28 | Ask Xtend can set a work schedule: a new `propose_schedule` tool proposes the weekly days worked (0 = Sunday … 6 = Saturday) for named merchandisers/marketers or a group; the Apply card runs it through `POST /api/admin/schedules` (`set_work_pattern`, 059), with the same team checks and audit as the Schedules page. No new migration | — |
| 2026-10-28 | **Location required to clock in or out** (+ services-off probe): the clock button on Home shows only when location is on, for clock-out as well as clock-in, gated by the shared `LocationGate`. Permission denied is caught instantly by the permission watcher; the phone's own location service being off (which the Permissions API cannot see) is caught up front by a new coarse one-shot probe, `probeLocation()` in `lib/geo.ts`, that tells apart denied (code 1) / service off (code 2) / slow signal (code 3, not blocked) / ok. The probe runs only once permission is granted, so it never prompts early; `prompt`, `unknown` and Safari fall through to the button, where the tap asks and blocks on its own. Client-only (`clock-panel.tsx`, `geo.ts`); no migration | — |
| 2026-11-05 | **Saving cost and database load**: a small in-memory cache (`src/lib/ttl-cache.ts`: bounded, least-recently-used out first, one load for simultaneous identical requests, a failure is never kept; nothing shared between servers or kept across a restart, and it never decides access, since callers put the asker into the key). **Ask Xtend** (`src/lib/assistant-cache.ts`, rules in `scripts/check-assistant-cache.ts`): (1) the first question of a chat is answered from memory for 5 minutes when someone (an admin; a supervisor only their own) asked it the same way today, shown as "Saved answer from N min ago. Look again"; follow-ups, questions with a file and any answer that proposed a card, plan or report, or followed a failed lookup, are never saved; (2) read-only lookups are reused, hours for a finished day or month and 90 seconds for anything that includes today (`match_names`, flag and request lists with references, and every action tool are never cached); (3) the newest message is marked for Anthropic prompt caching each round, so a long lookup result is resent at a tenth of the price; (4) X Metrics switches read once every 30 seconds; (5) `ASSISTANT_MODEL` picks a cheaper model without a code change. **`/api/version`** (every open page, every 10 minutes): the minimum builds and newest notes (the same rows for everyone) are read once a minute, a person's role once in 5 minutes, and a missing Android release is remembered for 5 minutes so GitHub's 60-an-hour limit is not hit. Places and addresses were already learned (0068) and Google answers cached 30 days, so nothing changed there | — |
| 2026-11-04 | **Node 22 declared, and a Nixpacks warning explained**: a Dokploy build log showed Nixpacks (not the `Dockerfile`) building on Node 18 (`EBADENGINE`, "Node.js 20 and below are deprecated" from supabase-js 2.116) and `SecretsUsedInArgOrEnv` for `ANTHROPIC_API_KEY`, `CRON_SECRET`, `GOOGLE_MAPS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY`: Nixpacks copies every environment variable into the image as build `ARG`/`ENV`. `package.json` now has `"engines": {"node": ">=22"}` and there is a `.nvmrc` of `22`, so any build picks Node 22. The real fix for the secrets warning is to switch the Dokploy app's Build Type to **Dockerfile** (only the `NEXT_PUBLIC_*` values are build arguments; secrets stay runtime-only); `deploy/DOCKER.md` now says so. The `$NIXPACKS_PATH` warning is a harmless Nixpacks quirk | — |
| 2026-11-04 | **"A new version of Xtend is ready" no longer comes back after Update (VPS/Docker)**: one build was getting several different ids, because `next.config.ts` evaluated `Date.now()` in each Next compile pass (browser and server bundles, `BUILD_ID` file all differed), and a Dokploy build has no `VERCEL_*` or `SOURCE_COMMIT` to fall back on. The page's id could therefore never equal `/api/version`'s, and Update only reloaded the same mismatch. The fallback is now pinned in `process.env.XTEND_BUILD_ID` on first use (child build processes inherit it), and the Dockerfile exports `XTEND_BUILD_ID` (`SOURCE_COMMIT` or a timestamp) before `npm run build`. Checked: a clean build has one id in the client chunks, the server route, `BUILD_ID` and the config. Vercel was never affected (`VERCEL_DEPLOYMENT_ID`). Redeploy the VPS image to apply; phones show the bar once more, then it clears | — |
| 2026-11-03 | **Quieter response headers**: `poweredByHeader: false` (no `X-Powered-By: Next.js`); new `deploy/nginx/xtend-quiet.conf` in `/etc/nginx/conf.d/` (`server_tokens off`, hides `X-Powered-By`, `X-Nextjs-Cache`, `X-Nextjs-Matched-Path`), installed by `setup-server.sh`; existing servers copy it once (`deploy/README.md`). The router's own `x-nextjs-*` and `Vary` headers stay | — |
| 2026-11-03 | **Ready for Dokploy or Coolify, and security pass**: `Dockerfile` (standalone server, non-root `node` user, health check on `/api/health`, `NEXT_PUBLIC_*` as build arguments, fails fast without the Supabase pair), `.dockerignore`, `docker/run-job.mjs` for the scheduled jobs, `deploy/DOCKER.md` (server hardening, panel, settings, jobs, moving over); `next.config.ts` builds standalone only when `NEXT_OUTPUT=standalone`. Security headers on every response (HSTS, `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, referrer and permissions policies, COOP). Next.js 15.5.25 → 15.5.28 (critical cache-poisoning advisory), Zod 3 → 4 (high memory-exhaustion advisory; `.uuid()` → `.guid()` to keep accepting any UUID shape, `errorMap` → `error`, two-argument `z.record`), PostCSS pinned to 8.5.28 for Next's copy; no high or critical `npm audit` findings left. The service-role client is `server-only`. 0078 closes signed-out access to database helpers | 0078 |
| 2026-11-03 | **Sign-in lockout**: five wrong passwords in a row (within 15 minutes) pause signing in on the phone or computer making them for 15 minutes, not the whole account, so nobody can lock a colleague out by knowing their phone number. A phone that has signed in before is recognised by a server-issued cookie (only its hash is stored) and counted on its own; other devices by address; 20 wrong from unknown devices pause unknown devices for that account (the person's own phone still works). Login says "…signing in here is paused until HH:MM…" (HTTP 423). Staff shows **Sign-in paused until HH:MM** with **Unlock** (admins, the person's supervisor, HR); **Reset password** lifts it too; audited. The in-memory per-identifier limit is now per address as well. Also fixed the RLS test's grant on `send_message` after 0075 | 0077 |
| 2026-10-28 | **Supervisor on the Messages page**: the staff Messages page (`/field/messages`) now opens with a header showing who they are writing to — their supervisor's photo (or initials) and name, "Your supervisor", or an "Xtend office" tile when they have none. New `my_supervisor()` (name + photo only, SECURITY DEFINER, since staff cannot read the office's profiles) | 0076 |
| 2026-10-28 | **Message attachments**: a message (0073) can carry one picture (JPEG/PNG/WebP/HEIC) or one PDF, up to 10 MB, on both the staff and office sides. The paperclip sits in the chat compose bar; the sender uploads to the private `message-files` bucket under their own folder, then `send_message` records it; a message may be an attachment with no words. Pictures show inline in the bubble, PDFs as a file card, both opened through `GET /api/message-files/<id>` (a 5-minute signed link, gated by the message's `can_message` RLS). Push says "Sent a photo"/"Sent a PDF" when there are no words; the inbox preview reads "Attachment". New columns on `messages`; `send_message` gains `p_attachment`; `conversation` returns the attachment. (Test-reset does not yet purge message-attachment blobs — see section 15.) | 0075 |
| 2026-10-28 | **Office stock counts and supplies through Ask Xtend**: an admin can record a stock count (with expiries) or log a delivery by typing it or attaching a count sheet, delivery note or invoice. Ask Xtend reads it and proposes `propose_stock_count` or `propose_supply`; Apply goes through the same X Metrics routes as the dashboard. Office counts have no GPS or shelf photo (new `xm_counts.source`, `'field'`/`'office'`; location/photo now optional, kept required for field counts by a check) and are recorded in the admin's name, so they feed stock-on-hand, expiry alerts and reconciliation but never a merchandiser's grade. New RPC `xm_office_count`, route `POST /api/admin/metrics/count`; supplies reuse `POST /api/admin/metrics/supplies` | 0074 |
| 2026-10-27 | **HR role and Messages**: a new HR account (People & attendance): every staff member but admins, attendance, analytics, leave decisions, schedules, exports, adds and deactivates merchandisers and marketers; no settings, stores, X Metrics, movement or alerts; audited. **Messages**: each merchandiser and marketer has one conversation with their supervisor (You → Messages, a Home banner when unread; `/admin/messages` for the office, where admins and HR read and reply in any); push on every message; live updates. New `POST /api/messages`, `/api/messages/read` | 0071, 0072, 0073 |
| 2026-10-27 | **Follow live**: from Movement, admins (anyone) and supervisors (their team) follow one clocked-in person moving on the map like a delivery rider (`/admin/follow/<person>`): smooth photo pin, heading arrow, accuracy circle, 5-minute trail, store circle, "Updated N s ago", km/h, last named place, Follow on map / free pan, Call, Stop. Only the followed phone speeds up (8 s, told through `interval_ms` on the location answers; web heartbeat and both native trackers obey); quick positions go over private Realtime (`follow:<session>`) and are never stored as pings; sessions end at clock-out, after 30 minutes (Keep following) or when the page closes; at most 20 at once; audited. New `POST /api/admin/follow`, `/api/admin/follow/<id>`, `/api/pings/live`; check script `check-follow-live`; native `ShiftTracker.follow` (new app build). Also removed a stray line that broke this table | 0070 |
| 2026-10-23 | Redesigned office overview around Start here, four linked metrics, attendance follow-up and expandable coverage; alerts use compact copy and expandable filters/notification settings; staff Home shows Your next step before clock controls, with progress/week under My day; normalise SQL line endings in the system reset check for Windows | — |
| 2026-10-23 | Admin guide: new “What’s new (October 2026)” section (migrations 0059–0067 to run in order and where each new feature lives), X Metrics on/off step by step, the Movement map held to Nigeria, and the iPhone app through TestFlight | — |
| 2026-10-23 | **Report photos survive a bad connection, and files are kept 14 days**: a report sent again does not upload its photos again (an id per photo when taken or picked, `<uid>/report-photo-<id>.jpg`, progress kept in the outbox, "already exists" counts as done, old queued jobs get ids on their first try) and `add_report_photo` answers a repeat with the same row (no duplicates, the five-photo limit still holds). Nothing is deleted automatically before 14 days (was 24 hours for clock photos and unused report documents) or without the day-before notice to admins (all) and supervisors (their team); reports and anything on them are never deleted; unused report photos are now cleaned up too; each night's deletions audited `retention.purge`. The ping-driven selfie sweep is removed. New `src/lib/report-photo-queue.ts`, `scripts/check-report-photos.ts`, `scripts/check-retention.ts`; admin and supervisor guides updated | 0067 |
| 2026-10-23 | iPhone app: every production build can sign itself and upload to **TestFlight** from GitHub (no Mac) once the App Store Connect API key secrets are set (`APPSTORE_API_KEY_P8`, `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPLE_TEAM_ID`); build numbers match the APK; `ITSAppUsesNonExemptEncryption` = false | — |
| 2026-10-23 | **View as**: an admin can switch between Admin, Merchandiser and Marketer (a "View as" switch in the admin sidebar/top bar, and a bar at the top of the field app). Picking a field role opens the field app in that role — merchandiser hides store visits and the daily report, marketer shows both — so an admin can test-run clock-in, visits and reports in different places. The choice is the `xtend_acting` cookie (`POST /api/admin/acting`), honoured only for a real admin; no database change, since admin already has every field capability | — |
| 2026-10-23 | **Test mode and reset**: Xtend starts in test mode (admins see "Test mode: records can be reset" across the dashboard). On the new admin-only **System** page (Setup) an admin ticks what to reset — 14 areas or everything — reviews what goes and what stays, types RESET and their password, and the database clears it in one transaction (dependencies included: staff accounts take their records, stores take their visits, counts and allocations), removes non-admin sign-ins and stored files, and keeps one audit row. **We are live** turns test mode off for good. New `POST /api/admin/system/reset`, `/reset/files`, `/go-live`; check script `check-system-reset` | 0066 |
| 2026-10-23 | **Report documents survive a bad connection**: removing a saved document works offline (queued, shows "Removing…", sent on signal; one that arrives after midnight is dropped and the report page says why); a report sent again does not upload its documents again (an id per picked file, progress kept in the outbox, "already exists" counts as done, `add_report_file` answers a repeat with the same row and takes uploads up to 24 hours old); the nightly purge job deletes report files left on no report after 24 hours. New `src/lib/report-file-queue.ts`; `check-report-files` extended | 0065 |
| 2026-10-23 | Mobile UI: full office attachment filenames, 44px activity/export controls, descriptive download labels; staff attachment controls stay disabled through removal and refresh with accessible status/errors. Verified sample layouts at 320px and 390px | — |
| 2026-10-23 | **Stock count sheet on the You page**: download this month's Xpel sheet as Excel, fill it and upload it back (Excel, PDF or photo) on any day, with this month's sheets and what each was for; the database now keeps a sheet sent when no count is due (`count_was_due`), and Count sheets on Stock count says what each was for. **Documents on the daily report**: attach up to 5 PDF, Word, Excel, CSV or picture files (10 MB each) to the report, remove them until midnight; private `report-files` bucket; office downloads on Marketer reports (audited), names in the report PDF/Word/Excel and Ask Xtend. New `GET`/`DELETE /api/report-files/<id>`, `scripts/check-report-files.ts` | 0064 |
| 2026-10-23 | **X Metrics feature switches**: a Features card at the top of X Metrics → Settings turns the whole module, Expiry, Supplies, Grading and Sales off and back on without losing anything. Off hides the part from the dashboard (menu, sub-navigation, overview tiles, store and staff pages, downloads, Ask Xtend, marketer report sales) and the staff app (Metrics tab, sales form, expiry date box, score), and the database refuses or skips its work; reconciliation needs Supplies and Sales and restarts cleanly when they return. New `PUT /api/admin/metrics/features` (audited `xm.features.update`); check script `check-xm-features` | 0063 |
| 2026-10-23 | Movement: the live map opens on the whole of Nigeria, and every Movement map is held to Nigeria (no panning or zooming out beyond it); a person's route still zooms to the route | — |
| 2026-10-22 | Admin **Activity log** (`/admin/activity`, menu after Audit log): everyone's sign-ins, sign-outs, app opens, clock-ins, visits, reports, counts, leave, support messages, password and photo changes with time, device, platform and IP; filters, summary cards, per-person table with Movement/Attendance links, day-by-day timeline, Excel/PDF/Word/CSV downloads. New `POST /api/activity` and `POST /api/auth/password` (the change-password form now saves through the server); nightly purge after 180 days; check script `check-activity` | 0062 |
| 2026-10-21 | Restrict post-login destinations to local pages; retain photos on temporary 401/429 check failures; roll back failed PM2 reloads and verify rollback health. Added three regression scripts | — |
| 2026-10-21 | UI/UX pass: the "Clock in" quick-action on the shift pill meets the 44 px touch target; white-on-orange small text (DayCard outlet line, HeaderField label, X Metrics deep-tile note) raised to pass 4.5:1 contrast; calendar day-labels enlarged from 8.5–9 px to 10 px for readability | — |
| 2026-10-20 | Hostinger VPS hosting: `deploy/` (one-time `setup-server.sh`, `deploy.sh` with health check and rollback, PM2 cluster, Nginx, crontab for the three jobs) and `.github/workflows/deploy-vps.yml` deploying every push over SSH. Repository variables `APP_URL` (site the phone apps open; release notes) and `JOBS_ON_VPS` (GitHub alerts job stands down) | — |
| 2026-10-19 | All dashboards: responsive header, readable attendance notes, larger controls and accessible menu dismissal | — |
| 2026-10-19 | Mobile dashboard: prominent clock controls, labelled navigation, larger tap targets, retry button, bounded place lookup; fewer profile queries and parallel History reads | — |
| 2026-10-19 | Movement: each person on the live map is their profile photo (initials when there is none or the link has expired); clicking it opens their movement for the day. Their photo also marks the latest point on their route | — |
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

- **Two-step sign-in, before 0080 is run**: the app already asks admins
  and HR for the code (default roles), skips the 10-minute password check
  and sends no new-device alerts. Run 0080 after deploying the code, never
  before (old code cannot reach `aal2`, so admins would lose their power).
  Supabase → Authentication → Multi-Factor must allow TOTP. An admin who
  lost their phone: another admin uses **Reset two-step sign-in**; if no
  admin can sign in, run `update public.system_settings set mfa_roles =
  '{hr}';` in the SQL editor (or delete the factor under Authentication →
  Users), then set it back to `'{admin,hr}'`. There are no backup codes yet.
- **Origin check and other front doors**: if Xtend is ever served on two
  addresses at once (say a custom domain and the Vercel address), each
  page only changes things on its own address, which is what a browser
  does anyway.

- **Several containers**: the IP-to-country cache behind the VPN check
  (`src/lib/audit-context.ts`) is still per container, so each one looks an
  address up once (6 hours); harmless, a little more IP-API use. A Compose
  deploy restarts all containers together (seconds of downtime); Dokploy's
  application replicas roll one by one.

- **Supabase advisor, left on purpose**: 27 small helper functions have no
  fixed `search_path` (none is SECURITY DEFINER and nobody signed in can
  create objects in `public`, so there is nothing to hijack; fixing it would
  stop Postgres inlining them in queries). 156 SECURITY DEFINER functions are
  callable when signed in: that is how Xtend works, each checks the caller
  itself. Tables with RLS and no policy are server-only by design.
- **Leaked-password check**: Supabase Auth → Passwords can refuse passwords
  known from breaches (HaveIBeenPwned). Switch it on in the dashboard (it
  may need a paid plan).
- **`npm audit`**: 9 moderate findings remain, all inside `exceljs`'s own
  dependencies (archiver, uuid, glob); the only fix is an old exceljs 3.4.
  Server-side, used to write spreadsheets from Xtend's own data.
- **Content-Security-Policy**: only the framing, base and form rules are
  set. A full script/connect policy needs nonces for Next.js and the
  Supabase, Google Maps and push hosts listed; worth doing with care. If
  one is added, allow `https://challenges.cloudflare.com` in `script-src`
  and `frame-src` for the sign-in check.
- **Bots** (4.8): the user-agent check is easy to fake; the real defence
  against password guessing is the lockout (0077), the optional Turnstile
  check and the platform's bot protection (Vercel Bot Management or
  Cloudflare Bot Fight Mode), which the owner switches on. Turnstile was
  checked with Cloudflare's test keys (the build machine cannot load the
  widget); confirm sign-in on the live site, in a browser and in both apps,
  right after setting the keys. Link previews (WhatsApp, Facebook) of Xtend
  links no longer show a title or picture.

- **What still shows the stack**: the browser must load `/_next/static/…`
  files and read the `Vary: rsc, next-router-…` and router `x-nextjs-*`
  headers, so a determined visitor can still tell it is Next.js; Supabase
  calls from the browser show the Supabase project address; on Vercel
  previews `server: Vercel` and `x-vercel-*` are added by Vercel and cannot
  be removed. Hiding headers only slows casual probing; the real defences
  are RLS, the lockout (0077) and keeping packages updated.

- **Message attachments and test-reset**: a test reset (0066) clears the
  `messages` rows but does not yet queue the `message-files` bucket for the
  storage sweep (`queue_reset_files`), so a "start fresh" leaves the
  attachment blobs behind in that private bucket. Harmless, but add
  `message-files` to the bucket list (and the `support` category's paths)
  when `queue_reset_files` is next touched.
- **iPhone app** is not yet on TestFlight or the App Store: the upload is
  automatic once the four Apple secrets are set (`mobile/README.md` §4);
  until then iPhone staff use Chrome/Safari and get site updates only. The
  TestFlight job has not yet run against a real Apple account.
- **Moving to the VPS**: set `APP_URL` and ship an app update before turning
  the old address off, since installed apps open the address they were
  built with. On the VPS the IP-location fallback has no Vercel headers, so
  keep an IP lookup (`IP_API_KEY` / `IP_GEO_URL`) configured.
- **Five-minute job** (`/api/cron/alerts`): runs from GitHub Actions and needs
  the `CRON_SECRET` repo secret to match Vercel's exactly (a 401 means they
  differ). Until it runs, scheduled notifications show as "Late" and
  clock-out reminders are not sent. GitHub's schedule is best-effort.
- **Five-minute heads-ups** (0069) are only sent inside their five minutes,
  so they depend on the alerts job running on time: the VPS crontab is
  reliable; GitHub's schedule is often several minutes late and can miss
  them (a missed clock-out heads-up is covered by the at-end reminder; a
  missed clock-in one is not resent). The phone screen shows its own card
  either way.
- **Activity log** (0062): clock-ins, visits, reports, counts, leave and
  support messages carry no IP address (those tables never stored one); only
  sign-ins, sign-outs, app opens and password/photo changes do. A sign-in
  made before 0062 ran is not recorded (the route logs and carries on).
- **X Metrics switches** (0063): a sales report or count saved offline on a
  phone and sent after its part was switched off is refused with a plain
  message and stays unsent. Expiry dates already known for a batch are
  carried from count to count while Expiry is off (the box is hidden), so
  they are there when it comes back on.
- **Retention** (0067): the first night after the migration only announces;
  nothing is deleted until the next night, and clock photos 24 hours to 14
  days old that 0012 would have deleted are now kept until they are 14 days
  old. Report photo copies left over from before 0067 are cleaned up only if
  they have the plain `<uid>/<uuid>.jpg` name those versions used. If the
  nightly job misses a night, nothing is deleted that night and the
  following night only deletes what was announced at least 20 hours before.
  Unused report photos and documents are on no report, so the notice's link
  cannot open them; the notice gives only their count.
- **Test mode** (0066): it is ON after the migration, including on a
  project that is already in real use: go live (System → We are live) once
  the test run is reset. The reset runs as one database transaction; on a
  very large data set it could exceed a database statement timeout and roll
  back with nothing changed (reset fewer areas at a time). Stored files are
  removed after the database work: if the function times out first, they wait
  in `system_reset_files` and **Finish removing files** clears them. Staff
  removed while signed in keep a working token for up to an hour, but with no
  profile every page treats them as signed out. If Supabase ever refuses SQL
  deletes on `auth.users`, the route removes the sign-ins with the Auth admin
  API instead (`auth_fallback`).
- **Clock-out reminders** ignore schedules: they go to anyone clocked in and
  not out, which covers someone working on a day off. The clock-in heads-up
  (0069) follows schedules and leave; it uses the home store's shift start,
  so a marketer working elsewhere is reminded by their home store's time.
- **Android signing secrets**: until they are set, the published APK is a
  debug build and each update needs the old app uninstalled first (the
  phone says "App not installed" or "package appears to be invalid"; the
  download page tells staff what to do).
- **Google map and place lookups** (0068): the Map / Satellite switch uses
  GoogleMutant's internal Google map (`setMapTypeId` on the same map, so no
  second map load); a future plugin version may need that line changed. The
  Google path was checked against a stand-in for Google's script (Google
  cannot be reached from the build machine); confirm on the live site once
  the browser key is set. Lookup counts start at zero when 0068 runs; Google
  answers cached before it are re-fetched once (the cache key changed to hold
  when each answer was fetched). Place learning by staff's own client
  (`learn_place` with a map source) is still open to any signed-in caller, as
  before 0068.
- **Follow live** (0070): with the iPhone app closed, iOS only wakes Xtend
  on significant moves (about 500 m), so an iPhone is followed coarsely
  then; Android keeps the 8-second pace. Phones with an app build from
  before 0070 send quick positions only while the Xtend home screen is open.
  A phone not using the app at that moment learns it is followed at its next
  check-in (about 2½ minutes on Android). Quick positions add a Realtime
  message and a one-row update every 8 s per followed phone; the cap
  (`system_settings.follow_max_sessions`, 20; change it with SQL) keeps that
  to a handful. The follow page relies on the browser running its timers:
  a page left in a background tab may be ended as "closed" after 60 s.
- **Usage limits** (4.9) are counted in the server process, like the
  sign-in rate limit: a restart starts them afresh, and with several
  replicas each keeps its own count. Fine for slowing misuse; a shared
  count would need a table.
- Migrations to run in production after each merge: check the change log
  above against what has been run in Supabase.
