# 10 — The field app (merchandisers and marketers)

This file specifies the staff phone app: every screen, flow, rule, number and
key string a merchandiser or marketer meets. It is the behaviour layer. For
raw shapes, use the generated inventories instead of this file:

- routes and their request bodies: `generated/routes.md`
- pages and their files: `generated/pages.md`
- modules and exports: `generated/modules.md`
- constants: `generated/constants.md`
- tables, functions, triggers: `generated/database.md`, `generated/schema.sql`

Where a number is given, the source file is named in brackets. "Lagos time"
means Africa/Lagos (UTC+1 all year). The "business date" is
`public.business_date()` (today in Lagos).

Build in the order of the sections below: sign-in, onboarding, shell and
home, gates, clock-in/out, place naming, store visits, report, stock count,
X Metrics, history/account/support/guide/leave, background behaviours, copy
rules. Schedules and leave come from migration 0059, allocated-store visits
and visits in the report from 0060, the clock-out reminder from 0061, the
stock count sheet on the You page and documents on the daily report from
0064, documents that survive a bad connection (no second upload on a
retry, removals queued offline) from 0065, the five-minute heads-ups before
the shift starts and ends from 0069.

---

## 0. Ground rules for the whole field app

- **Roles.** `FIELD_ROLES = ['merchandiser', 'marketer', 'admin']` may open
  `/field/*`. `REPORTING_ROLES = ['marketer', 'admin']` file the daily report
  and record store visits (`src/lib/auth.ts`). Admins can use the field app
  too, but land on `/admin`.
- **Logic lives in Postgres.** Distance, on-site status, business date, who
  the user is, whether a count is due, whether a place must be named, photo
  freshness: all decided by triggers and `SECURITY DEFINER` functions. Route
  handlers validate shape (zod) and pass through. React only displays.
  Anything the client sends for `distance_m`, `status`, `user_id` or
  `attendance_date` is ignored/not accepted.
- **Error messages.** A Postgres `raise exception` (SQLSTATE `P0001`) is
  written for people and is passed to the phone verbatim. Any other database
  error is logged and the phone gets a fallback ("That could not be saved.
  Try again." / "Something went wrong. Try again.") (`dbErrorMessage`,
  `apiError` in `src/lib/auth.ts`).
- **Place-naming refusal is 423.** If a write is refused because a place is
  waiting to be named (Postgres hint `place_naming_due`), the route answers
  `423 { error, code: 'name_place' }`, so the phone keeps the job instead of
  discarding it (`dbErrorResponse`).
- **Layout.** Mobile-first, `max-w-md` column, 16px side padding, bottom
  padding `pb-28` so the floating nav never covers content. Works at 360–390
  px wide. Brand orange (`#d1511a`) accents; dark bar colour
  `hsl(24 14% 11%)`.
- **Photos.** Every proof photo (clock selfie, visit selfie, shelf photo,
  place photos) is taken with the in-app camera from a live stream. There is
  no file input in those flows. Only the daily report photos, the profile
  photo and the paper count sheet may come from the gallery/files.
- **Times shown** are Lagos time via `formatLagos`.

---

## 1. Sign-in, password, daily re-login, deactivated, redirects

### 1.1 Middleware (`src/middleware.ts`)

- Runs on every path except `_next/static`, `_next/image`, `favicon.ico`,
  `manifest.webmanifest`, `sw.js`, `icons/`, `brand/`, `api/cron`.
- Refreshes the Supabase session cookie on every navigation so staff are not
  logged out mid-shift.
- Public paths: `/login`, `/deactivated`, `/offline`, `/download`, `/guide`
  (and anything under them).
- `/api/*` is never redirected: API routes answer 401/403 in JSON themselves
  (the offline outbox and login form rely on JSON, not an HTML redirect).
- Signed out and not public: redirect to `/login?next=<path>`.
- Signed in and on `/login`: redirect to `/`.
- Role enforcement is not done here; it is done by page guards and Postgres.

### 1.2 Root `/` (`src/app/page.tsx`)

No session → `/login`; inactive → `/deactivated`; `must_change_password` →
`/change-password`; otherwise merchandiser/marketer → `/field`, everyone else
→ `/admin`.

### 1.3 Page guard `requireSession(roles)` (`src/lib/auth.ts`)

In this order:

1. No session or no profile row → `/login`.
2. `profile.is_active = false` → `/deactivated`.
3. Daily re-login needed → `/api/auth/expired?reason=<new-day|clocked-out>`.
4. `must_change_password` → `/change-password`.
5. Role not allowed → `/`.

The API guard `requireApiSession` mirrors it with JSON: 401 `Not
authenticated`; 403 `Account deactivated`; 401 with `code: 'relogin'` and
message `You have clocked out for today. Log in again to continue.` or
`Please log in again for today.`; 403 `Not permitted`.

### 1.4 Daily re-login rule

Applies only to `merchandiser` and `marketer` (not admins, not supervisors).

- `new-day`: the user's `last_sign_in_at` is before 00:00 today Lagos time
  (`${today}T00:00:00+01:00`), or missing.
- `clocked-out`: today's `closing` attendance row was created after the last
  sign-in.
- Purpose (keep in code comments, not in staff copy): whoever holds the phone
  the next morning must know the password, so a colleague cannot clock in on
  a phone left logged in.

`GET /api/auth/expired` (`src/app/api/auth/expired/route.ts`): the server
decides, not the link. If a session exists and does not need re-login,
redirect to `/` (opening the link never signs out a valid login). Otherwise
sign out (clearing cookies) and redirect to `/login?reason=<reason>`, where
reason is the session's own reason, else the query's `clocked-out`, else
`new-day`.

### 1.5 Login page (`src/app/login/page.tsx`, `login-form.tsx`)

Layout: orange brand block on top (Xpel tile, heading **"Xtend"**, line
"Field attendance for Xpel Beauty. Clock in, report, go."), white rounded
sheet overlapping it (`-mt-10`, `rounded-t-[2rem]`).

- Heading **"Sign in"**, sub "Use the email or phone number your admin
  registered."
- Reason notice (tinted box) when `?reason=`:
  - `clocked-out`: "You have clocked out for today. Log in again when you
    next start work."
  - `new-day`: "A new day has started. Log in again to clock in."
- Field **"Email or phone"** (`autoComplete=username`, `inputMode=email`,
  no autocapitalise), placeholder `you@xpelbeauty.ng or 08012345678`.
- Field **"Password"** with an eye toggle (aria "Show password"/"Hide
  password").
- Button **"Sign in"** with arrow; while busy **"Signing in…"**.
- Errors: server message, else "Those details are not correct."; network
  failure "No connection. Check your data and try again."
- On success: `router.replace(next)` if `next` starts with `/`, else `/`.
- Card link **"Get the Xtend app"** / "For Android and iPhone" → `/download`,
  hidden when the user agent is the native app (`isAppUserAgent`).
- Footer: Xpel lockup, "Accounts are created by an administrator. There is
  no public signup." and link **"How to use Xtend"** → `/guide`.

### 1.6 Sign-in API (`POST /api/auth/sign-in`)

- Body `{ identifier (3–120, trimmed), password (1–200) }`.
- Every failure returns the same text `Those details are not correct.`
  (400 bad shape, 401 unknown/wrong).
- Rate limits (in-memory, per server instance, `src/lib/rate-limit.ts`):
  30 attempts per IP and 10 per identifier (lower-cased) per **15 minutes**;
  over → 429 "Too many attempts. Wait 15 minutes, then try again."
- If the identifier contains `@` it is the email (lower-cased). Otherwise it
  is a phone: strip to digits and `+`; under 7 characters → wrong. Try the
  number plus variants: `0…` ↔ `+234…`, `234…` → `0…`. Look up an **active**
  profile's email with the service-role client. The email is never returned
  to the browser.
- Signs in server-side so the session cookies are set on this response.
  Returns `{ ok: true }`.

### 1.7 First password / change password (`/change-password`)

- Signed out → `/login`. `forced = profile.must_change_password`.
- Brand block heading: forced **"Set your password"** with "Your account was
  created with a temporary password. Choose your own before you start.";
  otherwise **"Change your password"** with "Pick something you will
  remember. You will not be asked again."
- Fields **"New password"** and **"Repeat it"**. Minimum **8** characters
  (`MIN_LENGTH` in `form.tsx`): "Use at least 8 characters." Mismatch: "The
  two passwords do not match."
- Save: `POST /api/auth/password { password }`, which calls
  `auth.updateUser({ password })` on the server, sets own profile
  `must_change_password = false` (a trigger clears the stored temp password)
  and records the change for the office's activity log (0062); on an error
  the form shows the server's message; then `replace('/')`. Button **"Save password"** / **"Saving…"**; a ghost
  **"Cancel"** (router back) only when not forced. Network failure: "No
  connection. Try again when you have data."

### 1.8 Deactivated (`/deactivated`)

Icon, heading **"This account is deactivated"**, "Speak to your
administrator if you think this is a mistake.", and a **"Sign out"** button
(signs out, replaces to `/login`).

### Acceptance checks

- Typing `08012345678` or `+2348012345678` signs in the same account.
- A wrong phone and a wrong password give the identical message.
- The 11th attempt for one identifier within 15 minutes gets the 429 text.
- A merchandiser who signed in yesterday is sent to the login page with "A
  new day has started…" on the first navigation today.
- After clocking out, any page or API call ends the session with the
  clocked-out wording.
- Opening `/api/auth/expired` while validly signed in just lands on `/`.
- A new account is forced through "Set your password" before anything else.

---

## 2. First-run onboarding (`/welcome`)

- The field layout redirects to `/welcome` while `profile.onboarded_at is
  null` (migration 037). `/welcome` itself redirects to `/field` once
  onboarded, unless `?again=1`.
- Component `src/components/field/onboarding.tsx`. Five steps, in order:
  `welcome`, `photo`, `location`, `notifications`, `clock`.
- Top bar: round back button (hidden on step 1), one progress bar segment per
  step (filled up to the current one), and `n/5` counter.
- Big bottom button: a 64px pill with a white disc. Text per step:
  - step 1: **"Let's set you up"**
  - photo step without a photo: **"Add a photo first"** (disabled)
  - otherwise: **"Continue"**
  - last step: **"Start using Xtend"** (spinner while saving).

### Step 1 — Welcome

Heading "Welcome," then first name in brand colour with "!". Text "Xtend is
where your work day starts and ends. Here is how a day goes:" and four rows:

- **Clock in** — "At your store, with a quick selfie."
- **Work your store** — "Marketers check in at each store they visit."
- **Report and count** — "A daily report or a stock count when asked."
- **Clock out** — "At the end of your shift, with a selfie."

### Step 2 — Photo (required)

Title **"Add your photo"**, "Your photo helps your team recognise you. Face
the camera in good light." Large `ProfilePhoto` (see §11.3). Continue is
disabled until a photo is saved (or one already existed); hint "Add a photo
to continue."

### Step 3 — Location (not blocking)

Title **"Turn on location"**, "Xtend uses your location to confirm you are
at your store when you clock in." Numbered lines: "1. Tap the button below
and choose Allow." "2. In your phone's settings, set Location to High
accuracy." Button **"Allow location"** → `getCurrentPosition` (high accuracy,
timeout 20000 ms, maximumAge 0); becomes **"Location is on"** (green).
Permission denied shows: "Location is blocked. Open your phone's Settings,
then Apps, then Xtend or Chrome, and allow Location. You can carry on and do
this before you clock in." Any other error counts as on. Continue is never
blocked here.

### Step 4 — Notifications (not blocking)

Title **"Turn on notifications"**, "You need them to clock in. Xtend uses
them for stock counts and messages from the office." Button **"Turn on
notifications"** → `usePush().enable()`; done state **"Notifications are
on"**. Denied: "Notifications are blocked. Open your phone's Settings, find
Xtend (or Chrome), and allow Notifications. You can carry on and do this
before you clock in." Unsupported: "This browser cannot receive
notifications. Get the Xtend app from the download page, or open Xtend in
Chrome."

### Step 5 — Clocking in

Title **"Clocking in"**, "When you arrive at your store each day:" then
"1. Open Xtend inside your store." "2. Tap Clock in with selfie and take a
clear photo of your face." "3. Wait a moment while Xtend checks. That's it,
you are on shift." Image `/guide/staff-clock.png` (780×160). Line "Need more
help? The full guide is always under You." (link `/field/guide`).

Finish: RPC `finish_onboarding()` sets `onboarded_at`; then
`replace('/field')`. Failure: "That did not go through. Check your connection
and try again."

### Acceptance checks

- A new staff member cannot reach any `/field` page before finishing.
- Step 2 cannot be passed without a saved photo; steps 3 and 4 can.
- After finishing, `/welcome` redirects to `/field`; `/welcome?again=1`
  shows it again.

---

## 3. The field shell and home screen

### 3.1 Field layout (`src/app/field/layout.tsx`)

- `requireSession(FIELD_ROLES)`; `onboarded_at === null` → `/welcome`.
- Loads in parallel: count status (`store_count_status()`), `my_outlets()`,
  active `xm_stores` outlet ids, `my_place_due()`.
- `canFileReport` = role is marketer or admin (read from the session, no
  round-trip).
