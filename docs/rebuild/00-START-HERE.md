# Rebuild Xtend: start here

This folder is a complete specification of Xtend. Give it to an AI coding
assistant (or a developer) and they can build the whole app, from an empty
folder to what runs in production today, without needing to ask how
anything should work. Everything that can be decided has been decided here.

The only things a builder must ask for are the ones nobody can invent:
**accounts and secret keys** (section 4).

---

## 1. How to use this pack

Paste this to the AI, with the `docs/rebuild` folder attached (or the whole
repository, which is better still):

> You are rebuilding the Xtend app exactly as specified in the attached
> `docs/rebuild` folder. Read `00-START-HERE.md` first and follow its build
> order. Do not ask me questions about how features should work, what they
> should look like or what words to use: the pack decides all of it, and
> section 3 of `00-START-HERE.md` says what to do where something is not
> spelled out. Only ask me for the accounts and keys listed in section 4,
> all at once, when you reach the step that needs them. After each stage,
> run its acceptance checks and tell me the result before moving on.

## 2. What is in the pack

Read in this order.

| File | What it is | Made |
|---|---|---|
| `00-START-HERE.md` | This file: decisions, build order, acceptance checks | By hand |
| `../BUILD_GUIDE.md` | Setup, every migration, environment variables, scheduled jobs, phone apps, history | By hand |
| `10-field-app.md` | The staff app: every screen, flow, number and message | By hand |
| `20-admin-dashboard.md` | The dashboard: every page, filter, action, permission and export | By hand |
| `30-rules.md` | The business rules, with exact thresholds and where they live | By hand |
| `40-platform-and-design.md` | Project skeleton, integrations, offline, phone apps, design system, exports | By hand |
| `generated/schema.sql` | **The exact database**: every table, view, function, trigger, policy and grant | From the code |
| `generated/seed.sql` | The starting rows (product sheet, settings, starter replies and templates, scoring policy) | From the code |
| `generated/platform.sql` | Photo storage buckets and access rules, realtime tables | From the code |
| `generated/database.md` | A readable summary of the database | From the code |
| `generated/routes.md` | Every API route: method, who may call it, request body (zod), what it calls | From the code |
| `generated/pages.md` | Every page: path, who may open it, components, purpose | From the code |
| `generated/modules.md` | Every shared file: purpose and exports | From the code |
| `generated/constants.md` | Every tunable number in the code | From the code |
| `generated/tests/` | The database acceptance tests and the Supabase stand-in they run on | From the code |
| `generated/verbatim/` | Files whose words or values must match exactly: the three guides, every instruction given to Claude (Ask Xtend, the support helper, photo checks, invoice reading), flag and excuse wording, design tokens, service worker, app manifest, the VPS hosting files (`deploy/`). Copy them as they are | From the code |

The `generated/` files are rebuilt from the code by `scripts/rebuild-pack.ts`
and are always exact. The hand-written files explain behaviour, intent and
words. **If they ever disagree, the generated files win** for the database,
routes, numbers and anything in `verbatim/`; the hand-written files win for
layout and behaviour they describe that the generated files do not.

## 3. Decisions already made

Do not ask about these. Where the pack is silent on a detail, use the
default in the last column.

| Topic | Decision | Default where unspecified |
|---|---|---|
| Stack | Next.js 15 App Router, React 19, TypeScript strict, Tailwind 3, Supabase, a Hostinger VPS (Nginx + PM2; Vercel also works), Capacitor 8 | Latest patch of the versions in `40-platform-and-design.md` |
| Where logic lives | Postgres (triggers, `SECURITY DEFINER` functions); thin route handlers; React only displays | Put new rules in SQL, not React |
| Database | Apply `generated/schema.sql`, `seed.sql`, `platform.sql` as given | Never rewrite the SQL by hand |
| Who sees what | Row-level security; supervisors see their own team only | Read through the caller's client, never the service role |
| Audit | Every admin or supervisor change is audited with location and device | Call `audit()` after any write |
| Time | Africa/Lagos for every date, day and time shown | Format with `en-NG`, 24-hour `HH:MM` |
| Language | Plain English for Nigerian office and field staff; no jargon; no ids on screen | Short sentences; say what to do |
| Staff are not told about monitoring | Location tracking, integrity checks, alerts and excuses are never explained to staff | Neutral wording: "Finish setting up Xtend" |
| Colours | Brand orange family only (`40-platform-and-design.md`) | `#d1511a` for emphasis, `#f6e4d8` for tracks |
| Icons | lucide-react | The closest lucide icon |
| Layout | Works at 390 px wide with no sideways scroll; dashboard sidebar at large widths | Stack columns on phones |
| Filters | GET forms with query-string parameters, quick-range chips | Default range: today (or last 30 days for history pages) |
| Downloads | Excel, PDF, Word and CSV through the shared renderer | All four formats, exactly as filtered |
| Errors | Friendly sentence plus what to do; a missing migration names its number | "Could not load … Has migration NNN been run?" |
| AI features | Anthropic Claude via the official SDK, model ids as in `40-platform-and-design.md` | Optional: show a setup notice without the key |
| Phone apps | Capacitor shells loading the live site; native code only for location and push | Ship web changes without new app builds |
| Records | Attendance, counts, supplies and audit rows are never edited or deleted | Void with a reason instead |

## 4. What only the owner can provide

Ask for these together, at stage 1 and stage 8:

- Supabase project URL, anon key, service-role key.
- A long random `CRON_SECRET` (the builder can generate one).
- VAPID key pair (the builder can generate one).
- Anthropic API key (optional).
- Google Maps API key with Places API (New) and Geocoding API (optional).
- Firebase project `google-services.json` and service-account JSON (Android push).
- Apple Developer account, APNs key, Team ID, Key ID (iPhone app and push).
- Android signing keystore and passwords (or let the builder generate one).
- The production domain, and the first admin's name, email and password.