- `hasMetrics` = X Metrics is switched on (0063) and any of `my_outlets` is an active X Metrics store.
- Renders: the column; if a place is due, the **NamePlace** card at the top
  of every field page (§6); the page; `PhoneBeacon` (§13.2); `NativeBridge`
  (§13.6); `ActivityPing`; `FieldNav`.
- **Note for the builder (activity log, 0062):** the field app records
  activity silently for the admins' Activity log: `ActivityPing` (renders
  nothing) posts `app_open` to `/api/activity` on start and on return to the
  front; both Sign out buttons post `sign_out` first (waiting at most 1.5 s);
  sign-in, password and profile photo changes are recorded on the server.
  Failures are ignored and never shown. Staff see no text about this
  anywhere — not in the app, not in the staff guide. See
  `20-admin-dashboard.md` §27a.
- Error boundary title: "Your dashboard could not load" (home link
  `/field`).

### 3.2 Bottom navigation (`field-nav.tsx`)

Floating dark pill fixed at the bottom (`safe-bottom`, 8px from the edge).
Items in order, each an equal-width, 56px-high icon link with a visible label.
The active item has a white background; all labels remain visible:

1. **Home** `/field` (active only on exact match)
2. **History** `/field/history`
3. **Report** `/field/report` — only marketer/admin
4. **Count** `/field/count` — only while a stock count is open (§8.1)
5. **Metrics** `/field/metrics` — only when one of their stores is in X
   Metrics
6. **You** `/field/account`

### 3.3 Home page data (`src/app/field/page.tsx`)

Loads `my_day()` (DayState: date, can_file_report, profile, outlet with
lat/lng/radius/shift times, opening, closing, report_filed),
`my_store_visits()`, `my_visit_stores()` (the stores allocated to them for
the picker: id, name, address, lat, lng, geofence_radius_m, by name; **none**
when nothing is allocated, migration 060), `can_visit_stores()`, count
status, the user's avatar signed URL (1 hour), and
`my_calendar(p_from = today − 6, p_to = today)` for the week row (migration
059). Sign the avatar path from the authorized session profile without another
profile lookup. If `my_day` fails, show a connection error and a Try again button
which refreshes the route, disables while pending and announces loading.

`can_visit_stores()` is true for marketers and admins, and for a
merchandiser who has more than one outlet. The visit routes
(`POST /api/visits`, `POST /api/visits/[id]/end`) admit every field role
(`FIELD_ROLES`); the database trigger `store_visit_enforce()` refuses anyone
`can_visit_stores()` says no to, so a multi-store merchandiser can check in.

Account menu: outside pointer presses and Escape close it; Escape restores focus
to the avatar button. Links and sign-out have minimum 44px touch targets.

### 3.4 Home layout, top to bottom (`field-home.tsx`)

**23 October layout revision:** Your next step (`today-focus.tsx`) follows the greeting/outbox/tracker. It explains off days, clock-in, open visits, pending reports, active shifts and completed days, with links to the existing task. Shift pill and clock controls follow. Detail tabs are below the clock/location block. DayCard and WeekRow now render inside My day before its activity rows, rather than above all tabs. The numbered component descriptions below still define behaviour, but this order supersedes their previous placement.

0. (Layout) NamePlace card if due; (page) **CountDueBanner** if a count is
   open: orange card linking to `/field/count`, title "Stock count
   requested" or "Month-end stock count", sub "By <name> · due <long date>"
   or "due <long date>".
   Then, first inside the home component, the **clock-out prompt** (§5.9)
   when the shift has ended and they are still clocked in.
1. **Greeting header** (`greeting-header.tsx`): 56px round avatar (photo or
   initials, two letters) that toggles a menu; "Hi <first name>" and a bold
   subtitle: on shift "Have a good shift!", clocked out "Nice work today!",
   otherwise "Have a nice day!". Bell button on the right → `/field/account`
   (aria "Messages and account"). Menu items: **"Account and password"**
   (`/field/account`), **"How to use Xtend"** (`/field/guide`), **"Sign
   out"** (red; signs out and replaces to `/login`).
2. **OutboxBanner** (§5.8).
3. **ShiftTracker** setup prompt (native app only, §13.4).
4. **Tab chips** (horizontal, scrollable):
   - **Stores** — only when `canVisitStores`; it is then the default tab.
   - **My day** — default for everyone else.
   - **Outlet**, labelled **Base** when the user visits stores.
5. **Shift pill** (dark rounded bar): white disc with clock icon (check icon
   when done).
   - before clock-in: title "Today's shift", meta outlet name or "Clock in
     when you arrive", right button **"CLOCK IN"** (anchor `#clock`).
   - on shift: "On shift", "Since HH:MM · <outlet>", badge **"LIVE"**.
   - clocked out: "Shift complete", "See you next time", badge **"DONE"**.
   **Not working today** (only when today's `my_calendar` kind is `off` or
   `leave` and there is no clock-in yet; a missing calendar counts as
   working): muted rounded card with a palm-tree tile, bold **"Day off
   today"** / **"On leave today"** and "Enjoy your rest." / "Enjoy your
   leave." + " If you are working today, clock in as usual." Clocking in is
   never blocked on a day off.
The **LocationGate and ClockPanel** appear directly after the shift pill,
before the day-off notice, calendar and progress card. The place-name request
has a 2.5-second timeout and falls back to coordinates; GPS and selfie remain required.
Filters have minimum 44px height, and the login password toggle has a 44px square target.

6. **Week row**: the last 7 days ending today (6 days ago … today), weekday
   short name above a round date, a small word under it; today emphasised.
   Each links to `/field/history?d=<date>` (aria "<Wed> <14>, missed / day
   off / leave"). Each day is coloured by `calendarMark()` (§11.1):
   missed red, day off grey, leave soft orange, each with its word
   ("Missed", "Off", "Leave"); a worked day keeps the plain look with a
   brand "•" under it. Under the row: the **calendar legend** and a brand
   link **"Ask for leave ›"** (calendar icon) → `/field/leave`.
7. **Day card** (orange, rounded 2rem): store icon; status pill "Not
   started" / "In progress" / "Done"; italic "My day" and "<n>% done"; line
   "<outlet> · HH:MM–HH:MM" or "Have a good day"; one vertical bar per step
   (done bars tall white, pending short translucent) labelled In / Shift /
   Report / Out.
   - Steps: Clock in (opening exists); On shift (on shift or closed); Daily
     report (only if `can_file_report`; done when `report_filed`); Clock out
     (closing exists). Progress = round(done/total × 100).
8. **"You are at" line** (only when the location gate is ready): "You are at
   <place label or address>" or "finding the place name…" / "an unnamed
   spot"; "(your assigned store)" when the geocoder answered from the
   outlet; small line "lat, lng (5 dp) · accurate to ±N m · <distance> from
   your outlet". Place lookup is `GET /api/geocode?lat&lng&purpose=preview`,
   re-run only when the fix moves at 4-decimal rounding (~11 m)
   (`use-place.ts`).
9. **Clock area** (`id="clock"`): `LocationGate` wrapping `ClockPanel` (§4,
   §5).
10. **Tab content**:
    - Stores: `StoreVisits` (§7), loaded lazily with a pulsing placeholder.
    - My day: header "Progress" with "<n>% done", then ring rows:
      - Clock in: title time or "Clock in"; meta "Clocked in · on site / off
        site / not confirmed" or "Not yet today"; ring goes warning colour
        when off site.
      - Daily report (if allowed, links to `/field/report`): meta "Filed.
        Editable until midnight." or "Not filed yet · tap to file".
      - Clock out: meta "Clocked out", "At the end of your shift" or "Clock
        in first".
      - Each ring shows italic "Done" or "Due".
    - Outlet/Base: card with name and address ("No address on file"),
      details grid: Shift `HH:MM – HH:MM`; Geofence `N m`; You are
      ("Not on the map yet" if the outlet has no coordinates, "Locating…",
      or "N m away", green inside / red outside the radius); Your location
      (place or "Unnamed spot"); Fix accuracy `±N m` or "—". Link "Open the
      outlet on a map" (OpenStreetMap, zoom 17) when both a fix and outlet
      coordinates exist. No outlet: "No outlet is assigned to you yet." /
      "Ask your supervisor to assign one before you clock in." / link
      **"Contact support"**.

The distance shown on screen is display only (haversine in the browser);
the authoritative distance is computed by the database.

### Acceptance checks

- A marketer lands on the Stores tab; a merchandiser on My day.
- Report tab appears only for marketers/admins; Count only while a count is
  due; Metrics only with an X Metrics store.
- The progress percentage for a merchandiser after clock-in is 67% (2 of 3);
  for a marketer with clock-in and no report it is 50% (2 of 4).
- Tapping a day in the week row opens History on that date.
- With the default schedule, last Sunday shows grey "Off"; a past Monday
  with no clock-in (after the account was made) shows red "Missed"; a day
  of approved leave shows soft orange "Leave".
- On a day off with no clock-in, "Day off today" shows above the week row
  and the clock-in button still works; it disappears once clocked in.

---

## 4. Gates before clock-in

### 4.1 Location gate (`use-location-gate.ts`, `location-gate.tsx`, `src/lib/geo.ts`)

- On mount the home screen calls `requireFix()` (see §5.2 for the reading
  strategy). States: `checking`, `ready`, `blocked`.
- **Accuracy ceiling: 100 m** (`ACCURACY_CEILING_M`, `geo.ts`). A combined
  fix worse than that blocks with reason `low_accuracy` and message "Your
  location is only accurate to N m. Xtend needs 100 m or better."
- Block reasons and messages:
  - `permission_denied`: "Location permission is off. Xtend cannot record
    attendance without it."
  - `position_unavailable`: "Your phone could not get a location fix. Step
    outside or near a window and retry."
  - `unsupported`: "This browser cannot report your location."
- Every block is reported to `POST /api/location-block { reason, accuracy_m
  }` → RPC `log_location_block`, at most once per reason per mount (server
  throttles too). Offline: silently skipped.
- While checking: "Getting your location…" with a skeleton.
- Blocked card: title **"Location required"**, the message, and a help line
  per reason:
  - permission_denied: "Location permission is off for Xtend. Turn it on and
    this screen will clear itself."
  - position_unavailable: "Turn phone Location on, set it to High accuracy,
    and step outside or near a window."
  - low_accuracy: "Your phone is guessing from cell towers. Turn on
    high-accuracy GPS and wait a few seconds outdoors."
  - unsupported: "Open Xtend in Chrome. This browser cannot report
    location."
- **LocationHelp** (`location-help.tsx`):
  - Main button: **"Allow location"** when the browser can still prompt
    (permission `prompt` or unknown), else **"Try again"** ("Checking…"
    while busy). Under it when it can prompt: "Your phone will ask for
    permission. Choose Allow — Xtend only reads your location while you are
    using it." (says "iPhone" on iOS).
  - When denied: an expander **"How to turn location on in <platform>"**
    (auto-opened when denied) listing exact taps per platform
    (`locationSteps` in `src/lib/platform.ts`: iOS installed app, iOS
    Safari/Chrome, Android installed, Android Chrome, desktop), then "Xtend
    cannot open Settings for you — a website is not allowed to. Leave this
    page open while you go; it will notice as soon as location is allowed."
    and a button **"Copy this page's link"** → "Link copied" for 2.5 s.
  - iOS browser, not installed: "Adding Xtend to your Home Screen gives it
    its own entry in iPhone Settings, which is far easier to change than
    Safari's per-site permissions."
- Self-clearing: the Permissions API is watched; when permission flips to
  `granted` after a block, the gate retries automatically.
- While blocked, the clock button is not rendered at all.

### 4.2 Notification gate (`notification-gate.tsx`, `use-push.ts`)

- Required only for **clock-in** (not clock-out) and only when
  `profile.push_exempt` is false. Postgres trigger `attendance_push_check`
  refuses a clock-in for a field role without a live push subscription:
  "Turn on Xtend notifications before clocking in". A live subscription is
  an active `push_subscriptions` row whose endpoint is a known web-push host
  (FCM, Mozilla, Apple web push, Windows) or `native-fcm:` / `native-apns:`
  token (`has_live_push`).
- The gate replaces the clock button when push state is `off`, `denied`,
  `unsupported` or `working`. `unconfigured` (server has no VAPID key) does
  not block in the UI.
- Card: **"Turn on notifications to clock in"**, "Xtend needs to reach you
  during your shift, so clocking in needs notifications turned on for Xtend
  on this phone."
  - off: button **"Turn on notifications"**.
  - working: "Checking…".
  - denied: "Notifications are blocked for Xtend" plus, in the native app,
    "Open your phone's Settings, then Apps (or Notifications on iPhone),
    then Xtend, and turn Notifications on. Then come back here."; in a
    browser, "Tap the lock or settings icon next to the web address (or
    open your phone's Settings, then Apps, then Chrome or Xtend), choose
    Notifications, and set it to Allow. Then come back here and pull down to
    refresh."
  - unsupported: "This browser cannot receive notifications" plus on iPhone
    'On iPhone: tap Share, then "Add to Home Screen", and open Xtend from
    the new icon. Then turn notifications on here.', otherwise "Open Xtend
    in Chrome on this phone, then turn notifications on here." and "If it
    still does not work, ask your admin."
- `usePush` behaviour:
  - Native app: uses the OS permission (`nativePushPermission`) and
    registers the device token at `/api/push/native` on every start
    (`registerNativePush`). State on/off/denied.
  - Browser: no service worker or PushManager → `unsupported`; no
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → `unconfigured`; permission denied →
    `denied`. If a subscription exists and permission is granted, it is
    re-POSTed to `/api/push/subscribe` on every load (the server may have
    retired it); a non-401 failure unsubscribes and shows off. If permission
    is granted but the browser dropped the subscription, it re-subscribes
    silently on load (parity with the native app re-registering every start),
    so web alerts do not quietly lapse.
  - Enable: request permission, subscribe with the VAPID key
    (`userVisibleOnly: true`), POST the subscription JSON. Disable: DELETE
    `/api/push/subscribe { endpoint }` then unsubscribe.

### 4.3 What blocks clock-in (summary)

1. Not past the location gate (no fix ≤ 100 m).
2. Notifications not on (clock-in only; unless push-exempt).
3. Already clocked in today (unique; 409 "You have already clocked in
   today.").
4. Selfie missing, unchecked, rejected, older than 30 minutes, or reused
   (§5.6).
5. Capture time more than 2 minutes in the future or more than 24 hours old.

A due place-naming does **not** block clock-out (and there is no guard
trigger on attendance).

### Acceptance checks

- With location denied, the clock button never appears, and allowing it in
  settings clears the card without a tap.
- A 150 m-accurate fix shows "Your location is only accurate to 150 m…".
- Each distinct block reason posts one `/api/location-block`.
- With notifications off, the clock-in button is replaced by the gate; once
  clocked in, the clock-out button shows even with notifications off.

---

## 5. Clock-in and clock-out

Component: `src/components/field/clock-panel.tsx`.

### 5.1 The button

- `nextType` = `opening` if no opening today, `closing` if opened but not
  closed, else none.
- Button: 64px brand pill, white disc icon (log-in/log-out; pulsing camera
  while busy), italic label **"Clock in with selfie"** / **"Clock out with
  selfie"**, `›››` on the right. While busy the label is the current step
  followed by "…".
- Done for the day: success alert "Shift complete. One clock-in and one
  clock-out per day."
- Under it, always: "You do not have to choose a store."

### 5.2 Step 1: location first (`requireFix` → `bestFix`, `src/lib/geo.ts`)

Location is settled and named **before** the camera opens (a fix after the
photo is wherever they walked to; a refused fix after a selfie wastes the
selfie).

- Busy text "Getting your location", then "Naming the place".
- Defaults: `targetAccuracyM 20`, `settleMs 8000`, `minSamples 1`,
  `timeoutMs 20000`.
- **Native shell**: up to **6** readings from the OS plugin
  (`getNativeFix`, with Android mock-location flag and root/jailbreak
  check); stop early when the best reading ≤ target and min samples met, or
  after `settleMs`.
- **Browser**: `watchPosition` (high accuracy, maximumAge 0). Readings with
  a timestamp older than 2 s before the start are ignored (cached). Stop as
  soon as best ≤ 20 m; otherwise stop `settleMs` (8 s) after the first
  reading; if no reading at all within `timeoutMs` (20 s) → blocked
  (`position_unavailable`). An error after some readings just finishes with
  what there is. Polled every 250 ms.
- **Combining** (`combineFixes`): best = smallest accuracy; use readings
  with accuracy ≤ max(best × 2, best + 10); weighted average lat/lng with
  weight 1/max(acc,1)²; spread = max distance of used readings from the
  result; reported accuracy = max(best accuracy, spread); timestamp and
  extra fields from the latest used reading. Returns `samples`, `used`,
  `spread_m`. Any reading flagged mock/compromised marks the result.
- Ceiling: combined accuracy > 100 m → blocked `low_accuracy`.
- Reverse geocode: `GET /api/geocode?lat&lng` (no `purpose`, so the paid
  provider may be used; server uses the user's outlet as the answer when
  inside it). Returns `{ name, address, label, source: outlet|known|google
  |osm|coordinates }`; failure → all null.

### 5.3 Step 2: the in-app camera (`camera-capture.tsx`)

- Full-screen black dialog. Top: cancel (X, Escape also closes), title
  ("Clock in selfie" / "Clock out selfie"), subtitle with a pin = the place
  label, and a switch-camera button. Starts on the front camera (`user`).
- `getUserMedia({ video: { facingMode, width ideal 1280, height ideal 960 },
  audio: false })`. Front preview is mirrored; the saved frame is not.
- Errors: no API "This browser cannot open the camera. Use Chrome on your
  phone."; `NotAllowedError` "Camera permission is off. Allow the camera for
  this site, then try again."; `NotFoundError` "No camera found on this
  device."; other "The camera could not start. Close other apps using it and
  try again." with a **"Try again"** button. "Starting the camera…" while
  loading.
- Shutter: 80px round button (aria "Take the photo"). Footer text: "Taken
  live in the app. Photos from your gallery, or of a screen or a printed
  photo, are rejected."
- **Client quality check** (`src/lib/photo-quality.ts`): frame downscaled to
  160 px wide, grayscale. In order:
  - mean brightness < 35: "The photo is too dark. Move to better light, or
    face the light, and try again."
  - brightness > 235: "The photo is washed out. Move away from the direct
    light and try again."
  - contrast (std dev) < 10: "The camera sees almost nothing. Make sure
    nothing is covering it."
  - variance of Laplacian < 12: "The photo is blurry. Hold the phone still
    and try again."
  A failure shows the hint over the preview and keeps the camera open.
- With `locate` set (clock, visit, place photos), the GPS is followed while
  the camera is open (`followPosition`: `watchPosition`, high accuracy,
  timeout 30 s, keeps the last 20 readings, ignores readings older than 2 s
  before opening). At the shutter, readings from the last **10 s** are
  combined; if none, one native reading is tried, else it waits up to
  **4 s**. The result (or null) is passed with the photo.
- Frame saved as JPEG quality 0.92.

### 5.4 Step 3: prepare and send

1. If the first fix is older than **90 s** (`STALE_FIX_MS`) when the photo
   arrives, re-read the location ("Checking your location again") and
   re-geocode.
2. "Compressing your selfie": `processSelfie` (`src/lib/image.ts`): width
   min(640, source) keeping aspect; JPEG quality from 0.82 down in steps of
   0.12 (not below ~0.35) until ≤ **150 KB**; plus a **200×200** cover-crop
   thumbnail at quality 0.7.
3. "Sending": `submitOrQueue({ kind: 'clock', … })`. The job carries type,
   lat, lng, accuracy_m, address, place_name, place_source,
   `client_captured_at` = the fix's capture time, selfie and thumb blobs, and
   `device_info`:
   - `deviceInfo()`: ua, platform, languages (3), screen `WxH@dpr`, cores,
     memory_gb, network type, tz, tz_offset_min, standalone, `anchor_beacon`
     (last acknowledged beacon id, §13.2).
   - `selfie_source: 'in_app_camera'`.
   - `position`: `{ first, shutter, apart_m, agree }` where each point has
     lat, lng, accuracy (1 dp), captured_at, samples, spread; agree when
     apart ≤ max(50, accA + accB) (`positionCheck`, `fixesAgree`).
   - `gps`: altitude, altitude_accuracy, speed, heading.
   - native only: mock flag, compromised flag, platform
     (`nativeDeviceSignals`).
4. Running the job (`runClock`, `src/lib/offline/sync.ts`):
   - Upload to bucket **`selfies`** at `{userId}/{uuid}.jpg` and
     `{userId}/{uuid}_thumb.jpg` (upsert).
   - `POST /api/photo-check { bucket: 'selfies', path, thumb_path }` (§5.6).
     A 4xx is final for that photo.
   - `POST /api/attendance` with the fields above plus `selfie_path`,
     `thumb_path`, and `device_info.sent_at` = now.

### 5.5 Server: `POST /api/attendance`

- Field roles only; zod shape (`address` ≤ 500, `place_name` ≤ 200 cleaned
  map text; `place_source` enum; `client_captured_at` ISO with offset).
- `selfie_path` must start with `{userId}/` ("Selfie path does not belong to
  you").
- Insert into `attendance`; triggers decide:
  - `attendance_enforce`: sets user, created_at, attendance_date (business
    date). Measures against the **nearest** of the person's own stores that
    has coordinates; if they have a store still waiting for coordinates and
    are not inside a measured one, the event is left unmeasured; if they
    have no measurable store, any active outlet containing the point is used.
    Status: accuracy > 100 → `flagged`; no distance → null; distance ≤
    radius (default **150 m**) → `on_site`; else `off_site`. Capture time
    must be within **+2 minutes / −24 hours** of now ("Invalid capture
    timestamp").
  - `attendance_push_check` (clock-in), `selfie_check`, `attendance_timing`
    (phone clock vs server), place-due, integrity, punctuality, alerts.
- Errors: 23505 → 409 "You have already clocked in today." / "You have
  already clocked out today."; invalid timestamp → 400 "That capture is too
  old or your phone clock is wrong. Try again now."; other raised messages
  verbatim.
- Off-site or flagged: watchers (admins/supervisor) are pushed a
  notification. VPN/IP/mock checks run best-effort and never fail the
  clock-in. New flags are pushed to watchers.
- Response 201: `{ attendance: { id, type, status, distance_m, address,
  accuracy_m, created_at, outlet_radius_m, outlet_id, outlet_name },
  sign_out }`. `sign_out` is true for a **closing** by a merchandiser or
  marketer.

### 5.6 Photo check (`POST /api/photo-check`, `src/lib/photo-check.ts`)

- Body `{ bucket: selfies|reports, path, thumb_path?, kind?:
  shelf|storefront|product_selfie }`; selfies bucket always means kind
  `selfie`; reports bucket defaults to `shelf`. Paths must be in the
  caller's folder.
- Idempotent: an existing `photo_checks` row for the path returns the same
  verdict.
- With `ANTHROPIC_API_KEY`: the image is judged by a vision model (45 s
  timeout, 1 retry) returning verdict pass/reject, problem, message to the
  worker, setting. Uncertain → pass. Without the key, or on a model error,
  the verdict is `unchecked` and the photo is allowed.
- Verdict stored for the photo and its thumbnail. Reject → **422** `{
  verdict, error: <message> }` (default "That photo cannot be used. Take it
  again."). Upload missing → 400 "The photo was not uploaded. Take it
  again."
- Rejects and (when configured) unchecked photos raise an integrity flag;
  a passed selfie whose background is a home raises `selfie_at_home`. None
  of this is shown to staff.
- `selfie_check` trigger messages (shown verbatim): "A clock-in needs a
  selfie taken in the app"; "That selfie was rejected. Take a new one, live,
  of your face"; "The selfie has not been checked. Take it again in the
  app"; "The selfie must be taken in the app just now" (object older than
  **30 minutes**, `photo_is_fresh`); "That selfie has already been used".

### 5.7 What the phone shows after sending

Outcome alert (`clock-panel.tsx`); `where` = place label or "lat, lng":

- `on_site`: success **"Clocked in"/"Clocked out"**, "Location: <where>.
  That is <distance> from <store> — inside the store area." (`<store>` =
  the outlet the server measured against, else home outlet, else "your
  outlet".)
- `off_site`: warning **"Clocked in off site"/"Clocked out off site"**,
  "Location: <where>. That is <distance> from <store>, outside the <radius>
  m store area." (radius from the server, else the outlet's, else 150).
- null status with accuracy ≤ 100: success, "Location: <where>."
- otherwise: warning, "Location: <where>. Your location was not clear
  enough to match to your store. Next time, wait a moment outside for a
  better signal."
- Queued (offline): info **"Saved on your phone"**, "No data right now. This
  clock-in is queued from <where> at HH:MM, about <distance> from your
  outlet, and will send itself when you get signal."
- After a successful **clock-out** with `sign_out`: info alert **"You are
  signed out for today"**, "Clocking out ends your login. Log in again next
  time you start work." and button **"OK"** → `/api/auth/expired?reason=
  clocked-out`. Otherwise the page refreshes.
- Errors (destructive alert): GeoBlocked message, a permanent rejection
  message (e.g. the photo-check message), or "That did not go through. Try
  again."

Late and early: computed only on the server (`attendance_punctuality`):
grace **15 minutes** (`punctuality_grace_minutes()`); late if the capture
time is more than 15 minutes after shift start, early if more than 15
minutes before shift end; severity high above 60 minutes. Measured from the
capture time, so an offline clock-in is not late for waiting for signal.
**Nothing about late/early is shown to staff.**

### 5.8 Offline behaviour (outbox)

Storage: IndexedDB database `xtend` version 1, object store `outbox`
(auto-increment `id`, index `by_queued_at`) (`src/lib/offline/db.ts`).
Record: `{ kind, job, attempts, last_error, queued_at }`. Kinds: `clock`,
`ping`, `report`, `report_file_remove` (0065), `xm_count`, `xm_sales`. Blobs
(selfie, thumb, photos, documents) are stored in the job. A queued report's
documents record their progress on the record (`uploaded_path`), so a
retry only uploads what has not gone yet (0065).

`submitOrQueue(job)`:

- `navigator.onLine === false` → enqueue, return `{ queued: true }`.
- Else run it now. A `PermanentJobError` (any 4xx other than 401/423) is
  thrown to the UI and nothing is queued. Any other failure (network, 5xx,
  401, 423) → enqueue; a 423 sets `waitingForPlace: true`.
- 401 with `code: 'relogin'` also sends the browser to
  `/api/auth/expired?reason=new-day`; the job stays queued.

`flushOutbox()`:

- One flush at a time. Oldest first.
- Drop a record when its capture is older than **24 h** (`MAX_AGE_MS`), or
  **72 h** for `xm_count`/`xm_sales` (`XM_MAX_AGE_MS`), or after **8**
  attempts (`MAX_ATTEMPTS`).
- Consecutive `ping` records are sent as one batch of up to **400** to
  `POST /api/pings/offline { sent_at, points[] }` (server accepts 1–500).
- A permanent rejection drops the record; a transient failure marks the
  attempt and **stops** the flush (order is preserved).
- A `report_file_remove` that is dropped (too old, too many tries, or
  refused) is never silent: it leaves a notice for the report page (see the
  report's **Attach documents**).
- Flush triggers: OutboxBanner mount (when online), the `online` event (in
  OutboxBanner and PhoneBeacon), the **"Send now"** button, after a
  successful heartbeat ping when the outbox is non-empty, and after a place
  is named.

OutboxBanner (`outbox-banner.tsx`): counts non-ping records every **15 s**.
Hidden when nothing is pending and online. Text "<n> item(s) waiting to
send." with **"Send now"** ("Sending…") when online; offline with nothing
pending: "You are offline. Anything you save is kept on this phone." Pings
are never counted.

Service-worker fallback page `/offline`: "You are offline" / "Anything you
saved while offline is queued on this phone and will be sent the moment you
have data. Nothing is lost."

### 5.9 Clock-out reminder (migration 0061)

Timing and wording in `src/lib/clock-out-reminder.ts` (plain functions, no
imports, shared by the phone, the server and
`scripts/check-clock-out-reminder.ts`):

- Shift end = the home outlet's `shift_end` (`day.outlet.shift_end`), else
  **18:00** (`DEFAULT_SHIFT_END`); shown as `HH:MM` (`shiftEndLabel`;
  anything unusable → 18:00). Lagos is UTC+1, no daylight saving.
- `clockOutDue(state, now)`: clocked in, not clocked out, and `now` is from
  the shift end on that business date up to (not including) **midnight
  Lagos** at the end of it.
- Pushes (sent by the five-minute job, `30-rules.md` §2.8), both opening `/field`:
  - stage 1 at the shift end: **"Time to clock out"** / "Your shift ended at
    HH:MM. Clock out with a selfie before you leave."
  - stage 2 **60 minutes** later (`SECOND_REMINDER_MIN`): **"You have not
    clocked out yet"** / "Your shift ended at HH:MM. Please clock out with a
    selfie now."

**The prompt** (`src/components/field/clock-out-prompt.tsx`), the first
thing on the home screen while `clockOutDue` (state = `{ date: day.date,
shiftEnd: day.outlet?.shift_end ?? null, clockedIn, clockedOut }`):

- Brand-orange rounded card (`role="alert"`), white round bell tile, bold
  **"Your shift ended at HH:MM. Clock out now."**, then "Take your
  clock-out selfie before you leave."
- Big white pill button **"Clock out"** (log-out icon): scrolls to `#clock`
  and dispatches the window event `xtend:clock-out` (`CLOCK_OUT_EVENT`);
  `ClockPanel` listens for it while `nextType === 'closing'` and nothing is
  busy or pending, and starts the clock-out exactly as its own button
  (location, then camera).
- Still checked in at a store (an open visit): the text becomes "You are
  still checked in at <store>. Check out of it first, then clock out." and
  the button **"Check out of <store>"** (store icon) switches to the Stores
  tab and scrolls to it (`id="stores"`). The store is the visit's
  `store_label`, else `outlet_name`.
- Appears on its own: a timer wakes at the shift end
  (`msUntilClockOutDue` + 500 ms) and again at midnight to remove it; it
  re-checks when the page becomes visible (phones pause timers).

### 5.10 Five-minute heads-ups (migration 0069)

Timing and wording in `src/lib/shift-reminder.ts` (plain functions, shared
by the phone, the server and `scripts/check-shift-reminders.ts`; it reuses
`shiftEndAt`, `shiftEndLabel` and `dayEndAt` from `clock-out-reminder.ts`):

- Shift start = the home outlet's `shift_start` (`day.outlet.shift_start`),
  else **08:00** (`DEFAULT_SHIFT_START`; anything unusable → 08:00), shown as
  `HH:MM` (`shiftStartLabel`). Shift end as in §5.9 (18:00 default).
- `HEADS_UP_MIN` = 5. A heads-up shows inside **[time − 5 min, time)** on
  that Lagos business date, never at or after the time, never after
  midnight.
- `clockInSoon(state, now)`: not clocked in, a working day (`workingDay`:
  today's calendar kind is `working`, not `off` or `leave`), inside the five
  minutes before the start.
- `clockOutSoon(state, now)`: clocked in and not out, inside the five
  minutes before the end.
- `soonDue(state, now, sent)`: which one the job would send
  (`'clock_in_soon' | 'clock_out_soon'`), none already sent, none once the
  time has passed (a late job sends nothing stale).
- `msUntilSoonChange(state, now)`: ms until a heads-up appears or goes;
  null when nothing more changes today.
- Pushes (sent by the five-minute job, `30-rules.md` §2.9), both opening
  `/field`:
  - clock in: **"Time to clock in"** / "Your shift at <store> starts at
    HH:MM. Clock in with a selfie when you arrive." (no store: "Your shift
    starts at HH:MM. …").
  - clock out: **"Your shift ends soon"** / "Your shift ends at HH:MM. Get
    ready to clock out with a selfie."

**On the home screen** (`src/components/field/shift-soon-prompt.tsx`,
`ShiftSoonPrompt`, placed first, before the greeting; state = `{ date:
day.date, shiftStart: day.outlet?.shift_start ?? null, shiftEnd:
day.outlet?.shift_end ?? null, clockedIn, clockedOut, workingDay:
todayKind === 'working' }`):

- While `clockInSoon`: a gentle card (`role="status"`, soft tint
  background, thin brand border, round alarm-clock tile) with bold "Your
  shift starts at HH:MM." and "Clock in when you arrive.", and a brand pill
  button **"Clock in"** (log-in icon) that scrolls to `#clock` and focuses
  the clock panel's button (`id="clock-button"`), without starting the
  camera.
- While `clockOutSoon`: one tint line (alarm-clock icon) "**Your shift ends
  at HH:MM.** Get ready to clock out." At the end itself §5.9's prompt
  takes over.
- A timer wakes at each change (`msUntilSoonChange` + 500 ms) and it
  re-checks when the page becomes visible.

### Acceptance checks

- The camera only opens after a fix ≤ 100 m is in hand, and its subtitle
  names the place.
- A black or covered lens frame never leaves the phone; the hint shows and
  the camera stays open.
- A selfie of a phone screen is refused with the model's one-line message,
  and nothing is queued.
- Selfie objects appear at `selfies/{uid}/{uuid}.jpg` and `_thumb.jpg`,
  ≤ 150 KB and 200×200.
- Airplane mode: clock-in shows "Saved on your phone", the banner shows "1
  item waiting to send", and it sends itself on reconnect with the original
  capture time.
- Clocking out as a merchandiser shows the result then "You are signed out
  for today"; OK lands on the login page with the clocked-out notice.
- A second clock-in the same day shows "You have already clocked in today."
- Clocked in at a store whose shift ends 17:00: at 16:59 there is no prompt;
  with the app left open, at 17:00 "Your shift ended at 17:00. Clock out
  now." appears without a reload, and its button opens the clock-out
  camera after the location step. With no store the time is 18:00.
- A marketer still checked in at a store is first offered "Check out of
  <store>"; after clocking out, or after midnight Lagos, the prompt is gone.
- A store starting 09:00, not clocked in, a working day: with the app open,
  at 08:55 "Your shift starts at 09:00. Clock in when you arrive." appears
  without a reload, its **Clock in** button scrolls to the clock panel, and
  at 09:00 the card is gone. On a day off or leave it never shows. Clocked
  in at a store ending 17:30: from 17:25 "Your shift ends at 17:30. Get
  ready to clock out." shows, replaced at 17:30 by the clock-out prompt.

---

## 6. Naming a place Xtend does not know (migration 045)

### 6.1 When it becomes due (server)

After a **clock-in** (not clock-out) or a **store check-in**,
`raise_place_due` runs with the fix and `device_info.position`:

- Skip if accuracy is missing or > 100 m.
- If the shutter reading exists and is more than max(30, acc + shutter
  acc) metres from the first fix, skip (the position is not certain).
- Skip if either point is inside an outlet's fence or a known place
  (`place_is_recognised`). The more accurate of the two points is used.
- Skip if this person already has an unnamed due today within **150 m**
  (a dismissal by the office holds for the rest of the day there).
- Otherwise insert `place_naming_due` (user, lat, lng, accuracy, source
  `clock_in`|`visit`, source id, due_date).

`my_place_due()` returns the oldest open due for today (not named, not
dismissed).

### 6.2 What waits

`place_due_guard` triggers refuse inserts into `reports`, `store_counts`,
`store_visits`, `xm_counts`, `xm_sales` while a due is open, with "Name the
place you clocked in at first: take a photo of the store sign outside and a
selfie with our product" and hint `place_naming_due` (→ HTTP 423). Clock-out
is never blocked. Offline-capable jobs (report, X Metrics) are kept on the
phone and sent after naming.

### 6.3 The card (`name-place.tsx`)

Shown at the top of every field page while due. Orange-bordered card, no
dismiss button.

- Title **"Add this place before you go on"**. Text: "Xtend does not know
  where you clocked in [checked in]. Add it once, standing outside, and
  Xtend will recognise it next time, for you and everyone else. Store
  visits, counts, sales and your report wait until it is done. You can
  still clock out."
- Step 1 "The name on the store or plaza sign": text input, placeholder "e.g.
  Ojota Shopping Plaza", max 120. Rule `thingName(120, 'name on the store
  sign')`: 2–120 characters after cleaning, real words ("Type the name on
  the store sign in words"), no links. Empty: "Type the name on the store
  sign."
- Step 2 "Photo of the building from outside, with the sign showing":
  button "Open the camera" (enabled only once the name is valid). Pressing
  it first locks the location ("Locking your location") with
  `bestFix({ targetAccuracyM: 15, minSamples: 3, settleMs: 15000, timeoutMs:
  30000 })`, clears both photos, then opens the **back** camera titled "The
  building and its sign", subtitle "Stand outside so the sign is in the
  photo", with `locate`.
  - If the shutter reading disagrees with the locked fix (apart > max(50,
    accA + accB)): "Your location jumped N m while you took the photo. Stand
    still outside, wait a moment, and take it again." and the photo is
    discarded.
- Step 3 "Selfie holding one of our products": enabled after the sign
  photo; **front** camera titled "Selfie with our product", subtitle "Hold
  the product up next to your face", with `locate`. If the shutter point is
  more than max(100, place acc + selfie acc) from the place position: "Take
  the selfie at the place, next to the sign."
- Taken steps show "Sign photo taken (tap to retake)" / "Selfie taken (tap
  to retake)".
- After the lock: "Location locked from <used> of <samples> GPS reading(s),
  accurate to about N m; the photo of the sign was taken at the same spot."
- Place position = combine(first fix, sign shutter fix).
- Button **"Save this place"**, enabled when name valid, fix, both photos.
  Steps: offline → "You need signal to name the place. Your other work stays
  on the phone until then."; "Checking the photo of the sign" (compress with
  report settings, upload to `reports/{uid}/place-sign-{uuid}.jpg`, photo
  check kind `storefront`); "Checking the selfie" (`reports/{uid}/place-
  selfie-{uuid}.jpg`, kind `product_selfie`); a rejected photo is cleared for
  retake; "Saving the place" → `POST /api/places/name { due_id, name, lat,
  lng, accuracy_m, storefront_path, selfie_path, evidence: { first, sign,
  selfie } }`.
- Success: "Thank you. Xtend will recognise this place from now on." Then
  the outbox is flushed and the page refreshed.
- Network failure: "No connection. Your photos are still here; try again
  when you have signal."

### 6.4 Server: `name_place()`

Messages in order (verbatim to the phone):

- not theirs: "There is no place for you to name" (already named: returns
  the place quietly).
- name not 2–120: "Type the name on the store sign".
- accuracy > 100: "Your location is not accurate enough. Step outside, away
  from the building, and try again".
- more than **200 m** from the due point: "Name the place from where you
  clocked in: you are N m away".
- sign evidence further than max(30, acc + sign acc): "Your location moved
  while you took the photo of the sign. Stand still outside and take it
  again".
- selfie evidence further than max(100, …): "Take the selfie at the place,
  next to the sign".
- storefront photo not fresh (30 min) or not checked as `storefront`
  pass/unchecked: "Take the photo of the store sign from outside, in the
  app"; same for selfie: "Take the selfie holding our product, in the app".
- photos reused from a known place: "Take new photos here".
- the name overlaps an outlet or verified known place more than **500 m**
  away: "That name does not match where you are standing. Type the name on
  the sign here".

On success it upgrades a clock-in guess at that spot, or creates a known
place (`learn_place`, source `staff`) unless the point is inside an outlet,
and closes **every** open due of this person within 200 m. The route checks
both paths are in the caller's folder.

### Acceptance checks

- Clocking in at an unknown spot shows the card on every field page; the
  report submit then returns 423 and the report is kept on the phone with
  "Your report is saved on this phone. It is sent as soon as you add the
  place at the top of the screen."
- The sign photo cannot be taken before a valid name is typed.
- Walking 60 m between lock and shutter (with ~10 m accuracy) shows the
  "location jumped" message.
- After saving, the card disappears and queued work sends.
- Clock-out works while the card is showing.

---

## 7. Store visits (marketers)

Component `src/components/field/store-visits.tsx`, on the **Stores** tab.

- Header "Store visits" with "<n> done today".
- One open visit at a time (the database refuses a second: 409 "You are
  already checked in to a store. Check out of it first.").
- The store list is **the person's own stores** (`my_visit_stores()`,
  migration 060: their allocated stores plus their home store, only once
  they have at least one allocation; otherwise empty), sorted nearest first
  when a fix exists (a store with no pinned lat/lng sorts last and is never
  "here"). `here` = the first listed store whose fence contains the current
  fix (display only).

### 7.1 No open visit

- Button **"Check in here"** (camera icon). Under it: "You are at <store>."
  or "Xtend will work out where you are."
- **"Pick the store myself"** (ghost) when the list has at least one store.
  Opens a card "Which store are you at?" / "These are the stores on your
  list. Only needed if Xtend did not recognise the shop you are in.", rows
  with name and "N m away" (or address), a **"Here"** badge when inside the
  fence, and **"Cancel"**.
- With an empty list, instead of that button: muted rounded line "No stores
  are allocated to you yet. Ask your supervisor." ("Check in here" still
  works.)

### 7.2 Check-in flow

Same order as clock-in: location (`requireFix`), "Naming the place"
(geocode), then the camera titled "Check in at <store>" / "Check in", front
camera, `locate`. After the photo: stale fix (> 90 s) re-read,
"Compressing your selfie" (`processSelfie`), "Uploading" to
`selfies/{uid}/{uuid}.jpg` + `_thumb.jpg`, "Checking the photo" (photo
check; rejection shown and stops), "Checking in" → `POST /api/visits {
outlet_id | null, lat, lng, accuracy_m, address, place_name, selfie_path,
thumb_path, device_info { …deviceInfo, selfie_source, position },
client_captured_at }`. **Not offline-capable**: network errors are shown.

Server (`store_visit_enforce`): only `can_visit_stores()` ("Only marketers
record store visits" → 403 "Only marketers record store visits."); sets
user, times, visit_date, status `open`. **Allocated stores only** (migration
060): once the person has at least one `staff_outlets` row
(`has_allocated_stores`), a hand-picked store that is not theirs is
refused, and so is checking in without picking while standing inside the
fence of a store that is not theirs (unless one of their own stores' fences
also covers the spot; the nearest of theirs wins) → 403 **"This store is not
on your list. Ask your supervisor to add it."** Without any allocation the
old behaviour stands: if no outlet given, uses the outlet whose fence
contains the point; if none, the visit stands alone (status null unless
accuracy > 100 → flagged). With an allocation, a spot inside no fence at all
also stands alone. With an outlet: inactive/missing outlet
errors; distance and status (≤ fence → on_site, else off_site, accuracy >
100 → flagged). Capture time window +2 min/−24 h. Selfie check and place-due
guard apply; a visit can itself raise a place due. Off-site/flagged notify
watchers. Response includes `outlet_name`, `store_label` (outlet name inside
its fence, else the map's premises name) and `store_label_source`.

Success messages:

- on_site: "Checked in at <label>. You were <distance> from the door."
- off_site: "Checked in, but you are <distance> from <store>."
- otherwise: "Checked in at <label>."

### 7.3 Open visit card

Store label with badge **"On site"** (green) or **"Off site"** (red), "In
store since HH:MM · N min", button **"Check out of <store>"**.

Check-out: location ("Checking your location"), geocode, "Checking out" →
`POST /api/visits/{id}/end { lat, lng, accuracy_m, address, place_name }` →
RPC `end_store_visit`. No selfie. 409 if already closed, 404 if not theirs.
Message: "Checked out of <store> after N minutes."

### 7.4 Done visits list

Rows: label, "HH:MM – HH:MM · N min · <distance> from door"; trailing icon:
abandoned → clock (warning), on site → green check, otherwise red clock.

### Acceptance checks

- A marketer can check in without choosing a store and the server attributes
  it to the store whose fence they are in.
- Checking in a second time without checking out gives the 409 text.
- Check-out takes no photo and reports the minutes.
- With no signal, check-in shows an error (it is not queued).
- A marketer with stores allocated sees only those in "Pick the store
  myself"; checking in inside another store's fence shows "This store is not
  on your list. Ask your supervisor to add it." A marketer with no
  allocation sees "No stores are allocated to you yet. Ask your supervisor."
  and can still check in anywhere.

---

## 8. Daily report (marketers and admins)

Page `/field/report` (`src/app/field/report/page.tsx`); other roles are
redirected to `/field`.

- Sheet screen (orange header with back arrow to `/field`). Title "New
  daily report" or "Edit today's report". Header fields: Filed by, Outlet
  (or "No outlet assigned"), Date (long form of the business date).
- **Today's store visits** on top, above the form
  (`src/components/field/report-visits.tsx`, data `my_store_visits()`,
  lines from `visitLines()` / `visitTotals()` in `src/lib/marketer-report.ts`):
  section header **"Today’s store visits"** with "<time> in stores" in
  brand on the right; one row per visit in arrival order: store icon, store
  (store label, else outlet name, else "Unnamed place"), "In HH:MM · out
  HH:MM" (an open visit shows "still checked in" in brand), and the time on
  the right (`duration()`: "45 min", "1 h 20 min", "2 h"). Under the rows a
  tint bar "<n> visit(s) · <n> store(s)" / "Total time in stores: <time>"
  and "These are added to your report when you save it." No visits: muted
  "No store visits yet today. Check in and out at each store from the
  Stores tab and they appear here." Nothing to type: the database copies
  the day's visits into the report on every save (`reports.store_visits`,
  `30-rules.md` §2.6).
- Form (`report-form.tsx`): five sections as chips, one textarea shown at a
  time (min height 132px, autofocus), counter "<n>/5 filled", a check on
  filled chips, `*` on required unfilled ones.

| Chip | Label above textarea | Placeholder | Required | Max |
|---|---|---|---|---|
| The day | How the day went | Footfall, staffing, anything notable. | yes, min 10 | 4000 |
| Sales | What moved | Units sold, best sellers, value. | yes, min 10 | 2000 |
| Stock | What is on the shelf | What is low, what is out, what arrived. | yes, min 10 | 2000 |
| Competitors | What they are doing | Promos, new SKUs, price moves. Leave empty if nothing. | no | 2000 |
| Issues | What needs the office | Anything head office has to act on. Leave empty if nothing. | no | 2000 |

- Validation (`writtenText`, `src/lib/fields.ts`), checked on the phone
  before saving because a queued report is refused where nobody sees it:
  "Keep "X" under N characters", "Write a little more for "X"", "Write "X"
  in words", "Leave links out of "X"". The first failing section is
  selected.
- Photos: up to **5** per report including ones already saved (`MAX_PHOTOS`).
  Buttons **"Take photo"** (in-app camera, "Report photo", no locate) and
  **"From gallery"** (multiple). Each is compressed by `processReportPhoto`:
  width ≤ 900, JPEG from 0.78 stepping down 0.12 until ≤ **220 KB**.
  Thumbnails with remove buttons. Report photos are not photo-checked.
  Each photo gets its id (`newClientId()`) the moment it is taken or picked
  (0067); it is the name it is uploaded under.
- **Attach documents** (migration 0064, `report-files.tsx`, rules in
  `src/lib/report-files.ts`), below the photos: label "Attach documents
  (<n>/5)", text "Price lists, display plans, invoices or anything else for
  the office: PDF, Word, Excel or CSV files, or pictures. Up to 5, each 10 MB
  or smaller." Button **"Choose documents"** (dashed brand, multiple, accept
  = the allowlist and its endings) while fewer than 5 are attached or
  waiting. Accepted types: PDF, Word (.doc, .docx), Excel (.xls, .xlsx), CSV,
  JPEG, PNG, WebP, HEIC/HEIF; the ending decides when the phone gives no
  type, and a `.csv` Windows calls `application/vnd.ms-excel` is stored as
  `text/csv` (`reportFileType`). Each refused file says why, in a red list:
  "<name>: attach a PDF, Word, Excel or CSV file, or a picture." / "<name>:
  the file is empty." / "<name>: each document must be 10 MB or smaller." /
  "<name>: a report can have up to 5 documents." (`checkReportFiles`). Rows:
  type icon, name, "<PDF|Word|Excel|CSV|Picture> · <size> · Attached" (a
  saved one, the name links to `/api/report-files/<id>`) or "… · Sent when
  you save" (picked, not yet sent), and a 44 px **×** to remove. Each picked
  file gets its id (`newClientId()`) the moment it is picked; it is the name
  it is uploaded under. Removing a picked one only drops it from the list.
  Removing a saved one (0065) goes through `submitOrQueue({ kind:
  'report_file_remove', file_id, name })`: the row reads "… · Removing…"
  at once (dimmed, no link, no ×) and stops counting towards the five;
  online and accepted, it disappears and the page refreshes; with no
  signal it waits in the outbox and the row stays "Removing…" (also after
  reopening the page, read from the outbox), with the muted line
  "Documents you removed are taken off the report as soon as your phone
  has signal." The page checks the outbox every 5 s and on `online` (flushing
  when removals wait) and refreshes when one has gone. A removal that
  reaches the server after midnight is refused and dropped from the queue;
  the next time the report page is open it shows, in a tint (light brand) list
  above the documents, "“<name>”: This document could not be removed
  because the report closed at midnight." (once). Any other final refusal,
  or one given up after 8 tries: "“<name>”: This document could not be
  removed. Open today’s report and remove it again if you still want it
  gone." Refused while the person watches, the same words show in the red
  list. Sizes read "850 KB", "1.2 MB" (`fileSizeLabel`).
- Submit **"Submit report"** / **"Update report"** ("Saving…") →
  `submitOrQueue({ kind: 'report', …, photos: [{ blob, client_id }], files })`: uploads photos to
  `reports/{uid}/report-photo-{client_id}.jpg` (no upsert, 0067) and documents to the private bucket
  **`report-files`** at `{uid}/report-{client_id}.{ext}` (contentType = the
  stored type, no upsert), then `POST /api/reports { fields…, photo_paths,
  files[{ path, name }] }`. Documents are kept in the outbox with the
  report while offline (the job's `files` is optional for jobs queued
  earlier). A retry (0065 for documents, 0067 for photos) skips files
  already uploaded and treats storage's "already exists" as uploaded, and
  the database answers a document or photo already on today's report with
  the same row, so nothing is uploaded or attached twice; a report queued
  before 0067 gives its photos ids on its first try. Saving with new documents while a removal is
  still queued flushes the outbox first, so the removal frees its place. The route calls `add_report_photo(path)` for each photo (0067; a
  refusal returns 400 "Your report is saved, but photo <n> was not added:
  <reason>") and `add_report_file(path, name)` for each document after
  saving the report; a refusal returns 400 "Your report is saved, but
  <name> was not attached: <reason>".
- Server: one report per person per business day; a second submission
  updates today's row; the database refuses edits on any other day
  ("editable until midnight"). Report photo limit enforced by trigger.
  Place-due guard on insert.
- Messages: "Report saved. You can keep editing it until midnight."; queued
  "No data right now. Your report is saved on this phone and will send
  itself when you get signal."; waiting for place (see §6). Footer: "One
  report per day. Editable until midnight, not after."

### Acceptance checks

- Submitting with "The day" at 5 characters selects that chip and shows
  "Write a little more for "The day"".
- After 3 photos saved, only 2 more can be added.
- Re-submitting the same day updates rather than creating a second report.
- Offline submit queues and later sends with photos and documents.
- Picking a 12 MB PDF and a `.exe` lists two reasons and attaches neither;
  after 3 saved documents only 2 more can be picked.
- A saved document can be removed the same day; the next day the report and
  its documents are locked (the database refuses).
- After two visits today (50 min and 40 min, one still open), the top of
  the report lists both in arrival order, the open one "still checked in",
  and the bar reads "2 visits · 2 stores" / "Total time in stores: 1 h 30
  min". Saving the report stores the same visits with it, whatever the
  phone sends.

---

## 9. Stock count (Xpel sheet)

### 9.1 When counting is open

`store_count_status()` (Postgres) returns one of:

- `{ open: true, reason: 'request', request_id, due_date, note,
  requested_by }` — a supervisor/office asked.
- `{ open: true, reason: 'month_end', due_date: last day of month }` — the
  last **3** days of the month (`month_end_count_days() = 3`).
- `{ open: false, reason: 'none', next_month_end }` (first day of the
  window).
- `{ open: false, reason: 'not_allowed' }` — person does not count stock
  (also returned if the function is missing).

The Count tab and home banner exist only while open (the paper sheet is
also on the You page at any time, §11.2). `/field/count` with
`not_allowed` redirects to `/field`; with `none` shows "No stock count is
due. You count when your supervisor asks for one, and at the end of every
month. The next month-end count opens on <long date>."

### 9.2 Page (`src/app/field/count/page.tsx`)

Title "Requested stock count" or "Month-end stock count"; header "Asked by",
"Due", "Note". Loads `my_outlets()`, today's lines (`store_count_detail`),
sheet products (`products` with `sheet_order`, active, in sheet order:
name, barcode), `counted_product_names()` for suggestions, today's uploaded
sheets, whether a template exists.

### 9.3 Count on paper (`count-sheet-panel.tsx`)

Card **"Count on paper"**: "Download the <Month YYYY> stock count sheet for
your store, fill it in on your phone or print it and fill it by pen, then
upload it here: the Excel file, a PDF or a photo."

- Store picker when more than one store.
- **"Download <Month> sheet"** → `/api/store-counts/template?store=<id>`
  (only when a template or sheet products exist; else "The office has not
  set up the count sheet yet. You can still upload one you have.").
- **"Upload filled sheet"**: accepts xlsx, PDF, JPEG, PNG (an xlsx with no
  MIME type is recognised by name); max **10 MB** (`MAX_BYTES`). Errors:
  "Send the count sheet as the Excel file, a PDF, or a photo of it (JPG or
  PNG)." / "The count sheet must be smaller than 10 MB." Uploads to
  `reports/{uid}/count-sheet-{uuid}.{ext}` then `POST /api/store-counts/
  sheets { outlet_id, path, file_name }` → `submit_count_sheet`. Steps
  "Uploading the sheet", "Sending it". Success "Sent the count sheet for
  <store>." List "Sent today: <store>, <file>".
- Props `title` (default "Count on paper") and `sentHeading`; with a
  heading the sent sheets show as rows (file name, store, status)
  under it, or "Nothing sent yet this month.".
- Since 0064 `submit_count_sheet` no longer needs a count to be due: only
  `can_count_stock()`, the store, the fresh upload, type and size. While a
  count is due the sheet still counts towards it (`request_id`); otherwise
  it is kept with `count_was_due = false` and counts towards nothing.

### 9.4 Count form (`store-count-form.tsx`)

- No stores: "You have no store allocated yet, so there is nothing to
  count. Ask your supervisor or the office to allocate your store."
- Store select when more than one; switching store reloads today's figures
  for it.
- Intro: "This is the Xpel stock count sheet. Tap each product you have, and
  enter how many are in the back store and on the shop floor. Add the expiry
  date of the stock, and how many sold since the last count. Leave out
  products you do not have." and "Submit while you are in the store. Xtend
  checks your location and asks for a photo of the shelf before saving."
- Search "Search by name or barcode" (all words must match name+barcode);
  chips "All <n>" / "Counted <n>".
- Sheet rows: name, barcode (mono), badge with the total when counted or
  "No count" when touched without back/shop numbers; tap to expand.
- Figure fields per product: **Back store**, **Shop floor**, **Total**
  (computed, read-only), **Sold**, **Expiry date** (date, 2000-01-01 to
  2100-12-31). Numbers accept digits only; "Clear this product".
- **Products not on the sheet** (or "Products" when no sheet): a free list
  with a trailing empty row that appears when the last is used; name input
  with datalist suggestions (names counted before, not on the sheet), max
  120; remove button.
- Today's earlier figures prefill (an old line with only `in_store` shows as
  shop floor).
- Problems (warning, submit disabled), first match wins: "Give every product
  you added a name."; "<name>: <name rule problem>" (`thingName(120,
  'product name', 1)`); "<name> is on the sheet: count it there."; "<name>
  is in the list twice."; "Numbers must be whole numbers." (1–7 digits);
  "Enter the back store or shop floor number for <name>."
- Submit button (sticky, above the nav): **"Submit count (N product(s))"** or
  **"Count at least one product"**.
- Flow: "Checking you are in the store" (`requireFix`), then back camera
  "Photo of the shelf" / "Show the products you counted" (no locate).
  Closing the camera: "The count was not sent: it needs a photo of the
  shelf." Then "Uploading the shelf photo" (`reports/{uid}/count-{uuid}.jpg`,
  report compression), "Checking the photo" (kind `shelf`), "Saving the
  count" → `POST /api/store-counts { outlet_id, lat, lng, accuracy_m,
  photo_path, lines[{ product_name, back_store, shop_floor, sold,
  expiry_date }] }`. **Not offline-capable**: "No connection. Your numbers
  are still on the screen; try again when you have signal."
- Server (`submit_store_count`), messages verbatim: "You cannot submit a
  store count"; "No store count is due: counts are taken when a supervisor
  asks, or at the end of the month"; "That store is not one of yours";
  accuracy > 100 "Your location is not accurate enough. Step near a window
  and try again"; store without coordinates "This store's location is still
  being confirmed. Ask your supervisor, then count it once it is confirmed";
  distance > fence + **25 m** "You must be in the store to submit its count
  (you are N m away)"; photo not fresh (30 min) "Take the shelf photo in the
  app just before submitting"; reused photo; 1–500 lines; names ≤ 120;
  "Expiry dates must be real dates"; "A product appears twice in the
  count"; "Counts must be whole numbers from 0 up". Route caps each number at
  1,000,000.
- Success: "Saved N product(s). You can correct it until midnight."
  (re-submitting the same store the same day replaces its figures).

### Acceptance checks

- Outside the last 3 days of the month and with no request, the Count tab is
  absent and `/field/count` shows the "next month-end count opens on" text.
- Total always equals back store + shop floor.
- Submitting 30 m outside a 100 m fence passes; 130 m outside fails with
  the distance.
- Cancelling the shelf camera shows "The count was not sent…".
- Uploading a 12 MB PDF is refused on the phone.

---

## 10. X Metrics (field side, migrations 043–044)

Page `/field/metrics` (field roles; others → `/field`; X Metrics switched
off (0063) → `/field`). Sheet title "X Metrics". Stores = the person's
outlets that are active X Metrics stores.
None: "None of your stores is in X Metrics yet. When the office adds your
store, its stock count and daily sales appear here."

Top: OutboxBanner; chips **"Stock count"**, **"Daily sales"**, **"My
score"** (with " •" when the current policy is unread). `?tab=sales|score`
selects the initial tab. When the policy is unread and not on the score
tab: info "The scoring policy has been updated. **Read it**". No products:
"There are no products in X Metrics yet. The office adds them." Bottom:
"Sent this week" list (last 7 days, up to 30 each): "Stock count · <store>"
or "Sales · <store>", date, or struck-through "Voided".

**Switched-off parts (0063, `xmFieldView`)**: staff are never told why;
the part is simply not there.

- Sales off: no **Daily sales** chip or form, no sales in "Sent this week",
  the empty-store line ends "its stock count appears here."; `?tab=sales`
  opens the count. A queued sales report is refused by the server: "Sales
  are not being collected at the moment".
- Grading off: no **My score** chip, no policy banner; `?tab=score` opens
  the count; `xm_grade` is not called.
- Expiry off: no expiry date box on a batch, and the count text drops
  ", with the expiry date printed on it". A batch's known expiry date (from
  `xm_my_store_batches`) still goes with it, unseen.
- Only the count left: the chip row is not shown.
- X Metrics off: no Metrics tab, the page sends to `/field`; a queued count
  is refused: "Stock counts are not being collected here at the moment".
- The score card leaves out the factors whose part is off (`grade.parts`),
  and "How the score is worked out" leaves out their weights and lines.

### 10.1 Stock count by batch

- Rows start from the batches last counted at the store
  (`xm_my_store_batches`). Store picker (name only when one store).
- Text: "For each product, count what is on the shelf and in the backroom,
  batch by batch, with the expiry date printed on it. Leave out products you
  do not have." and "Send it from the store. Xtend checks your location and
  asks for a shelf photo. No signal? It is kept on the phone and sent
  later."
- Search "Search by name or SKU" (name, SKU, category); chips All / Counted.
- Product row: name, "SKU · category · unit", unit total badge; expanding a
  product with no batch adds one. Each batch: "Batch no." (max 60), expiry
  date, **On shelf**, **In backroom**, remove; **"Another batch"**.
- Problems: "Numbers for <p> must be whole numbers."; "<p> has the same
  batch twice."; "The batch for <p> is too long."
- Button **"Send count (N product(s))"** / "Count a product to send".
- Flow: "Checking you are in the store" (`requireFix`), capture time =
  now, back camera "Photo of the shelf" with the store as subtitle; then
  `submitOrQueue({ kind: 'xm_count', … })` (offline-capable, **72 h**). The
  job uploads `reports/{uid}/xm-count-{uuid}.jpg`, photo-checks it (shelf),
  then `POST /api/metrics/counts { outlet_id, lat, lng, accuracy_m,
  photo_path, captured_at, lines[{ product_id, batch, expiry_date, on_shelf,
  in_backroom }] }`.
- Server (`xm_submit_count`): accuracy > 100 refused; distance > fence +
  25 m: "You must be in the store to count it (you are N m away)" (a store
  without coordinates is accepted without a distance); photo must be the
  caller's and checked pass/unchecked; lines non-empty, whole numbers, no
  duplicate product+batch.
- Messages: sent "Count for <store> sent: N line(s)."; queued "No signal:
  the count for <store> is saved on this phone and will be sent when you are
  back online (within 3 days)."; waiting for place "...saved on this phone.
  It is sent as soon as you add the place above."

### 10.2 Daily sales

- Store picker; **Day** select: Today, Yesterday, and two more days (today
  and the previous 3).
- Note "Units sold that day, per product. Send it by the end of the day."
  plus " You will be asked for a photo of the shelf." when
  `xm_settings.sales_photo_required` is not false.
- One numeric input per product (red border if not whole); "Units sold must
  be whole numbers."
- Button **"Send sales (N product(s))"** / "Enter units sold to send".
- Photo (if required) via back camera; `submitOrQueue({ kind: 'xm_sales' })`
  uploads `reports/{uid}/xm-sales-{uuid}.jpg` (checked) and posts
  `/api/metrics/sales { outlet_id, sale_date, photo_path, captured_at,
  lines[{ product_id, units }] }`.
- Server: "Sales can be sent for today or the last 3 days"; photo rules;
  at least one product; no duplicates; whole units. Sending the same day
  again replaces it.
- Messages: "Sales for <date> sent. Sending this day again replaces them.";
  queued and waiting-for-place variants as above.

### 10.3 My score and the policy (`xm-score.tsx`)

- Card "Your score, <Month YYYY>", big score, band badge (or "Not scored
  yet"). Four factor rows with score × weight and a detail line:
  - Sales against target ("Your stores sold X of T" / "You sold X of T" /
    "No target set yet")
  - Stock accuracy ("X of Y counts matched")
  - Reporting consistency ("N days worked: sales on time A, counts up to
    date B")
  - Expiry handling ("X of Y batches dated, Z expired on shelf")
  - A factor with no score: "Nothing to score yet this month".
  - Footer "It changes as you send counts and sales. Up to yesterday; the
    office finalises it after the month ends."
- "How the score is worked out" (`ScoringSummary` of settings).
- The current policy: title, "Updated <date> · <change note>", body, then
  "You have read this version." or button **"I have read this"** → `POST
  /api/metrics/policy { policy_id }` → `xm_mark_policy_read`.

### Acceptance checks

- The Metrics tab appears only when one of the person's stores is enrolled
  and X Metrics is switched on.
- With Sales off there is no Daily sales tab; with Expiry off no expiry date
  box; with Grading off no My score tab.
- An X Metrics count saved offline sends up to 72 hours later; a 4-day-old
  one is dropped.
- Sales for 4 days ago cannot be chosen.
- Marking the policy read removes the dot and the banner.

---

## 11. History, account, support, guide

### 11.1 History (`/field/history`)

- Header: back arrow to `/field`, "My attendance", calendar tile.
- Big month label of the selected date; **"Today"** pill when another day is
  selected.
- Day strip (`day-strip.tsx`): 7 days ending today, pills 52×68px, selected
  filled brand, a dot under days with any event; scrolls the selected day
  into view. `?d=YYYY-MM-DD` selects (invalid or after today → today).
  Unselected pills take the calendar colour of the day (below) with its word
  ("Missed", "Off", "Leave") in place of the dot; plain and worked days are
  a bordered card. The calendar legend sits under the strip.
- Data: own `attendance_detail`, newest first, last **90** rows; and
  `my_calendar()` twice (migration 059): the strip's 7 days, and the whole
  month of the selected date.
- Day section: "Today" or long date, "<n> event(s)"; empty "Nothing recorded
  on this day." — or, for a missed day, red bold "Missed: no clock-in on
  this working day."; for a day off / leave "Day off. Nothing recorded on
  this day." / "Leave. Nothing recorded on this day."; rows "Clock
  in"/"Clock out", "HH:MM · <distance> from outlet · ±N m" and the location
  label; badge **"On site"**, **"Off site"** or **"Not confirmed"**.
- **"Your month"** section (action link **"Ask for leave"** → `/field/leave`):
  `MonthCalendar` (`src/components/field/calendar-marks.tsx`), a card with
  the month name ("October 2026"), ‹ › arrows (`?d=` the 1st of the month
  before/after; no › past the current month), weekday heads Mo Tu We Th Fr
  Sa Su (Monday first, `monthWeeks()`), 44 px day cells linking to
  `?d=<date>` (selected: brand outline; today: extra bold with the word
  "Today"; future days 60 % opacity, but days off and leave still show
  there), the legend, and a count line "N missed · N days off · N days of
  leave" (parts left out when zero).
- "This month" stats (of the selected month, from those rows): **Days**
  (clock-ins), **On site**, **Not on site**.

**How a day is marked** (`calendarMark()`, `src/lib/schedule.ts`, from a
`my_calendar` row `{ day, kind, clocked_in, missed }`), first match wins:

| Mark | When | Look (`MARK_CLASS`) | Word | Legend |
|---|---|---|---|---|
| worked | clocked in (whatever the schedule said) | bordered card | "•" (brand) | Clocked in |
| missed | `missed`: a past working day (not today), on or after the day the account was made, no clock-in | red tint `bg-destructive/12`, red ring | Missed | Missed |
| off | kind `off` | grey `bg-muted` | Off | Day off |
| leave | kind `leave` (approved) | `#fbe4d3` fill, `#f2b48a` ring, brand-deep text | Leave | Leave |
| plain | today, a future working day, or before they joined | bordered | — | — |