Everything else (names, wording, colours, numbers, flows) is in the pack.

## 5. Build order and acceptance checks

Build in this order. Finish each stage's checks before starting the next.

### Stage 0 — Skeleton

- Create the Next.js project with the dependencies, configs and folder layout
  in `40-platform-and-design.md` §1 and `../BUILD_GUIDE.md` §11.
- Add the design tokens, UI kit and fonts (`40-platform-and-design.md` §6).
- **Checks:** `npx tsc --noEmit` and `npx eslint` pass; `next build` succeeds;
  an empty page renders in the brand colours at 390 px and 1280 px.

### Stage 1 — Database

- Create the Supabase project. Run `generated/schema.sql`, then
  `generated/seed.sql`, then `generated/platform.sql` in the SQL editor.
  (Or, with the repository, run `supabase/migrations` in number order.)
- **Checks:** on a local Postgres 16, load `generated/tests/supabase_stub.sql`,
  the three files above, then `generated/tests/rules.sql` and
  `generated/tests/rls_counts.sql`. They must print `ALL RULES PASSED` and
  `ALL RLS CHECKS PASSED`. (This has been verified against the pack.)

### Stage 2 — Sign-in and shells

- Supabase clients, `src/lib/auth.ts`, middleware, `/login`,
  `/change-password`, `/deactivated`, the field layout and the dashboard
  layout with its menu (`20-admin-dashboard.md`, shell section).
- Create the first admin with the bootstrap script (`../BUILD_GUIDE.md` §4.3).
- **Checks:** signed-out visits redirect to `/login`; a staff member lands on
  `/field`, an admin or supervisor on `/admin`; supervisors do not see
  admin-only menu items; a new account must change its password first.

### Stage 3 — Clock in and out

- Location gate, notification gate, camera capture, clock-in and clock-out,
  offline outbox, onboarding (`10-field-app.md`).
- **Checks:** every acceptance check in the clock-in, clock-out, gates and
  offline sections of `10-field-app.md`; a clock-in inside the store's radius
  is on site, outside is off site, late after shift start.

### Stage 4 — The office basics

- Outlets, Staff, Teams, Roles, Store allocation, Schedules, Leave (and the
  staff leave screen and coloured calendar), Overview, Attendance, Analytics,
  exports (`20-admin-dashboard.md`, `10-field-app.md`).
- **Checks:** the acceptance checks for those pages; every download opens in
  Excel, Word and a PDF reader.

### Stage 5 — Where people are

- Heartbeat, live locations, Movement, Store visits (allocated stores only),
  Marketer reports, places and place naming, Alerts, absence sweep,
  clock-out reminders and the five-minute heads-ups before the shift starts
  and ends, scheduled jobs (`10-field-app.md`,
  `20-admin-dashboard.md`, `30-rules.md`, `../BUILD_GUIDE.md` §8).
- **Checks:** the acceptance checks for those sections; each scheduled job
  refuses a request without `Authorization: Bearer $CRON_SECRET`.

### Stage 6 — Stock

- Stock counts and requests, count sheets, X Metrics (field forms, every
  dashboard subpage, supplies import, grading, and the feature switches that
  turn the module, expiry, supplies, grading and sales off and on, 0063).
- **Checks:** the acceptance checks for those sections.

### Stage 7 — Checks, support, notifications, AI

- Integrity, Check an excuse, phone checks, Support (with the helper),
  Notifications (templates, scheduling, history), Ask Xtend (tools, reports,
  allocation plans, action cards, saved chats), Audit log, Updates, System
  (test mode, choosing what to reset, going live for good; 0066,
  `30-rules.md` §16b).
- **Checks:** the acceptance checks for those pages; Ask Xtend's action cards
  do nothing until their button is pressed; a full reset leaves only admins,
  products and settings, and test mode cannot be turned back on.

### Stage 8 — Phone apps and release

- `mobile/` Capacitor project, native plugins, GitHub Actions workflow,
  `/download`, push (FCM, APNs), the shift tracker (`40-platform-and-design.md`
  §5).
- Deploy to the VPS with `deploy/` (`deploy/README.md`) or to Vercel, with every environment variable (`../BUILD_GUIDE.md` §7).
- **Checks:** the workflow builds a debug APK; the download page links to it;
  a test phone clocks in from the app and receives a notification; the
  update banner appears after a second deploy.

### Stage 9 — Guides

- Staff guide (`/guide` and in the app), supervisor guide, admin guide, with
  the audience rules in section 3.
- **Checks:** the staff guide says nothing about how monitoring works; the
  admin guide is hidden from supervisors.

## 6. Done means

- All database tests pass on the rebuilt database.
- Every acceptance check in files 10–40 holds.
- `tsc`, `eslint` and `next build` are clean.
- A phone can install the app, clock in at a store, count stock and send a
  support message; the office sees it on the dashboard and can download it.

## 7. Keeping the pack current

Whenever Xtend changes:

1. Update the hand-written file(s) the change touches (10–40), and this file
   if the build order or a decision changes.
2. Regenerate the exact parts:
   `PGURL=postgres://postgres@localhost:5433/postgres npx tsx --tsconfig tsconfig.scripts.json scripts/rebuild-pack.ts`
   (any local Postgres 16; it builds a scratch database from the migrations,
   dumps it and drops it).
3. Re-run the stage 1 check against the regenerated files.
4. Add a row to the change log in `../BUILD_GUIDE.md`.

`CLAUDE.md` at the repository root makes this part of every change.