Colour is never the only sign: every mark has its word and an aria label.

### 11.2 Account (`/field/account`, labelled You)

Sheet "Your account"; header Name, Signed in as (email), Role (custom staff
role name or the base label). Sections:

1. Profile photo (`ProfilePhoto`) and "Your photo helps your team recognise
   you. Take it facing the camera in good light."
2. **Your posting**: outlet name, "<address or No address> · N m geofence ·
   HH:MM–HH:MM", or "No outlet assigned" / "Ask your admin to assign your
   outlet."
3. **Stock count sheet** (0064), only when `store_count_status()` is not
   `not_allowed` and `my_outlets()` returns a store (merchandisers, and
   marketers whose role takes stock counts): a `CountSheetPanel` card
   titled **"Stock count sheet"** (no separate section header), always
   available whether or not a count is due: Download this month's sheet as
   Excel (`/api/store-counts/template?store=<id>`), **Upload filled sheet**
   (Excel, PDF or photo, as §9.3), and **"Sent this month"**: each sheet
   sent since the 1st: file name (up to two lines), store, then "Sent
   <date time> · <status>", status from
   `countSheetStatus()`: "For the count your supervisor asked for" (has a
   request), "For the month-end count" (due, no request), "Received by the
   office" (sent with no count due). Offline: as §9.3, "No connection. Try
   again when you have data."
4. **Days off and leave**: "Ask for leave" ("Annual, sick or casual leave.
   See your requests and the answers.", trailing brand "Open") →
   `/field/leave`; "Your calendar" ("Days you clocked in, days off, leave
   and missed days.") → `/field/history`.
5. **Need help?**: "Message support" ("Report a problem. The Xtend helper
   replies, and the office steps in when needed.") → `/field/support`; "How
   to use Xtend" ("Step-by-step help, from clocking in to the end of the
   day.") → `/field/guide`.
6. **Messages from the office**: `PushToggle` then the last **10**
   notifications (`my_notifications`), title, body, "<sender or Office> ·
   time", read ones muted.
   - PushToggle labels: "On for this device", "Blocked in your browser
     settings" (+ "Open your browser settings for this site and set
     Notifications to Allow."), "Not supported by this browser", "Not
     switched on by your admin yet", "Checking…", "Off"; button "Turn on" /
     "Turn off".
7. **Security**: "Change your password" ("Pick something only you know.") →
   `/change-password`.
8. **Tips**: "Keep location and notifications on" ("Xtend needs them to
   clock you in and out and to reach you."); "Install Xtend to your home
   screen" ("Chrome menu → Add to Home screen. It opens full screen and
   loads faster on a weak network.").
9. Sign out button; Xpel lockup; "Xtend · field attendance".

### 11.3 Profile photo (`profile-photo.tsx`)

- Round avatar (128px on onboarding, 80px on account) with a camera badge;
  buttons **"Take your photo"** / **"Retake photo"** (in-app camera, "Your
  profile photo", "Face the camera in good light") and **"Upload from
  gallery"** (file input, `image/*`, no `capture`). Gallery is allowed
  because this photo is for recognition only, not attendance.
- Non-image: "Choose an image file."; over **20 MB**: "That image is too
  large. Pick a smaller one."
- Processed with `processSelfie` (640 px, ≤ 150 KB), uploaded to bucket
  **`avatars`** at `{uid}/{Date.now()}.jpg` (no upsert), then RPC
  `set_my_avatar(p_path)`. Errors "The photo could not be saved. Check your
  connection and try again." / "The photo could not be saved. Try again."
- Avatars are read through signed URLs valid 1 hour.

### 11.4 Support chat (`/field/support`)

- Sheet "Message support", back to `/field/account`. Lists the user's
  threads (RLS, newest activity first, up to 50) and their messages.
- New message card: **"Tell us what is wrong"**, "The Xtend helper answers
  straight away. Anything it cannot sort out goes to the office.", "Short
  title (optional)" (≤ 160), textarea "Describe the problem. For example: my
  clock-in keeps saying off site at my store." (2–4000), **"Send message"**
  ("Sending…").
- `POST /api/support { subject?, body }` → `open_support_thread`, then the
  helper replies synchronously (`respondToSupportThread`): a model answers
  briefly in simple English and decides whether to escalate. It must
  escalate account, store allocation, password or record changes, anything
  outside its knowledge, or when unsure; it never changes data. Without an
  API key it escalates straight away. Escalation sets status `escalated`
  and pushes the office.
- Replies: `POST /api/support/{id}/message { body }` →
  `post_support_message`, then the helper replies again.
- Thread list: subject, last time, status pill: open "Waiting", ai_answered
  "Answered", escalated "With the office", resolved "Resolved". Expanded:
  bubbles (staff right in brand; "Xtend helper" left tinted; "Office" left
  muted); reply input "Write a reply" with send icon; resolved threads show
  "Marked resolved by the office." and no input. Empty: "No messages yet.
  Anything you send shows here with the reply."
- Live: rides the member's own private Broadcast topic `field:<uid>`
  (migration 0058) and refreshes when the event's `table` is
  `support_messages` or `support_threads`. Skipped when
  `NEXT_PUBLIC_REALTIME_DISABLED=1` (the fleet-wide release valve); sending
  still refreshes the thread.

### 11.5 Staff guide (`/field/guide`, public `/guide`)

`StaffGuide` (`src/components/staff-guide.tsx`) inside a sheet "How to use
Xtend" (back to `/field/account`); the same component on public `/guide`.
Sections: Get started; Before your first clock-in; Your profile photo; Clock
in; Store visits (marketers); Adding a place; Daily report; Stock count;
Clock out; History and your account; Report a problem; Common problems
(location blocked, not accurate enough, off site but in my store,
notifications blocked, camera does not open, banner waiting to send, forgot
password). Screenshots under `/guide/staff-*.png`. It covers only what to
do; it never explains monitoring.

### 11.6 Leave (`/field/leave`, migration 059)

Page `src/app/field/leave/page.tsx`, components `src/components/field/leave-form.tsx`;
reached from the home week row, History ("Your month") and You.

- Sheet **"Leave"**, back to `/field/account`. Header fields: Name;
  "Waiting for an answer" = "<n> request(s)" pending, or "None".
- Data: own `leave_requests` (RLS), newest first-day first, up to **60**,
  then `sortLeave()` (pending first by soonest first day; then the rest by
  latest first day; then newest asked).
- **"Ask for leave"** section. Only a merchandiser or marketer gets the
  form (an admin in the field app sees info "Leave requests are for
  merchandisers and marketers."). Intro: "Pick the type, your first and last
  day of leave, and say why. Your supervisor approves it, and you get a
  message when they do."
- Form (`LeaveForm`, `surface` card):
  - **Type of leave** select: Annual leave (default), Sick leave, Casual
    leave, Other (`LEAVE_KINDS`).
  - **First day** / **Last day** date inputs side by side, both default to
    tomorrow; min today − **7**, max today + **365**; moving the first day
    past the last moves the last with it.
  - A line with a calendar icon showing the date problem, or the range
    (`leaveRangeText`): "Tue 20 Oct (1 day)" / "Tue 20 Oct to Thu 22 Oct
    (3 days)".
  - **Reason** textarea (3 rows, max **1000**), placeholder "For example: my
    sister's wedding in Enugu."; validated with `writtenText(1000, 3, 'the
    reason')`; empty → "Say why you need the leave".
  - **"Send request"** (send icon; "Sending…") → `POST /api/leave { kind,
    from, to, reason }`. Success: "Sent. Your supervisor will look at it.",
    reason cleared, page refreshed. Network failure: "No network. Try again
    when you have signal." (not queued). Server error text shown as is,
    fallback "Your request could not be sent. Try again."
  - Date problems checked on the phone first (`leaveDateProblem`, same order
    and words as the database): "Pick the first and last day of your
    leave"; "The last day cannot be before the first day"; "Leave can start
    at most 7 days ago"; "Pick dates within the next year"; "One request can
    cover at most 60 days"; "You already have leave asked for or approved on
    some of those days" (only pending and approved requests block).
- **"Your requests"** section (`LeaveList`): each a `surface` row with a
  calendar icon tile (muted when cancelled), the kind in bold, a status
  badge (Pending warning, Approved success, Rejected destructive, Cancelled
  outline), the range, the reason, "Reply: <note>" when the decider wrote
  one, and for a pending one a red **"Cancel request"** ("Cancelling…")
  after `confirm('Cancel this leave request?')` → `POST
  /api/leave/{id}/cancel`. Empty: "You have not asked for leave yet."
  Load failure: "Could not load your requests. Pull down to retry."
- Pushes: sending tells their supervisor and admins (`20-admin-dashboard.md`,
  Leave);
  the decision comes back to the person as **"Leave approved"** / **"Leave
  not approved"**, "Your <annual leave> for <range> was approved|not
  approved. <note>", opening `/field/leave`.

### Acceptance checks

- History shows the badge "Not confirmed" for an unmeasured clock-in.
- A gallery image can become the profile photo; it can never become a
  clock-in selfie.
- A support message gets a helper reply in the same request; a password
  request is shown as "With the office".
- An office reply appears in the open thread without a manual refresh.
- History's month calendar for a person on the default week shows every
  Sunday grey "Off", past working days without a clock-in red "Missed", and
  no › arrow on the current month.
- Asking for 61 days of leave shows "One request can cover at most 60
  days" before anything is sent; asking for days that overlap a pending
  request shows the overlap message; a sent request appears as "Pending"
  with "Cancel request", and after cancelling it shows "Cancelled" with no
  button.


### 11.7 Messages (`/field/messages`, migration 0073)

- Entry: on **You**, under "Need help?", first row **Messages** ("Talk to
  your supervisor about your work.", icon `MessagesSquare`) with an orange
  count pill when there are unread messages (`unread_messages()`). On
  **Home**, above everything, an orange banner "You have a new message" /
  "You have N new messages", "Tap to read and reply", while unread > 0
  (`messages-banner.tsx`).
- Page: `SheetScreen` "Messages", back to `/field/account`. A header at the
  top shows who they write to: the supervisor's photo (signed from
  `avatar_path`, or their initials on a tint circle) with their name and
  "Your supervisor"; with no supervisor, an "XO" tile, "The office" and
  "Xtend office". Then the line: "Talk to <supervisor name or 'the office'>
  about your work: stock, the store, your shift or anything you need." Data
  `conversation(null)` and `my_supervisor()` (0076: id, name, avatar_path).
- `Conversation` (`src/components/messages/conversation.tsx`, shared with
  the dashboard): bubbles oldest first, own on the right in brand orange,
  others on the left in grey with the sender's name; Lagos time under each.
  Empty: "No messages yet. Write to <name> below." Textarea (placeholder
  "Message <name>", 2,000 characters) and a **Send** button; errors in a red
  alert ("Your message was not sent. Try again."). Opening the page and each
  new message marks it read (`POST /api/messages/read`). New messages appear
  live (the private `field:<uid>` topic hears `messages`), with a 60 s
  refresh while visible as a fallback.
- Attachments (0075): a paperclip in the compose bar takes one picture
  (JPEG/PNG/WebP/HEIC) or one PDF, up to 10 MB; a chosen file shows as a
  chip above the box with its size and an X. On send the file is uploaded
  to the private `message-files` bucket under the sender's own folder, then
  `POST /api/messages` carries `{staff_id, body, attachment}`; a message may
  be an attachment with no words. Pictures render inline in the bubble, PDFs
  as a file card; both open at `GET /api/message-files/<id>` (a 5-minute
  signed link, gated by the message's RLS).
- Push: a reply from the office arrives as "Message from <name>" (or "Sent a
  photo" / "Sent a PDF" when there are no words) and opens `/field/messages`.

### Acceptance checks

- A staff member's message shows at once on their screen and in their
  supervisor's inbox; the supervisor's reply shows on the phone without
  refreshing and the Home banner appears until it is read.
- A staff member can never see or write in anyone else's conversation.

---

## 12. Field screens summary (build checklist)

| Path | Who | Notes |
|---|---|---|
| `/login` | public | §1.5 |
| `/change-password` | signed in | §1.7 |
| `/deactivated` | public | §1.8 |
| `/welcome` | field roles, once | §2 |
| `/field` | field roles | home §3–§7 |
| `/field/history` | field roles | §11.1 |
| `/field/report` | marketer, admin | §8 |
| `/field/count` | when allowed | §9 |
| `/field/metrics` | field roles | §10 |
| `/field/account` | field roles | §11.2 |
| `/field/messages` | field roles | §11.7 |
| `/field/support` | field roles | §11.4 |
| `/field/leave` | field roles (form: merchandiser, marketer) | §11.6 |
| `/field/guide` | field roles | §11.5 |
| `/offline` | public | SW fallback |

---

## 13. Background behaviours

### 13.1 Location heartbeat (`heartbeat.ts`)

- Active only when **on shift** (opened, not closed) **and** the location
  gate is ready. Nothing about it is shown on the home screen.
- Sends immediately, then every **5 minutes** (`HEARTBEAT_INTERVAL_MS =
  5 * 60 * 1000`, `geo.ts`), and again whenever the page becomes visible.
  Skipped while the page is hidden or a ping is in flight.
- Each ping: `getCurrentPosition` (high accuracy, timeout **15000 ms**,
  maximumAge **60000 ms**), `POST /api/pings { lat, lng, accuracy_m }` with
  `keepalive`.
- Offline (or a network `TypeError`): the position is queued as a `ping`
  job with its capture time; internal text "No connection right now. Xtend
  will carry on when you are back online." After a successful ping, a
  non-empty outbox is flushed.
- Screen wake lock (`navigator.wakeLock.request('screen')`) held while on
  shift and visible; re-acquired on return; failures ignored.
- Server: `location_pings` trigger measures distance; a `left_geofence`
  alert fires above **300 m** (`HEARTBEAT_GEOFENCE_M`) at most once every
  **30 minutes**, and only then is the spot geocoded and watchers notified.
  The heartbeat also drives the expired-selfie sweep (throttled in the
  database).
- Older native builds without the shift tracker: a background watcher
  (`BackgroundGeolocation` plugin, `distanceFilter` **25 m**, notification
  "Xtend" / "On shift") posts via the native HTTP client at most every
  **150 s** unless moved ≥ **150 m**; a non-400 failure is queued.
- **Follow live (migration 0070), silent.** The `/api/pings` answer may
  carry `interval_ms` (8000) while someone in the office follows this
  person (`nextInterval` in `src/lib/follow-live.ts` accepts 2–60 s). The
  page then first asks the native tracker (`followFast(ms)` →
  `ShiftTracker.follow({ intervalMs })`, resolves `{ ok }`); if that is not
  available (browser, app build before 0070, tracker not running) it sends
  quick positions itself: `getCurrentPosition` (high accuracy, timeout
  **7000 ms**, maximumAge **2000 ms**) → `POST /api/pings/live { lat, lng,
  accuracy_m, heading, speed, captured_at }` (never stored as a ping; the
  answer's `interval_ms` schedules the next one, its absence stops the
  loop). Only while visible and online; stops when the hook is inactive. A
  `sync` broadcast on the member's own topic (see 13.3) dispatches the
  window event `xtend:sync`, on which the heartbeat sends one quick
  position at once. Nothing is shown and no text mentions it.

### 13.2 Phone beacon (`phone-beacon.tsx`, `src/lib/phone-report.ts`)

- Mounted in the field layout; renders nothing.
- Reports on: open, visible, hidden, online, and every **5 minutes** while
  visible (`EVERY_MS`). Offline event stores `xtend.offline_since` in
  localStorage. Online event also flushes the outbox.
- Payload to `POST /api/beacon`: reason, connection type, battery % and
  charging, outbox count and oldest queued capture time, device time,
  offline_since, and a position only if location permission is already
  granted (never prompts; low accuracy, timeout 8000 ms, maximumAge 5 min).
- `hidden` uses `navigator.sendBeacon` without a position.
- The server answers `{ id }`, stored as `xtend.anchor` and attached to the
  next clock-in as `device_info.anchor_beacon` (proof of the last moment in
  touch for an offline clock-in). Never throws, never shown.

### 13.3 Realtime refresh (`use-dashboard-refresh.ts`)

- One **private Broadcast** channel `field:<uid>`. Database triggers
  (migration 0058) send a `change` event `{ table, op }` to that topic
  whenever the member's `attendance`, `store_visits`, `support_messages` or
  `notification_deliveries` row changes. RLS on `realtime.messages` lets a
  member read only their own topic. Broadcast replaces Postgres Changes so
  the realtime server does not run RLS per subscriber per change, which is
  what lets the connection count scale to thousands.
- A `sync` event (migration 0070, empty payload, sent when someone starts
  or extends following this member live) does not refresh: it dispatches
  `window` event `xtend:sync` for the heartbeat (13.1).
- Any `change` event → debounce **400 ms** → `router.refresh()` (which re-fetches
  through RLS; the socket never carries row data); refreshes are skipped
  while hidden or offline and are locked for **1500 ms** after one.
- Only **on-shift** members open a socket; a clocked-out member with the app
  open rides the poll, keeping the connection count down to people working.
- Safety poll on shift **45 s** when realtime is live, **20 s** when it is
  off or has failed; off shift **120 s** / **60 s**. Each interval is
  jittered **±30 %** per client so a fleet does not stampede the backend on
  one tick. Also refreshes on visibility and on `online`.
- Scale release valve: `NEXT_PUBLIC_REALTIME_DISABLED=1` skips the socket
  entirely (here and in the field support chat) and everyone rides the poll
  — used when Supabase's concurrent-connection cap is the bottleneck. The
  poll also speeds up on its own if a socket subscribes then errors
  (`CHANNEL_ERROR` / `TIMED_OUT`), so hitting the cap slows updates rather
  than breaking the app. See `load-test/` for the k6 script that finds the
  ceiling.

### 13.4 Native shift tracker (`shift-tracker.tsx`, `src/lib/native.ts`, `mobile/`)

- Only inside the native app with the `ShiftTracker` plugin; renders nothing
  in a browser.
- On shift: if not already active and running, `POST /api/track/token {
  platform }` (→ `issue_tracking_token`; returns `{ token, expires_at,
  endpoint: /api/track/device }`), then native `ShiftTracker.start({ token,
  endpoint, expiresAt, title: 'Xtend', text: 'On shift' })`. Retried when the
  app becomes visible (a clock-in made offline has no token until online).
- Clocked out: native stop and `POST /api/track/stop` immediately.
- Native cadence: a position at least every **150 s** while still, sooner
  after **100 m** of movement (Android `EVERY_MS`, `MOVED_M`; iOS `every`,
  `movedMetres`, `distanceFilter` 50); readings rougher than **250 m** only
  used if nothing better; network retry no more often than every **60 s**;
  queue up to **2000** points, sent in batches of up to **500**; continues
  with the app closed and after reboot (Android boot receiver). The server's
  answer says when the shift is over.
- **Follow live (0070)**: the `/api/track/device` answer may carry
  `interval_ms`. While it does (held **60 s** after each such answer; an
  answer without it ends it at once), Android re-registers GPS and network
  updates at that interval (normally 60 s) with a timer that sends even if
  GPS is quiet, and iOS asks for best accuracy with no distance filter; each
  request then also carries `live: { lat, lng, accuracy_m, captured_at,
  heading?, speed?, is_mock }` (the latest reading, at most once per
  interval). Stored points keep their usual cadence. iOS also sends an
  empty request at most every **150 s** on a location update so it notices
  a follow; with the app closed iOS only wakes on significant changes. New
  plugin method `follow({ intervalMs })` → `{ ok }` (false when no shift is
  tracked or the interval is outside 2–60 s) starts it at once; the
  notification text stays "On shift".
- **Neutral setup prompt** (only when needed, never explaining why):
  heading **"Finish setting up Xtend"**;
  - location not "always": iOS "Set Location to “Always” for Xtend." with
    button "Allow always"; Android "Set Location to “Allow all the time”
    for Xtend." with "Open location settings".
  - Android battery restricted: "Turn off battery saving for Xtend." with
    "Open battery settings".
  - Start failure: small red text with the error (default "Location could
    not be started").

### 13.5 Update manager (mention only)

`src/components/update-manager.tsx`, mounted in the root layout: checks the
build every **10 minutes**; site update snooze **30 minutes**, app update
snooze **24 hours**; prompts such as "Update Xtend to carry on" and "Install
the new Xtend app" ("This version of the app is too old to keep using.
Install the new one; your account and anything waiting to upload are
kept."). Full spec belongs to the platform file.

### 13.6 Service worker (`public/sw.js`) and native push bridge

- Registered from `src/components/service-worker.tsx`. Cache name
  `xtend-v3`; precaches `/offline`, `/manifest.webmanifest`,
  `/icons/icon-192.png`; `skipWaiting` + `clients.claim`; deletes old
  caches.
- Fetch: ignores non-GET, cross-origin and `/api/*`. Navigations: network,
  falling back to cached `/offline`. `/_next/static/*` and `/icons/*`:
  cache-first, filled on miss. Writes are never replayed by the worker (the
  page owns the outbox and the session).
- Push: JSON payload `{ title, body, url, notificationId, check }`;
  unreadable body → title "Xtend" and text. Shows icon-192, badge icon-64,
  tag = notificationId (renotify), vibrate `[80, 40, 80]`, data url default
  `/field`. A supervisor phone-check (`check.id`, `check.token`) is answered
  `delivered` via `POST /api/phone-check/ack`.
- Click: answers the check `opened`; opens only same-origin URLs (else
  `/field`), focusing and navigating an existing window if any.
- `pushsubscriptionchange`: re-subscribes and re-POSTs to
  `/api/push/subscribe`.
- Native app equivalent: `NativeBridge` listens to Capacitor push received
  (answer `delivered`) and action performed (answer `opened`, then
  `router.push(url)` only for paths starting with a single `/`).

### Acceptance checks

- On shift with the page visible, a ping is posted on load and every 5
  minutes; none while signed out of shift.
- With no signal, pings queue silently (no counter in the banner) and go as
  one batch later.
- A clock-in done on another device refreshes this home screen within a
  second via realtime.
- In the Android app, location keeps arriving with the app closed; after
  clock-out it stops at once.
- The setup prompt never mentions tracking, supervisors or why.
- Offline navigation shows the `/offline` page.

---

## 14. Copy rules: staff are never told about monitoring

The rule (BUILD_GUIDE.md §rules 4 and 7; CLAUDE.md):

> "Staff are not told how they are monitored. The staff app and guide cover
> clocking in and out, stock counts, using the app and reporting a problem.
> How location, integrity checks, alerts and excuses work is in the admin
> guide only. The supervisor guide leaves it out too."

> "Words staff see: only what they need to do. Never explain monitoring."

What this means in practice:

- Never show or mention: heartbeat pings, background/shift tracking,
  geofence breach alerts, integrity flags (late/early, VPN, mock GPS,
  backdated clock, selfie at home, photo rejected counts), phone beacons,
  phone checks, notifications sent to supervisors, absence sweeps, excuses.
- Do tell staff the plain result of their own action, honestly: on site /
  off site with the distance, "Not confirmed", a refused photo with what to
  fix.
- Schedules, leave, the heads-ups and the clock-out reminder are told as the person's own
  plan ("Day off today", "Missed", "Your shift ended at 17:00. Clock out
  now."), never as being watched: nothing says the office is told about a
  missed day, that a no-show is reported, or that a reminder was logged.
- Explain a requirement by the task, not by surveillance. Examples used in
  the app:
  - Location: "Xtend uses your location to confirm you are at your store
    when you clock in."; "Choose Allow — Xtend only reads your location
    while you are using it."
  - Notifications: "Xtend needs to reach you during your shift, so clocking
    in needs notifications turned on for Xtend on this phone."; "Xtend uses
    them for stock counts and messages from the office."
  - Native tracker: "Finish setting up Xtend" / "Set Location to “Allow all
    the time” for Xtend." / "Turn off battery saving for Xtend." — no
    reason given.
  - Camera: "Taken live in the app. Photos from your gallery, or of a screen
    or a printed photo, are rejected."
  - Heartbeat offline (internal state): "No connection right now. Xtend will
    carry on when you are back online."
  - Support helper is described as "The Xtend helper answers straight away.
    Anything it cannot sort out goes to the office."
- The photo-check model prompt itself enforces this: its message to the
  worker must "Never mention supervisors, admins, the office, reviews,
  checks, flags or anything being recorded; only say what is wrong with the
  photo and how to retake it."
- Code comments may explain monitoring (e.g. "Runs quietly while on shift;
  nothing about it is shown here"); user-facing strings may not.
- Plain English for Nigerian staff; short sentences; Lagos time; no internal
  ids on screen.

### Acceptance checks

- Grep every staff-visible string (field components, staff guide, push
  bodies sent to staff): none contains "track", "monitor", "flag",
  "supervisor will be notified", "alert", "beacon" or "integrity".
- A late clock-in shows exactly the same success text as an on-time one.
- A rejected photo message says only what is wrong and how to retake it.


### Recovery fixes (2026-10-21)

After sign-in, loginDestination accepts only root-relative local destinations;
external, protocol-relative, backslash, control-character and malformed paths
fall back to `/`. Photo-check 401 (expired login) and 429 (rate limit) responses
are retryable rather than permanent photo rejections. Existing queue age and
attempt limits remain in effect. Other rejected photos still require retaking.

Document removal disables document picking and all removal buttons through the DELETE request and route refresh. Announce “Updating documents…” in a status region and validation/network errors as alerts.
