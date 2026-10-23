# 20 — The admin and supervisor dashboard

This file describes everything under `/admin`: the frame around every page, who can see and do what, and then every page in the order of the menu. It covers behaviour, layout, filters, actions, numbers and words. It does not repeat raw data shapes:

- Database tables, views, RPCs and their columns: `generated/database.md` and `generated/schema.sql`.
- API routes (method, file, who may call, request body): `generated/routes.md`.
- Page files, the components each page uses: `generated/pages.md`.
- Library modules and exported constants: `generated/modules.md`, `generated/constants.md`.

Conventions used below:

- "Admin" is a profile with `role = 'admin'`; "supervisor" is `role = 'supervisor'`. Every page here calls `requireSession(['admin','supervisor'])` (or `['admin']`), from `src/lib/auth.ts`. `requireSession` redirects: no session to `/login`, inactive profile to `/deactivated`, expired re-login to `/api/auth/expired?reason=…`, `must_change_password` to `/change-password`, wrong role to `/`.
- All reads go through `createServerSupabase()` (the user's own session), so row-level security narrows what a supervisor sees to their own team. Pages do not filter by team themselves unless stated.
- All human times are Africa/Lagos (`TZ` in `src/lib/utils.ts`). `formatLagos(value, withDate=true)` prints `en-NG` with 2-digit day, short month, year, 24-hour `HH:MM`; with `withDate=false` it prints only `HH:MM`. Null prints `—`. `lagosDateString()` gives today as `YYYY-MM-DD` in Lagos. `metres(v)` prints `123 m` under 1000 and `1.2 km` above, `—` for null. Date arithmetic (`addDays`) works on `YYYY-MM-DD` strings anchored at UTC noon.
- Every page sets `export const dynamic = 'force-dynamic'` and a `metadata.title` of the form "`<Page> — Xtend`".
- Every admin/supervisor change goes through an API route that writes an audit row (`audit()` in `src/lib/audit.ts`); every download is also audited. Schedule and leave changes are the exception in form, not in effect: their `SECURITY DEFINER` functions write the audit row themselves in the same transaction (`schedule.pattern`, `schedule.override`, `schedule.override_remove`, `leave.approve`, `leave.reject`; migration 059).
- The brand palette is orange. Chart colours live in `src/lib/chart-colours.ts`:
  - `ON_TIME = #d1511a`, `LATE = #c98500`, `NOT_IN = #8a3a12` (overview charts).
  - `ORANGE = { main #d1511a, deep #9b3517, light #e8833a, dark #52281a, pale #f2b48a, track #f6e4d8 }`.
  - `DAY_COLOUR = { on_time: main, late: pale, off_site: deep, absent: dark, off: #e7e3df, leave: track }` (day off neutral grey; approved leave the softest orange).
  - Rule: a part is never told by colour alone; every chart prints its figures and the calendar marks each day with a letter.

---

## 1. The shell

### 1.1 Layout (`src/app/admin/layout.tsx`)

Server component. Steps:

1. `requireSession(['admin','supervisor'])`. `readOnly = role === 'supervisor'`.
2. Counts open alerts for the bell, in parallel (RLS narrows both to a supervisor's team):
   - `location_alerts` with `is_resolved = false` (count only, `head: true`).
   - `integrity_flags` with `reviewed_at IS NULL` and `severity IN ('medium','high')`.
   - `openAlerts = null` when both counts came back null (query failed); otherwise the sum (nulls as 0).
3. For admins only, reads `system_settings.test_mode` (0066; error or no row means false). For supervisors it is not read.
4. Renders `<AdminFrame name role readOnly openAlerts assistant xmEnabled testMode>` where `role` is the word `"Supervisor"` or `"Admin"` and `assistant = assistantConfigured()` (true when `ANTHROPIC_API_KEY` is set). Inside it, `<AdminLocation />` then the page.

`src/app/admin/loading.tsx` re-exports `PageLoading`: a `role="status"` block reading **"Loading page…"** above three pulsing grey shapes (a 32×160 px bar and two 112 px tall rounded cards; the pulse only with `motion-safe`).

`src/app/admin/error.tsx` renders `RouteError` with `homeHref="/admin"` and title **"The admin dashboard could not load"**. `RouteError` is a centred column (max width `md`, min height 60dvh): a round red warning icon tile, the title, the sentence **"Check your connection and try again. Your saved offline work is safe."**, and two equal buttons: **"Try again"** (calls `reset()`, with a refresh icon) and **"Go back"** (outline link to `/admin`).

### 1.2 Frame (`src/components/admin/admin-frame.tsx`)

Whole page has class `admin-shell`, `min-h-dvh`, canvas background.

**Desktop (≥ `lg`, 1024 px)**: a row.

- Left sidebar: sticky, full viewport height, 256 px wide (`w-64`), white card background, right border.
  - Top: the brand — a 36 px rounded square with the brand gradient (`brand-surface`) holding the Xpel mark in light tone, then the word **"Xtend"** (xl, extra bold). It links to `/admin`.
  - Middle (scrolls): `AdminSidebarNav`.
  - Lower card, hidden when the window is 1150 px tall or less (`[@media(max-height:1150px)]:hidden`):
    - When the assistant is configured: a black round icon with a sparkle, **"Ask Xtend"**, the line **"Who clocked in late? Who is off site? Ask in plain words."**, and a black full-width button **"Ask a question"** linking to `/admin/ask`.
    - Otherwise: a key icon, **"Your account"**, **"Keep your password private. Change it any time."**, button **"Change password"** to `/change-password`.
  - Bottom: **"Sign out"** outline button (full width, left aligned). Sign out calls `supabase.auth.signOut()`, then `router.replace('/login')` and `router.refresh()`.
- Right: the workspace on the grey canvas. When `testMode` is set, a full-width dark orange link to `/admin/system` reading **"Test mode: records can be reset"** (flask icon) sits at the very top, above the top bar on desktop and the sticky header on phones (see §28a).
  - Top bar (desktop only), padding 24 px sides, 20 px top:
    - Left: a search form, max width `sm` (384 px), that GETs `/admin/users` with field `q`. Search icon inside on the left; placeholder **"Find staff by name, email or phone"**; aria-label "Find staff"; 44 px tall; focus ring brand.
    - Right, 10 px apart: the bell; an identity pill (circle with up to two initials of the name, name truncated at 11 rem, role word underneath); and **"Add staff"** button (user-plus icon) linking to `/admin/users?new=1`.
  - `<main>`: full width, padding 16 px (24 px on `lg`), 96 px bottom padding (room for the floating Ask button).

**Phone and tablet (< `lg`)**: no sidebar. A sticky header (z 20, bottom border, background at 95 % with blur):

- Row 1: brand on the left; on the right the bell and a small **"Sign out"** button (36 px tall).
- Row 2: `AdminNav`, the drop-down menu.

**The bell**: a 44 px square white button with rounded corners linking to `/admin/alerts`. aria-label is `"Alerts"` or `"Alerts, N open"`. When `openAlerts` is truthy (non-zero, not null), a brand-orange pill sits on the top-right corner (20 px tall, min width 20 px, 10 px bold white text) showing the count, or **"99+"** above 99.

After the main area the frame mounts `AssistantLauncher` (only if the assistant is configured) and `NativeBridge` (the native-app bridge; see the phone-app file).

### 1.3 Menu (`src/components/admin/admin-nav.tsx`)

Groups and items, exactly in this order (label, path, icon, flags):

| Group heading | Label | Path | Icon (lucide) | Flag |
|---|---|---|---|---|
| (none) | Overview | `/admin` | LayoutDashboard | — |
| | Ask Xtend | `/admin/ask` | MessageSquareText | — |
| | Admin guide | `/admin/guide` | BookOpen | adminOnly |
| | Guide | `/admin/supervisor-guide` | BookOpen | supervisorOnly |
| Attendance | Attendance | `/admin/attendance` | ClipboardList | — |
| | Movement | `/admin/tracking` | Route | — |
| | Store visits | `/admin/visits` | MapPin | — |
| | Marketer reports | `/admin/marketer-reports` | FileText | — |
| | Alerts | `/admin/alerts` | Siren | — |
| | Support | `/admin/support` | Headset | — |
| | Analytics | `/admin/analytics` | BarChart3 | — |
| Stock | Stock count | `/admin/store-counts` | PackageSearch | — |
| | X Metrics | `/admin/metrics` | Gauge | — (0063: hidden from supervisors while X Metrics is off; admins see "X Metrics (off)" opening `/admin/metrics/settings`) |
| Checks | Integrity | `/admin/integrity` | ShieldAlert | — |
| | Check an excuse | `/admin/excuses` | PhoneOff | — |
| People | Staff | `/admin/users` | Users | — |
| | Teams | `/admin/teams` | UsersRound | adminOnly |
| | Schedules | `/admin/schedules` | CalendarDays | — |
| | Leave | `/admin/leave` | CalendarCheck | — |
| | Roles | `/admin/roles` | BadgeCheck | adminOnly |
| | Store allocation | `/admin/assignments` | UserCog | — |
| | Notifications | `/admin/notifications` | Bell | — |
| Setup | Outlets | `/admin/outlets` | Store | — |
| | Places | `/admin/places` | MapPinned | adminOnly |
| | Audit log | `/admin/audit` | FileClock | adminOnly |
| | Activity log | `/admin/activity` | Activity | adminOnly |
| | Updates | `/admin/updates` | RefreshCw | adminOnly |
| | System | `/admin/system` | Wrench | adminOnly |

Filtering: an item shows when `(!adminOnly || !readOnly) && (!supervisorOnly || readOnly)`. A group with no items left is dropped. So an admin sees "Admin guide" and not "Guide"; a supervisor sees "Guide" (the supervisor guide) and none of Teams, Roles, Places, Audit log, Activity log, Updates, System.

Active item: `/admin` is active only on an exact match; every other item is active when the path starts with its href (so `/admin/metrics/grades` lights "X Metrics").

**Sidebar look**: groups 24 px apart; group heading 11 px bold uppercase, wide tracking, muted. Item: 15 px medium text, 18 px icon, 12 px gap, rounded, padding 12×10 px. Active: muted background, full-strength text, brand-coloured icon, and a 4 px wide, 24 px tall brand bar hanging off the left edge of the sidebar (`before:` pseudo-element at `-left-4`). Inactive: 75 % text, muted hover.

**Phone menu (`AdminNav`)**: one full-width button (rounded 2xl, soft shadow) showing a brand menu icon and the current page's label (or **"Menu"** if none matches), and a chevron that rotates 180° when open. Open shows a floating panel under it (max height 70dvh, scrolls, fade-up animation, `role="menu"`) with the same groups; the active item is filled brand with white text. It closes on route change, on Escape, and on any mouse-down outside it.

### 1.4 Ask Xtend launcher (`src/components/admin/assistant-launcher.tsx`)

- A floating pill button, bottom-right (20 px from the edges, 24 px on `md`), 56 px tall, brand fill, white text **"Ask Xtend"** with a chat icon, `shadow-lift`, z 50. aria-label "Ask Xtend" / "Close Ask Xtend".
- Hidden entirely on any path starting with `/admin/ask` (the page is already the chat).
- Clicking it opens a dialog (`role="dialog"`, aria-label "Ask Xtend"): on phones a full-screen sheet (`inset-0`); from `md` up a 400 px wide panel 96 px above the bottom and 24 px from the right, height `min(640px, 100dvh − 8rem)`, rounded 3xl with a border and a large soft shadow. While open the floating button becomes a close (X) button on desktop and hides on phones.
- Panel header: **"Ask Xtend"** and the sub-line **"Attendance, visits, stock, integrity and more"**; on the right an expand icon (link to `/admin/ask`, title "Open full page", also closes the panel) and a close X.
- Body: `AttendanceAssistant` in `compact` mode. It is only mounted after the first open (lazy, via `next/dynamic`, showing **"Loading chat…"** while the code loads), and then kept mounted while hidden, so the conversation survives closing and moving between pages. Escape closes.

### 1.5 Location cookie (`src/components/admin/admin-location.tsx`)

Invisible. On mount, and then every 15 minutes (`REFRESH_MS = 15 * 60_000`), it asks the browser for the position (`enableHighAccuracy: true`, `timeout: 20_000` ms, `maximumAge: 5 * 60_000` ms) and writes cookie `xt_loc` = `lat,lng,accuracy,epochMs` (lat/lng to 6 decimals, accuracy rounded to metres), `path=/`, `SameSite=Lax`, `max-age=7200` (2 hours), plus `Secure` on https. Errors are ignored silently. The server's audit code reads this cookie to record where each action was done, and falls back to IP geolocation when it is missing (see `src/lib/audit-context.ts`).

### Acceptance checks (shell)

- A supervisor's menu shows exactly: Overview, Ask Xtend, Guide; Attendance group (7); Stock (2); Checks (2); People: Staff, Schedules, Leave, Store allocation, Notifications; Setup: Outlets. An admin's shows all but "Guide".
- With 3 unresolved location alerts and 2 unreviewed medium/high integrity flags, the bell shows "5"; with 150 it shows "99+"; with 0 no pill appears.
- Typing a name in the top search and pressing Enter lands on `/admin/users?q=<text>`.
- On a 390 px wide screen there is no sidebar; the menu button shows the current page's label and opens a grouped list.
- The floating Ask Xtend button is absent on `/admin/ask`; on other pages a conversation started in the panel is still there after navigating to another page and reopening.
- After allowing location, the `xt_loc` cookie exists with four comma-separated parts.
- Throwing in a page shows "The admin dashboard could not load" with "Try again" and "Go back".

---

## 2. Permission matrix

"Hidden" = not in the supervisor's menu and `requireSession(['admin'])` redirects them to `/`. "Read-only" = they can open it and see their team's data but cannot change anything. "Team" = full use, but only over their own team (RLS and the RPCs enforce it). Admins have full use of everything.

| Page | Admin | Supervisor | What a supervisor cannot do there |
|---|---|---|---|
| Overview | full | team | — (second quick action is "Stores" instead of "Teams") |
| Ask Xtend | full | team | Change who someone reports to; admin-only actions are refused by their routes |
| Admin guide | full | hidden (menu shows "Guide" instead) | — |
| Supervisor guide ("Guide") | can open by URL (not in menu) | full | — |
| Attendance | full | team (read) | Nothing to change: clock records are never editable by anyone |
| Movement | full | team | — |
| Store visits | full | team | No Team filter; coverage limited to their team's stores |
| Marketer reports | full | team | — (lists and downloads their team only) |
| Alerts | full | team, read-only | Resolve alerts (single or bulk) — admin only. They can run phone checks. |
| Support | full | team | — (reply, close, reopen, assign, quick replies on their team) |
| Analytics | full | team (read) | — |
| Stock count | full | team | Upload/replace the PDF count sheet. They can request counts and close requests they made. |
| X Metrics overview | full | read-only | Run checks now (downloads allowed, their team only) |
| X Metrics Expiry | full | read-only | Mark handled |
| X Metrics Grades | full | read-only | Finalise; review notes (downloads allowed, their team only) |
| X Metrics Scoring policy | full | read-only | Publish a version (they read the current one) |
| X Metrics Supplies / Targets / Products & stores / Settings | full | hidden (tabs not shown, page redirects) | everything |
| X Metrics staff/[id], stores/[id] | full | read-only | Void counts, sales, supplies (downloads allowed, their team only) |
| Integrity | full | team | — (they review their team's flags) |
| Check an excuse | full | team | — |
| Staff | full | team | Change email, role, store, supervisor, notification rule; delete an account; Login details (Word); Bulk import CSV. They can add merchandisers/marketers to their own stores (who report to them), edit name/phone, reset passwords, deactivate/reactivate — but not delete. |
| Staff bulk import | full | hidden | everything |
| Teams | full | hidden | everything |
| Schedules | full | team | Set anyone outside their team |
| Leave | full | team | Decide leave outside their team, or their own |
| Roles | full | hidden | everything |
| Store allocation | full | team | No team chips |
| Notifications | full | team | Reach anyone outside their team; manage others' templates/scheduled items; resend others' messages |
| Outlets | full | read-only | Add, edit, deactivate, delete; search; bulk add |
| Outlets bulk add | full | hidden | everything |
| Places | full | hidden | everything |
| Audit log | full | hidden | everything |
| Activity log | full | hidden | everything (the `activity_feed` RPC refuses them too) |
| Updates | full | hidden | everything |
| System (test mode, reset, go live) | full | hidden | everything (the reset and go-live functions are service-role only and check the admin again) |

Underlying API permissions worth knowing (from `generated/routes.md`): alert resolve routes, X Metrics admin routes (`xmAdminAction`), X Metrics exports, `/api/admin/metrics/run`, `/api/admin/teams`, `/api/admin/staff-roles`, `/api/admin/staff-logins`, `/api/admin/count-template`, `/api/admin/export/audit/*`, `/api/admin/export/activity/*` are `['admin']`; everything else under `/api/admin` admits both and relies on RLS/RPC checks.

### Acceptance checks

- Signed in as a supervisor, typing each hidden URL (`/admin/guide`, `/admin/teams`, `/admin/roles`, `/admin/places`, `/admin/audit`, `/admin/activity`, `/admin/updates`, `/admin/system`, `/admin/users/import`, `/admin/outlets/import`, `/admin/metrics/supplies`, `/admin/metrics/targets`, `/admin/metrics/setup`, `/admin/metrics/settings`) lands on `/`.
- A field worker typing any `/admin` URL lands on `/`; a signed-out visitor on `/login`.
- A supervisor never sees a person outside their team on any page or in any download.

---

## 3. Overview — `/admin`

Files: `src/app/admin/page.tsx` (data), `src/components/admin/overview-view.tsx` (layout), `overview-charts.tsx`, `live-alert-feed.tsx`, `live-locations.tsx`. Title "Overview — Xtend".

### What loads (all in parallel, through the user's session)

| Data | Source |
|---|---|
| Today's figures | RPC `admin_overview()` → `{date, staff_total, clocked_in, clocked_out, still_on_shift, absent, not_expected, late, off_site, open_alerts}`. `absent` counts only people expected in today (`day_kind = 'working'`, migration 059); `not_expected` = those on a day off or approved leave (returned, not shown yet) |
| Not clocked in | RPC `absentees_today()` → `{user_id, full_name, phone, outlet_name}`; leaves out anyone on a day off or approved leave (059) |
| Location coverage | RPC `coverage_today()` → `{user_id, full_name, outlet_name, ping_count, coverage_pct, last_ping_at}` |
| On shift now | RPC `live_locations()` then `withAvatars()` adds a signed `avatar_url` per person (`src/lib/avatars.ts`) |
| Open alerts | view `alert_detail` where `is_resolved = false`, newest first, limit 20 |
| Photo retention | RPC `selfie_retention_status()` → `{last_run_at, last_result{photos_deleted}, photos_held, overdue}` |
| Week of clock-ins | view `attendance_detail`, `type = 'opening'`, `attendance_date` between today−6 and today, columns `attendance_date, is_late`, limit 5000 |

The week is 7 entries (today−6 … today), each `{date, label: 'Mon', long: 'Wednesday, 7 Oct', onTime, late}` counted from the openings.

### Derived numbers

- `weekTotal` = all clock-ins in the 7 days; `weekLate` = late ones.
- `yesterday` = clock-ins on day 6 of 7.
- `pct(n, of = staff_total)` = round(n / of × 100), 0 when `of` is 0.
- `change` = round((clocked_in − yesterday) / yesterday × 100), or null when yesterday is 0.
- `avgCoverage` = mean of `coverage_pct` (null as 0), rounded; 0 when nobody is tracked.
- `lowest` = the 4 tracked rows with the lowest coverage.

### Layout (top to bottom)

1. **Heading**: "`Good morning|Good afternoon|Good evening`, `<first name>`" — before 12:00 Lagos is morning, before 17:00 afternoon, else evening. Under it: "`Wednesday 14 October 2026` · updated `HH:MM`".
2. Two columns on `xl` (main, and a right column 22 rem wide); stacked below.

**Main column**

- **Attendance card** (`surface`, row on `md`):
  - Left: big number (4xl/5xl) = clocked in today; line "clocked in today · `{weekTotal}` this week, `{weekLate}` late". Top right: a chip "Last 7 days" and a legend (square swatches) "On time" (`ON_TIME`) and "Late" (`LATE`).
  - The **week chart** (`AttendanceChart`): 256 px tall stacked bars, one per day, on-time at the bottom, late on top, 3 px gap, rounded 8 px, max bar width 4.5 rem. Y axis has 5 ticks (max, ¾, ½, ¼, 0) with gridlines; `max = niceMax(highest day)` where `niceMax(v)` = 4 when v ≤ 4, else the first of 1,2,3,4,6,8,10 × 10^floor(log10 v) that is ≥ v. One day is "picked" (default today; hover, focus or click picks another): the picked day is in colour with a diagonal hatch, the others are greys (`#e6e2de` on-time, `#efece9` late). Above the chart a summary strip for the picked day: its long date, "On time N", "Late N", and on the right "Clock-ins N". A zero day still shows a 4 px stub. Each bar button has aria-label "`<long date>`: N on time, N late".
  - Right panel (3 columns on phones, one column 240 px wide on `md` with a left border), three figures:
    - **Clocked in**: value; note "`|change|`% vs yesterday" with an up/down arrow when `change` is known, otherwise "`pct`% of staff"; green when change ≥ 0 or unknown, brand-orange when down.
    - **Late**: value; note "`pct(late, clocked_in)`% of clock-ins"; green only when 0.
    - **Not in store**: `off_site`; note "N open alert(s)"; green only when 0.
- Two cards side by side on `lg`:
  - **"Clock-ins today"** / "Of everyone assigned to a store": a 32 px track with a hatched `ON_TIME` fill at `pct(clocked_in)`% (min 8 px when > 0); under it "`N` in" and "`total` staff".
  - **Tip card**: one suggestion, with a decorative 4×4 block pattern bottom right. Rules, first match wins:
    1. `absent > 0`: title "`N` person has / people have not clocked in yet", body "They are assigned to a store today. A quick call usually settles it before the morning is gone.", link **"See who"** → `#not-clocked-in`.
    2. `open_alerts > 0`: "`N` open alert(s) to look at", "Someone left their store or clocked in away from it. Check and resolve each one.", **"Review alerts"** → `/admin/alerts`.
    3. else: "Everyone assigned is in", "Nobody is missing and there are no open alerts. Stock counts and visits are worth a look.", **"Stock count"** → `/admin/store-counts`.
- Three cards (2 columns on `lg`, 3 on `2xl`):
  - **"Where everyone is"** / "Right now, of `total` staff": big number `still_on_shift` "on shift", then a `SegmentBar` (28 px, parts separated by 4 px gaps, hatched, min 6 px each) of "On shift now" (`ON_TIME`), "Clocked out" (`LATE`), "Not clocked in" (`NOT_IN`), against `total`; under it each part listed with swatch, count and share %.
  - **"Location coverage"** / "Today, people on shift": big number = rows tracked, "tracked"; a **gauge** — a half ring in 5 blocks (36° each, 2° gaps, stroke 26), filled up to `avgCoverage`% with a gradient from `LATE` to `ON_TIME` plus a white hatch, figure "`N`%" and label "of shift time located" inside; footnote "The average share of each shift in which the phone reported where it was."
  - **"Least located"** / "Lowest coverage first", button **"Map"** → `/admin/tracking`. Up to 4 rows: avatar (initials tile), name, "`c`%", a 10 px hatched bar (min 3 %) coloured `ON_TIME` when c ≥ 70 else `LATE`, then "`outlet` · last seen HH:MM" ("No outlet" when none). Empty: "Nobody has clocked in yet."

**Right column**

- **"Today"** / "Quick actions" card with a **"+ Add staff"** chip (→ `/admin/users?new=1`).
  - A brand-gradient tile with a hatch overlay: the short date, big `still_on_shift`, "on shift right now", footer "`clocked_in` of `total` clocked in" and the word **XTEND** on the right.
  - Five icon shortcuts in a row: Staff (`/admin/users`); for admins **Teams** (`/admin/teams`), for supervisors **Stores** (`/admin/assignments`); Movement (`/admin/tracking`); Alerts (`/admin/alerts`); More (`/admin/attendance`).
  - **"On shift now"**: up to 5 people as 48 px avatars (photo if any, else initials) with first names, each linking to `/admin/tracking?person=<id>`; anyone outside their geofence (`inside_geofence === false`) gets a brand ring. Empty: "Nobody is on shift yet." More than 5: link "and `N` more on the map" → `/admin/tracking`.
- **"Open alerts"** card (`LiveAlertFeed`), button **"Review all"** → `/admin/alerts`. Column hints "Name" / "When". Shows up to 8 alerts: bell tile, staff name, the type in words plus " · `distance`" when known, time HH:MM and the word "Open" in brand. Types: `left_geofence` "Left the store during their shift", `low_accuracy` "Location too rough to verify", `permission_denied` "Opened Xtend with location off", `off_site_clock` "Clocked in or out away from the store". More than 8: "`N` more" link. Empty: "Nothing unresolved." **Realtime**: subscribes to Supabase channel `alerts-feed` for INSERTs on `location_alerts`; for each it re-reads the row from `alert_detail` (for the name) and prepends it, keeping at most 20.

**Below both columns**

- **"Where everyone is (`N` on shift)"** (`LiveLocations`), with link **"Live map"** → `/admin/tracking` and a refresh icon button (calls `router.refresh()`). One row per person on shift:
  - Name with a badge: "In store" (success) when inside, "Not in store" (destructive) when outside, "No outlet" (outline) when unknown.
  - Pin line: last place name, else the clock-in label, else coordinates to 5 decimals, else "Location unknown"; then " · `distance` from `outlet`" in green when inside, bold red when outside.
  - Small line: "Clocked in HH:MM · last seen HH:MM (N min ago)"; the last-seen part turns warning colour when stale, i.e. `minutes_since_ping > 15` (null counts as 999). With no ping: "no location check since clock-in" in warning colour.
  - Buttons: call (`tel:`), route (→ `/admin/tracking?person=<id>`, aria "Follow `<name>`'s route today"), and an external Google Maps pin (`https://www.google.com/maps/search/?api=1&query=lat,lng`) when a position exists.
  - Empty: "Nobody is on shift right now."
- **"Not clocked in (`N`)"** (anchor `#not-clocked-in`, scroll margin 96 px) / "Assigned to a store today, with no clock-in yet": a 1/2/3-column list; each row an initials avatar, name, outlet ("No outlet assigned"), and a call button when there is a phone. Empty: "Everyone assigned has clocked in."
- **Photo footnote** (only when the retention RPC returned): "Clock photos are deleted 24 hours after they are taken — `held` held right now[, `overdue` due to go on the next sweep][ · last swept HH:MM, `N` removed]."

### Supervisor differences

Same page; all figures are their team's (RLS). The quick-action second icon is **Stores** instead of **Teams**.

### Acceptance checks

- Before noon Lagos the heading starts "Good morning".
- With 5 clock-ins today and 4 yesterday the Clocked in note reads "25% vs yesterday" in green with an up arrow; with 0 yesterday it reads "`x`% of staff".
- Hovering Tuesday's bar recolours only Tuesday and the strip above shows Tuesday's on-time, late and total.
- With anyone absent the tip says "… not clocked in yet" and "See who" scrolls to the Not clocked in list.
- A new location alert inserted in the database appears at the top of Open alerts without a reload.
- A person last pinged 20 minutes ago shows the last-seen text in warning colour.
- The Least located list shows at most 4 people, lowest first, with bars orange-red (≥ 70 %) or gold (< 70 %).
- Someone on a day off or approved leave today who has not clocked in is not in "Not clocked in" and does not make the tip say anyone is missing.

---

## 4. Ask Xtend — `/admin/ask`

Files: `src/app/admin/ask/page.tsx`, `src/components/admin/attendance-assistant.tsx`, `assistant-plan-card.tsx`, `assistant-action-card.tsx`, `src/lib/assistant-conversations.ts`, `src/lib/assistant-report-spec.ts`, `src/lib/assistant-action-types.ts`. The server side (model, tools, data the model can read) is `src/lib/assistant.ts` and `src/lib/assistant-data.ts`; it is only summarised here.

### Page

Max width 5xl. Heading **"Ask Xtend"**; paragraph: "Ask in plain words about attendance, store visits, stock counts, X Metrics, integrity flags, location alerts, support issues and notifications. It can make reports to download, and prepare notifications, count requests and reviews for you to approve." + for supervisors " Answers cover your own team only." + " Every chat is kept under Earlier chats for you alone; rename or delete it there. Times are Africa/Lagos."

Not configured (no `ANTHROPIC_API_KEY`): a warning alert "The assistant is not set up yet. Add `ANTHROPIC_API_KEY` to the environment and redeploy."

### Layout

- Full page, `lg` and up: two columns — a sticky left column 15 rem wide headed **"EARLIER CHATS"** with the history list, and the chat. Below `lg` the history is behind a button.
- Compact (the floating panel): the chat fills the panel; the message list scrolls; the question box is pinned at the bottom; the history replaces the message list when shown.

Bar above the chat: **"New chat"** (outline, plus icon; disabled while busy or when there is nothing to clear) and **"Earlier chats (N)"** (history icon; toggles the list; hidden on `lg` on the full page; loads the list on first open in the panel). When the current chat has been kept: right-aligned muted "Kept in your earlier chats".

Empty chat: a card "**Try one of these**" (sparkle icon) with topic tabs (pills) and the suggestions of the chosen topic as chips; clicking a chip asks it immediately. Topics and questions (from `SUGGESTION_GROUPS`):

- Attendance: "Who has not clocked in today?", "Who is still on shift and has not clocked out?", "Who clocked in late today?", "Who clocked in away from their store today?", "Who forgot to clock out yesterday?", "Who was late most often this week?", "Make today's attendance report", "Weekly attendance report for this week".
- Visits: "Which allocated stores did nobody visit this week?", "Who visited the fewest of their stores this week?", "How long did each marketer spend in stores today?", "Store visits report for this week", "Who left their store during their shift today?".
- Stock: "Show today's stock counts", "Who has not done the stock count they were asked for?", "How are X Metrics sales against target this month?", "Which stock counts did not add up this month?", "Any products close to expiry?".
- Integrity: "Who should I look at first for integrity flags?", "Who has a fake-GPS flag this week?", "Any high integrity flags not yet reviewed?", "Bala says his network was bad this morning. Is that true?".
- Staff and support: "Any support issues waiting for the office?", "What problems have staff raised this week?", "Summarise this week's field reports", "Which notifications did we send this week, and did they arrive?".
- Actions: "Remind everyone who has not clocked in to clock in now", "Ask all merchandisers for a stock count by Friday", "Check if Ada's phone is on", "Show me Ada's movement yesterday".

Footnote: "To allocate stores, attach a spreadsheet, PDF or photo of the list with the paperclip, or paste the list in the box. You check the changes before anything is saved."

Messages: user bubbles right-aligned, brand fill, white; assistant bubbles left, white card with a border and soft shadow; max width 85 % (full width when a bubble holds a plan or action). Text keeps line breaks. A user turn with a file shows a paperclip and the file name. Under every assistant answer a small **"Copy"** button (shows **"Copied"** for 1.8 s). While waiting: a grey bubble "Checking…" or, if the question had a file, "Reading the file…". The list auto-scrolls to the end.

Composer: a hidden file input; paperclip button (title "Attach a spreadsheet, PDF or photo"); a 2-row textarea (max 20 000 characters, min height 56 px), placeholder "Ask anything, e.g. who hasn't clocked out yet?" or, with a file attached, "Say what to do with the file, or just send it"; send button (disabled when busy or nothing to send). Enter sends; Shift+Enter is a new line. An attached file shows as a tint chip with its name and a remove X.

### Limits and rules (`attendance-assistant.tsx`)

- Accepted files: `.csv,.tsv,.txt,.xlsx,.pdf,image/png,image/jpeg,image/webp,image/gif`; max 3 MB (`MAX_FILE_BYTES = 3 * 1024 * 1024`). Over: "That file is over 3 MB. Split it, or save it as CSV, and attach it again."
- A file sent without words sends the question "Read the attached file and prepare the store allocations in it."
- Only the last 12 turns (`HISTORY_SENT = 12`) are sent, with leading assistant turns dropped; older turns with a file carry "(attached: name)" in their text; only the newest question carries the file.
- POST `/api/admin/ask` `{messages, attachment}`; server allows 1–30 messages each ≤ 20 000 characters, `maxDuration` 300 s. Server errors: 503 "The assistant is not set up. Add ANTHROPIC_API_KEY to the environment."; 400 "Type a question to ask, or attach a file under 3 MB." / "The last message must be a question."; 429 "The assistant is busy. Try again in a moment."; 400 "The assistant could not read that. If you attached a file, try a smaller or simpler one."; 502 "The assistant could not answer right now."; 413 on the client becomes "That file is too big to send. Save it as CSV and try again."; anything else "The assistant did not answer.". On failure the question and file are put back in the box and the error shows as a red alert.
- Model `claude-opus-5`, at most 10 tool rounds (`src/lib/assistant.ts`). The model reads through the caller's session, so a supervisor only gets their team.
- **Schedules and leave** (migration 059). The system prompt says: "Everyone has a work schedule (days on and days off; Monday to Saturday unless changed) and may have approved leave. Never call someone absent, or say they did not come, on a day off or a day of approved leave: say it was their day off or that they were on leave. Only a working day with no clock-in is an absence." `attendance_on_day` splits people into clocked in and out, still on shift, **not clocked in (expected at work)**, **day off** and **on leave** (counts `day_off`, `on_leave`); `staff_history` gives each day's `schedule` ("working day", "day off", "on approved leave"); `attendance_summary` adds `working_days`, `days_off`, `leave_days` and `absent_days` (past working days with no clock-in, on or after the account was made; today not counted).
- **Field reports** carry the store visits kept with each report (`visits`: "Store 09:10–10:00 (50 min); …. Total 1 h 30 min." or "No store visits", and `visit_minutes`; migration 060).

### Answer extras

- **Report card** (per report): file icon + title, then four pill buttons **PDF**, **Excel**, **Word**, **CSV**, each a download link to `/api/admin/ask/report/<pdf|xlsx|docx|csv>?kind&from&to&name&title&summary`. Kinds: `daily_attendance` (counts include "Day off" and "On leave"), `attendance_summary` (columns Staff, Role, Store, Working days, Absent, Leave days, Days clocked in, Days clocked out, In but not out, Late days, Off-site clock-ins), `staff_history` (a Schedule column after Staff), `field_reports` (Store visits and Minutes in stores after Store; a last **Documents** column with the attached documents' names and sizes, 0064), `store_visits`, `store_counts`. The download rebuilds rows from the database for whoever clicks; nothing the model typed goes into a table.
- **Plan card** (store allocations and team changes): "`N` change(s) to review"; section "STORE ALLOCATIONS" (each row: person, "only these stores" or "add to their stores", the store list or "no stores", and "Now: …" current stores); section "SUPERVISORS" ("person → supervisor" or "no supervisor", "Now: …" when different); amber box "Left out, could not be matched" listing unmatched lines. Buttons **"Apply N change(s)"** (→ POST `/api/admin/ask/apply` with ids only; label "Applying…" meanwhile) and **"Discard"** ("Discarded. Nothing was changed."). After apply: "`ok` of `N` applied." plus a red line per failure "name: detail", or "Everything was saved." in green; the page data refreshes. Only admins can change supervisors (the server refuses for supervisors).
- **Action card** (one proposed action): wand icon + title, detail lines, optional amber warning, buttons `<verb>` (e.g. "Send", "Request", "Deactivate"; "Working…" meanwhile) and **"Cancel"** ("Cancelled. Nothing was done."). Apply POSTs `/api/admin/ask/act` `{kind, payload}`, which calls the same route as the dashboard button (same permissions, pushes and audit). Result shown green or red; e.g. notify → "Sent to N (D delivered, F failed)."; count request → "Requested from N; M told on their phone."; network error "No connection. Try again.". Kinds: `notify`, `count_request`, `close_count_request`, `phone_check`, `review_flags`, `sales_target`, `xm_store`, `outlet_hours`, `deactivate`.
- **Page links**: pill links with an arrow to dashboard pages (only `/admin…` paths are allowed): Movement, Check an excuse, Attendance, Store visits, Integrity flags, Stock counts, Notifications, Staff, Stores (`/admin/outlets`), X Metrics, Audit log, Alerts, Support.

### Kept chats

- After every answered question the whole chat is saved (first time POST `/api/admin/ask/conversations`, then PATCH `/api/admin/ask/conversations/<id>`), saves queued one after another. Saved turns keep text, file name, reports and links; actions and plans are turned into words only ("A plan: 3 store allocations and 1 team change", or the action title) shown later in a dashed box "**Proposed in this chat earlier**" … "Ask again to do it now; old buttons are not kept." Max 200 turns, 40 000 characters per turn. If saving fails a small note: "This chat could not be kept: <reason>".
- Title = first question, whole words, ≤ ~60 characters with "…" (cut at a space after character 30 when possible); "New conversation" if empty.
- History list grouped "Today", "Yesterday", "Last 7 days", "Older" (by Lagos date of `updated_at`, newest first). Each row: title (bold if current), "`date time` · N question(s)" (N = ceil(turns / 2)), a pencil (rename inline, max 120 characters, check/X buttons; errors "Give it a name", "Keep the name under 120 characters") and a bin (confirm "Delete “title”? This cannot be undone."; deleting the open chat starts a new one). Empty: "Nothing yet. Each chat you have is kept here, for you only." Loading: "Loading…".

### Supervisor differences

Same UI. Answers cover their team only. Plans can only change store allocations; supervisor changes are refused. Admin-only actions are refused by the underlying route.

### Acceptance checks

- Clicking a suggestion chip sends it at once and shows "Checking…".
- Attaching a 4 MB file shows the over-3 MB message and attaches nothing.
- An answer with a report shows four download buttons whose links start `/api/admin/ask/report/pdf?kind=`.
- Reopening a kept chat that once offered "Send" shows the dashed "Proposed in this chat earlier" box and no button.
- A failed request puts the question back in the box.

---

## 5. Admin guide — `/admin/guide` (admins only)

File: `src/app/admin/guide/page.tsx`, building blocks in `src/components/guide.tsx`. `requireSession(['admin'])`; supervisors who type the URL are redirected to `/`.

Layout: heading **"Admin guide"**, intro "How to use the dashboard, page by page, in the order of the menu. Only admins can see this guide. Staff have a short guide of their own at /guide (clocking in and out, stock counts, using the app and reporting a problem), which you can share with them. Times everywhere are Lagos time." Then a row of contents pills (icon + title, each an anchor), then sections in a 2-column grid on `xl`. Each section is a card with an icon tile, an h2 title, a muted intro, and body text. Building blocks: `Steps` (numbered list with grey number circles), `Tip` (tint rounded box), `Questions` (expanding `<details>` with a brand "+" that rotates 45° when open), `Ui` (bold text for on-screen names), `GuideShot` (bordered screenshot with caption).

Sections (id, title, intro) and what each must say:

| id | Title | Intro | Content in short |
|---|---|---|---|
| first-week | Your first week | Do these once, in this order, before staff start clocking in. | Steps: Outlets (radius 50–100 m small shop, 150–300 m supermarket or mall); Staff (one by one or Bulk import CSV); Store allocation; Teams; share download page and staff guide and download Login details (Word); optional X Metrics. |
| every-day | Every day | Ten minutes each morning keeps on top of the field. | Steps: Overview; Alerts oldest first; Support longest waiting first; Integrity "Who to look at first"; late in the day Attendance and Store visits. Tip with Ask Xtend questions. |
| overview | Overview, Ask Xtend and the guide | The top of the menu. | What Overview shows; screenshot `/guide/admin-overview.png` (2880×1800) "The overview, before anyone has clocked in"; Ask Xtend abilities and examples; nothing happens until the card's button; chats under Earlier chats. |
| attendance | Attendance and Analytics | Who came in, when, and where. | Late = after shift start; off site = outside radius; flagged = location unclear; no clock-in on a working day = absent; each person's schedule decides their working days, and days off (grey "–") and approved leave (soft orange "Lv") never count as absent (here, Analytics, downloads, Ask Xtend, the 09:30 no-show message); records cannot be edited. Analytics compares with the same number of days before. |
| movement | Movement and Store visits | Where staff are during their shift. | Live map, "not heard from in 15 minutes"; up to 7 days; impossible jumps faster than 150 km/h; Store coverage 7/14/30 days. "How location is recorded (not shown to staff)": pings every few minutes; Android "Xtend · On shift" notification, "Allow all the time"; iPhone wakes after about 500 m; offline positions sent later; a position after clock-out is refused; browser must stay open. |
| alerts-support | Alerts and Support | What needs a person today. | Alerts filters; three or more alerts listed at the top; bulk resolve with one note. Support: helper answers simple ones; `{name}` in quick replies; Who answers; closes, reopens if they write again. |
| stock | Stock count and X Metrics | What is in each store, and how staff are scored. | Count requests; back store + shop floor, expiry, sold, shelf photo; Count sheets as Excel/PDF/photo. X Metrics sub-pages listed. |
| checks | Integrity and Check an excuse | When something does not look right. Staff never see these. | Integrity up to 120 days; Check an excuse up to 3 days; Keep on record. |
| people | Staff, teams, roles and notifications | The People part of the menu. | Staff tabs, Add staff, Login details (Word); screenshots `/guide/admin-add-staff.png` (1932×504) and `/guide/admin-teams.png` (2000×1216); Teams "Select all shown", "Assign to supervisor"; Roles; Store allocation (once someone has any store allocated, a check-in at a store not theirs is refused); Schedules (Mon–Sat unless changed; one-off changes 60 days back to a year ahead; leave, then one-off change, then weekly pattern) and Leave (Annual/Sick/Casual/Other, 7 days back, a year ahead, 60 days, no overlaps; nobody decides their own; pending leave does not excuse a day; audited `schedule.pattern`, `schedule.override`, `leave.approve`, `leave.reject`); Notifications "See who", "Later", "Send again". Tip on what supervisors can and cannot do. |
| setup | Outlets, places, audit and activity logs, updates, test mode | The Setup part of the menu. | Steps to add a store ("Add outlet", "I am standing here", "Create outlet"); "No location yet" tip; Places ("Save and verify", "Make it a store", "Dismiss"); Audit log; Activity log (what it records, quick ranges, By person with Movement/Attendance links, downloads, admins only, 180 days for sign-ins and app opens, migration 062); Updates ("What's new", "Required", lowest Android/iPhone build); System: test mode, the four steps Test / Reset (tick categories, dependencies, Review, RESET + password, Finish removing files) / Go live ("We are live — turn off test mode", WE ARE LIVE), and a tip on what always stays, the one audit row, and that both are permanent. |
| apps | Staff phones and the app | Getting staff set up, and what their phones need. | Download page with QR; sign in, password, profile photo, allow location/camera/notifications; clocking in blocked until notifications on. |
| exports | Downloads and records | Getting the numbers out. | Excel, PDF, Word, CSV exactly as filtered; downloads audited. Marketer reports (eight tiles, clock-in/out, visits with the time between stores, daily report, counts, sales; month adds day-by-day, per-store and each day) and the daily report's database-written copy of the day's visits. Clock-out reminders (shift end, then an hour later). |
| questions | Questions | — | 7 Q&As: cannot clock in; clocked in but nothing shows; long silences; forgot password; left the company; store location wrong; a supervisor wants this guide (link to `/admin/supervisor-guide`). |

The rule from the project: how monitoring works (location, integrity, alerts, excuses) is told only in this guide, never to staff.

### Acceptance checks

- A supervisor opening `/admin/guide` is redirected to `/`.
- The contents row has 13 pills; clicking one scrolls to its section.
- The Questions items open and close individually.

---

## 6. Supervisor guide — `/admin/supervisor-guide` (menu label "Guide", supervisors only in the menu)

File: `src/app/admin/supervisor-guide/page.tsx`. `requireSession(['admin','supervisor'])` — admins may open it by URL; then a tint note shows: "You are an admin: this is the guide supervisors see. Yours is the Admin guide." (link to `/admin/guide`).

Heading **"Supervisor guide"**; intro "How to look after your team from the dashboard, page by page. Everything you see covers your own team only. Your staff have a short guide of their own at /guide, which you can share with them. Times are Lagos time."

Sections (same building blocks): Your team in the dashboard ("What you can see and do."), Every day ("Ten minutes each morning, and a look before close."), Overview and Ask Xtend, Attendance and Analytics, Movement and Store visits (tip "Use what you see to ask, not to accuse: a phone with no network or no battery looks quiet too."), Alerts and Support ("admins resolve alerts"; pass to an admin under Who answers), Stock count and X Metrics (3 steps; X Metrics read-only, "an admin sets it up and changes it"), Integrity and Check an excuse (tip "Staff do not see flags, checks or excuses kept on record. Keep it that way."), Your staff, stores and messages (Outlets: "To add a store or change one, ask an admin."), Questions (5).

The "Your team" section is the plain statement of supervisor rights: they can add merchandisers and marketers (who join their team), reset their passwords, allocate their stores, ask for stock counts, send notifications, answer support, check excuses and review integrity flags. An admin does the rest: adding supervisors and admins, moving people between teams, adding or changing stores, resolving alerts and changing X Metrics. This guide leaves out how location and the checks work.

### Acceptance checks

- A supervisor's menu shows "Guide" linking here; an admin's does not, but an admin can open the URL and sees the "You are an admin" note.

---

## 7. Attendance — `/admin/attendance`

Files: `src/app/admin/attendance/page.tsx`, `src/components/admin/attendance-filters.tsx`, `attendance-grid.tsx`, `attendance-table.tsx`, `attendance-map.tsx`; logic in `src/lib/attendance-report.ts` (pure, tested by `scripts/check-attendance.ts`) and `src/lib/attendance-server.ts`. Title "Attendance — Xtend".

Heading **"Attendance"**; intro: "Who came, when, and where, day by day: on time or late (against their store’s opening time), at the store or away from it, and whether they clocked out. A working day on someone’s schedule without a clock-in counts as absent; their days off and approved leave do not. Times are Lagos time; clock records cannot be changed or deleted."

### The day model (shared with Analytics and the downloads)

Only field staff are reported: profiles with role `merchandiser` or `marketer` that the caller can see (RLS: all for admins, own team for supervisors).

For each person × each day of the range one **day record** is built (`buildDays`):

- Clock-in = the earliest `opening` event that day; clock-out = the latest `closing` event at or after the clock-in.
- `present` = has a clock-in. `offSite` = clock-in status is not `on_site` (so `off_site` or `flagged`). `flagged` = status `flagged`. `late` = the clock-in's `is_late` (set by the database against the store's `shift_start`).
- Status, in this order: present → `off_site` if offSite, else `late` if late, else `on_time` ("off site wins over late"). Not present → `none` if the day is after today, before the account was created (Lagos date of `created_at`), or the person is inactive; else the person's schedule for that day (`ScheduleBook.kind`, `src/lib/schedule.ts`, the same order as `day_kind()` in migration 059: approved leave → `leave`, else a one-off change for that date, else their weekly pattern, else Monday to Saturday → `off` or working): `off` (day off), `leave` (approved leave), or `absent` on a working day. The schedule is read through the caller's session (`loadScheduleSafe`, `src/lib/schedule-server.ts`: `work_patterns`, `schedule_overrides` in range, approved `leave_requests` overlapping the range, 1000 rows a page up to 20 000, only the chosen person when one is picked); if it cannot be read everyone falls back to Monday to Saturday.
- `missingOut` = present, no clock-out, day before today. `onShift` = present, no clock-out, day is today.
- `minutesLate` = clock-in minute − shift start minute (≥ 0) when late. `hours` = clock-out − clock-in. `sentLateMin` = minutes between the phone taking the clock-in (`client_captured_at`) and the server receiving it (`created_at`).
- The record's store = the clock-in's store, or the person's own store on a day without one.
- "Counted" days = present or absent (off, leave and none are ignored in all totals).

**Summary** (`summarise`): people (distinct in counted days), expected (counted days), present, absent, onTime, late, offSite, flagged, missingOut, punctuality = onTime / present × 100, turnout = present / expected × 100, avgIn (mean clock-in minute), avgLateMin, avgHours. `percent()` prints a rounded "NN%" or "—".

### Filters (GET form; the address bar holds the whole view)

| Param | Meaning | Default / rules |
|---|---|---|
| `from`, `to` | Date range (date inputs, max = today) | Attendance falls back to **today only** (`parseReportFilter(params, 1)`). `cleanRange`: `to` capped at today; missing `to` with a `from` → today; swapped if reversed; longer than **92 days** (`MAX_RANGE_DAYS`, `attendance-server.ts`) keeps the end and moves the start, and sets `clipped`. |
| `user_id` (or legacy `person`) | "Who": **Everyone**, active people, then an optgroup **"Switched off"** for inactive ones | all |
| `outlet_id` | "Store": **All stores** + every store the caller can see | all. Keeps people whose own store it is or who clocked in there, then keeps only day records at that store. |
| `team` | "Team" (only shown when more than one team): **All teams**, "`<Supervisor>`’s team" options, **"Reports to nobody"** (`none`) | all. A supervisor's own lead name is known; others read "Another team". |
| `role` | "Role" (only when more than one): **All roles**, built-in labels and added roles as `custom:<id>` | all |
| `status` | "Show days": **All days**, On time, Late, Off site or flagged, Flagged, No clock-out, Absent / not in, Came in (any), **On leave** (`leave`), **Day off** (`off`) | all. Filters the table and download only, not the cards. On leave / Day off match days without a clock-in of that kind. |
| `sort`, `dir`, `by` | Used by links and Analytics; table sorting itself is client-side | `date`, `desc`, `person` |

Value `all` means no filter. Button **"Show"** submits. Under the form a **"Quick:"** row of preset chips: Today, Yesterday, This week (Monday start), Last 7 days, Last 30 days, This month; the chip matching the current range is filled brand. When any of person/store/team/role/status is set, a **"Clear filters"** link keeps only the dates.

**Export** button (a `<details>` drop-down pill with a download icon and a chevron) opens a 256 px panel with two groups, each with four chips **Excel**, **PDF**, **Word**, **CSV**:

- **"Download day by day"** → `/api/admin/export/attendance/<fmt>?<current filter>`.
- **"Every clock-in and out"** → `/api/admin/export/<fmt>?from&to&user_id&outlet_id` (raw events).

### Notices

- `clipped`: info alert "Showing the last 92 days of the range you picked."
- More than 40 000 clock events in range (`MAX_EVENTS`, read 1000 per page): warning "There are more clock records in this range than one page can read. Pick fewer days."
- Load failure: heading plus red alert "Could not load attendance: <message>".

### Summary cards

A line "`<long date>`" (or "`<from long>` to `<to long>`") " · N person/people". Then 8 cards (2 / 4 / 8 columns at phone / `sm` / `xl`); a value turns red when it is a warning and above 0:

| Card | Value | Note |
|---|---|---|
| Came in | present | "of N working day(s)" |
| Absent or not in yet (when range ends today) / Absent | absent (red if > 0) | — |
| Late | late (red if > 0) | "`X` late on average" (e.g. "12 min", "1 h 15 min") |
| Off site or flagged | offSite (red) | — |
| No clock-out | missingOut (red) | — |
| On time | punctuality % | "of those who came" |
| Turned up | turnout % | "of working days" |
| Usual clock-in | avgIn as HH:MM | "`x.x` h on shift on average" |

### Today lists (only when the range ends today and there are records today)

Two cards side by side:

- **"Not clocked in today (N)"**, note "`k` on shift now." when anyone is; each row: name, own store ("No store") and " · `<Supervisor>`’s team"; links **Call** (`tel:`) and **Movement** (`/admin/tracking?person=<id>&date=<today>&until=<today>`). Empty: "Everybody expected today has clocked in."
- **"Late today (N)"**, most minutes late first; line "In at HH:MM, `X` late · store". Empty: "Nobody was late today."

Lists scroll after 288 px.

### Worth a look (`concerns`, `attendance-report.ts`)

Shown as a red alert titled **"Worth a look"** when any pattern reaches its threshold within the range. Thresholds (`CONCERN_AT`): absent **2** days, late **3**, off site **2**, missing clock-out **2**, sent late **2** (a clock-in received **30+** minutes after it was taken, `SENT_LATE_MIN = 30`). Ranked by count × weight (absent 5, off site 4, sent late 3, missing out 2, late 1), then name; at most **10** on the page (20 in the download). Sentences:

- "`Name` did not clock in on N days."
- "`Name` was late on N days, by `X` on average."
- "`Name` clocked in away from their store (or was flagged) on N days."
- "`Name` did not clock out on N days."
- "`Name`'s clock-in reached Xtend 30+ minutes after the photo was taken on N days. Saved with no network, or worth asking about."

Each line ends with a link **"See their days"** (same filter, that person, status cleared) and, for absent and late, " · **Check an excuse for today**" (or "**for the last one**") → `/admin/excuses?person=<id>&date=<last>&until=<last>&from=06:00&to=12:00`.

### Calendar (only when the range is more than one day and at most **62 days**, `GRID_MAX_DAYS`)

Card **"Calendar"** / "One square per day. Point at a square for the times; tap it to open that day." A table with a sticky first column "Person" (truncated at 8.5 rem / 12 rem), a column per day (header: weekday initial from "SMTWTFS" over the day number, all muted), and a last column **"Came"** = "came/expected" (expected = present or absent days). 24 px squares, 3 px apart, 5 px radius:

| Status | Fill | Letter |
|---|---|---|
| on_time | `#d1511a`, white | — |
| late | `#f2b48a`, dark text `#52281a` | L |
| off_site | `#9b3517`, white | O |
| absent | `#52281a`, white | A |
| off (day off) | `#e7e3df`, text `#6f6862` | – |
| leave (approved leave) | `#f6e4d8`, text `#9b3517`, inset 1 px `#f2b48a` ring | Lv |
| none | dashed outline box, not a link | — |

A small dot in the top-right corner marks a missing clock-out (dark `#52281a` on a late square, else `#e8833a`); a short white bar at the bottom marks "still on shift". The tooltip/aria text (`cellTitle`): "`Name`, `Weekday` `d Mon` · In HH:MM (X late) · Off site|Flagged · Out HH:MM|Still on shift|No clock-out", or the status label for absent/off/leave ("Absent", "Day off", "On leave"). Clicking a square goes to the same page filtered to that person and day, `#days`. People with nothing but `none` days are left out; none at all: "Nobody to show for these days." A key underneath: On time, "L  Late", "O  Off site or flagged", "A  Absent", "–  Day off", "Lv  On leave", "No clock-out" (dot), "Not on the team yet" (dashed). Longer than 62 days: "Pick 62 days or fewer to see the calendar."

### Day by day (`#days`)

Which days are listed (`inDayTable`): with a status picked, the days matching it; with none, every counted day plus days of leave, and, when one person is picked, their days off too (for everyone, days off would bury the rest).

Heading **"Day by day"**, right: "N day(s)[ matching] · tap a row for photos, map, phone and links". The page hands at most **1500** rows (`TABLE_MAX`) to the table, newest first; above that: "The newest 1500 of N days are listed here. The download has them all."

Toggle **Table** / **Map**.

**Table (≥ `md`)**, sortable by clicking a header (arrow shows direction; first click sorts name and store ascending, the rest descending; blanks always last; ties newest day then name). Columns: Day ("Wed, 14 Oct"), Person (with "`<Supervisor>`’s team" underneath), Store, In, Out (or "on shift"), Hours ("8 h 05 min"), From store (metres), How it went (badges), chevron. Badges: not present → "Clock-out only" (red) when only a clock-out exists, else "Day off" (outline) on a day off, "On leave" (default/brand) on leave, else "Absent" (red); present → "Late `X`" (warning) or "On time" (success); "Flagged" or "Off site" (red); "No clock-out" (warning); "On shift" (outline); "Sent `X` later" (outline) when the clock-in arrived ≥ **5** minutes after it was taken (`OFFLINE_MIN = 5`). 100 rows at a time (`PAGE = 100`), button **"Show more (N left)"**.

**Phone (< `md`)**: cards with name, short date, "In HH:MM · out HH:MM|on shift|no clock-out · hours" or "No clock-in", "store · distance from it", badges, and a chevron. A **Sort** picker replaces header clicks: Newest day, Oldest day, Name, Earliest in, Most late, Furthest from store, Shortest day.

**Expanded day** (click a row): two panels, Clock-in and Clock-out. Each shows the photo (fetched on open as a 5-minute signed link: POST `/api/signed-url` `{bucket:'selfies', paths, expires_in: 300}`, thumbnail preferred; skeleton while loading; when gone: "Photo deleted. Clock photos are kept for 24 hours."), and facts: "`Clock-in` at HH:MM" (+ "· flagged"/"· off site" in red), Where (location label), Map ("Open in Google Maps"), Store, From the store ("120 m (allowed 150 m)"), GPS accuracy ("±12 m"), Taken on the phone, Reached Xtend (+ " · saved offline, sent `X` later" when ≥ 5 min), Phone (`deviceText`: e.g. "TECNO KG5, Android 12 in the Xtend app", "iPhone in a web browser", "Not reported"). Empty panels: "No clock-in recorded on this day.", "Still on shift: no clock-out yet.", "They never clocked out.". A footer line: role · own store · team; **Call `<phone>`**; **Movement that day** (`/admin/tracking?person&date&until`); **Check an excuse** (`/admin/excuses?person&date&until&from&to` where `from` = shift start − 2 h, default shift 08:00, and `to` = clock-in time when late, else clock-out time, else 18:00); **X Metrics** (`/admin/metrics/staff/<id>`).

**Map**: Leaflet 1.9.4 loaded from cdnjs only when opened, OpenStreetMap tiles, 520 px tall, scroll-wheel zoom off. Each store's geofence as a circle (`#c1572a`, weight 1, fill 0.08, radius default 150 m, popup "Name / N m geofence"); each clock event a 6 px dot, green `#15803d` when on site else orange `#c2410c`, popup "Name / Clock in|Clock out `time` / `distance` from outlet · ±N m". Fits all points (padding 30, max zoom 16) or shows Nigeria (9.082, 8.6753, zoom 6). Failure: "The map could not load. Check your connection."

Empty table: dashed box "Nothing matches these filters."

### Downloads

- **Day by day** (`src/lib/export/attendance-days.ts`): title "Xtend attendance, day by day"; subtitle = the filter in words ("2026-10-01 to 2026-10-14 · person: Ada · one store · … · days off and leave are not absences") + ". Times are Lagos time."; notes = three summary sentences ("N people. Came in on X of Y working days (Z%); absent on A.", "On time on … (P%); late on L, by X on average.", "Clocked in off site or flagged on … days. No clock-out on … days. Usual clock-in HH:MM.") then "Worth a look:" bullets (up to 20). Columns: Date, Person, Role, Supervisor, Store, How it went (On time, Late, Off site, Absent, Day off, On leave), Clock in, Late by, Clock out, Hours, From store, Also, Where they clocked in, Map (link "Map" to Google Maps; CSV keeps the URL). Sorted newest day then name. File `xtend-attendance-days.<ext>`. Audited `export.attendance_days.<fmt>`.
- **Every clock-in and out** (`src/lib/export/data.ts`): up to 2000 events by default (`limit` param, capped at 5000), newest first. Columns: Staff name, Date, Type, Time (Africa/Lagos), Outlet, Location (premises and street), Distance from outlet, Accuracy, Status, Selfie link (1-hour signed link, or "deleted after 24h"). Subtitle "N record(s). Times are Africa/Lagos. Clock photos are deleted 24 hours after capture; links to the ones still held expire an hour after this file was made." Status column coloured. File `xtend-attendance.<ext>`. Audited `export.<fmt>`.

### Supervisor differences

None in the UI; everything (people, stores in the choices, downloads) is their team via RLS. The Team filter usually hides because they have one team.

### Acceptance checks

- Opening the page with no parameters shows today only; the "Today" chip is filled.
- `?from=2026-01-01&to=2026-10-14` shows the "last 92 days" notice and a range starting 2026-07-15.
- A person with 3 late days in range appears under Worth a look with the average lateness; a person with 2 late days does not.
- With 30 days selected the calendar shows; with 63 it shows "Pick 62 days or fewer to see the calendar."
- With the default schedule a Sunday without a clock-in is a grey "–" square and not counted absent; for someone whose pattern includes Sunday it is "A". A day of approved leave is a soft orange "Lv" square, never absent; pending or rejected leave does not excuse the day.
- There is no "Sundays are working days" checkbox; an old `sundays=1` in the address is ignored.
- Show days "On leave" lists only days of approved leave without a clock-in.
- Clicking a calendar square lands on that one day and person, scrolled to Day by day.
- Opening a row loads the photo or says it was deleted; the links open Movement and Check an excuse prefilled.
- Every export link carries the same filter as the page.

---

## 8. Movement — `/admin/tracking`

Files: `src/app/admin/tracking/page.tsx`, `src/components/admin/movement-map.tsx`, `journey-strip.tsx`; logic `src/lib/movement.ts` (pure) and `src/lib/movement-server.ts`. Title "Movement — Xtend".

Heading **"Movement"** (2xl, extra bold); intro: "Where staff are and where they have been since clocking in. While someone is on shift, the app sends their position every 5 minutes (with no network, the phone keeps it and sends it when the connection is back); Xtend also records every clock-in, store check-in and check-out. Pick a person to see their journey over up to 7 days: where they stayed, how they travelled and when nothing was heard." + " Updates every minute." when the range ends today.

### Query parameters

| Param | Meaning | Rules |
|---|---|---|
| `person` | profile id to follow | must be an active merchandiser/marketer the caller can see; otherwise the live view |
| `date` | first day | `YYYY-MM-DD` not after today; default today |
| `until` | last day | must be ≥ `date` and ≤ today, else = `date`; capped at `date + 6` (`MAX_DAYS = 7`, `movement-server.ts`) |

Auto refresh: when `until` is today the page mounts `AutoRefresh seconds={60}`, which calls `router.refresh()` every 60 s while the tab is visible.

### Form

GET form: **"Follow"** select (**"Everyone on shift (live)"** + active field staff by name), **"From day"**, **"To day"** (max today), **"Show"**. When a person is chosen, a row: "Quick:" chips **Today**, **Yesterday**, **Last 3 days**, **Last 7 days**, then "· up to 7 days", and on the right "**Download the journey:**" chips Excel / PDF / Word / CSV → `/api/admin/export/movement/<fmt>?person&date&until`.

### What loads

- `profiles` (id, full_name) with role merchandiser/marketer, active, by name — for the picker.
- RPC `live_locations()` + `withAvatars` — for the live view.
- For a person: `avatarUrls()` for their photo, and RPC `movement_trail(p_user, p_date)` once per day (in parallel). If any call fails with code `PGRST202` or `42883` the page shows a red alert **"This needs the movement update (028) run in Supabase."**, otherwise the error message.

### Live view (no person)

- Four cards: **On shift** (count), **In a store** (inside geofence), **Away from their store** (red when > 0), **Not heard in 15+ min** (`minutes_since_ping > 15`, null counts as stale; red when > 0).
- `LiveMap` (2/3 width on `xl`, 460 px tall, 560 px on `lg`, rounded 3xl): a 150 m default geofence circle per distinct store (`#d1511a`, weight 1, fill 0.06, tooltip store name); a marker per person with a last position — a round 40 px photo with a 3 px ring in the status colour and the first name under it; with no photo, or when the photo's link fails (expired), the same circle filled in the status colour with up to two initials. Colours: in store `#d1511a`, outside `#8a3a12`, stale `#9a8f88`. Pointer cursor, marker title "`<name>`: see their movement", rises on hover. Hover tooltip (above): name, "place · HH:MM (N min ago)", "distance from store", *"Click to see their movement"*. **Clicking the photo goes straight to** `?person=<id>&date=<today>` (client navigation), no popup. Opens on the whole of Nigeria (bounds `[[4.0, 2.6], [13.95, 14.7]]`) whatever the positions; every Movement map is held to Nigeria: `maxBounds` `[[3.0, 1.6], [14.9, 15.7]]` with viscosity 1, tiles `noWrap`, and a minimum zoom of the whole country (recomputed on resize), so it cannot be panned or zoomed out beyond it.
- Legend: In a store, Outside every store, Not heard from in 15+ min, "Circles are store geofences".
- Side list **"On shift now (N)"** / "Click a photo on the map, or a name here, to see their route today.": a dot (grey stale / `#8a3a12` away / `#d1511a`), name, "place or store or 'No position yet' · N min ago", and on the right "`distance` away" or "In store". Each links to `?person=<id>&date=<today>`. Empty: "Nobody is on shift right now."

### Person view

Header: 56 px photo (or initials tile), name, and the date ("Wednesday, 14 October 2026" or "… to … · N days").

**Figures** (8 cards, 2 / 4 / 8 columns):

| Card | Value |
|---|---|
| Clocked in / First clock-in | first clock-in time (with date when several days) or — |
| Clocked out / Last clock-out / Last seen | last clock-out, else last point |
| Distance moved | sum of straight lines between good readings (accuracy ≤ 100 m), ignoring steps shorter than max(accuracy a, accuracy b, 20 m) |
| At their stores | minutes in stop legs inside a store, or "None" |
| Stayed elsewhere | stop legs outside stores; red at ≥ 60 min |
| Travelling | move legs |
| Nothing heard | gap legs; red when the longest gap is ≥ 60 min |
| Stops | "N · K store(s)" |

**Journey model** (`journey()`):

- Readings rougher than **100 m** (`ROUGH_M`) are left out of measurement (still listed).
- Consecutive good readings join one cluster when the previous one is not a clock-out, they are less than **20 min** apart (`GAP_MINUTES`), and either both are in the same store or the reading is within **150 m** (`STOP_RADIUS_M`) of the cluster's running centre.
- A cluster is a **stop** when it lasts ≥ **8 min** (`STOP_MINUTES`) or contains a clock-in/out or visit check-in/out; named after the store, else the most common place name, else "Unnamed spot". Otherwise it is **travel**.
- Between clusters: after a clock-out → "off" (Clocked out); a pause ≥ 20 min → **gap** (Nothing heard); else travel. Back-to-back travel legs merge; speed = km / h when ≥ 1 min.
- **Jumps**: two good consecutive readings more than **2000 m** apart at more than **150 km/h** (`JUMP_KMH`; time floor 0.5 min).
- Durations print "45 min", "2 h", "2 h 5 min".

**Worth a look** (red alert, shown when any applies):

- Each jump: "`time`: moved `X km` in `N min` (`from place` to `to place`), over 150 km/h. A fake-location app, or a borrowed phone, can do this; a person cannot."
- Each gap of **60+ minutes**: "Nothing heard for `2 h 10 min` from `time`." + link **"Check an excuse for it"** → `/admin/excuses?person&date=<gap start day>&from=<HH:MM>&until=<gap end day>&to=<HH:MM>`.
- Stayed elsewhere ≥ 60 min: "`X` spent staying somewhere other than their stores: `up to 4 distinct place names`."

No points at all: info alert "Nothing recorded for `<name>` on this day|on these days: no clock-in and no positions."

**Day by day** card: heading and the key (At a store `#d1511a`, Stayed somewhere else `#52281a`, Travelling `#e8833a`, Nothing heard hatched `#9a8f88`, Clocked out `#f6e4d8`). One `JourneyStrip` per day: weekday and day number on the left; a 28 px bar spanning from min(06:00, first event) to max(20:00, last event) Lagos (time off after clock-out does not stretch it), legs placed by time (min width 3 px), gaps hatched at 45°; hover title e.g. "At Ikeja Mall, 08:02–12:40 (4 h 38 min)", "Travelling 3.2 km, 12:40–13:05 (25 min), about 8 km/h", "Nothing heard, …", "Clocked out, …"; tick labels every 2 hours (every other one hidden on phones).

**Trail map** (2/3 width; held to Nigeria like the live map, but zoomed to the route): store circles with their real radius (weight 1.5, tooltip "Name · N m"); line segments between consecutive points — dashed grey (`6 6`) when ≥ 20 min apart, else solid 3 px in-store/outside colour of the start point; clock-in and clock-out as pills **IN** (`#d1511a`) and **OUT** (`#8a3a12`) on top; other points as 5 px dots (7 px for the last) with white outline, grey when rough; offline-sent points as white dots with a coloured ring. Popups: "`Kind` · HH:MM / place or store or 'Outside every store' / ±N m (rough reading)". The person's photo pin (same as the live map, ring coloured by whether the latest point is in a store) sits on the latest point above everything, tooltip "`name` / Latest: HH:MM". Legend adds "No position for 20+ min" and "Saved offline, sent later".

Kind labels: Clocked in, Clocked out, Location check, "Location check (no network, sent later)", Checked in at a store, Checked out of a store, Phone reported in.

**Journey** list (1/3 width): "N stop(s) from M reading(s). Readings rougher than 100 m are left out." An ordered list (scrolls after 520 px), with day headers when several days: time, a coloured 6 px strip (dashed for gaps), what ("store or place name" bold; "Travelling 1.2 km"; "Nothing heard"; "Clocked out") and sub-line ("At their store · 1 h 5 min" / "Outside their stores · …" / "25 min · about 8 km/h"), and a **Map** link for stops. A collapsed **"Every reading"** section lists every point (scrolls after 360 px) with "Nothing heard for X" separators at ≥ 20 min (not after a clock-out), time, kind, place, " · rough reading", and an in/out dot. Footer link **"Check an excuse for these days →"** (`/admin/excuses?person&date&until`).

### Download

`/api/admin/export/movement/<fmt>?person&date&until` (person must be a uuid: "Pick a person" 400; unknown 404; dates clamped the same way). Title "Movement: `<name>`", subtitle the date or "from to until", notes "Moved X. At their stores …, stayed elsewhere …, travelling …, nothing heard …." + "N impossible jump(s) (faster than 150 km/h), first at …". Columns From, To, How long, What (At a store / Stayed elsewhere / Travelling / Nothing heard / Clocked out), Where, Distance, Speed, Map ("Open map" link). File `xtend-movement-<name-slug>.<ext>`. Audited `export.movement.<fmt>`.

### Supervisor differences

Only their team in the picker, the live list and the trails (RLS inside `movement_trail`).

### Acceptance checks

- Without `person` the page shows the four live cards, the live map and the list, and reloads its data every minute while visible.
- `?person=<id>&date=2026-10-01&until=2026-10-20` is cut to 2026-10-01…2026-10-07.
- Two readings 30 km apart 5 minutes apart produce a Worth a look line "over 150 km/h".
- A 90-minute silence shows in Worth a look with a "Check an excuse for it" link carrying `from` and `to` times.
- A rough reading (accuracy 300 m) appears under Every reading as "rough reading" but does not split a stop.
- If migration 028 is missing, choosing a person shows "This needs the movement update (028) run in Supabase."

---

## 9. Store visits — `/admin/visits`

Files: `src/app/admin/visits/page.tsx`, `src/components/admin/visit-filters.tsx`, `visit-views.tsx`; logic `src/lib/visit-review.ts` (pure, tested by `scripts/check-visits-alerts.ts`); data and downloads `src/lib/export/visits.ts`. Title "Store visits — Xtend". Visits are marketers' (and anyone's) store check-in/check-out pairs from the view `store_visit_detail`; coverage from the view `store_coverage` (migration 052).

Heading **"Store visits"**. Intro: for coverage view "Every store and when somebody last visited it, longest first."; otherwise "`<range | Today | date>`, Africa/Lagos. When each person clocked in, the stores they worked and for how long, and when they clocked out." Both continue: "Tap a visit for where they checked in and out. Very short visits, check-ins away from the store and trips between stores too fast to be real are called out. Download the same list as Excel, PDF, Word or CSV."

### Query parameters (`parseVisitFilter`)

| Param | Values | Default |
|---|---|---|
| `from`, `to` | dates | both **today**. `from` after today → today; `to` before `from` → `from`; `to` after today → today. No maximum span on the page (rows are capped instead). |
| `user_id` | uuid ("Who": Everyone + all merchandisers/marketers by name, inactive included) | all |
| `outlet_id` | uuid ("Store": All stores + all outlets) | all |
| `team` | supervisor uuid ("Team": **Every team** + "`Name`’s team"; admins only — supervisors do not get this picker) | all |
| `status` | "Arrival": Any, At the store (`on_site`), Away from the store (`off_site`), Location too rough (`flagged`), A shop not on Xtend (`none` = arrived status null) | any |
| `short` | "How long": Any length, Under 5 / 10 / 15 / 30 min (any integer 1–240 accepted) — only closed visits shorter than N | none |
| `view` | `visits` (default), `stores`, `people`, `coverage` | visits |
| `gap` | 7, 14 or 30 (coverage only) | none |

All values are trimmed to 80 characters; `all` means none. The page reads at most **1000** visits (`limit: 1000`); the export defaults to 2000 (`limit` param, max 5000). Ordered by visit date desc, staff name, arrival.

Form: From, To, Who, Store, [Team], Arrival, How long, **Show**. Row under it: "Quick:" chips Today, Yesterday, Last 7 days, Last 30 days, This month (not in coverage view); **"Clear"** when any of who/store/team/arrival/length is set (keeps dates, view and gap); on the right "**Download:**" (or "**Download the store list:**" in coverage view) chips Excel / PDF / Word / CSV → `/api/admin/export/visits/<fmt>?<same query>`.

"Short" threshold used everywhere on the page = the `short` filter if set, else **10 minutes** (`SHORT_MINUTES`).

### Figures (not in coverage view; 2 / 4 columns)

| Card | Value | Link |
|---|---|---|
| Visits | count; note "newest 1,000 shown" when 1000 | — |
| Stores covered | distinct stores (outlet id, or the map name for unknown shops) | — |
| People | distinct people | — |
| Average time in a store | mean minutes of closed visits; note "`X` in all" | — |
| Shorter than N min | closed visits under N (red if > 0) | "Show them →" sets `short=N` |
| Arrived away from the store | `arrived_status = off_site` (red) | "Show them →" sets `status=off_site` |
| In a store now (range ends today) / Rough location on arrival | open visits / `flagged` arrivals | — |
| Stores not visited in 7+ days | from coverage (— on error; red if > 0) | "Show them →" → coverage view with `gap=7` |

### Worth a look (`worthALook`)

Red alert "**Worth a look (N)**", newest first, first **8** listed, then "And N more, marked on the visits below and in the download." Each: **name** (+ " (date)" when a range) + text + "." + link **"Movement that day"** (`/admin/tracking?person&date&until`, until capped at date + 6). Rules:

- **Short** (`short`): a closed visit under the short threshold — "only 6 min at `Store` (09:10 to 09:16)".
- **Far** (`far`): arrived `off_site` and at least **300 m** away (`FAR_M`) — "checked in at `Store` from 450 m away, at 10:02 (`label`)".
- **Hop** (`hop`): two visits by the same person on the same day, sorted by arrival, where the distance from the first's check-out point (or check-in point) to the next check-in point is at least **1000 m** (`HOP_MIN_M`) and the speed exceeds **80 km/h** (`HOP_KMH`; time floor 1 min) — "left `A` at 11:00 and checked in at `B` 12 km away 5 min later (about 144 km/h)".

Badge words: Very short, Far from the store, Too far from the last store.

### View tabs

Chips **Visits**, **By store**, **By person**, **Store coverage** (active chip filled brand with shadow; others tint). Switching keeps the filter; `gap` is only carried into coverage.

### Visits view

- **"In a store right now"** card (only when the range ends today and there are open visits): name, "Store · since HH:MM · duration", arrival badge.
- One card per person (in the order returned): title = name; on the right a red badge "N worth a look", link **Movement** (range), and **"Only `<first name>`"** (when not already filtered to a person). Under the title a **day strip**: CLOCKED IN (from RPC `staff_day(p_date)` — only for a single-day range), STORES (distinct), IN STORE (total minutes), CLOCKED OUT (or "still out"), and NOW IN (brand badge with the store) when still in a store.
- Each visit is an expandable `<details>` row (red-tinted border when flagged): time "HH:MM – HH:MM" (with the date above when a range), store name (`store_label` → `outlet_name` → "Unnamed place") and a sub-line ("named by the map · nearest of theirs: X" when the map named it, else the arrival label), the duration (red when short) or a brand badge "Still there · 25 min", the arrival badge (At the store = success, Away from the store = red, Rough location = warning, Shop not on Xtend = outline) and red flag badges.
- Opened: three columns. **CHECKED IN**: Time, Where, From the store ("120 m (the store’s fence is 150 m)" or "No store of theirs to measure from"), Location accurate to (±N m), link "Where they checked in, on the map". **CHECKED OUT**: Time, Where, From the store, How they left (At the store / Away from the store / Location too rough), link "Where they checked out, on the map"; or "Not yet: still in the store."; plus "The store, on the map". **Photo**: the check-in selfie as a 96 px square link (signed for 1 hour, only for visits that arrived in the last **26 hours**), else "Photo deleted after 24 hours" or "No photo". Then the flag sentences in red, and links **"Movement that day"** and **"Check “I was at the store” for this visit"** → `/admin/excuses?person&date&from&until&to&claim=at_store` (from arrival to departure or now).
- Empty: dashed box "No store visits recorded for that period."
- Load error: "Could not load the visits: <message>".

### By store / By person

Card **"Visits by store"** ("Which stores got attention, and how much. Tap a store to see its visits.") or **"Visits by person"** ("Who covered how many stores, and for how long. Tap a name to see their visits."). Columns: Store|Person, Visits, People|Stores, Time in store, Average, Under N min (bold red when > 0), Away on arrival (bold red), Last visit (time; with date when a range), and for people a **Movement** link. In the person table the last cell holds **Movement** and, beside it, **"Day report"** (single-day range) or **"Month report"** (otherwise, the month of `to`) → `/admin/marketer-reports?user_id&period=day&date=` / `period=month&month=`. Sorted by visits desc, then name. A shop not in Xtend's list is not linked and shows "not on Xtend’s store list". Empty: "No store visits recorded for that period."

### Store coverage

Card **"Store coverage"**: "`Every active store` | `The stores your team covers or has visited`, with the last visit on record, longest without one first. This list ignores the dates above. “Covered by” counts the staff whose store it is." Chips: **All (N)**, **Not visited in 7+ days (N)**, **14+**, **30+**. Admins see every active store; supervisors only active stores with staff assigned or a visit on record. Sorted by days since (never first), then name. Columns: Store (link to its visits; address under it), Last visit (date time and who) or "Never", Days since badge (red "No visit" or ≥ 30, warning ≥ 7, success below; "Today", "1 day", "N days"), Visits, 30 days, Covered by ("N person/people" or "Nobody"). Empty with a gap: "Every store has had a visit in the last N days."; otherwise "No stores to show." If the view is missing (codes `42P01`, `PGRST205`, or the message mentions it): red alert **"Store coverage needs the store visits update (052) run in Supabase."**

### Downloads (`/api/admin/export/visits/<fmt>`)

- Visits: title "Xtend store visits"; subtitle "N visit(s) · P staff · S store(s) · M minutes in store (about A a visit) · K shorter than N min · O arrived away from the store · F worth a look. Times are Africa/Lagos. Clock photos are deleted 24 hours after capture; links to the ones still held expire an hour after this file was made." Columns: Marketer, Date, Store, Store named by ("the map" / "their own store record"), Nearest of their stores, Checked in, Checked out ("still there (status)"), Minutes in store, Arrived, Distance on arrival, Left, Distance on departure, Where they checked in, Where they checked out, Worth a look, Selfie link. Status column coloured. File `xtend-store-visits`.
- Coverage view: title "Xtend store coverage"; subtitle "N store(s) as of DATE · X not visited in 7 days or more · Y with no visit on record. Longest without a visit first. Times are Africa/Lagos." Columns: Store, Address, Staff covering it, Last visit, Days since, Last visited by, Visits in the last 30 days. File `xtend-store-coverage`. Audited `export.coverage.<fmt>`.

### Supervisor differences

No Team picker; coverage lists only their team's stores; rows through RLS.

### Acceptance checks

- Opening with no parameters shows today's visits.
- A closed 6-minute visit shows its duration in red, a "Very short" badge, and appears under Worth a look; with `short=5` it no longer does.
- Two visits 12 km apart with 5 minutes between check-out and check-in are flagged "Too far from the last store".
- Clicking "Stores not visited in 7+ days" opens coverage with the 7+ chip active.
- A visit older than 26 hours shows "Photo deleted after 24 hours" instead of a photo.
- The Download chips carry the same query string as the page.
- In By person for today, each person has "Day report" opening Marketer reports on that person and day; over a range it reads "Month report" for the month of the end date.

---

## 10. Marketer reports — `/admin/marketer-reports`

Files: `src/app/admin/marketer-reports/page.tsx`, `src/components/admin/marketer-report-list.tsx`; model `src/lib/marketer-report.ts` (pure, tested by `scripts/check-marketer-reports.ts`), data `src/lib/marketer-report-server.ts`, files `src/lib/export/marketer-report.ts` (+ `-pdf.ts`, `-docx.ts`, `-xlsx.ts`, layouts in `40-platform-and-design.md`). Title "Marketer reports — Xtend". `requireSession(['admin','supervisor'])`; in the menu under Attendance, after Store visits.

Heading **"Marketer reports"**. Intro: "A report to download for each marketer, for one day or a whole month: when they clocked in and out, every store they checked in to and how long they spent there, the time between stores, and the daily report they filed. PDF is the one to share; Word and Excel hold the same." + for supervisors " You see your own team only." + " Times are Africa/Lagos."

### Query parameters (`parseReportRequest`)

| Param | Values | Default / rules |
|---|---|---|
| `period` | `day` or `month` | `day` (anything else) |
| `date` | YYYY-MM-DD | today; a date after today → today |
| `month` | YYYY-MM | the month of `date`; after the current month → that month too |
| `user_id` | uuid | none (everyone) |

Values trimmed to 80 characters. Range: a day report is that day; a month report runs from the 1st to the month's last day, or today when the month is the current one. `reportQuery(userId, kind, dateOrMonth)` builds `user_id=…&period=day&date=…` / `…&period=month&month=…`.

### Form

GET form: chips **"A day"** / **"A month"** (links keeping the person when one is shown); a **Day** date input (max today) or a **Month** month input (max this month); **Show**. Then "Quick:" chips: Today, Yesterday (day) or This month, Last month (month); the matching chip filled brand.

### The list (`loadMarketerRows`, through the caller's session)

People: every **marketer** the caller can see (inactive included, "(switched off)" after the name), plus any merchandiser who checked in to a store in the period. Each row's figures for the period: visits and distinct stores (`store_visit_detail`, ≤ 20 000 rows), minutes in stores, reports filed (`reports`). Card title: "Today, `<long date>`", the long date, or "October 2026"; description "N person/people: every marketer, and anyone else who checked in to a store in this period. Tap PDF, Word or Excel to download their day|month report." With a `user_id` that is in the list: only that row, "One person. …" and a **"Show everyone"** link.

Row: name (bold), "role · `<Supervisor>`’s team"; four small tint stats **VISITS**, **STORES**, **TIME** ("—" with no visits; `duration()` text) and **REPORTS**; three download links (`download`): **PDF** (brand, download icon, primary), **Word**, **Excel** → `/api/admin/export/marketer-report/<pdf|docx|xlsx>?<reportQuery>`. Empty: dashed "No marketers to show."

Also reached from Store visits → By person ("Day report" / "Month report").

### Documents attached (0064)

A second card under the list: **"Documents attached (N)"**, description "Files staff attached to their daily reports in this period: price lists, plans, invoices, pictures. The PDF, Word and Excel reports list them by name." Rows from `report_file_detail` for the period (only the one person when a `user_id` is shown; RLS keeps a supervisor to their team; ≤ 500, newest day first) (`src/components/admin/report-file-list.tsx`): file icon, name (bold), "`<staff>` · `<Fri 16 Oct>` · `<PDF|Word|Excel|CSV|Picture>`, `<size>`", and an outline **Download** link → `GET /api/report-files/<id>`: read as the caller (not found unless owner, admin or the owner's supervisor), a 5-minute signed link from the private `report-files` bucket with the file's own name as the download name, a 302 to it; a download by anyone but the owner is audited `report_file.download` (`report_files`, id; meta staff, report_date, name, size_bytes). Empty: dashed "No documents were attached to the daily reports in this period."

### What a report holds (`buildMarketerReport`)

Read for one person (`loadMarketerReport`; RLS: somebody the caller cannot see → null): profile, role label (added role names included), home store, supervisor name ("Another team" when not visible, null when none), `attendance_detail` events, `store_visit_detail` visits (≤ 3000), `reports`, `store_count_detail` lines (≤ 3000) and `xm_live_sale_lines` (≤ 3000, product and store names looked up).

- **Days**: every day from `from` to the earlier of `to` and today. Per day: first clock-in and the latest clock-out at or after it; status lines "On time, at the store", "12 min late, away from the store", "Late, location unclear", "… place not confirmed"; clock-out "At the store" etc.; "In" `HH:MM` or "—"; "Out" `HH:MM`, "Still on shift" (today), "Not clocked out", or "—". Missing clock-out = clocked in, no clock-out, before today.
- **Visits** (`visitLines`, by arrival): store (store label → outlet name → "Unnamed place"), address (store's, else the arrival address), in/out (`HH:MM`; open: "Still checked in" today, else "Not checked out"), minutes, arrival ("At the store", "Away from the store", "Location unclear", "Not measured", "Shop not on the store list"), and the time before it: "First store", "`<t>` after the last store", or "—" when the last one was never closed.
- **Daily report**: filed at (the later of created/updated), then the five sections in field order — How the day went, Sales, Stock status, Competitor activity, Issues for the office — empty ones "Nothing reported." Documents attached that day (0064, `report_file_detail`, ≤ 500) are listed as "Price survey.pdf (PDF, 1.2 MB)" (`reportFileLine`): the PDF and Word files add a sixth line **"Documents attached"** (joined with "; ") only when there are any (`reportFieldsWithDocuments`); the Excel "Daily reports" sheet has a last column **Documents attached**.
- **Stock counts** (store, product, in store, sold) and **X Metrics sales** (store, product, units).
- **Day summary** (one sentence): e.g. "Clocked in at 08:02, on time; visited 3 stores in 4 visits, 2 h 10 min in stores; filed the daily report; clocked out at 17:30." Variants "Did not clock in", "no store visits", "no daily report", "still on shift" / "did not clock out", "(still checked in)". Nothing at all: "Nothing recorded: no clock-in, no store visits, no report." ("Sunday. Nothing recorded." on a Sunday; "This day has not come yet." for a future day).
- **Tiles (8)**: Days worked (days with a clock-in or a visit; month adds "of N working days", where working days = days of the period up to today that are not Sundays, plus any Sunday with something recorded), Stores visited, Visits, Time in stores, Average visit (closed visits; "—" when none), On-time clock-ins "A of B", Missing clock-outs, Reports filed "R of D".
- **Month summary**: "Worked D of N working days, visited S stores T times for X in all, clocked in on time on A of B days and filed R daily reports." (+ " N days without a clock-out."); no activity: "Nothing recorded for October 2026."
- **Stores** (month): per store visits, total minutes, last visit, most time first.
- File name `xtend-report-<name slug, ≤ 40>-<YYYY-MM-DD | YYYY-MM>.<pdf|docx|xlsx>`.

### Downloads (`GET /api/admin/export/marketer-report/[format]`)

`requireApiSession(['admin','supervisor'])`; format not pdf/docx/xlsx → 400 "Unsupported export format"; no `user_id` → 400 "Choose a person first"; a person the caller cannot see → 404 "That person was not found". Audited `export.marketer_report.<fmt>` on `profiles`/<user_id> with `{ period, from, to, visits, days_worked }`. `Content-Disposition: attachment`, `Cache-Control: no-store`, `maxDuration` 60 s.

### Supervisor differences

Their team only (list and downloads, by RLS); someone outside it is "That person was not found".

### Acceptance checks

- No parameters → today's day reports for every marketer; the "Today" chip is filled.
- `?period=month&month=2099-01` shows the current month.
- A merchandiser with one store visit this month is listed for the month; one with none is not.
- Downloading a PDF writes one `export.marketer_report.pdf` audit row and the file is named `xtend-report-<name>-<date>.pdf`.
- A supervisor requesting another team's person gets 404.
- A month report for someone who visited 2 stores on 3 occasions shows Visits 3, Stores visited 2, and a Stores visited table with both stores, most time first.

---

## 11. Alerts — `/admin/alerts`

Files: `src/app/admin/alerts/page.tsx`, `src/components/admin/alerts-list.tsx`, `src/components/admin/phone-check.tsx`, `src/components/field/push-toggle.tsx`; logic `src/lib/alert-review.ts`; data and download `src/lib/export/alerts.ts`. Title "Alerts — Xtend".

Heading **"Alerts"**. Intro (admin): "Everything about every member of staff, newest first. Filter by what happened, who and when; see who keeps coming up; and open their movement for the day or check their excuse from the alert itself. Tick several alerts to resolve them together with one note. Every resolution is written to the audit log." Supervisor: "Everything about your team, newest first. … Admins resolve alerts. Every resolution is written to the audit log."

### Push switch

A `PushToggle` card titled **"Alerts on this device"**, hint (while off) "Turn this on to be told the moment somebody clocks in late, leaves their store or does something suspicious. Do it on each computer or phone you use." States: "On for this device" (with a green "On" badge, button **Turn off**), "Off" (button **Turn on**), "Blocked in your browser settings" (+ "Tap the icon just before the web address (a lock or sliders), set Notifications to Allow, then Check again. On a phone it is under the three-dot menu → site settings." and a **Check again** button that re-reads the browser permission, since the app cannot re-ask once blocked), "Not supported by this browser", "Not switched on by your admin yet" (no VAPID keys), "Checking…".

### Tabs (links, bookmarkable)

- **"Location (N open)"** → `/admin/alerts`; N = count of `location_alerts` with `is_resolved = false`.
- **"Late & suspicious (N)"** → `/admin/alerts?show=activity`; N = unreviewed medium/high rows in `integrity_flag_detail` (newest first, limit 200).

Active tab is a filled brand chip with shadow; inactive tint.

### Late & suspicious tab

One card per flag: staff name + outlet ("No outlet"), the headline (`flagHeadline(kind)`, first letter capitalised — e.g. "Clocked in late", "Clocked out early", "Location looks faked", "Fake GPS app in use", "Using a VPN"; unknown kinds "Needs a look"), "summary · date time", a severity badge (high = red, medium = warning) and a **Review** link to `/admin/integrity`. Empty: dashed box "Nothing late or suspicious waiting to be reviewed."

### Location tab — filters (`parseAlertFilter`)

| Param | Field | Values | Default |
|---|---|---|---|
| `state` | Show | Open (`open`), Resolved (`resolved`), Open and resolved (`all`); legacy `show=resolved` maps to resolved | open |
| `type` | What happened | **Every kind** + the four types | all |
| `person` | Who | **Everyone** + field staff | all |
| `store` | Their store | **Every store** + active outlets; matches the alert's home-store name | all |
| `from`, `to` | dates (max today); `to` before `from` becomes `from`; Lagos midnight bounds | none (all dates) |

Alert types (long / short): `left_geofence` "Left the store during their shift" / "Left the store"; `low_accuracy` "Location fix too rough to trust" / "Rough location"; `permission_denied` "Tried to open Xtend with location off" / "Location off"; `off_site_clock` "Clocked in or out away from the store" / "Away from the store".

Button **Show**. "Quick:" chips Today, Yesterday, Last 7 days, Last 30 days (keep the other filters). **Clear** (→ `/admin/alerts`) when anything is set. "**Download:**" Excel / PDF / Word / CSV → `/api/admin/export/alerts/<fmt>?<query>`.

At most **500** alerts are read (`fetchAlerts(…, 500)`, newest first); failure: "Could not load the alerts: <message>".

### Figures (2 / 4 columns)

- **Open alerts | Resolved alerts | Alerts** (by state) = count; note "newest 500 shown" when cut, else the range "from to to" ("the start", "today").
- **Still open** (red if > 0).
- **Open over 24 hours** (`STALE_HOURS = 24`; red if > 0).
- **People** = distinct people; note "N with 3 or more" (`REPEAT_AT = 3`).

**"By kind:"** chips, one per type with its count; clicking toggles the type filter (active chip has a brand border and tint; title "Only …" / "Show every kind again").

### Worth a look

Red alert shown when someone has ≥ 3 alerts in the list, or any open alert is ≥ 24 h old:

- Up to **6** people: "**Name**: 5 alerts on 3 days (3 left the store, 2 rough location), 2 still open. Movement on the latest day" — the name filters to that person; the link opens Movement on the day of their latest alert.
- "N alert(s) has/have been open for more than 24 hours. The oldest: `Name`, `date time`."

### By person (only when more than one person)

A collapsible card "**By person (N)** · most alerts first · tap to open". Rows sorted by total desc, open desc, name: name (filters to them), "type mix · last `date time`", a badge "N alerts" (red at ≥ 3, else outline), a warning badge "N open", and links **Movement** (the filter's dates, or the latest alert's day; capped at 7 days) and **Check an excuse** (an hour either side of the latest alert).

### The list (`AlertsList`)

- Auto-refresh every **60 s** (`router.refresh()` while visible) when the view is "live" (state not resolved and `to` empty or today) **and** nothing is ticked and no note is being typed.
- Admins: when more than one open alert, a checkbox **"Pick all N open alerts shown"**.
- Each alert card (brand border when picked): checkbox (admins, open alerts only); name + home store ("No home store"); a type badge and an age badge ("open for 25 min" / "open for 3 h" / "open for 2 days" from 48 h, "under a minute"; "resolved after …"): green when resolved, red when open ≥ 24 h, else warning; the long type text; "date time · `distance` from the store"; a pin line with the location label and a **map** link (Google Maps search); links **Movement that day** (`/admin/tracking?person&date&until` = alert day), **Check an excuse** (`/admin/excuses?person&date&from&until&to` covering one hour before to one hour after, not past now), **Call `<phone>`**.
- Open alerts have a collapsible **"Is their phone on right now?"** containing the phone check (below).
- Resolved: "Resolved by `name|an admin` `date time` — “note”".
- Admins on open alerts: an input "Resolution note" (max 1000) and an outline **Resolve** button ("…" while busy) → POST `/api/admin/alerts/<id>` `{note}` → RPC `resolve_alert` (resolution and audit row in one transaction); then refresh.
- Supervisors on open alerts: "Open. An admin resolves alerts."
- Bulk bar (sticky at the bottom, brand border, when anything is picked): "N alert(s) picked. Resolve them together with one note:", input placeholder "What was done, e.g. “Called them, they were at the bank for the store”" (max 1000), **Resolve N** ("Resolving…") and **Clear**. Calls POST `/api/admin/alerts` `{ids (1–500), note}` → RPC `resolve_alerts` (migration 052, one audit row per alert); if that RPC is missing (`PGRST202`/`42883`) it resolves one by one with `resolve_alert`. Result: green "N alert(s) resolved." or "N of M resolved; the others had already been resolved by someone else." Validation errors: "Pick at least one alert", "Resolve at most 500 alerts at a time".
- Empty: "Nothing resolved matches." (resolved state), "No alerts match." (filters set), else "No open alerts. All clear."

### Phone check (`PhoneCheck`, also used on Integrity and Check an excuse)

Button **"Check `<name>`'s phone now"** → POST `/api/admin/phone-check` `{user_id}`. The server calls RPC `request_phone_check` (migration 026, decides who may check whom) and pushes "Xtend" / "Please open Xtend now." to the person's devices with a check id and token. If a check was sent in the last two minutes it reuses it. While waiting: spinner, "Waiting for the phone…" and "Sent. Waiting up to 3 minutes for the phone to answer."; the browser polls `phone_checks.delivered_at, opened_at` every **3 s** (`POLL_MS`) for up to **3 min** (`WAIT_MS`). Results:

- Delivered: green "The phone is on and has network: the check reached it at HH:MM. They opened it at HH:MM." / "They have not opened it (yet)." (keeps polling until opened or 3 minutes).
- Silent: red "No answer after 3 minutes. The phone is off, has no network, or is on strong battery saver. Try again in a few minutes; a phone that answers later was not off."
- No device reached: "`Name` has notifications turned off in Xtend, so their phone cannot be checked. Ask them to turn notifications on."
- No push keys on the server: 503 "Notifications are not set up on the server."

### Download

Title "Xtend alerts"; subtitle "N alert(s), `range|all dates` · O still open · P people · `type mix`. Times are Africa/Lagos."; notes "Most alerts:" + up to 10 lines "Name: T (O open) on D day(s)". Columns: Person, Phone, Home store, What happened, When, Distance from the store, Where, Open or resolved, How long, Resolved by, Note. File `xtend-alerts`.

### Supervisor differences

Their team only (RLS). No checkboxes, no notes, no Resolve; each open alert says "Open. An admin resolves alerts." Both resolve routes are admin-only (`requireApiSession(['admin'])`). Supervisors can still run phone checks on their team.

### Acceptance checks

- The bell count in the frame equals the Location tab's open count plus the Late & suspicious count.
- An open alert created 30 hours ago has a red "open for 30 h" badge and is counted under "Open over 24 hours".
- A person with 3 alerts in view appears in Worth a look and gets a red "3 alerts" badge under By person.
- Ticking two alerts and pressing "Resolve 2" with a note resolves both, shows "2 alerts resolved.", and they move to the Resolved view with the note.
- While a box is ticked the list does not refresh itself.
- A supervisor sees no checkboxes and no Resolve buttons.
- The phone check reports "No answer after 3 minutes" when the phone never acknowledges.

---

## 12. Support — `/admin/support`

Files: `src/app/admin/support/page.tsx`, `src/components/admin/support-threads.tsx` (client panel), `src/components/admin/support-inbox.tsx` (server pieces); logic `src/lib/support-inbox.ts` (pure, tested by `scripts/check-support-notifications.ts`). Data: view `support_inbox`, tables `support_messages`, `support_quick_replies`, RPCs `support_assignees`, `office_name`, `resolve_notification_targets` (migration 053). Title "Support — Xtend".

Heading **"Support"**; intro: "Issues field staff raised in the app. The Xtend helper answers the simple ones; anything marked **With the office** needs a person. Longest waiting is at the top. Reply here and the person gets it in their app; give a thread to a colleague, close it when it is sorted, and reopen it if it is not."

The page refreshes itself every **60 s** (`AutoRefresh`, only while visible).

### What loads

- `support_inbox` newest `last_message_at` first, limit **500** (note under the list when 500: "Showing the 500 most recent threads. Search or pick a person to go further back.").
- `support_messages` (thread_id, sender_role, created_at) from the last **14 days**, limit 5000 — for reply-time figures.
- `support_quick_replies` by title.
- When searching: `support_messages` whose body `ilike %q%` (escaped), limit 500 — thread ids that match.
- Missing tables (`42P01`/`PGRST205`): red alert **"This page needs the support and notifications update (053) run in Supabase."**; other errors "Could not load support: <message>".

### Thread status words (`statusLabel`)

| status | Badge |
|---|---|
| `escalated` | **With the office** (red) |
| `open` | **Waiting** (warning) |
| `resolved` | **Closed** (outline) |
| `ai_answered`, last sender admin/supervisor | **Office answered** (success) |
| `ai_answered`, otherwise | **Helper answered** (default) |

"Needs a reply" = status `open` or `escalated`. Waiting time = now − `waiting_since` (the member's oldest message not yet answered by a person); shown as "waiting just now", "waiting 25 min", "waiting 2 h 10 min" (minutes dropped from 3 h), "waiting 2 days". Tone: ok under **60 min** (`LONG_WAIT_MIN`), warn from 60, late from **240 min** (`LATE_WAIT_MIN`); badge outline / warning / red.

### Figures (2 / 4 columns, over everything the viewer can see)

- **Needs a reply** (red if > 0).
- **Waiting over 1 hour** (red if > 0).
- **Answered today** = threads with an office message on today's Lagos date.
- **Typical reply time, 7 days** = median of reply times (for each office message in the last 7 days, minutes since the first unanswered staff message before it); note "from N repl(y|ies)" or "no replies yet".

### Filters (`parseSupportFilter`)

| Param | Field | Default |
|---|---|---|
| `view` | chips: **Needs a reply**, **Given to me** (assigned to me and not closed), **Answered** (`ai_answered`), **Closed**, **All**, each with its count (counts follow person and search) | `needs` |
| `person` | "Who": **Everyone** + people who have threads | all |
| `q` | "Search", placeholder "Words in any message, a name, a store…" (max 80 chars). Matches when a message body matched, or every word appears in name + store + subject + last message + assignee | none |
| `sort` | "Order": **Longest waiting first** (waiting threads by `waiting_since` ascending, then the rest by latest message), **Latest message first**, **Oldest thread first** | `waiting` |
| `thread` | the open thread id | none |

Button **Show**; **Clear** (→ `/admin/support`) when person, search or a non-default order is set. View chips keep the filter and close the thread.

### Layout

Two columns on `lg` (list 5 : panel 7). On smaller screens only one shows: the list, or the open thread (with a round back-arrow link "Back to the inbox").

**Thread row**: initials circle, name, last message time (time only if today, else date and time), subject, last message preview prefixed "Helper: " or "Office: ", badges: status, waiting time, "With you" / "With `name`" (when assigned and not closed), store. The active row has a brand border and ring; a late wait gets a 4 px red left border, a warn wait a 4 px `#e8833a` left border. Empty list: "Nothing waiting. New issues from the field appear here." (needs view, no filters) or "Nothing matches."

**No thread open**: "**Pick a thread**" / "The conversation, who the person is and how their day is going show here."

**Thread panel**:

- Header: subject (bold), "name · store · started `date time`", badges status, waiting, "With you|`name`".
- **Person context** (grey box): role word, red "Account off" when inactive, a day badge ("Clocked out at HH:MM" outline; "Clocked in at HH:MM, at their store|away from their store|location unclear" success when on site else warning; "Not clocked in today" warning), "Notifications on" (outline) or "Notifications off" (warning) from `resolve_notification_targets('users', {user_ids:[id]})` device count. Facts: Store ("None set"), Supervisor ("None set"), Phone (tel link or "Not on file"), Other issues raised (count). Links: **Movement today**, **Check an excuse** (`/admin/excuses?person=<id>`), **All their issues** (when they have others; `?view=all&person=<id>`).
- Messages (scroll after 55vh, scrolled to the end): staff on the left in white; helper ("Xtend helper" with a bot icon) in tint; office on the right in brand with white text, labelled with the sender's name (via `office_name`) or "Office"; each with time.
- **Who answers** select: "Nobody yet", "Me (`name`)", "`name` · `role`" for each assignee from `support_assignees(thread)` (disabled when closed). Changing it → POST `/api/admin/support/<id>` `{action:'assign', user_id}` → RPC `assign_support_thread`, audit `support.assign`; when given to someone else they get a notification "A support issue was passed to you" / "`Staff`: `subject`. `Me` asked you to answer it." linking to `/admin/support?thread=<id>`. Messages: "You have it." / "Passed to `name`. They have been told." / "Nobody has it now."
- **Close without reply** (open threads) → `{action:'close'}` → RPC `resolve_support_thread`, audit `support.close`, "Closed without a reply." **Reopen** (closed threads) → `{action:'reopen'}` → `reopen_support_thread`, audit `support.reopen`, "Reopened. It is back with the office."
- Closed: "Closed by `name|the office` on `date time`. If `first name` writes again it opens by itself." (no reply box).
- Open: **Quick replies:** chips (title; tooltip shows the filled text); clicking inserts the body with `{name}` replaced by the member's first name (appended after a blank line if the box has text). A 4-row textarea, placeholder "Reply to `name`. They get this in their app." (max 4000; at least 2 characters — validation via `writtenText(4000, 2, 'the reply', true)`). Note under it: "`First` gets your reply as a notification on their phone." or, with no devices, "`First` has notifications off, so the reply waits in Support until they next open Xtend." Buttons **Send reply** ("Sending…") and **Reply and close** → POST `/api/admin/support/<id>/reply` `{body, resolve}` → RPC `post_support_message` (+ `resolve_support_thread` when closing), audit `support.reply`, then a push "Reply from the office" / "`subject`: `first 200 chars`" to `/field/support`. Results "Sent. `First` gets it in their app." / "Sent to `First` and closed."
- **Save as a quick reply** (ghost, when the draft has ≥ 2 characters): a name input ("Name it, e.g. Clock-in fixed", max 60, ≥ 2 to save), **Save**, **Cancel**, note "`First`’s name is saved as {name} and filled in for whoever you reply to." The member's first name in the draft is replaced by `{name}`. POST `/api/admin/support/quick-replies` `{title, body}`; "Saved as “title”."
- **Manage quick replies** (collapsible, when the viewer may remove any): list with title, body and a bin → DELETE `/api/admin/support/quick-replies?id=<id>`; "Removed “title”." Admins may remove any; others only their own.

### Supervisor differences

Their team's threads only. They can reply, close, reopen, assign (to whoever `support_assignees` offers, e.g. an admin) and manage their own quick replies.

### Acceptance checks

- Opening the page lists "Needs a reply" threads, longest waiting first, and refreshes every minute.
- A thread waiting 5 hours shows a red "waiting 5 h" badge and a red left edge; one waiting 90 minutes a warning badge and an orange edge.
- Clicking a quick reply with body "Hi {name}, fixed" for "Ada Obi" inserts "Hi Ada, fixed".
- "Reply and close" moves the thread to Closed and shows "Sent to Ada and closed."
- Searching a word that appears only in an old message still finds the thread.
- Without migration 053 the page shows the "needs the support and notifications update (053)" message.

---

## 13. Analytics — `/admin/analytics`

Files: `src/app/admin/analytics/page.tsx`, `src/components/admin/analytics-charts.tsx`, plus the attendance libraries described in section 7 (same day model, same filter form). Title "Analytics — Xtend".

Heading **"Punctuality and attendance"**; intro: "How the team is turning up over a period, and how that compares with the same number of days just before. Late means clocking in after the store’s opening time; a working day without a clock-in is an absence."

### What loads

`loadAnalytics`: the filter's range and the **previous period** (the same number of days straight before: `previousPeriod(from,to)` = from − n … from − 1) in one read of `attendance_detail` (light columns), the filter choices, and the schedule (patterns, one-off changes and approved leave) from the previous period's start to the end of the range (`loadScheduleSafe`). Both periods are assembled with the same filter and schedule, so a day off or a day of leave is never an absence.

### Filters

Same form as Attendance with `mode="analytics"`: no "Who" and no "Show days" pickers; instead **"Compare by"**: Person (default), Store, Team (`by` param). Default range **last 30 days** (`parseReportFilter(params, 30)`), max 92 days. Quick chips: This week, Last week, Last 7 days, Last 30 days, This month, Last month, Last 90 days. Export panel has one group **"Download the table by `<by>`"** → `/api/admin/export/analytics/<fmt>?<filter>`.

Notices: "Showing the last 92 days of the range you picked."; "There are more clock records than one page can read. Pick fewer days."; load failure "Could not load analytics: <message>".

Range line: "**`<from long>` to `<to long>`** · N days, P people · compared with `d Mon` to `d Mon`".

### Cards (7; 2 / 4 / 7 columns)

Each shows the value, then a change line and " · was `<previous>`". Change: "no earlier figure" when either side is missing; "no change" when it rounds to 0; otherwise "▲ N" or "▼ N" plus unit, green when better, red when worse.

| Card | Value | Better when | Unit |
|---|---|---|---|
| On time | punctuality % | higher | " points" |
| Turned up | turnout % | higher | " points" |
| Late days | late | lower | — |
| Absent days | absent | lower | — |
| Off site or flagged | offSite | lower | — |
| No clock-out | missingOut | lower | — |
| Usual clock-in | avgIn HH:MM | earlier | " min"; note "late ones `X` late" |

### Charts (`StackChart`)

All stacked-column charts work like the overview chart: hovering/focusing/clicking a column picks it; other columns fade to 40 % opacity; a pop-up card shows the long label, each part with a coloured dot and value, a total line (when there is more than one part and `total` is set) and notes. Y axis 3 ticks (max, half, 0), `max = niceMax(largest sum)` unless fixed. With more than 20 columns only every ceil(n/10)-th label shows and columns have a 1 px gap. An all-zero column shows a 3 px `#f6e4d8` stub. Empty: "Nothing to show yet."

1. **"Day by day"** (or **"Week by week"** when the range is more than **45** days; weeks start Monday) / "Everybody expected, split by how the day went. Point at a column for its figures." Parts: On time `#d1511a`, Late `#f2b48a`, Absent `#52281a`; total label "Expected"; notes "On time: P%", "Off site or flagged: N", "No clock-out: N". Labels: weekday short for ≤ 10 days, day number for 11–45, "d Mon" weekly; long "Monday, 5 Oct" or "Week of Monday 5 Oct". Height 240 px. Key underneath.
2. **"On time, by weekday"** / "Share of clock-ins that were on time on each day of the week." Mon…Sun, one part (on-time %, `#d1511a`), fixed max 100, unit "%", no total, height 208 px; notes "N clock-ins, L late", "A absent · turned up P%".
3. **"When people clock in"** / "Clock-ins by the hour they happened." One column per hour from min(6, earliest) to max(11, latest), label "07", long "07:00 to 07:59"; parts On time `#d1511a` and Late `#e8833a`; total "Clock-ins"; height 208 px.

### Who stands out, by `<by>`

Heading and the line "Punctuality is ranked only with 3 or more clock-ins. Tap a name to open their days on Attendance." (`MIN_DAYS = 3`). Six boards (1 / 2 / 3 columns), each a `RankList` of up to 5: name (truncated), a 16 px bar on a `#f6e4d8` track (against 100 for percentages, otherwise against the top value; min 4 px), and the figure. Empty board: "Nobody here. Good." Each row links to Attendance with the same dates plus that person / store / team; the "none" group (no store / no supervisor) is not linked. Hover title "label: text · N clock-ins, A absent".

| Board | Rows | Bar colour |
|---|---|---|
| Most on time | ranked (≥ 3 clock-ins), highest punctuality | `#d1511a` |
| Least on time | ranked, lowest punctuality | `#9b3517` |
| Slipped most since the period before | ranked with a negative punctuality change, worst 5; text "−N pts"; detail "P% before, Q% now" | `#9b3517` |
| Most absences | all, text "N days" | `#52281a` |
| Most days off site or flagged | all | `#9b3517` |
| Most days without a clock-out | all | `#e8833a` |

`leaders()` leaves out rows with zero (except in the "lowest" list, which keeps any non-null).

### Store coverage

Card **"Store coverage"** / "On how many working days at least one person clocked in at each store. Least covered first." Stores listed are those that are the own store of an active person in view, plus any store someone clocked in at. A store's working days = days up to today on which at least one of its own people (whose own store it is) was expected in by their schedule; a store nobody is posted to follows Monday to Saturday. Per store: name (link to Attendance filtered to the store), "N person/people" (whose own store it is), a 12 px bar (`#9b3517` when coverage < **80 %**, else `#d1511a`), "covered/working · P%", and "Nobody in: `d Mon, …`" (last 4 gaps, "and N more") or "Somebody in every working day", plus " · last clock-in `d Mon`" or " · no clock-in in this period". Sorted by coverage ascending (stores without a figure last), then name. Shows the **40** least covered; more: "The 40 least covered of N stores." Empty: "No stores to show."

### All `<people|stores|teams>` (N)

Table: Person/Store/Team (linked like the boards; teams read "`Name`’s team"), Came in ("present/expected"), Absent (red if > 0), Late, On time (bold %), Change (vs before, " pts"), Off site, No clock-out, Usual in. Sorted by label. Empty: "Nothing in this period." Group labels: person name; store name or "No store"; supervisor name or "No supervisor".

### Download

`analyticsSheet` (`src/lib/export/attendance-days.ts`): title "Xtend punctuality and attendance, by `person|store|supervisor`"; subtitle filter in words + ". Compared with `from` to `to`."; notes "This period:" + 3 summary sentences, blank, "The period before:" + 3. Columns: Person|Store|Supervisor, Working days, Came in, Absent, Turned up, Late, On time, On time, change (points) ("+3"/"-2"/blank), Off site, No clock-out, Usual clock-in, Late by, on average. File `xtend-analytics-by-<by>.<ext>`.

### Supervisor differences

None in the UI; their team only.

### Acceptance checks

- No parameters → the last 30 days and the "Last 30 days" chip filled; the range line names the previous 30 days.
- Choosing 60 days switches the trend chart heading to "Week by week".
- A person with 2 clock-ins does not appear in Most/Least on time.
- A store covered on 7 of 10 working days shows a deep-red bar and "7/10 · 70%".
- A person on approved leave for the whole range has no absences on any board or in the table; the filter form has no Sundays checkbox.
- Changing "Compare by" to Store changes the board rows, the table heading "All stores (N)" and the download file name.

---

## 14. Stock count — `/admin/store-counts`

Files: `src/app/admin/store-counts/page.tsx`, `src/components/admin/count-requests.tsx`, `count-template-card.tsx`; data `storeCounts()` in `src/lib/assistant-data.ts`; sheet naming `src/lib/count-sheet.ts`; status `src/lib/store-count-status.ts`. Title "Stock count — Xtend".

Heading **"Stock count"**; intro: "Merchandisers count every product on the Xpel stock count sheet: how many are in the back store and on the shop floor, the expiry date, and how many sold since their last count. They count when a supervisor asks, and at the end of every month."

### Query parameters

`from` (default today) and `to` (default = `from`). No `max` on the inputs; `storeCounts` rejects a range longer than **62 days** with "Ask for at most 62 days at a time", "\"to\" is before \"from\"" when reversed, or a bad date — shown as a red alert above the tables.

### What loads

- `store_count_detail` between the dates (newest date, then store, then product; limit 5000). Falls back to fewer columns when migration 040 (sheet columns) or 022 (location/photo) is missing (`42703`).
- RPC `my_staff()` — everyone for an admin, own team for a supervisor.
- View `count_request_progress` — 15 newest requests.
- View `store_count_sheet_detail` between the dates — paper sheets (limit 500).
- `count_sheet_templates` newest (an uploaded PDF), and a count of active `products` with a `sheet_order` (the Xpel sheet, migration 040).
- `staff_roles` (id, name, counts_stock) and `role_store_counts` (which built-in roles count, migration 046).
- Shelf photos and sheet files are signed with the **service role** from bucket `reports` for 1 hour (max 500 paths), because supervisors cannot read that bucket directly; the rows are already narrowed by RLS. Without the service key the tables still show, without links.

### Count sheet card (`CountTemplateCard`)

- When the Xpel sheet has products: "**Xpel `OCTOBER 2026` stock count sheet**" / "`N` products, with barcodes. Staff count them in the app, or download this sheet as Excel with their store's name on it, fill it in and send it back. Each month the sheet carries that month's name." Button **Download sheet** → `/api/store-counts/template` (an Excel built from the product list, named like `XPEL_OCTOBER_2026_STOCK_COUNT_SHEET.xlsx`).
- Otherwise "**Count sheet**" with one of: "Staff download "`file`", uploaded `date`, fill it in and send it back from the stock count screen." / (admin, none yet) "Upload your blank count sheet as a PDF. Staff download it from the stock count screen, fill it in and send it back." / (supervisor) "No count sheet has been uploaded yet. An admin uploads it here." Buttons **Download** (when one exists) and, for admins, **Upload sheet** / **Replace sheet** ("Uploading…"). Upload rules: PDF only ("The count sheet must be a PDF."), under **10 MB** ("The count sheet must be smaller than 10 MB."). The file goes to `reports/<uid>/count-template-<uuid>.pdf`, then POST `/api/admin/count-template` `{path, file_name}` (admin only). Success: "\"`file`\" is now the count sheet staff download."

### Ask for a stock count (`CountRequests`)

Card titled **"Ask for a stock count"** (clipboard icon): "Merchandisers count when you ask, and at the end of every month (from `Sat, 28 Oct` this month) without being asked." The month-end window starts 3 days before the first of next month.

People offered: active staff from `my_staff()` (not the viewer) whose role takes stock counts (`takesStoreCounts`: built-in roles per `role_store_counts`, added roles per `counts_stock`). Labelled with the added role's name or Merchandiser/Marketer; team = "`Supervisor`'s team" or "No team".

None: info alert — admin "There are no active merchandisers or marketers to ask."; supervisor "Nobody is on your team yet. An admin puts people on your team from the Teams page."

Otherwise:

- **Count by** date (min today, default today) and **Note (optional)** (max 500, placeholder "e.g. Before the promo starts on Monday").
- **"Who counts (k of n)"** with **Select everyone** / **Clear all**. Everyone starts chosen.
- **By role** chips and (when more than one team) **By team** chips: "Label · n", or "Label · picked/n" when partly chosen (brand border), filled brand with "✓ " when all chosen. Clicking adds the whole group, or removes it when already all chosen, and filters the list to that group ("Showing `Label`. **Show everyone**").
- A search box "Find a person" when more than 8 people.
- A two-column checkbox list (scrolls after 240 px) with name and role label.
- Button **"Ask `k` to count"** ("Sending…"; disabled with nobody or no date) → POST `/api/admin/count-requests` `{user_ids (1–500), due_date, note}` → RPC `request_store_count` (decides who may ask whom), then a push "Stock count requested" / "`Name` asked for a stock count by `long date`. `note`" to `/field/count`. Success: "Asked N person/people to count by `Sat, 31 Oct`. M got a phone notification; everyone sees it when they open Xtend."
- **RECENT REQUESTS**: each "Due `Sat, 31 Oct` · c of p counted", badge **Open**/**Closed**, a ghost **Close** button for open requests when the viewer is an admin or asked for it (POST `/api/admin/count-requests/<id>/close`; error "That request could not be closed."), "Asked by `name` · note", and "Waiting on: names…".

### Range form and downloads

From, To, **Show**. When there are rows, four outline buttons **PDF**, **Excel**, **Word**, **CSV** → the Ask Xtend report route with kind `store_counts` and title "Stock count, `<long date>`" or "Stock count, `<from>` to `<to>`".

### Tables

- **By product**: Product, Sold (since last count) = sum over all counts, In store (latest count) = sum of each store's latest count of that product, Stores. Sorted by sold desc. Empty: "No counts for these dates yet."
- **Count sheets (N)** (only when any): "Counts done on paper and sent as a file. Their figures are not in the totals above; open the sheet to read them. Staff can also send a sheet from their profile when no count is due; those show as “Sent any time”." Columns Date, Staff, Store, **For** ("Requested count" when it has a request, "Sent any time" when `count_was_due` is false (0064), else "Month-end count"), Sheet ("Open PDF"/"Open Excel"/"Open photo" + file name, or "Link unavailable"). Sheets sent from the You page land here like any other.
- **Every count (N)** (only when any): Date, Staff, Store, Product (barcode under it in mono), Back store, Shop floor, Total (bold), Expiry ("31 Mar 2027" or —), Sold, Taken ("120 m from store" + **Shelf photo** link).

### Supervisor differences

Only their team's people, counts and sheets. They can ask for counts and close requests they made. They cannot upload or replace the PDF count sheet.

### Acceptance checks

- With today's counts, the By product table sums sold across counts but counts each store's latest in-store figure once.
- Choosing the "Merchandiser" role chip when all are chosen clears them all; choosing it again selects them and shows "✓ Merchandiser · n".
- Sending a request shows "Asked N people to count by …" and the request appears under Recent requests as Open.
- A supervisor sees Close only on requests they made.
- `?from=2026-01-01&to=2026-10-14` shows "Ask for at most 62 days at a time".

---

## 15. X Metrics — `/admin/metrics` and sub-pages

Files: `src/app/admin/metrics/**/page.tsx`, `src/components/admin/xm/dashboard.tsx`, `widgets.tsx`, `forms.tsx`, `policy-editor.tsx`, `supply-import.tsx`, `day-bars.tsx`, `src/components/admin/score-bars.tsx`, `src/components/metrics/policy.tsx` (shared with the staff app); logic `src/lib/metrics/dashboard.ts`, `shared.ts`, `server.ts`, `supply-import.ts`, `export.ts`, `admin-route.ts`, `features.ts` (pure switch rules, tested by `scripts/check-xm-features.ts`), `features-server.ts`; switches UI `src/components/admin/xm/features-form.tsx`, `features-context.tsx`, `switched-off.tsx`, `src/app/admin/metrics/layout.tsx`. Schema: migrations 043 (X Metrics), 044 (policy), 047 (cartons), 063 (feature switches). The scoring and reconciliation rules live in Postgres (see `generated/database.md`: `xm_*` tables, views and functions).

### Common parts

- **Header** (`XmHeader`): h1 title, muted intro, then the **sub-navigation** as pill links (active = brand fill, inactive = tint): **Overview** (`/admin/metrics`), **Expiry**, **Grades**, **Scoring policy**, and admin-only **Supplies**, **Targets**, **Products & stores** (`/setup`), **Settings**. Supervisors (`readOnly`) do not see the admin-only pills. Active: exact match for Overview, prefix for others.
- **Month picker** (`MonthPicker`): an `<input type="month">` (160 px) that pushes `?month=YYYY-MM` (keeping other params). `monthStart()` turns it into the 1st; invalid or missing = this month in Lagos (UTC+1).
- **Export links** (`ExportLinks`): a download icon, an optional label, and four small pills **Excel**, **WORD**, **PDF**, **CSV** → `/api/admin/metrics/export/<kind>/<fmt>?month=YYYY-MM&outlet=<id>`. Kinds: `grades`, `stock`, `discrepancies`, `supplies`. The export route admits admins and supervisors (`requireApiSession(['admin', 'supervisor'])`); it reads through the caller's client, so a supervisor's file holds only their team.
- **Admin actions** all go through `xmAdminAction` (`src/lib/metrics/admin-route.ts`): admin only, zod-checked body, one Postgres function, an audit row; a unique-key clash returns 409 "That already exists."; other errors the database message. Client calls use `xmCall`, which throws "That did not work (status)" when no message comes back.
- **Void** (`VoidButton` → `NoteAction`): a ghost **Void** button opens an inline input "Why is it being voided?" (max 300; the tick is disabled until ≥ 3 characters) with a tick and an X; POST `/api/admin/metrics/void` `{kind: supply|count|sales, id, reason}`. Records are never edited or deleted, only voided.
- Expiry window words (`windowLabel`): 0 or less "Expired"; multiples of 365 "1 year"/"N years"; multiples of 30 "1 month"/"N months"; else "N days".
- Scores print with one decimal, trailing ".0" dropped (`fmtScore`), "—" when none. Band badges: Strong = success, Average = warning, Poor = red, none = outline "Not graded".
- Colours (`src/lib/metrics/colours.ts`): BRAND `#d1511a`, SOLD `#9b3517`, SUPPLIED `#e8833a`, DEEP `#9b3517`, TRACK `#f6e4d8`.

### 14.1 Overview — `/admin/metrics` (admins and supervisors)

Title "X Metrics — Xtend". Intro: "Stock, sales and expiry for the stores in X Metrics: what merchandisers count and sell, what was supplied, and where the numbers do not add up."

Top row: admin-only **Run checks now** (refresh icon, spins while busy) → POST `/api/admin/metrics/run` (admin) which runs the sweep (`runMetricsSweep`: `xm_reconcile_pending`, `xm_expiry_scan`, push expiry alerts to admins, flush integrity flag alerts) and shows "N counts reconciled, M new expiry alerts."; then **Stock on hand** export links.

**KPI cards** (4; 1 / 2 / 4 columns; the first has the brand gradient `150deg #d1511a → #9b3517` with white text, the others white with coloured icon tiles `#d1511a`, `#e8833a`, `#9b3517`, `#c26a1e`):

| Card | Value | Change pill | Note |
|---|---|---|---|
| Units sold this month | sum of `xm_live_sale_lines` this month | vs last month **up to the same day** ("+12%", "New" when last was 0) | "vs last month to date" |
| Units supplied | non-voided `xm_supplies` this month | same | "vs last month to date" |
| Stock accuracy | % of this month's reconciliations not flagged | "+N pts" vs last month | "counts within tolerance" |
| Open expiry alerts | unacknowledged alerts | "N to pull" (shown as a fall) | "batches near expiry" |

Pill colours: up `#fde1cc`/`#8a3a12`, down `#efe6e1`/`#52281a`, flat muted; no change → "No change".

**Sales overview** (2/3 width) / "Units sold and supplied across all X Metrics stores, last 12 months.": paired columns per month (sold `#9b3517`, supplied `#e8833a`, max 14 px wide, rounded tops), 256 px tall, dashed gridlines with 5 ticks (`niceMax` here uses steps 1, 2, 2.5, 4, 5, 6, 8, 10). A line above reads "**Oct**: N sold · M supplied" for the hovered month (default the latest); hover shows a tooltip; on phones every other month label hides. A collapsible **"Show as a table"** lists Month / Sold / Supplied.

**Stock statistic** / "How well counts match, and sales against store targets, this month.": two concentric three-quarter rings (outer = accuracy `#9b3517`, inner = sales vs store targets `#e8833a`, track `#f6e4d8`, stroke 9), the big accuracy % ("—" if none) with "Stock accuracy this month", then "X of Y counts matched" / "No counts checked yet" and "P% of store targets (sold / target)" / "No store targets this month" (P capped at 100). Then **"Sold this month by category"**: top 4 categories with units and share % (of all units sold), or "No sales yet this month."

**Recent activity** / "The latest counts, daily sales and supplies.": up to 8 newest across `xm_counts`, `xm_sales`, `xm_supply_detail`. Columns What (icon + "Opening stock count" / "Stock count" / "Daily sales" / "Supply: 24 × Product", linking to the store or staff page), Store, By, When (Lagos "14 Oct, 09:30"), Status chip: count → Voided (bad) / Baseline (opening) / Reconciled (good) / Awaiting check (warn); sales → Voided / Replaced / Received; supply → Voided / Delivered. Empty: "Nothing sent yet."

**Top stores** / "Units sold this month[, against each store's target].": top 5 by units sold, numbered circles, "sold / target" or "N sold", an 8 px bar (first `#9b3517`, others `#e8833a`) against the target or the top figure. Empty: "No stores in X Metrics yet."

**Stock gaps** / "Counts that differ from what was expected (last count + supplied − sold) by more than the tolerance. Each one is also an integrity flag on the person, to review there.": flagged reconciliations in the last **30 days**, up to 50. Columns Date, Store (→ store page), Counted by (→ staff page), Product, Expected, Counted, Gap badge "+N (P%)" (red when negative, warning when positive). Empty "No gaps in the last 30 days." Link **"Review the flags →"** to `/admin/integrity`.

**Expiry alerts** / "Batches entering an expiry window, soonest first.": up to 8 open alerts by days left: product, " · batch X", " · store · N units", badge "Expired" or "Within 6 months · 31 Mar 2027" (red when the window is ≤ 30 days, else warning), red **Consider pulling** when set. Empty "Nothing open." Link **"All expiry alerts →"**.

**Stores** / "Open a store for its stock, sales, supplies and reconciliation.": active `xm_stores` by name: Store (→ `/admin/metrics/stores/<id>`), Last count (or "No count yet"), Units on hand, Sold this month, Gaps (30 days). Empty: "No store is in X Metrics yet." + admin link **Add stores** (`/admin/metrics/setup`).

### 14.2 Products & stores — `/admin/metrics/setup` (admins only)

Title "Products & stores — X Metrics". Intro: "The products counted and sold, and which of your existing stores are in X Metrics. Stores and staff allocations are the ones already in Xtend."

**Products** / "Name, SKU, category and unit. A retired product stays on every record that has it.": a five-field row (Name ≤ 120 required, SKU ≤ 40 letters/numbers/dashes/dots, Category ≤ 60, Unit ≤ 30 default "unit" e.g. "bottle, tub…", Units per carton 1–100 000) and **Add product** (POST `/api/admin/metrics/products`; "`Name` added."). A search box "Search products". A list: "**Name** · SKU · category · unit · N per carton" (+ outline "Retired"), buttons **Edit** (inline fields, **Save** / **Cancel**, PATCH `/api/admin/metrics/products/<id>`, "Saved.") and **Retire** / **Bring back** (PATCH `{is_active}`; "Retired." / "Back in use."). Empty "No products."

**Stores**: "A store joins X Metrics here. Its first stock count after joining is its opening stock, the baseline every later count is reconciled against. Taking a store out keeps its history." Search "Search stores"; a scrolling list (max 28 rem) of active outlets with a badge for enrolled ones — "In X Metrics" (success, has a count) or "Waiting for opening count" (warning) — and a button **Add** (outline) / **Take out** (ghost) → POST `/api/admin/metrics/stores` `{outlet_id, active}`; "`Name` added to X Metrics." / "`Name` taken out of X Metrics."

### 14.3 Targets — `/admin/metrics/targets` (admins only)

Title "Targets — X Metrics"; header **"Sales targets"**: "A monthly target in units, for a person or a store. A person's own target is used for their grade; without one, the targets of their stores are." Month picker.

Card **"Set a target for October 2026"** / "Setting one again replaces it; the earlier one is kept.": **Target for** (A person / A store), **Merchandiser or marketer** or **Store** (active field staff, or active X Metrics stores), **Units to sell** (whole number), **Set target** (disabled until valid) → POST `/api/admin/metrics/targets` `{month, user_id|null, outlet_id|null, target_units}` (1 – 100 000 000). Success: "Target set. Any earlier target for the same month is kept in the history."

Table of current targets (`xm_current_targets` for the month): For (name, "Former staff" or store), kind (Person/Store), Target, Sold so far (from live sale lines in the month), % (rounded). Sorted by kind then name. Empty "No targets for October 2026."

### 14.4 Supplies — `/admin/metrics/supplies` (admins only)

Title "Supplies — X Metrics". Intro: "Every delivery to a store, by batch, in units or cartons. Log one by hand, or import an invoice or supply sheet. Reconciliation adds them to the last count. A mistake is voided with a reason, never edited or deleted."

If there are no X Metrics stores or no active products, both forms show "Add products and stores to X Metrics first (Products & stores)."

**Log a supply** (`SupplyForm`): Store, Product ("Name (SKU)"), **Units supplied** / **Cartons supplied** with a Units/Cartons select, (cartons only) **Units in one carton[ of Product]** (prefilled from the product, "e.g. 24"; hint "`5` cartons × `24` = `120` bottles", or "Saved on the product for next time." when the product had no size, or "Cartons are turned into units for stock checks."), **Date supplied** (max today, default today), **Batch** (≤ 60), **Expiry date**, **Note (optional)** (≤ 300, "Waybill number, driver…"). **Log supply** → POST `/api/admin/metrics/supplies`. "Supply logged."; the store, date and unit choice stay for the next line.

**Import supplies from a file** (`SupplyImport`):

1. A dashed drop area **"Choose an invoice or supply sheet"** / "PDF or Word invoice, CSV or Excel (.xlsx) sheet, up to 10 MB. Nothing is logged until you check the lines." While reading: "Reading the invoice (this can take a minute)" for PDF/DOCX, else "Reading the file". POST multipart `/api/admin/metrics/supplies/import`.
2. Reading rules (`src/lib/metrics/supply-import.ts`, `MAX_IMPORT_BYTES = 10 MB`): CSV/XLSX with recognisable headings is read as a table (`read_by: 'table'`): headings for product/item/description, SKU/code/barcode, store/outlet/branch/deliver to, qty/quantity/units/pieces, cartons/ctns/cases/boxes, units per carton/pack size, batch/lot, expiry/best before, date/delivery date. Rows without a quantity or cartons, and lines like subtotal, total, VAT, discount, delivery, transport, freight, are skipped. A sheet without known headings (first 400 rows), a PDF, or a Word file is read by Claude (`read_by: 'claude'`, model `claude-opus-5-5`, structured JSON). Errors: "Import a CSV, Excel (.xlsx), PDF or Word (.docx) file", "That file is over 10 MB", "That CSV|Excel file could not be opened", "That Word file is empty", "Reading PDF and Word invoices is not set up on this server (ANTHROPIC_API_KEY). Use a CSV or Excel file with column headings, or log the supply by hand.", "The invoice reader is busy. Try again in a minute.", "That document has too many lines to read at once. Split it and import each part.", "That file could not be read. Try a clearer copy, or a CSV or Excel file." Products are matched by SKU, then exact name, then a "close" name match (shared-word likeness ≥ 0.6); stores likewise.
3. Review: a tint header with the file name and "supplier · Invoice N · date · To X" (or "Read from the column headings") · "N lines found[, read by Claude: check them]"; a **"Same store for all…"** select that sets every line's store; **Start again**. A wide table (min 1040 px, scrolls): From the file (description, "SKU · N units stated", and the first problem in red), Product (select; a warning badge "Close match: check" when matched loosely), Store, Quantity (number + Units/Cartons; "= 120 bottles" for cartons), Per carton, Batch, Expiry, Supplied (max today), and a bin/restore button to leave a line out (left-out lines fade to 40 %). Problems per kept line, in order: "Choose the store", "Choose the product", "Enter the units|cartons", "Units per carton?", "Date?".
4. **"Log N supplies (U units)"** (disabled while any kept line has a problem; next to it "Line k: problem") → POST `/api/admin/metrics/supplies/import/<import_id>` `{rows}`; every row carries a note "supplier, Invoice N" (≤ 300). Success "N supplies logged from `file`."

**Month list**: month picker and **supplies** export links; table of `xm_supply_detail` in the month (limit 1000, newest first): Supplied (long date), Store, Product (+ note), Qty ("1,200" and "50 ctn × 24"), Batch, Expiry, Logged (who, "From `file`", when), and **Void** or an outline "Voided" badge with "who: reason". Voided rows at 60 % opacity. Empty "No supplies logged in October 2026."

### 14.5 Expiry — `/admin/metrics/expiry` (both)

Title "Expiry alerts — X Metrics". Intro: "Each batch is alerted as it enters a window (by default 2 years, 1 year, 6 months, 3 months and 1 month before expiry) and again once expired. Consider pulling means it will not sell before it expires at the current rate of sale."

Toggle links **Open** (`?show=open`, default) · **Handled** (`?show=handled`). Reads `xm_expiry_alert_detail` (limit 500): open = unacknowledged by days left; handled = acknowledged, newest first.

Columns: Product (bold; "SKU · batch X" under it), Store, Expires (long date + badge "Expired"/"Within …" — red when window ≤ 30, warning ≤ 180, else default — and red "Consider pulling"), On hand, Sells / day (1 decimal), Days to sell (or "No sales"), and the last column: in Open, admins get **Mark handled** (inline note "What was decided (optional)" → POST `/api/admin/metrics/expiry/<id>` `{note}`, admin only); in Handled, "who · date" and the note. Empty "No open expiry alerts." / "Nothing handled yet."

Admins are also pushed new alerts by the sweep: title "Expiry: consider pulling N batch(es)" or "Expiry: N batch(es) nearing expiry", body up to 4 lines "Product (batch) at Store: N units, 3 months left|expired" + " and N more", link `/admin/metrics/expiry`.

### 14.6 Grades — `/admin/metrics/grades` (both)

Title "Grades — X Metrics"; header **"Monthly grades"**: "Each merchandiser and marketer, graded on sales against target, stock accuracy, reporting consistency (against the days they clocked in) and expiry handling. Weights and bands are set in Settings."

Row: month picker, **grades** export links, and (admin, month not finalised, month already ended) **Finalise `October 2026`** (filled) with confirm "Keep the grades for October 2026 as they stand? They will not change after this." → POST `/api/admin/metrics/grades/finalise` `{month}`; result "N grades kept."

Source: if `xm_monthly_grades` has rows for the month they are shown (finalised); otherwise live grades from RPC `xm_month_grades(p_month)`. Banner: finalised → green "These grades were finalised and do not change. Add a review note to any of them."; live → info "Live grades: they change as counts, sales and targets come in." + " Finalise the month to keep them." (ended) or " A month can be finalised once it has ended." RPC failure: "The grades could not be worked out. Has migration 043 been run?"

A line: "Weights: sales W · accuracy W · consistency W · expiry W. Bands: Poor below P, Strong from S. A factor with nothing to judge is left out and the rest scaled to 100."

Table sorted by score desc (none last): Staff (→ `/admin/metrics/staff/<id>?month=YYYY-MM`), Score (bold), Band, Sales (score; "sold / target" — the store's units when the target is a store target — or "No target"), Accuracy ("x/y ok"), Consistency ("N days present"), Expiry, and for finalised months **Review** (the note, and for admins **Add note** / **Change note** → POST `/api/admin/metrics/grades/<id>` `{note}`). Empty "Nobody to grade for October 2026."

### 14.7 Scoring policy — `/admin/metrics/policy` (both)

Title "Scoring policy — X Metrics". Intro: "The policy and guidelines staff are scored by. Staff read it in the Metrics tab on their phone, next to their own score, and mark it read. Each publish is kept as a version."

No policy row: "The policy could not be read. Has migration 044 been run?"

Two columns on `lg` (3 : 2):

- Left card: admins **"Write the next version"**, supervisors the current title; description "Current version published `date, time` by `name`." Supervisors see the rendered policy (`PolicyText`). Admins get `PolicyEditor`: **Title** (≤ 120), **Policy and scoring guidelines** textarea (18 rows, mono, ≤ 20 000) with a **Preview**/**Edit** toggle; hint "Leave a blank line between paragraphs. Start a line with “- ” for a bullet point; a short line just before bullets becomes their heading. No links. The weights and bands are shown to staff automatically from Settings, so you do not need to repeat the numbers."; **What changed (optional)** (≤ 300, "Counts now due every Monday"); **Publish new version** (disabled when title and body are unchanged) → POST `/api/admin/metrics/policy`; "Published. Staff see this version now and are asked to read it."
- Right: **"Scoring as set now"** / "Shown to staff with the policy. Change it in Settings." (`ScoringSummary`); **"Who has read it"** / "R of N merchandisers and marketers have read the current version." with each active field person and a badge "Read `date`" (success) or "Not yet" (scrolls after 288 px); **"Earlier versions"**: each older version as a collapsible card (title, "date · by · change note", the text) or "None yet." (up to 50 versions read).

### 14.8 Settings — `/admin/metrics/settings` (admins only)

Title "Settings — X Metrics"; header **"X Metrics settings"**: "Which parts of X Metrics are in use, and the rules it applies. Every change is kept, with who made it." Missing row: "The settings could not be read. Has migration 043 been run?"

**Features** card (0063, first on the page) / "Switch X Metrics, or parts of it, off while you are not using them, and back on later. Off hides the part from the dashboard and the staff app; all its records are kept." (`FeaturesForm`, `src/components/admin/xm/features-form.tsx`). Five rows, each a label, one muted line and a brand-orange switch (`role="switch"`, 48 × 28 px; on = brand, off = `#e6d9cf`; on but blocked by the master = `#f2b48a`):

| Switch | Line |
|---|---|
| **X Metrics** (larger label) | "The whole module: stock counts by batch, stores and products. Off hides X Metrics from the menu and the staff app." |
| **Expiry** | "Expiry dates on stock counts, expiry alerts, the Expiry page and expiry in grades." |
| **Supplies** | "Stock supplied to stores: the Supplies page, invoice imports, and checking counts against what was supplied." |
| **Grading** | "Monthly grades, the Grades and Scoring policy pages, and the score staff see." |
| **Sales** | "Units sold: the daily sales form for staff, month-end sales, sales against target and the Targets page." |

The four parts are indented under X Metrics on wide screens; with X Metrics off, a part still on reads "(off while X Metrics is off)". With Supplies on and Sales off (or the reverse) the on one adds "Checking counts against supplies also needs Sales on." / "… needs Supplies on.". Footer: "Turning a part off hides it and stops its work. Nothing it recorded is deleted: turn it back on and it carries on." Each switch saves at once (PUT `/api/admin/metrics/features` `{enabled, expiry, supplies, grading, sales}` → `xm_set_features`, audited `xm.features.update` with `changes` such as "Sales off"); switching the whole module off first asks "Switch X Metrics off? It disappears from the menu and the staff app. All its records are kept.". Messages: "`Part` is off. Everything it recorded is kept, and comes back when you turn it on." / "`Part` is on again. It carries on from where it stopped.". Before 0063: warning "Run migration 0063 in Supabase to switch parts of X Metrics on and off."

**Rules** card, form sections:

- **Reconciliation**: Tolerance (%) (0–100, step 0.5). "A count further than this from expected is flagged. More than four times it is a high flag."
- **Grade weights (must add up to 100; now N)**: Sales vs target, Stock accuracy, Reporting consistency, Expiry handling (0–100 each).
- **Bands**: Poor below (1–99), Strong from (2–100); live text "Poor 0–P−1, Average P–S−1, Strong S–100."
- **Expiry**: Alert windows (days before expiry) as a comma/space list; Rate of sale over (days) (7–365). "730, 365, 180, 90, 30 is 2 years, 1 year, 6 months, 3 months and 1 month. A batch that will not sell before it expires at the recent rate of sale is marked “consider pulling”."
- **Reporting**: A count is due every (days) (1–31); Sales on time if sent within (hours after the day) (0–72); checkbox Daily sales need a shelf photo.

**Save settings** is disabled unless the weights sum to exactly 100 and every window is a whole number ≥ 1 → PUT `/api/admin/metrics/settings`; "Settings saved. The earlier version is kept in the history below."

**Earlier versions** (20 newest of `xm_settings_history`): "Replaced `date time` by `name`" and "Was: tolerance T% · weights a/b/c/d · bands p/s · windows … days" + (0063 rows) " · all parts on" or " · off: Expiry, Sales". Empty "Not changed yet."

### 14.8.1 What each switch hides (0063, `src/lib/metrics/features.ts`)

`readXmFeatures(client)` reads the switches (all on before 0063 or when unreadable); `src/app/admin/metrics/layout.tsx` hands them to the sub-navigation (`XmFeaturesProvider`). Every X Metrics page checks `xmPageOn(features, page)` and, when off, shows its header plus info alert "This part of X Metrics is switched off. An admin can turn it on in X Metrics → Settings." (+ **Open Settings** link for admins) instead (`XmSwitchedOff`). Reconciliation counts as on only with Supplies and Sales on; with the module off every part is off.

| Off | Gone from the dashboard |
|---|---|
| X Metrics | Menu item for supervisors; for admins the item reads "X Metrics (off)" and opens `/admin/metrics/settings`. Every X Metrics page but Settings; sub-navigation shows only Settings. Downloads, Ask Xtend's `x_metrics` and `propose_xmetrics_store` |
| Expiry | Expiry pill and page; overview "Open expiry alerts" tile and Expiry alerts card; store page Expiry column; Expiry and Time left columns in stock and supplies downloads; Expiry column in grades; expiry in Ask Xtend's `x_metrics` |
| Supplies | Supplies pill and page (and the import route, refused before reading the file); "Units supplied" tile and the supplied bars; supplies in Recent activity and on the store page; `supplies` download |
| Grading | Grades and Scoring policy pills and pages; grade cards, breakdown and finalised grades on the staff page; `grades` download |
| Sales | Targets pill and page; "Units sold" tile, sold bars (the chart becomes "Supplies overview"), Top stores, Sold columns, Units sold per day, daily sales in activity lists; Sales columns in grades; sales in Ask Xtend's `x_metrics`, `propose_sales_target`; X Metrics sales in marketer reports |
| Supplies or Sales | Reconciliation: "Stock accuracy" tile and ring (the ring shows sales against target only), Stock gaps card, Gaps column, store and staff Reconciliation tables, `discrepancies` download, Accuracy in grades |

Overview grids re-span so the remaining cards fill the row. **Run checks now** shows only when reconciliation or expiry is on. Ask Xtend is told in its system prompt what is off (`xmAssistantNote`).

### 14.9 Staff — `/admin/metrics/staff/[id]` (both)

Title "Staff — X Metrics". Unknown or not visible person → 404. Header = the person's name, intro "X Metrics for `October 2026`: grade, counts, sales and reconciliation."; month picker.

- When RPC `xm_grade(p_user, p_month)` returns: five cards (2 / 5 columns) — **Grade** (score, band badge) and four factor cards titled "Sales (W)", "Accuracy (W)", "Consistency (W)", "Expiry (W)" with score and detail ("x of target (store target)" or "N sold, no target"; "x of y within T%"; "N days present: sales on time a, count in time b"; "x of y lines dated, z expired on shelf"); a factor without a score says "Nothing to judge yet".
- **Grade breakdown**: `ScoreBars` (0–100, hatched `#d1511a` bars, 20 px tall): Sales vs target, Stock accuracy, Reporting, Expiry handling (no % sign).
- **Stock counts reconciled**: a donut (`Donut`: ring r = 70, width 26, 2 px gaps, hovered part grows by 4 and its value shows in the middle) of "Within tolerance" (`#d1511a`) and "Off by more" (`#c98500`), centre "P%" "accurate".
- **Units sold per day** (`DayBars`): one bar per day of the month, 112 px tall, brand at 80 %, labels on day 1, 6, 11, …; tooltip "date: units".
- **Finalised grades**: badges "October 2026: 78" (band colours) for up to 12 months, each linking to that month.
- **Reconciliation**: Date, Store, Product, Expected, Counted, Gap badge (red if flagged, else green). Empty "Nothing reconciled this month."
- **What they sent**: their counts ("Stock count" + "Opening" badge; store + "N m from the pin"; sent time) and daily sales ("Daily sales" + "Replaced"), each with **Void** for admins (not on replaced sales) or "Voided: reason".

### 14.10 Store — `/admin/metrics/stores/[id]` (both)

Title "Store — X Metrics". Unknown outlet → 404. Header = store name; intro "In X Metrics since `date`[ (taken out)]." or "This store is not in X Metrics." Row: month picker, **Stock** export links (`stock`, this outlet), **Reconciliation** export links (`discrepancies`, outlet and month).

- Three cards: **Sold in `month`** (units; "Target T (P%)" or "No store target"), **Stock accuracy** (% not flagged; "N product counts reconciled"), **Units on hand** ("From the latest count of each product").
- **Units sold per day** (DayBars).
- **Stock on hand** (`xm_stock_on_hand`, by product then expiry): Product, Batch, Expiry (or "Not recorded") with a badge when ≤ **90 days** left — "Expired" or "N days", red when expired or ≤ 30, else warning — Shelf, Backroom, Sold this month, Counted. Empty "No count yet. The first count is the opening stock."
- **Reconciliation**: Date, Product, Counted by, Previous, + Supplied, − Sold, Expected, Counted, Gap badge.
- **Counts, sales and supplies**: counts ("Opening stock" badge), sales ("Replaced"), supplies ("Supply: 24 × Product (batch)", By "Office"), each with **Void** for admins.

### Downloads (`src/lib/metrics/export.ts`, admin only)

| kind | Title | Columns | File |
|---|---|---|---|
| grades | "X Metrics grades: October 2026"; subtitle "`Finalised|Live`. N staff." | Staff, Score, Band, Sales, Sold / target, Accuracy, Consistency, Expiry, Review | `xmetrics-grades-YYYY-MM` |
| stock | "X Metrics stock on hand"; "From the latest count of each product in each store. N batches." | Store, Product, SKU, Batch, Expiry, Time left, Shelf, Backroom, Total, Counted | `xmetrics-stock` |
| discrepancies | "X Metrics stock reconciliation: October 2026"; "N product counts checked, M outside tolerance." | Date, Store, Counted by, Product, Previous, Supplied, Sold, Expected, Counted, Gap, Gap %, Flagged | `xmetrics-reconciliation-YYYY-MM` |
| supplies | "X Metrics supplies: October 2026"; "N deliveries, M voided." | Supplied, Store, Product, Units, Cartons, Batch, Expiry, Logged by, Note, Status | `xmetrics-supplies-YYYY-MM` |

### Supervisor differences (X Metrics)

- Menu item visible; sub-tabs only Overview, Expiry, Grades, Scoring policy. Supplies, Targets, Products & stores and Settings call `requireSession(['admin'])` and redirect a supervisor to `/`.
- Data narrowed to their team by RLS.
- No Run checks now, no Mark handled, no Finalise, no review notes, no Void, no policy editor (they read the current policy). Export links work and hold only their team.

### Acceptance checks

- On the 14th, "Units sold this month" compares with last month's 1st–14th only.
- A supervisor on `/admin/metrics` sees four sub-tabs and no "Run checks now".
- A flagged reconciliation in the last 30 days appears under Stock gaps with a red "−N (P%)" badge and links to the store and the person.
- Settings cannot be saved while the weights add up to 95; the heading says "now 95".
- Importing a CSV with headings "Item, Qty, Batch, Expiry" lists its lines with no Claude call; a line without a store blocks logging with "Line k: Choose the store".
- Finalise appears only for an ended month that is not finalised, asks for confirmation, and afterwards the page shows the green finalised banner and Review notes.
- A batch on the store page expiring in 20 days shows a red "20 days" badge; one in 60 days a warning badge; one in 120 days none.

---

## 16. Integrity — `/admin/integrity`

Files: `src/app/admin/integrity/page.tsx`, `src/components/admin/integrity-overview.tsx`, `integrity-flags.tsx`, `phone-check.tsx`; logic `src/lib/integrity-review.ts` (pure apart from the fetch; tested by `scripts/check-integrity-ask.ts`), names and meanings `src/lib/integrity.ts`. Data: view `integrity_flag_detail` (migration 022 and later). Title "Integrity checks — Xtend".

Heading **"Integrity checks"**; intro: "Things that look wrong: signs of a fake-location app, phone clocks changed, photos refused, and stock counts that do not add up. A flag is a reason to look, not proof. See who to look at first, open a flag for the detail and the evidence around it, then mark it reviewed with what you found, one at a time or several together." + (supervisor) " You see your own team only." + " Staff do not see these."

### Flag kinds (label — meaning), grouped by area

| Area (`AREA_LABEL`) | Kind | Label | Meaning (shown when a flag is opened) |
|---|---|---|---|
| Location | `repeated_exact_location` | Same GPS point again | Clocked in at exactly the same point, to the centimetre, as on another day. Real GPS always moves a little; fake-location apps do not. |
| | `perfect_accuracy` | Too-perfect GPS | The phone claimed accuracy under 2 m, which phones do not achieve indoors. |
| | `impossible_journey` | Impossible journey | Moved faster than any car between two readings: one of them was probably faked. |
| | `own_named_place` | Self-named place | Keeps clocking in … at a place they named themselves that nobody else has visited … look at the photo on the Places page. |
| | `vpn_suspected` | VPN or proxy | The clock-in arrived through a VPN, proxy or datacentre IP address. … |
| | `ip_location_mismatch` | GPS vs internet far apart | The GPS pin and the internet address … are hundreds of kilometres apart. … |
| | `gps_mock_fingerprint` | Fake-GPS fingerprint | The GPS fix carried no altitude, speed or heading … On its own it is weak; read it with the other flags. |
| | `mock_location_confirmed` | Fake GPS confirmed | The Xtend app (Android) reported that the location came from a mock provider … This is proof, not a guess. |
| Phone and clock | `backdated_clock` | Faked clock-in time | A clock event saved "offline" claims a time before the phone was last in touch with Xtend. … |
| | `phone_clock_wrong` | Phone clock changed | The phone's clock was more than 5 minutes out at a clock event. … |
| | `late_sync_with_network` | Sent late with network | A clock event was taken offline and sent much later, although the phone had network well before it was sent. |
| | `timezone_mismatch` | Phone zone not Nigeria | The phone's time zone was not Nigeria's. … |
| | `device_integrity_failed` | Rooted / jailbroken phone | The clock-in came from a rooted (Android) or jailbroken (iOS) phone … Treat its location as untrusted. |
| Photos | `photo_rejected` | Photo rejected | A photo was refused by the server check: a picture of a screen or a printed photo, no face, or too poor to use. |
| | `photo_unchecked` | Photo not checked | The photo check was unavailable, so the photo was allowed without being looked at. |
| | `selfie_at_home` | Selfie at home | The clock-in selfie looks like it was taken inside a home (bed, sofa, curtains). … |
| Stock counts | `count_units_missing` | Units missing | Fewer units left than the last count minus what was sold. … |
| | `count_identical` | Copied count | Every number is exactly the same as the previous count. |
| | `count_round_numbers` | Round numbers | Every number is a multiple of 10, which real counts rarely are. |
| | `stock_discrepancy` | Stock does not add up | An X Metrics count is far from what the last count, the supplies and the sales say should be on the shelf. |
| Punctuality | `late_clock_in` | Late clock-in | Clocked in more than 15 minutes after the shift started. |
| | `early_clock_out` | Early clock-out | Clocked out more than 15 minutes before the shift ended. |

(The full meanings are the strings in `src/lib/integrity.ts`; rebuild them word for word from there. Unknown kinds print the kind with underscores as spaces, and "A check Xtend raised." as the meaning.)

### Filters (`parseIntegrityFilter`)

| Param | Field | Default / rules |
|---|---|---|
| `from`, `to` | dates (max today) | `to` = today, `from` = to − 29 (**30 days**, `DEFAULT_DAYS`); swapped if reversed; longer than **120 days** (`MAX_DAYS`) moves `from` to to − 119 |
| `person` | "Who": **Everyone** + field staff (`FIELD_ROLES`) | all |
| `store` | "Store": **Every store** + all outlets | all |
| `kind` | "Check": **Every check** + the kinds in optgroups by area | all |
| `severity` | "Severity": **Any**, High, Medium, Low | all |
| `status` | "Show": **To review** (`open`), **Reviewed**, **All** | open |
| `q` | "Search", placeholder "Name, store, note…" — matches name, summary, store, check label, review note | none |

Values are cut to 120 characters. The database query uses only dates, person and store (newest first, up to **2000**, `fetchIntegrity`); kind, severity, status and search are applied in the page so every count can be shown. Button **Show**. "Quick:" chips Today, Yesterday, Last 7 days, This month, Last 30 days, Last 90 days (the matching one gets a brand border and tint); **Clear** → `/admin/integrity`; "**Download:**" Excel / PDF / Word / CSV → `/api/admin/export/integrity/<fmt>?<query>`. A line under the form: "`long from`[ to `long to`] · up to 120 days at a time[ · only the newest 2,000 flags are shown: narrow the dates]".

Load failure: red text "The checks could not be loaded: <message>. Has migration 022 been run in Supabase?"

### Figures (2 / 4 columns, over everything in the dates for the person/store)

- **To review** (warning colour if > 0), note "of N in these dates".
- **High, not reviewed** (red if > 0).
- **People with open flags**, note "N to act on now" (level `act`).
- **Reviewed**, note "P% done".

### Who to look at first (`personRisk`, 3/5 width; only when there are flags)

Description: "People ranked by open flags: high counts most, the last 7 days count double, and proof from the phone (fake GPS confirmed, a tampered phone, a faked clock time) puts them straight to the top."

Rules (unreviewed flags only): score = Σ severity weight (high **5**, medium **2**, low **1**) × (1 if the flag day is within the last 7 days, else **0.5**) + **5** for each proof flag (`mock_location_confirmed`, `device_integrity_failed`, `backdated_clock`). Level: **Act now** (red) when any proof or score ≥ **10**; **Keep an eye** (warning) when score ≥ **4**; else **Minor** (outline). Sorted by score, then open count, then name. Shows the top **8** ("And N more with fewer flags."); none: "Everything in these dates has been reviewed."

Each row: rank "1.", name, level badge, severity count chips (coloured dot + number: high `#9b3517`, medium `#d1511a`, low `#f2b48a`), the reason sentence, and chips **"Their N flags"** (filters to them, status open), **"Movement MM-DD"** (latest open flag day), **"Check an excuse"** (`/admin/excuses?person&date`).

Reason (`riskReason`): lead "N high flag(s) this week" / "N open flag(s) this week" / "N open flag(s), none this week", then ": " and up to 3 kinds — "`Label` on D different days", "`Label` ×N", or the label — "and N other kind(s)", "." and " Includes proof: `labels`." when any.

### Flags per day and By check (2/5 width)

- **Flags per day** / "Every flag in these dates, reviewed or not, by severity.": stacked columns (112 px tall, 1 px gaps, high at the bottom `#9b3517`, medium `#d1511a`, low `#f2b48a`) on a pale track; tooltip "`long date`: N flags (h high, m medium, l low)"; axis shows first, middle and last day "MM-DD"; legend with totals and "Busiest: `long date` (N)".
- **By check** / "Tap one to see only those.": up to 10 kinds, most first: label (bold brand when active), "o open · t", an 8 px `#d1511a` bar (min 4 %). Clicking toggles the kind filter.

### The list

Heading "To review" / "Reviewed" / "All flags", badges for active kind, severity, person and store, and on the right chips **To review (N)**, **Reviewed (N)**, **All (N)**.

Above the items: "N flags[, k not reviewed]. Tap one for the detail." and, when unreviewed flags are visible, a pill checkbox **"Select all N to review"** (visible ones only).

Each flag (`FlagItem`): a checkbox (unreviewed) or a green tick (reviewed); a collapsible row with name, a severity-coloured badge (high red, medium warning, low outline) carrying a dot and the check label, "Reviewed" badge, the summary " · store", and the raised time with a chevron. Opened:

- "`Severity` · `meaning`".
- **Facts** from the flag's `detail` JSON (`detailFacts`), e.g. GPS point (6 decimals), Seen in (a clock-in / a clock-out / a store visit / location while on shift / positions saved offline / tracking with the app closed), Distance (km), Minutes late / Minutes early / Time between readings, Accuracy the phone claimed, Internet address, Country of the internet address, VPN or proxy (Yes/No), Datacentre address, Mobile network, Phone time zone, Phone offset (UTC+1), Phone (iPhone/Android), Phone clock ("right" under 60 s, else "N min ahead|behind"), Sent after, Really taken at, Phone was in touch with Xtend at, Last in touch before that, How we know, Positions refused, Positions from a fake-GPS app, Times seen there, Last count, Supplied since, and any other key humanised.
- For count flags a small table: Product, Left last time, Sold, Counted, Missing (red).
- Chips: **Movement that day**, **Check an excuse** (`?person&date`), plus **Places** (self-named place), **Stock counts** (count flags; that day), **X Metrics** (stock discrepancy); **The GPS point** (Google Maps) when there is one; **Is their phone on now?** toggles the phone check (section 11).
- Reviewed: "Reviewed by `name` `date time`: note". Unreviewed: input "What you found (optional)" (max 500) and **Mark reviewed** → POST `/api/admin/integrity/<id>/review` `{note}`.
- "Flag day: `long date`".

100 flags render at first (`PAGE = 100`), then **"Show N more of M"**.

Bulk bar (sticky, when anything is selected): "N selected" + **Clear**, input "One note for all of them (optional)" (max 500), **Mark N reviewed** ("Saving…") → POST `/api/admin/integrity/review` `{ids (1–200), note}` → RPC `review_integrity_flags` (migration 054; flags already reviewed keep their review), audit `integrity.review_many`. Results: "N flags marked reviewed." or "N of M marked reviewed. The rest were already reviewed or are not in your team." Missing RPC: "Reviewing several at once needs update 054 run in Supabase." Validation: "Pick at least one flag", "Review at most 200 flags at a time".

Empty list: "Nothing left to review for these filters. New flags appear here as clock-ins and counts come in." (status open) or "No flags match these filters."

Medium and high flags are also pushed to the person's admins and supervisor once each (`flushFlagAlerts`, `src/lib/flag-alerts.ts`): title "`Name`: `headline`", body "summary (store).", link `/admin/integrity`.

### Download

Title "Integrity checks"; subtitle "`from` to `to` · `to review|reviewed|all`[, check][, severity] · N flags, M not yet reviewed"; notes "Things that looked wrong: … A flag is a reason to look, not proof." + "Look at first: Name (reason) …" for up to 5 people at Act now or Keep an eye. Columns: Day, Raised, Person, Severity, Check, What happened, Store, Detail, Reviewed (time or "Not yet"), Reviewed by, Note. File `xtend-integrity`.

### Supervisor differences

Their team only; they can review flags (single and bulk) — the database refuses flags outside their team.

### Acceptance checks

- No parameters → the last 30 days, status "To review".
- `from` 200 days ago is cut to 120 days, and the line says "up to 120 days at a time".
- One unreviewed `mock_location_confirmed` flag puts that person at "Act now" even with nothing else; two medium flags this week (score 4) make "Keep an eye"; one medium flag 10 days ago (score 1) "Minor".
- Clicking a kind under By check filters the list and shows the kind as a badge; clicking again clears it.
- Selecting 3 flags and pressing "Mark 3 reviewed" moves them to Reviewed with the shared note.
- The Download link carries the same query string.

---

## 17. Check an excuse — `/admin/excuses`

Files: `src/app/admin/excuses/page.tsx`, `src/components/admin/excuse-timeline.tsx`, `save-excuse-check.tsx`, `phone-check.tsx`; logic `src/lib/excuse.ts` (`judgeExcuse`, pure) and `src/lib/excuse-server.ts`. Data: RPCs `check_excuse` (migration 026) and `check_excuse_more` (048), `record_excuse_check`, view `excuse_check_detail`. Title "Check an excuse — Xtend".

Heading **"Check an excuse"**; intro: "Someone says their network was bad, their phone was off, their location would not work, they were at the store all along, or the app would not let them clock in? Pick who, when, and what they said. Xtend lays out everything their phone did in that time, on a timeline, and says whether it fits. Keep the check on their record to see a pattern. Staff are not told any of this is recorded."

### Query parameters

| Param | Meaning | Default / rules |
|---|---|---|
| `person` | active merchandiser/marketer id | none → no check runs |
| `claim` | `no_network` "My network was bad / no data"; `phone_off` "My phone was off / battery died"; `gps_failed` "My location / GPS would not work"; `at_store` "I was at my store the whole time"; `app_failed` "The app would not let me clock in" | `no_network` |
| `date` | window start day (≤ today) | today |
| `from` | start time `HH:MM` | `08:00` |
| `until` | window end day (≥ date, ≤ today) | = date |
| `to` | end time `HH:MM` | now (Lagos HH:MM) when `until` is today, else `18:00` |

The window is `lagosInstant(date, from)` to `lagosInstant(until, to)`. The database refuses windows that are empty or longer than **72 hours**: "Pick a time window of up to 3 days" (shown as the red problem alert).

Many pages link here with these parameters prefilled: Attendance (absent/late: 06:00–12:00, or shift − 2 h to clock-in), Movement (a silence), Alerts (an hour either side), Store visits (`claim=at_store` for a visit), Integrity, Support.

### Form

Row 1: **Who** (required; a disabled first option "Pick a person"; active field staff by name), **What they said** (the five claims). Row 2: **From day**, **Time**, **To day**, **Time**, **Check**. "Quick:" chips (keeping who and what): **This morning** (today 07:00–12:00), **This afternoon** (today 12:00–now), **Last 2 hours** (now − 2 h to now), **Yesterday’s shift** (yesterday 07:00–19:00), **Last 3 days** (today − 2, 00:00 to now), then "· up to 3 days".

### Errors

- `check_excuse` missing (`PGRST202`/`42883`): "This needs the phone evidence update (026) run in Supabase."
- For `gps_failed`, `at_store`, `app_failed` when `check_excuse_more` is missing: "This check needs the excuse update (048) run in Supabase." (the timeline still shows).
- Anything else: the database message.

### Verdict card (when a person is chosen and the check ran)

Card tinted by verdict: **Not true** (`false`, red), **Doubtful** (amber), **Fits the evidence** (`fits`, green), **No evidence** (`unknown`, grey). Small caps line: "`Verdict` · `Name` · “`claim`” · `from` to `to`". Title = the headline; then bullet points (the evidence in words). Examples of headlines from `judgeExcuse`:

- "Not true: the time on the phone was changed to make a clock-in look earlier."
- "Not true: the phone had network. It reached Xtend at …"
- "It fits: the phone was on but had no network, and saved its work to send later."
- "It fits: the battery was down to N% at HH:MM." / "Doubtful: the battery did not run flat (a% before, b% after, not charging). If the phone was off, it was switched off."
- "Xtend heard nothing from the phone in this time. …"
- "It fits: every position the phone gave was rougher than 100 m (best N m)."
- "Xtend cannot tell: none of their stores has a location yet."
- "It fits: all N accurate positions were at `Store`." / "Not true|Doubtful: k of N accurate positions were away from the store, up to X from `Store` at HH:MM." (Not true when the furthest is more than the store radius + **300 m**.)
- "Not true: a clock-in went through at HH:MM." / "It fits: they tried, and the app stopped them because …" / "Doubtful: the app was open with network at HH:MM, and nothing stopped a clock-in: no location problem, no refused photo, nothing waiting."

Under the points, **Keep on record**: an input "Note (optional): what they said, what you decided" (max 500) and a button **Keep on record** → POST `/api/admin/excuses` `{user_id, claim, from, to, note}`; the server re-runs the check and calls `record_excuse_check` (so the verdict saved is the server's, not the browser's). Then "Kept on their record." with a tick; errors "It could not be kept" or the message.

### What the phone did (timeline)

Card **"What the phone did"** / "`from` to `to`. Point at a mark for the detail." Rows (label column 6.5 rem): **Phone heard**, **Kept offline**, **Location**, **Problems**, **Battery**, each a dashed baseline with marks placed by time:

- Phone heard: `#d1511a` dots (tooltip "time: app open, WIFI, battery 54%"); stretches with nothing heard for more than **30 minutes** between contacts are hatched grey (tooltip "Nothing heard from … to …").
- Kept offline: `#e8833a` rings — offline clock-ins/outs ("Clock-in taken offline, sent `time`") and offline positions.
- Location: squares `#9b3517` at the store, diamonds `#52281a` away, squares `#f2b48a` for rough positions (accuracy > 100 m); tooltip "source, accurate to N m, X from Store (at the store|away)".
- Problems: `#52281a` crosses — location problems, refused photos ("Photo refused: message"), etc.
- Battery: a small line chart of battery % (including the reading just before the window, if within 12 h).
- Time ticks every 1 h (≤ 6 h window), 2 h (≤ 14 h), 4 h (≤ 30 h) or 12 h, with dates when the window is longer than 24 h.
- Key: Phone heard (had network), Kept offline, At their store, Away from store, Rough position, Problem, Silent over 30 min.

### Is the phone on right now?

Card with "If they say their phone is off or has no network now, check it. Xtend sends the phone a notification (“Please open Xtend now”), and the phone reports when it arrives. If it arrives, the phone is on and has network." and the `PhoneCheck` (section 11).

### Kept checks

Card **"`Name`’s excuses, last 90 days"** / "Checks kept on their record, newest first." (up to 50), or without a person **"Excuses kept, last 90 days"** / "Pick a person to check, or open one below." (up to 15 across everyone visible).

With a person, a **pattern** block first: when at least **2** kept checks were Not true or Doubtful, a warning "N of their last M excuses did not hold up. Worth a conversation."; then one chip per claim: "`claim` / N time(s), k not true or doubtful" or ", all held up".

Each kept row: verdict badge (red / warning / success / outline), the person's name (link to `?person&claim`, only in the all-people list), “claim”, the window, the headline, and "Checked by `name` on `date time` · note". Empty "None kept yet."

### Supervisor differences

Only their team in the picker and the kept list; the RPCs refuse anyone else.

### Acceptance checks

- Opening the page with no person shows the form and the last 15 kept checks, and runs no check.
- `?person=<id>&date=<today>&from=06:00&to=12:00` shows a verdict card, the timeline and the phone check.
- A 4-day window shows "Pick a time window of up to 3 days".
- Choosing "I was at my store the whole time" without migration 048 shows the 048 message.
- After "Keep on record", the check appears at the top of the person's kept list; with two Not true/Doubtful checks the warning appears.

---

## 18. Staff — `/admin/users` (and `/admin/users/import`)

Files: `src/app/admin/users/page.tsx`, `src/app/admin/users/import/page.tsx`, `src/components/admin/staff-manager.tsx`, `role-select.tsx`, `csv-importer.tsx`; login sheet `src/lib/staff-logins.ts`; roles `src/lib/staff-roles.ts`; field rules `src/lib/fields.ts`. Title "Staff — Xtend".

### Query parameters

- `q` — initial search text (max 80 characters), from the top-bar search box.
- `new=1` — opens the Add staff form straight away (from the top bar's and Overview's "Add staff").

### What loads

- RPC `my_staff()` — everyone for an admin; the supervisor's own team for a supervisor (decided in Postgres).
- `outlets` (all), RPC `available_supervisors()` (empty for a supervisor), and for supervisors RPC `outlets_for_user(target = me)` — the only stores they may add new staff to.
- `staff_roles` (added roles), `avatarUrls()` (signed profile photos), and with the service role the active `push_subscriptions` whose endpoint matches `LIVE_PUSH_ENDPOINT` — who has notifications on (clocking in needs them, migration 027). Without the service key the badges are not shown correctly but the list still loads.

### Header

Heading **"Staff"**. Admin intro: "Accounts are created here. Deactivation is a soft delete: attendance history is never destroyed." Supervisor intro: "Your team. People you add here report to you, and you can reset a password or deactivate an account."

Admin-only buttons on the right: **Login details (Word)** (file icon; downloads `/api/admin/staff-logins`, admin only — a Word document "Xtend staff login details", built fresh each time: the Xtend title, "Staff login details and app installation", install steps for Android 7+ and iPhone iOS 15+, then each field worker's name, email, phone and temporary password, or a note when there is none to show, grouped by role including added roles), and **Bulk import CSV** (→ `/admin/users/import`).

### Controls

- **Category tabs** (only when there are more than two non-empty categories): All, Merchandisers, Marketers, Supervisors, Admins, then each added role by name, each with "(count)"; empty categories are hidden (so a supervisor sees only their team's). Segmented control style: muted track, the active tab white with a soft shadow.
- Search "Search name, email or phone" (max width `xs`), filters as you type.
- **Add staff** (user-plus icon; becomes **Cancel** while the form is open).

### Add staff form (`POST /api/admin/users`)

Fields (5 columns on `lg`): **Full name** (≤ 80, placeholder "Ada Okafor"), **Email** (≤ 200, "name@gmail.com"), **Phone (Nigerian mobile)** (≤ 18, digits/+/spaces only, "08012345678"; required for roles that work like merchandiser or marketer, label gets ", optional" otherwise), **Role** (`RoleSelect`: admins get Merchandiser, Marketer, Supervisor, Admin and an optgroup "Added roles" "Name (Base)"; supervisors only Merchandiser, Marketer and added roles based on them; retired added roles only shown for people who have them), **Outlet** ("No outlet" + all stores for admins, only `outlets_for_user` stores for supervisors), **Reports to** ("Nobody" + supervisors for admins; disabled showing "You" for supervisors). **Create account** ("Creating…").

Client checks first (name, email, phone rules from `src/lib/fields.ts`); "Enter their phone number: merchandisers and marketers sign in with it." Server rules: supervisors "Supervisors can create merchandisers and marketers only.", "Supervisors can add staff to their own stores only."; their new staff always report to them; retired added role "That role is not available any more."; duplicates (email/phone) refused.

Success: a green alert **"Temporary password for `name`"** with the password in large mono text and "Hand it over now; they must change it at first login. Until they do, admins also find it in Login details (Word) on this page." The temporary password is also kept in `staff_temp_passwords` for the login sheet.

### The list

**Desktop table** (≥ `md`): Name (36 px round photo or initials; field staff names link to `/admin/metrics/staff/<id>` "See their X Metrics"), Contact (email, phone or —), Role, Outlet, Reports to, Status, actions.

- Admins edit Role, Outlet and Reports to inline with selects (each change PATCHes `/api/admin/users/<id>` immediately; Reports to only when there are supervisors, never offering the person themselves). Supervisors see plain text (role label, store or "No store", supervisor name or —).
- Status badges: **Active** (success) / **Deactivated** (outline); **Temp password** (warning) while `must_change_password`; for field staff **Notifications on** (success), **Notifications off: cannot clock in** (warning), or **Excused from notifications** (outline) when `push_exempt`.
- Actions (ghost buttons): **Edit details**, **Reset password** (PATCH `{reset_password: true}` → shows the new temporary password the same way), **Deactivate** / **Reactivate** (PATCH `{is_active}`, no confirmation), for admins on field staff **Excuse from notifications** / **Require notifications** (confirm "Let `name` clock in without notifications? Only do this for a phone that cannot receive them: their phone can then not be checked live."), **Schedule** (a link, for active merchandisers and marketers, to `/admin/schedules?user=<id>`; outline on phone cards), and for admins **Delete** (red; `confirm` "Delete `name`'s account for good? …" → DELETE `/api/admin/users/<id>`). Delete removes the auth account, which cascades the profile; it is refused with a 409 ("This person has attendance history … Deactivate it instead.") when they have attendance or any other ON DELETE RESTRICT history, and you cannot delete your own account. Supervisors do not see Delete.

**Phone cards** (< `md`): photo, name, email, phone ("No phone"), the badges on the right; Role / Outlet / Reports to as labelled selects (admins) or text; the same buttons (Edit details and Reset password as outline; Delete red for admins).

**Edit details** card (above the list): "Edit `name`", **Full name** (≤ 80), **Email (their login)** (≤ 200; disabled for supervisors with "Only an admin can change an email."), **Phone (Nigerian mobile)**; **Save details** sends only changed fields; "`name`'s details are saved."

Server rules for PATCH (`src/app/api/admin/users/[id]/route.ts`): "You cannot deactivate your own account."; "You cannot remove your own admin role."; a supervisor may edit only people with `supervisor_id = me` ("That person is not on your team.") and only name, phone, password reset and active state ("Only an admin can change somebody's email, role, store, supervisor or notification rule."); "Somebody already uses that email." (409); "Somebody already uses that phone number."; "That role is not available any more."

Errors show in a red alert at the top ("That change did not save.", "No connection. Try again.").

### Bulk import — `/admin/users/import` (admins only)

Title "Bulk import — Xtend". Heading **"Bulk import staff"**: "Upload a CSV with the columns `full_name, email, phone, outlet_name, role`. Role is one of `merchandiser`, `marketer`, `supervisor` or `admin`; only marketers file daily reports. The whole file is validated first, and nothing is created until you commit."

- **Choose CSV** (`.csv`), **Download template** (`xtend-staff-template.csv`), and "Known outlets: a, b, c" (or "none yet — create outlets first").
- Errors: "That file has no rows.", "Split the file: 500 rows at a time is the limit.", "That file could not be read as CSV."
- Upload → POST `/api/admin/users/import` `{rows, commit:false}` → a preview table: Line, Name, Email, Phone, Outlet, Role, Result (problem text, or "Ready"). Summary: "N row(s) ready, M with problems. Fix the file and upload it again." (warning) or "… Nothing has been created yet." (success).
- With no problems: **Create N account(s)** ("Creating accounts…") → `{rows, commit:true}`; result "N account(s) created, M failed." and a Result column "Created"; a button downloads `xtend-temporary-passwords.csv` (`full_name,email,temp_password`).

### Supervisor differences

Their team only; can add merchandisers/marketers (and added roles based on them) to their own stores, who then report to them; can edit name and phone, reset passwords, deactivate/reactivate. Cannot change email, role, store, supervisor or the notification rule; no Login details, no Bulk import.

### Acceptance checks

- `/admin/users?q=ada` opens with "ada" in the search box and the list filtered.
- `/admin/users?new=1` opens with the Add staff form showing.
- Creating a marketer without a phone is refused with "Enter their phone number: merchandisers and marketers sign in with it."
- After creating, the temporary password shows once in a green box and the new row has a "Temp password" badge.
- A field worker without a live push subscription shows "Notifications off: cannot clock in".
- A supervisor's Role, Outlet and Reports to columns are plain text; their Add staff role picker offers only field roles.
- An admin cannot deactivate themselves.
- Each active merchandiser or marketer row has **Schedule**, opening Schedules on that person; supervisors and admins rows have none.

---

## 19. Teams — `/admin/teams` (admins only)

Files: `src/app/admin/teams/page.tsx`, `src/components/admin/team-manager.tsx`. Title "Teams — Xtend". `requireSession(['admin'])`.

Heading **"Teams"**: "Put merchandisers and marketers on a supervisor's team. A supervisor sees their team's attendance, reports and counts, and manages their accounts. Pick a category, tick several people (or select all shown) and move them at once."

Loads `my_staff()` (keeps active merchandisers and marketers), `available_supervisors()`, outlets (for home-store names), `staff_roles` (for added-role names).

No supervisors at all: info alert "There are no supervisors yet. Make somebody a supervisor on the Staff page first, then come back here to give them a team."

Layout:

- Category tabs **All (n)**, **Merchandisers (n)**, **Marketers (n)** (segmented). Switching category drops ticked people not in it.
- Team chips: **Everyone (n)**, **No supervisor (n)**, one per supervisor "`Name` (n)" — counts within the category.
- A sticky action bar (top 7.5 rem on phones under the header, 16 px on `lg`): "N selected", a supervisor select (default the first; admins listed as "Name (admin)"), **Assign to supervisor** (user-check icon) and **Remove from team** (outline, user-minus). Both → PUT `/api/admin/teams` `{user_ids, supervisor_id | null}` (admin only). Results: "N person now reports / people now report to `Name`." / "N person was / people were taken off their supervisor's team." Errors "That change could not be saved."
- Search "Find by name or store".
- A list card with a header checkbox **"Select all shown (n)"** and one row per person: checkbox, name, a role pill (the added-role or built-in label; merchandisers tinted, marketers muted), home store or "no home store", and on the right the supervisor's name or "No supervisor". Ticked rows tint. Empty "Nobody here."

### Acceptance checks

- A supervisor opening `/admin/teams` is redirected to `/`.
- Ticking three marketers and pressing "Assign to supervisor" with Bola selected reports "3 people now report to Bola." and the Bola chip count grows by 3.
- "Select all shown" ticks only the people visible under the current chip and search.

---

## 20. Schedules — `/admin/schedules`

Files: `src/app/admin/schedules/page.tsx`, `src/components/admin/schedule-manager.tsx`; rules `src/lib/schedule.ts` (pure, tested by `scripts/check-schedules-leave.ts`); database migration 059 (`30-rules.md`, schedules and leave). Title "Schedules — Xtend". `requireSession(['admin','supervisor'])`.

Heading **"Schedules"**. Intro: admin "Days on and days off for every merchandiser and marketer." / supervisor "Days on and days off for your team." + " A day off, or a day of approved **leave** (link to `/admin/leave`), is never counted as absent, and nobody is chased for not clocking in on one. Every change is in the audit log."

**What loads** (through the session): `my_staff()` (kept: active merchandisers and marketers, never the viewer), `work_patterns` (user_id, days; ≤ 5000), `schedule_overrides` from today − **60** days on (≤ 2000, by day), outlets, `staff_roles`. Each person: name, role label, home store, "`<Supervisor>`’s team", own pattern or null (default). `?user=<id>` (from Staff → **Schedule**) starts on that person: the search holds their name, they are ticked, their row is tinted, and the one-off form and its list start on them. Load error: "Could not load staff: <message>"; nobody: info "There are no merchandisers or marketers to schedule yet."

### Weekly days on and off

Card **"Weekly days on and off"** / "Orange days are working days; grey days are days off. Everyone starts on Monday to Saturday. Tick several people to give them all the same week at once."

- Category tabs (same style as Teams): **"All (N)"**, **"Merchandisers (N)"**, **"Marketers (N)"**, by built-in role (`kind`); `?user=` starts on that person's category. Switching category unticks anyone no longer shown.
- Chips under the tabs, counted within the category: **"Everyone (N)"**, **"Mon–Sat (N)"** (default pattern, or one equal to Mon–Sat), **"Own week (N)"** (any other pattern).
- Search "Search name, store or team" (name, store, team, role) and **"Tick all shown (N)"** / **"Clear shown"**; search, category and chip combine.
- **Week toggles** (`WeekToggles`): seven round buttons, Monday first, labelled Mo Tu We Th Fr Sa Su; on = brand fill, off = muted; `aria-pressed`, title/aria "Monday: working|day off". Days are Postgres `extract(dow)` numbers, 0 = Sunday … 6 = Saturday.
- One row per person: checkbox, name, "role · store (or No store) · team", small toggles holding a draft, and the pattern in words (`patternText`: runs of 3+ joined with a dash — "Mon–Sat", "Mon–Fri", "Mon, Wed, Fri", "Every day", "No working days"; "usual week" under it when on the default). A changed draft shows **Save** (→ one person) and **Undo**.
- With anyone ticked, a tint bar: "N ticked · give them", toggles (start Mon–Sat), the pattern in words, **"Apply to N"** and **"Back to Mon–Sat"** (sends `days: null`).
- Save → `POST /api/admin/schedules { user_ids (1–500), days (0–6, ≤ 7) | null }` → `set_work_pattern`. Notices: "`Name` schedule is now Mon–Fri." for one, "N people now work Mon–Fri." for several; null reads "Mon–Sat (the usual week)". Errors from the database, e.g. "You can only set schedules for your own team"; fallback "That change could not be saved."

### One-off changes

Card **"One-off changes"** / "Make one date an extra day in (for example a Sunday stock count) or an extra day off (a swap or a public holiday). It replaces the weekly pattern for that date only. Approved leave is on the Leave page."

- Form: **Person** (select), **Date** (default today), **Make it** ("A day off" default / "A working day"), **Note (optional)** (≤ 300, "Public holiday, swap…"), **Add** (calendar-minus / calendar-plus icon) → `POST /api/admin/schedules/overrides { user_id, day, working, note }` → `set_schedule_override` (replaces any change already on that date; 60 days back to a year ahead). Notice "`Name`: Tue 20 Oct is now a day off|a working day."
- "Show:" pills **`<person>`** / **Everyone**. List by date: "Tue 20 Oct", name, badge **"Extra day in"** (default) or **"Day off"** (outline), "past" for a date before today, the note, and **Remove** (bin) → `DELETE /api/admin/schedules/overrides/<id>`; notice "`Name`: Tue 20 Oct follows the weekly pattern again." Empty: "No one-off changes from the last 60 days onwards."

### Supervisor differences

Only their team is listed; the database refuses anyone else ("You can only set schedules for your own team"). All or nothing: one person outside the team in a bulk apply refuses the whole change.

### Acceptance checks

- Unticking Saturday for one person and pressing Save shows "… schedule is now Mon–Fri." and writes one `schedule.pattern` audit row.
- Ticking 3 people and "Apply to 3" with Mon, Wed, Fri reports "3 people now work Mon, Wed, Fri."
- "Back to Mon–Sat" removes their pattern; the row reads "Mon–Sat" with "usual week".
- Adding a Sunday as "A working day" lists it as "Extra day in"; on Attendance that Sunday without a clock-in becomes "A".
- A date more than a year ahead is refused with "Pick a date within the next year".
- Staff → **Schedule** on a person opens this page ticked and tinted on them.

---

## 21. Leave — `/admin/leave`

Files: `src/app/admin/leave/page.tsx`, `src/components/admin/leave-decisions.tsx`. Title "Leave — Xtend". `requireSession(['admin','supervisor'])`.

Heading **"Leave"**. Intro: admin "Leave requests from every merchandiser and marketer." / supervisor "Leave requests from your team." + " Approve or reject each one; the person gets a message either way. Approved days are not counted as absent and nobody is chased for not clocking in on them. Requests still waiting come first."

**Query parameters** (GET form): `status` (Status: **Any**, Pending, Approved, Rejected, Cancelled), `person` (Person: **Everyone** + merchandisers and marketers by name), `from` / `to` (date inputs; keep requests that overlap: `to_date ≥ from`, `from_date ≤ to`). **Show**; **Clear** when anything is set.

**What loads**: view `leave_request_detail` (security_invoker, so RLS applies; request + `staff_name`, `staff_role`, `outlet_name`, `supervisor_id`, `decided_by_name`, `days`), newest first day first, ≤ **500**, filtered, then `sortLeave()` (pending first by soonest first day, then the rest by latest first day, then newest asked). A warning alert when any are pending: "N request(s) is/are waiting for a decision." + link **"Show only those"** (→ `?status=pending`) unless already filtered so.

**Cards** (`LeaveDecisions`): name and store ("No store"), status badge (Pending warning, Approved success, Rejected destructive, Cancelled outline); "**Annual leave** · Tue 20 Oct to Thu 22 Oct (3 days)" (+ "already started" in warning for a pending one whose first day is today or earlier); the reason; "Asked `<time>`" + " · Approved|Rejected by `<name or the office>` `<time>`"; "Note: …" when written. A pending request of someone else gets a note input "Note to them (optional)" (≤ 500) and **Approve** (check) / **Reject** (outline, X) → `POST /api/admin/leave/<id> { decision: 'approve'|'reject', note }` → `decide_leave`. Your own request never shows the buttons. Notice "`Name`'s leave was approved|rejected. They have been told." Empty: "No leave requests match." Load error: "Could not load leave requests: <message>".

**Pushes**: when staff ask (`POST /api/leave`), `notifyWatchers` tells their supervisor and admins: "`<Name>` asked for leave" / "Annual leave: Tue 20 Oct (1 day). `<reason>`", opening `/admin/leave?status=pending` (detail kind `leave_request`). After a decision `notifyUsers` tells the person: "Leave approved" / "Leave not approved", "Your annual leave for `<range>` was approved|not approved.` <note>`", opening `/field/leave` (kind `leave_decision`).

### Supervisor differences

Their team's requests only; the database refuses deciding anyone else's ("You can only decide leave for your own team") and anyone's own ("You cannot decide your own leave").

### Acceptance checks

- With 2 pending requests the warning reads "2 requests are waiting for a decision." and "Show only those" filters to them.
- Approving writes `leave.approve` in the audit log, the person gets "Leave approved", and the days show "Lv" on Attendance.
- Deciding the same request twice gives "That request has already been decided"; a cancelled one "That request was cancelled".
- Only merchandisers and marketers can ask (`apply_leave`), so a request never belongs to the admin or supervisor viewing it; the buttons are also hidden for the viewer's own id.

---

## 22. Roles — `/admin/roles` (admins only)

Files: `src/app/admin/roles/page.tsx`, `src/components/admin/role-manager.tsx`. Title "Roles — Xtend". Migration 042 (added roles) and 046 (who counts stock).

Heading **"Roles"**: "Add a role with its own name, such as Account Receivable or Promoter, and choose what it works like. People with it can do what that role does, and show by the new name on Staff, Teams and the login details. Give someone a role on the Staff page."

Loads `staff_roles` (id, name, base_role, is_active, counts_stock), active profiles with a `staff_role_id` (to count holders), `role_store_counts` (built-in roles' stock-count switch).

- **Add form**: **Role name** (≤ 40, "e.g. Account Receivable"), **Works like** (Merchandiser — "Clocks in and out with a selfie at one store or office."; Marketer — "Clocks in, checks in at each store visited, files a daily report."; Supervisor — "Uses the dashboard for their own team."; the hint shows under the form), checkbox **Takes stock counts** (default on; hidden for Supervisor), **Add role** → POST `/api/admin/staff-roles` `{name, base_role, counts_stock}`; "Added "Name"."; duplicate "There is already a role with that name."
- **Stock count** card: "Choose which roles take the month-end stock count and counts a supervisor asks for. Roles that are off do not see the count form, and cannot be asked to count." A switch row for Merchandiser and Marketer ("Built-in role"; PATCH `/api/admin/role-store-counts` `{role, counts_stock}`) and for each active added role not based on supervisor ("Works like a merchandiser"; PATCH `/api/admin/staff-roles/<id>` `{counts_stock}`), with "Yes"/"No". Notices "`Name` now take stock counts." / "`Name` no longer take stock counts: the count form is gone from their app."
- **List** of added roles: name (+ "Retired" badge), "Works like a `base` · N person/people", **Rename** (inline input ≤ 40, **Save**/**Cancel**, "Renamed.") and **Retire** / **Bring back** ("\"Name\" retired: it can no longer be given." / "\"Name\" is back in use."). Empty "No roles added yet."

### Acceptance checks

- Adding "Promoter" working like Marketer shows it on Staff's Role picker under "Added roles" as "Promoter (Marketer)".
- Turning the Marketer switch off removes marketers from the Stock count page's request list.
- A retired role stays on the people who have it but cannot be chosen for anyone else.

---

## 23. Store allocation — `/admin/assignments`

Files: `src/app/admin/assignments/page.tsx`, `src/components/admin/outlet-allocator.tsx`. Title "Store allocation — Xtend".

Heading **"Store allocation"**: "Choose which stores each person works. A marketer with stores here can only check in at those (and their home store), and the app lists only those; with none, they check in wherever they are. A merchandiser is measured against their store. Allocating also puts someone on a supervisor’s team."

Loads view `staff_allocation` (each field person: role, active, home outlet, allocated outlet ids and names; by name), active outlets (id, name, address), `my_staff()` (to know each person's supervisor), `available_supervisors()` (empty for a supervisor).

Layout:

- Role tabs **All**, **Merchandisers**, **Marketers** with counts.
- (Admins) team chips **Every team (n)**, "`Name`’s team (n)", **No supervisor (n)**.
- Search "Search staff or store" (matches the name or any allocated store).
- One card per person, sorted by team name (no team last) then name: name, role badge (outline, lower-case role), red "inactive" badge, "Home store: `name|none set`" (+ " · `Name`'s team" / " · No supervisor" for admins), and either the allocated stores as brand badges or "No extra stores allocated — only the home store."
- **Allocate stores** (outline, store icon) opens a two-column grid of every active outlet as toggle tiles (check box, name, address; the home store says "Home store — always included"). **Cancel** / **Save N store(s)** ("Saving") → PUT `/api/admin/assignments` `{user_id, outlet_ids}` (admins and supervisors; RLS and the route keep supervisors to their team). Success "`Name` now covers N|no allocated store(s)."; errors "Those stores could not be saved."
- Empty: "Nobody to allocate stores to." or "Nobody matches."

The home store is set on the Staff page, not here, and always counts as allocated.

Effect on store visits (migration 060): once a person has at least one allocated store (an active store in `staff_outlets`), their phone's store picker lists only their allocated stores plus their home store (`my_visit_stores()`), and the database refuses a check-in at any other store, picked or recognised by location: "This store is not on your list. Ask your supervisor to add it." Someone with no allocation keeps checking in anywhere.

### Supervisor differences

Only their team; no team chips. They can save allocations for their people.

### Acceptance checks

- Opening Allocate stores pre-ticks the person's current allocated stores; saving with none shows "… now covers no allocated stores."
- The home store tile says "Home store — always included".
- A supervisor sees no team chips and only their team.
- After allocating one store to a marketer who had none, their phone's "Pick the store myself" lists that store and their home store only.

---

## 24. Notifications — `/admin/notifications`

Files: `src/app/admin/notifications/page.tsx`, `src/components/admin/notification-composer.tsx`, `notification-history.tsx`, `notification-tools.tsx`; logic `src/lib/notification-log.ts` (pure), sending `src/lib/notification-send.ts`. Data (migration 053): view `notification_log`, `notification_deliveries`, `notification_templates`, `scheduled_notifications`, RPC `resolve_notification_targets(p_audience, p_detail)`. Title "Notifications — Xtend".

Heading **"Notifications"**: "Send a push notification to staff phones, now or at a set time." + (supervisor) "As a supervisor you can reach the staff in your own team." / (admin) "You can reach everyone, a role, an outlet, or named people." + " Below, see who got each one, who read it in the app, and send it again to anyone it missed."

If the log view is missing: warning "The history, templates and scheduling need the support and notifications update (053) run in Supabase. You can still send now."

### Query parameters (`parseNotificationFilter`)

| Param | Values | Default |
|---|---|---|
| `kind` | `message` (Messages), `support` (Support replies), `alert` (Automatic alerts: no sender, or `audience_detail.system = true`; the clock-out reminders "Time to clock out" / "You have not clocked out yet" of migration 0061 land here), `all` | `message` |
| `q` | search words (≤ 80) in title, message, sender | none |
| `days` | 7, 30, 90 | 30 |
| `n` | id of the history item opened | none |
| `reuse` | id of an earlier message to copy into the composer | none |

### What loads

Active profiles (id, name, role, outlet), active outlets, `notification_log` since `days` ago (newest first, limit **1000**; note "Showing the newest 1,000. Pick a shorter time to see fewer."), templates by title, scheduled notifications that are `scheduled`/`sending`, or `failed` in the last 7 days (by send time, limit 50), and `resolve_notification_targets('everyone', {})` — everyone the viewer can reach with their device counts.

### Figures (2 / 5 columns; this week = last 7 days, messages only)

- **Sent this week** — "messages from the office".
- **People reached** — delivered, "of N aimed at".
- **Delivery rate** — delivered / recipients % (red under **80 %**).
- **Read in the app** — read / delivered %, "of those delivered".
- **Notifications off** — field staff with 0 devices, "of N field staff" (red if > 0).

When anyone is off: a collapsible "**N field staff will not get notifications** · see who" with "They have no phone with Xtend notifications turned on. Ask them to open Xtend and allow notifications; until they do they cannot clock in (unless excused) and will not hear from the office." and name chips "Name · store".

### Composer (`NotificationComposer`, anchor `#compose`)

- **Start from a template** chips (tooltip = body) fill title and message.
- **Title** (≤ 80, "Stock delivery today"), **Opens at** select: Home (clock in) `/field`, Daily report `/field/report`, Stock count `/field/count`, Support `/field/support`, History `/field/history` (default `/field`).
- **Message** (≤ 400, "The Ikeja delivery lands at 2pm. Please be on the floor to receive it."), a counter "n/400", and **Save as a template** (when title set and message ≥ 2 chars) → POST `/api/admin/notifications/templates`; "Saved “title” as a template."
- **Send to** chips: **Everyone**, **By role** (Merchandisers / Marketers / Supervisors / Admins), **By outlet** (active outlets), **Specific people** (search "Find a name", "N picked", **Clear**, a checkbox list scrolling after 224 px with role badges; "No one by that name.").
- **When** chips **Now** / **Later**. Later shows **Day** (min today) and **Time** (default 07:45), "Quick:" buttons **Today|Tomorrow 7:45**, **8:00**, **1 pm**, **4 pm** (today when at least 5 minutes ahead, else tomorrow), and "Goes out within five minutes of the time, Lagos time. Who gets it is fixed now, with the people this audience reaches today."
- A grey bar: "**N** recipients · **M** with notifications on" (or "Working out who this reaches…"), **See who** / **Hide names**, and the send button **Send notification** / **Schedule** ("Sending…"/"Scheduling…"). Disabled until title and message are filled, at least one recipient, and (Later) a time.
- The recipient preview re-runs whenever the audience changes (not when typing): POST `/api/admin/notifications` with `preview: true`.
- "See who" lists recipients ("name · store") with a warning "Off" badge for those without devices; a note "N of these has/have not turned notifications on for any device, so they will not receive it. They are still recorded in the history, and you can send it again to them later."
- Validation: title via `thingName(80)`, message via `writtenText(400, 2)`; schedule must be at least **5 minutes** ahead ("Pick a time at least 5 minutes from now.", `MIN_AHEAD_MIN`) and within **60 days** ("Pick a time within the next 60 days.", `MAX_AHEAD_DAYS`), "Pick a day and a time." The database itself refuses under 2 minutes.
- Results: "Sent to D of R.[ N had notifications off.][ F failed.]" or "Scheduled for `date time` to N people. You can cancel it below until then."
- **Manage templates** (collapsible; admins see all, others their own): title, body, bin (DELETE `/api/admin/notifications/templates?id=`).
- `?reuse=<id>` pre-fills title, message and (if it is one of the pages) "Opens at" from that message.

### Scheduled (only when any)

Card **"Scheduled"** / "Waiting to go out. Cancel one, or send it now instead." Each: title, "`date time` · to `audience` (N) · by `you|name`", a badge — **Waiting**, **Late** (red; when still scheduled more than **15 minutes** after its time, with "This should have gone by now. The five-minute job may not be running: send it now, and tell whoever looks after the server."), **Sending**, **Not sent** (failed, with the error) — and for the creator or an admin **Send now** and **Cancel** → POST `/api/admin/notifications/scheduled/<id>` `{action: 'send_now'|'cancel'}`; "Cancelled. It will not be sent." / "Sent to D of R."

### History

Card **"History"** / "Newest first. Open one to see who got it, who read it and who did not." Form: **Search** ("Words in the title or message, sender…"), **Over** (Last 7 / 30 / 90 days), **Show**. Kind chips **Messages**, **Support replies**, **Automatic alerts**, **All** with counts.

Each row (link toggling `n`): date time and the kind (singular), title, two-line message, "To `audience` · by `you|name|the office|Xtend`[ · sent again][ · scheduled]", and a reach block: "**D** of R got it", rate %, a 6 px bar (`#d1511a` on `#f6e4d8`), badges "N read" (success), "N failed" (red), "N off" (warning). Audience words: Everyone, Merchandisers…, the store name, "Ada Okafor and 2 others". Empty: "Nothing sent in this time."

Opened row: the full message; groups **Read it in the app**, **Got it, not opened yet**, **Failed to deliver**, **Notifications off**, each with count and names (or "No delivery record is visible to you for this one."); then for messages the sender (or an admin) can **"Send again to the N who did not get it"** — first checks (preview) and then says "None of the N has notifications on yet. Ask them to turn them on first." or "K of the N now have notifications on and should get it." with **Send again** (disabled at 0) and **Not now**; result "Sent again: D of R got it this time." (`resend_of` marks it). **Use again** (ghost) opens `?reuse=<id>#compose`.

### Supervisor differences

They can only reach their own team (the RPC decides); the audience chips are the same but resolve to their team. They manage only their own templates and scheduled items and can resend only their own messages.

### Acceptance checks

- Choosing "By role" → Marketers updates the recipient count without typing anything.
- Scheduling for 3 minutes from now is refused with "Pick a time at least 5 minutes from now."
- A scheduled item 20 minutes past due shows a red "Late" badge and the explanation.
- Opening a sent message lists names under the four groups; "Send again" appears only when someone missed it.
- "Use again" fills the composer with the old title and message.

---

## 25. Outlets — `/admin/outlets` (and `/admin/outlets/import`)

Files: `src/app/admin/outlets/page.tsx`, `src/app/admin/outlets/import/page.tsx`, `src/components/admin/outlet-manager.tsx`, `store-importer.tsx`; geocoding `src/lib/geocode.ts`; the July stockist list `src/lib/stockists-july.ts`. Title "Outlets — Xtend".

Heading **"Outlets"**. Admin intro: "The geofence radius is per outlet: a mall kiosk is not a standalone store." Supervisor intro: "The stores field staff work in. Only an admin can add or change them." Admins also get an outline button **Add stores in bulk** → `/admin/outlets/import`.

Loads `outlets` (id, name, address, lat, lng, geofence_radius_m, shift_start, shift_end, is_active, created_at) by name — RLS narrows what a supervisor sees — and active profiles' `outlet_id` to count staff per store.

### Add / edit (admins)

**Add outlet** (plus icon; becomes **Cancel**). Form (4 columns on `lg`):

- **Name** (required, ≤ 160, "Justrite Ogba"), **Address** (≤ 400, "124 Oba Akran Ave, Ogba, Lagos").
- **Latitude**, **Longitude** (required, decimal).
- **Geofence radius (m)** (required, 25–2000, default **150**).
- **I am standing here** (crosshair; "Reading…" while busy): reads the browser position (`enableHighAccuracy`, timeout **15 s**, `maximumAge: 0`), fills lat/lng to 6 decimals, warns "Your location is only accurate to N m. Step outside and try again, or the fence will be in the wrong place." when accuracy > **100 m**, then asks `/api/geocode?lat&lng` and fills an empty name and address from the answer. Failure: "Could not read your location. Type the coordinates instead."
- **Clock-in time** (default 08:00) and **Clock-out time** (default 18:00) — the store's `shift_start` and `shift_end`, against which lateness and early clock-outs are judged.
- **Create outlet** / **Save changes** ("Saving…") → POST `/api/admin/outlets` or PATCH `/api/admin/outlets/<id>`. Errors from the field rules or "That outlet did not save."

### Cards (1 / 2 / 3 columns)

Name, address (—), a badge **Inactive** (outline), **No location yet** (warning, when `lat` is null), or **Active** (success); facts "Geofence: N m", "Shift: 08:00–18:00", coordinates to 5 decimals or "Pinned from a clock-in, on Places", "Staff: N". Admins: **Edit** (opens the form filled), **Deactivate** / **Reactivate** (PATCH `{is_active}`, no confirmation), and a trash icon → inline confirm **"Delete this outlet for good?"** (**Delete** / **Cancel**) → DELETE `/api/admin/outlets/<id>`. An outlet with visit, stock-count or metrics history (ON DELETE RESTRICT) is refused with "This outlet has visit, stock-count or metrics history, so it cannot be deleted. Deactivate it instead." (HTTP 409); its allocations cascade away and attendance/thread references are nulled.

When there are more than 4 outlets, a **search** box ("Search outlets by name or address") filters the cards client-side by name or address; "No outlets match your search." when none do.

### Add stores in bulk — `/admin/outlets/import` (admins only)

Title "Add stores — Xtend". Heading **"Add stores in bulk"**: "Load the July customer list, or paste your own — names and addresses are enough. Xtend looks up the coordinates for each one and shows you where it landed before anything is saved." Button **Back to outlets**.

- **Find the July stockist list on the map** loads `/api/admin/outlets/stockists` ("Loading the list").
- A textarea "One store per line — name, then the address" (sample placeholder lines like "Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos").
- **Geofence radius (m)** (max 2000, default 150), **Shift start** (08:00), **Shift end** (18:00), **Or upload a CSV** (needs a "name" column: "That file has no "name" column with store names in it.").
- **Find these on the map** ("Looking up each address") sends lines in chunks of **25** to POST `/api/admin/outlets/import` (preview), with a progress bar "done of total". Then **Import N store(s)** ("Importing") commits. A partial failure says "<error> after N of M."
- Preview text: "N of M ready to import." / "Result of the import." + "Check anything marked **Street only** — the pin is on the road, not the shop door, so widen the radius or set the coordinates by hand afterwards." Table: Store, Where it landed, Coordinates (5 decimals), Accuracy (Shop pinned / Street only / OpenStreetMap / Coordinates given), Status ("Ready" brand, "Added" success, or the problem).

### Supervisor differences

Read-only cards; no form, no buttons, no bulk import (`requireSession(['admin'])` there).

### Acceptance checks

- A supervisor sees cards with no Edit/Deactivate and no "Add outlet".
- Saving a radius of 10 is refused (minimum 25).
- An outlet without coordinates shows "No location yet" and "Pinned from a clock-in, on Places".
- "I am standing here" indoors with 300 m accuracy fills the numbers but shows the accuracy warning.

---

## 26. Places — `/admin/places` (admins only)

Files: `src/app/admin/places/page.tsx`, `src/components/admin/place-manager.tsx`, `place-dues.tsx`. Data: view `known_place_detail` (migrations 024, 025, 034), outlets without a location, view `place_naming_due_detail` (045). Title "Places — Xtend".

Heading **"Places"**; intro: "Places Xtend has learned. When someone clocks in or checks in somewhere no store, learned place or map can name, they must add it before they go on: standing outside, they type the name on the sign, take a photo of the building with the sign and a selfie holding one of our products, both live in the app, and the phone's GPS gives the position. Next time anyone stands there, Xtend recognises it. Check the names against the photos, correct any that are wrong, or turn a place into one of your stores. Stores added without a location get it here: when someone allocated to one clocks in away from their other stores, the spot is listed with the stores it could be, and you confirm which."

Load error: "Places could not be loaded. Has migration 024 been run in Supabase?"

Photos (shop front and selfie) are signed with the service role from bucket `reports` for 1 hour (max 500); without the key the list shows without photos.

### Places staff had to add (only when any in the last 7 days; up to 200)

"Last 7 days. N still waiting. | None waiting. Dismiss one only when it was not a shop or plaza: the person can then carry on." Each: name · "store check-in" or "clock-in" · time · **Map** link; then a badge "Added: `place` | inside a store" (success), "Dismissed by `name`: reason" (outline), or **Waiting** (warning) with **Dismiss** → an input "Why? e.g. clocked in at the depot gate" (≤ 300; tick enabled from 3 characters) → POST `/api/admin/places/due/<id>` `{reason}`.

### Place list (`PlaceManager`)

No places: info "No places learned yet. They appear here as staff clock in and check in at places that are not one of your stores."

Chips: **Store locations to confirm (N)** (shown when there are candidate spots or stores waiting; default view when any spot has candidates), **Names to check (N)** (unverified, named by staff; default otherwise), **All places (N)**; search "Find a place" (name or address). Places are read unverified first, then most recently seen (limit 1000).

Each place card:

- Name (+ brand tick when verified), address, "`source`[ (`named by`)] · seen N time(s) · last `date time` · R m around · N person/people". Source words: Named by Google, Named by OpenStreetMap, Named by staff, Added by an admin, Seen at a clock-in.
- "Clocked in here: names" for clock-in spots.
- Red warning when unverified, only ever visited by its namer and seen ≥ **3** times: "Only ever used by the person who named it. Check the photo before verifying."
- Links **Photo of the place**, **Selfie with product**, **See on map**.
- For spots with candidate stores (or clock-in spots when stores are waiting): a select "Which store is this?" with optgroups "Allocated to whoever clocked in here" and "Other stores with no location" (preselected when there is exactly one candidate), and **Confirm store location** → confirm "Is this where `Store` is? Check the map first. Clock-ins there will be measured against this spot from now on." → POST `/api/admin/places/<id>/pin` `{outlet_id}`; "`Store` now has its location."
- A name input (≤ 120) and a button **Verify** / **Verified** / **Save and verify** (when the name was changed; needs ≥ 2 characters) → PATCH `/api/admin/places/<id>` `{name, verified: true}`; "\"Name\" is verified."
- **Make it a store** (outline) → confirm "Make "Name" one of your stores? Staff can then be allocated to it." → POST `/api/admin/places/<id>/store`; "\"Name\" is now a store."
- A red bin → confirm "Forget "Name"?" → DELETE `/api/admin/places/<id>`; "\"Name\" was removed."

Empty lists: stores view "N store(s) is/are waiting for a location. Spots appear here when staff allocated to them clock in." or "Every store has its location."; names view "No names waiting to be checked."; all "No place matches."

### Acceptance checks

- A supervisor opening `/admin/places` is redirected to `/`.
- A staff-named place seen 3 times only by its namer shows the red warning.
- Changing the name text switches the button to "Save and verify".
- Confirming a store location gives that outlet coordinates and removes its "No location yet" badge on Outlets.

---

## 27. Audit log — `/admin/audit` (admins only)

Files: `src/app/admin/audit/page.tsx`; logic and download `src/lib/audit-log.ts` (pure helpers tested by `scripts/check-audit.ts`); writing `src/lib/audit.ts` and `src/lib/audit-context.ts`. Data: view `audit_log_detail`. Title "Audit log — Xtend". `requireSession(['admin'])`.

Heading **"Audit log"**: "Every change an admin or supervisor makes, newest first: who, what, where they were and on what device. Location comes from the browser when it was allowed, otherwise roughly from the IP address. Rows are written by the server and the database, never by the browser."

### Filters (`parseAuditFilter`)

| Param | Field | Notes |
|---|---|---|
| `person` | "Who": **Everyone** + admins and supervisors | uuid |
| `group` | "What": **All actions** + groups: Staff accounts, Teams and stores, Roles, Stores, Places, Stock counts, Notifications, Support, Alerts, Exports, X Metrics, Updates, Other | by action prefix  (`ACTION_GROUPS` in `src/lib/audit-log.ts`). `schedule.*` and `leave.*` (059) have no group of their own and fall under Other; `export.marketer_report.*` is under Exports |
| `from`, `to` | dates (max today), Lagos midnight bounds | none |
| `q` | "Search", "Name, store, IP, device…" — matches action, label, actor, table, place, IP, device, meta JSON | ≤ 120 |
| `flagged=1` | checkbox **"Only VPN, new device or new location"** | off |

**Show**; "Quick:" Today, Last 7 days, Last 30 days; **Clear** (→ `/admin/audit`) when anything is set; "**Download:**" Excel / PDF / Word / CSV → `/api/admin/export/audit/<fmt>?<query>` (admin only).

Reading: up to `3 × 400` = **1200** rows (max 3000) newest first for the person and up to `to`, so that "new device / new location" can be judged against earlier history; then filtered and cut to **400** shown (`fetchAudit(…, 400)`).

**New device / new location** (`markNew`): walking each person's history oldest first, an entry is a **new device** when its device key (type | OS | app or browser) was not seen before (never on their first entry); a **new location** when it has a precise browser location and every earlier precise spot is more than **30 km** away (`NEW_PLACE_KM`). IP-based locations never count.

Load failure: "Could not load the audit log: <message>".

### Figures (2 / 4 columns)

**Actions** (note "newest shown" when cut), **With a location** ("P%"), **Devices used** (distinct device labels), **VPN or new device / place** (warning colour if > 0).

### Entries

Each is a `<details>`: time and the group; the label (e.g. "Added a staff member", "Reset a password", "Allocated stores", "Assigned a supervisor", "Resolved an alert", "Sent a notification", "Published an update", "Logged a supply", "Finalised the grades"; exports read "Exported `what` (Excel)"; X Metrics voids "Voided a `kind`"; unknown actions with dots/underscores as spaces), "`actor | System` · Admin|Supervisor · `meta key: value; …`" (cut at 90 characters), the location ("place" or coordinates to 4 decimals, "About … (from IP)", "Somewhere in `country`", "Unknown") linked to Google Maps when known, the device ("Xtend app on Android 14", "Chrome on Windows" · Phone/Tablet/Computer, or "Unknown device"), and badges **VPN** (red), **New device**, **New location** (warning), **GPS** or **IP location** (outline). Opened: Action (mono), Target (table · id), IP address (country), VPN or datacentre (Yes/No), Location ("lat, lng · from the browser, ±N m" or "from the IP, to about 25 km"), Store or place, Device, App or web, Browser string, and the full meta JSON. Empty "Nothing matches."

### Download

Title "Audit log"; subtitle "`range | All dates` · N actions"; notes "Each action with who did it, where (from the browser when allowed, otherwise roughly from the IP address) and on what device. "New device" and "New location" mark the first time a person acted from that device or more than 30 km from anywhere they had before." Columns When, Who, Role, Action, Target, Location, Accuracy ("~25 km" for IP, "±N m"), Device, IP, VPN, Flags, Detail, Map ("Open map"). File `xtend-audit-log`.

### Acceptance checks

- A supervisor opening `/admin/audit` is redirected to `/`.
- Resetting a password elsewhere adds a "Reset a password" entry at the top with the actor's name.
- An action from a new browser after earlier ones from the app shows "New device"; the person's very first entry never does.
- "Only VPN, new device or new location" hides every unflagged entry.

---

## 27a. Activity log — `/admin/activity` (admins only)

What everybody (staff, supervisors, admins) does in Xtend; the Audit log covers only office changes. Files: `src/app/admin/activity/page.tsx`, view `src/components/admin/activity-view.tsx`; pure logic `src/lib/activity-log.ts` (tested by `scripts/check-activity.ts`); server `src/lib/activity-server.ts` (`recordActivity`, `fetchActivity`); download `src/app/api/admin/export/activity/[format]/route.ts`. Data (migration 062): table `user_activity`, RPC `activity_feed` (admins only; raises "Only admins can see the activity log" for anyone else). Title "Activity log — Xtend". `requireSession(['admin'])`. Menu: Setup group, after Audit log, label **Activity log**, lucide icon `Activity`, adminOnly.

Heading **"Activity log"**: "What everyone does in Xtend — staff, supervisors and admins — newest first, in Lagos time: signing in and out, opening the app, clocking in and out, store visits, reports, counts, leave and support messages, with the device and IP address where known. Only admins can see this page."

### Recording (all server-side or silent; never shown to staff)

| Kind | Where it is recorded |
|---|---|
| `sign_in` | `POST /api/auth/sign-in` after a successful sign-in (service role → `record_activity`) |
| `sign_out` | The two Sign out buttons (`sign-out-button.tsx`, `greeting-header.tsx`) call `POST /api/activity` (`sendActivity('sign_out')`, waits at most 1.5 s) before `auth.signOut()`; `/api/auth/expired` records it with `detail.reason` (`new-day` / `clocked-out`) |
| `app_open` | `<ActivityPing />` (renders nothing) in the field and admin layouts: on mount and whenever the page becomes visible again, at most once per 5 minutes per page; sends `platform` (`nativePlatform()` or `web`) and the app build (`App.getInfo`). The database keeps at most one per person per platform per 30 minutes |
| `password_changed` | `POST /api/auth/password` (the change-password form now posts here; the server calls `auth.updateUser`, clears `must_change_password`, records `detail.first` when it replaced the temporary password) |
| `photo_changed` | Inside `set_my_avatar()` (SQL), with the IP and browser string from PostgREST's `request.headers` |

`POST /api/activity`: `requireApiSession()` (any role), zod `{ kind: 'sign_out' | 'app_open', platform?: 'web'|'android'|'ios', app_build?: int }`. Signing in, passwords and photos are not accepted from the browser. IP from `requestIp` (`src/lib/client-ip.ts`), device from `parseUserAgent` (`audit-context.ts`). Failures are logged and ignored.

### Filters (GET form, `parseActivityFilter`)

| Param | Field | Notes |
|---|---|---|
| `person` | "Who": **Everyone** + every profile ("Name (Role)") | uuid |
| `group` | "What": **All activity**, Signing in and out, Opening the app, Clocking in and out, Store visits, Reports and counts, Leave, Support messages, Password and photo (`ACTIVITY_GROUPS`) | sent to the RPC as `p_kinds` |
| `from`, `to` | dates, never after today; default today; swapped if reversed; at most **92 days** (`MAX_RANGE_DAYS`, the start is moved) | Lagos days |

**Show**; "Quick:" **Today**, **Yesterday**, **Last 7 days**, **Last 30 days** (the active one filled brand); **Clear** (→ `/admin/activity`) when not the default; "**Download:**" Excel / PDF / Word / CSV → `/api/admin/export/activity/<fmt>?<query>`. Reads up to **2000** rows (downloads 5000) newest first; "Showing the newest N entries…" when cut.

Missing migration: "Could not load the activity log. The activity log needs migration 062 (supabase/migrations/0062_user_activity.sql). Run it in Supabase, then reload."

### Figures (2 / 4 columns)

**People active** (note "N actions in all"), **Sign-ins**, **App opens** ("At most one per 30 minutes"), **Most active** (name, "N entries"). "Actions" = everything except sign-in, sign-out and app open.

### By person

Busiest first (then latest). Phone: a list; ≥ 640 px a table: Person (links to `?person=`) and role, First, Last, Sign-ins, App opens, Actions, Last device (device; platform · IP), See: **Movement** (`/admin/tracking?person=&date=from&until=to`) and **Attendance** (`/admin/attendance?user_id=&from=&to=`).

### Timeline

Grouped by Lagos day (heading "Thursday, 22 October 2026", "N entries"), newest first. Each line: time (HH:MM), a dot coloured by group (brand palette), name (role), the label · plain detail ("on site · 12 m from the store", "45 min in the store", "14 products", "Annual leave, 10 Nov to 12 Nov", "“subject”", "app build 131", "a new day"), and "device · platform · IP x" when known. On ≥ 640 px the Movement / Attendance links for that day sit on the right. Empty: "Nothing matches."

Labels (from SQL): Signed in; Signed out; Signed out (login expired); Opened the app; Changed their password; Changed their profile photo; Clocked in at `store`; Clocked out at `store`; Checked in at `store`; Checked out of `store`; Filed the daily report; Submitted a stock count at `store`; Submitted an X Metrics count at `store` (voided); Logged the day's sales at `store` (voided); Asked for leave; Cancelled a leave request; Sent a support message.

### Download

Through the shared renderer (§29). Title "Activity log"; subtitle "`range` · `Everyone | name` · `All activity | group` · N entries"; notes summarise people, sign-ins, app opens and other actions and the 30-minute rule. Columns When, Person, Role, What, Detail, Platform, Device, IP address. File `xtend-activity-log`. Audited as `export.activity.<fmt>` with the filter and row count.

### Acceptance checks

- A supervisor or a field worker opening `/admin/activity` lands on `/`; `activity_feed` raises for them.
- Signing in on the Android app adds "Signed in" with "Xtend app on Android … · Android app · IP …".
- Opening the app twice within 30 minutes adds one "Opened the app".
- Nothing in the staff app or the staff or supervisor guides mentions this page.

---

## 28. Updates — `/admin/updates` (admins only)

Files: `src/app/admin/updates/page.tsx`, `src/components/admin/update-tools.tsx`; logic `src/lib/app-update.ts`, `src/lib/app-release.ts`. Data (migration 057): `app_releases`, `app_installs`, `app_minimum_builds`. Environment: `NEXT_PUBLIC_BUILD_ID`, `ANDROID_APK_URL`, `ANDROID_LATEST_BUILD`, `IOS_LATEST_BUILD`, `IOS_APP_URL`. Title "Updates — Xtend".

Heading **"Updates"**: "Xtend updates itself: every phone and browser runs the live site, and anyone with Xtend open is told when a newer version is ready (“A new version of Xtend is ready”) and moves to it with one tap. A new phone app is only needed when something on the phone itself changes; then they are offered the download, or required to install it if you set the lowest app allowed. Publish a short “What's new” so people know what changed."

Load failure: "The updates could not be loaded. Has migration 057 been run in Supabase?"

### Figures (2 / 4 columns)

- **Site version live** — first 10 characters of `NEXT_PUBLIC_BUILD_ID` ("Changes with every deploy").
- **Newest Android app** — the published APK's version, or "build N" from `ANDROID_LATEST_BUILD`; note "Lowest allowed: build N" or "No lowest build set". (When `ANDROID_APK_URL` is not set, the page looks up the published APK itself.)
- **iPhone app** — "build N", "Published" (when `IOS_APP_URL`), or "Not yet"; same note.
- **On an older app** — older app + must update (warning when > 0), note "N must update".

### Publish what's new

Card "**Publish what's new**" / "Shown once to each person, the next time Xtend opens or comes back to the screen after the update." Fields: **Title** (≤ 120, required, "e.g. Location now works with the app closed"), **What changed (shown once to each person)** (≤ 3000, 5 rows, placeholder with "- " points), **Who sees it** (Everyone / Field staff / Office (admins and supervisors)), **Lowest Android app allowed** and **Lowest iPhone app allowed** (digits only; placeholder "e.g. <latest>" or "Build number"), checkbox **Required:** "anyone still on an older version must update before they can carry on. Use it when the old version would record something wrong.", checkbox "Also send it to their phones as a notification." When a lowest build is typed, a warning box: "Anyone on an older phone app will be asked to install the new one before carrying on. Only set this when the new app is already on the download page." **Publish** ("Publishing…") → POST `/api/admin/updates`; "Published.[ Sent to N phone(s).] People see it the next time Xtend opens or comes back to the screen."

### Published

Card "**Published**" / "The newest live one is what people see." (30 newest): title, audience badge, **Required** (red), **Android ≥ N** / **iPhone ≥ N** (warning), **Withdrawn** (outline; row faded), notes (3 lines), time, and **Withdraw** (confirm "Withdraw this? Its notes stop showing and any lowest app build it set no longer applies." → DELETE `/api/admin/updates/<id>`). Empty "Nothing published yet."

### Who is on which version

Card with the sentence "Recorded each time someone opens Xtend. a up to date, b not reloaded onto the newest site yet (it happens by itself next time they open it), c on an older app, d below the lowest app allowed." Chips **Everyone (N)** and **On an older app (N)** (`?show=behind`), and **Remind N to update** (bell) → POST `/api/admin/updates/remind` `{user_ids}`; "Sent to N phone(s)." or the error.

One row per person and platform from `app_installs` (2000 newest; inactive people dropped; the browser row only for people who never used the app): Person (name, role), On (Android app / iPhone app / Browser), App version ("1.4.0 (build 23)", "Before updates were tracked", or — for browser), Last opened, Status:

| Status (`installStatus`) | Rule | Badge |
|---|---|---|
| Must update | app build below the platform's lowest allowed | red |
| Older app | app build below the latest known build | warning |
| Not reloaded yet | the page build differs from the live build | outline |
| Up to date | otherwise | success |

Empty: "Nobody is on an older app." / "Nobody has opened Xtend since this was set up."

### Acceptance checks

- A supervisor opening `/admin/updates` is redirected to `/`.
- With the lowest Android build set to 20, a phone on build 18 shows "Must update" and counts in "On an older app".
- Typing a lowest build shows the warning box before publishing.
- Withdrawing asks for confirmation and fades the row with a "Withdrawn" badge.

---

## 28a. System — `/admin/system` (admins only, migration 0066)

Test mode, resetting the test run, and going live. Code: `src/app/admin/system/page.tsx`, `src/components/admin/system-reset.tsx` (`ResetPanel`, `FinishFiles`, `GoLivePanel`), `src/lib/system-reset.ts` (categories, dependencies, confirmation words, summary; pure), `src/lib/system-reset-server.ts` (password check, service client with audit context, file removal, left-over sign-ins). Rules and the WIPE/KEEP list: `30-rules.md` "Test mode and reset".

**Banner**: while `system_settings.test_mode` is true, the admin layout (admins only; skipped for supervisors, and RLS hides the row from everyone but admins) passes `testMode` to `AdminFrame`, which renders a full-width link to `/admin/system` above the workspace: dark orange (`bg-brand-deep`), white bold xs/sm text, flask icon, **"Test mode: records can be reset"**. No table (0066 not run): no banner.

**Page** (heading **"System"**, intro "Test mode lets you try Xtend out in different places, then clear the test records and start afresh. When you are ready for real work, turn test mode off."). Reads `system_settings` (maybeSingle) and `reset_files_pending()` through the user's session; names for `went_live_by`/`last_reset_by` from `profiles`. Missing row or error: "The system settings could not be loaded. Has migration 0066 been run in Supabase?"

1. Status card: flask icon + **"Test mode is on"** ("Records can be reset. Everyone uses Xtend as normal; staff are not told it is a test.") or shield icon + **"Xtend is live"** ("Test mode was turned off <Lagos time> by <name>. It cannot be turned back on, and nothing can be reset."). Under it, when there was one: "Last reset <time> by <name>: everything" or the category labels.
2. When files are still queued (`reset_files_pending() > 0`): card **"Stored files from the last reset"** with `FinishFiles` (warning "N stored files are still to be removed." + outline **"Finish removing files"** → `POST /api/admin/system/reset/files`, repeat until 0, then success "All stored files from the reset are removed.").
3. Test mode on only: card **"Reset test records"** with `ResetPanel`, and card **"Go live"** with `GoLivePanel`. When live, neither is rendered (the reset disappears for good).

**ResetPanel — choose**: a bordered checkbox row **"Select everything (start completely fresh)"** ("Only admin accounts, the product list and settings are left.") that ticks or clears all; then the 14 categories as checkbox cards (two columns from `md`), each with label and one-line description (`RESET_CATEGORIES`). A category brought in by another is shown ticked, disabled, with **"Included because you chose <label(s)>."**; a chosen category with dependencies shows its note ("Staff accounts also clears everything they recorded…", "Stores also clears the visits, counts, X Metrics records and allocations for those stores…"). Button **"Review what will be deleted"** (disabled with nothing chosen) and "N of 14 areas chosen."

**ResetPanel — confirm**: red-tinted box "This will be deleted for good" (or "Everything below will be deleted. Xtend starts completely fresh.") listing each resolved category with its description and "Stored files: …"; a box **"This stays"** listing `ALWAYS_KEPT` and every category not chosen (the audit log "(with one new row recording this reset)"; with staff chosen, each kept category adds "(except what belonged to the staff removed)"); inputs **"Type RESET to confirm"** and **"Your password"** (current-password); red **"Reset now"** (enabled only when the word matches, case and spaces forgiven, and a password is typed) and **"Back"**. While running: "Resetting…" and "This can take up to a minute. Keep this page open." Errors appear in a red alert ("That password is not right.", "Type RESET to confirm.", the database's message).

**ResetPanel — done**: success alert with the headline (`resetSummary`: "Xtend is empty again: N records removed, including M staff accounts. Only admins, products and settings are left." or "N records removed from K areas…"), one row per category with its count, the files line ("N stored files removed." / "… N still to remove." with `FinishFiles`), and **"Reset something else"**.

**GoLivePanel**: deep-orange **"We are live — turn off test mode"** opens a warning ("This cannot be undone. Once test mode is off, the Reset card disappears for good and nobody can reset Xtend again, not even an admin. Reset the test run first if you have not."), input **"Type WE ARE LIVE to confirm"**, **"Turn off test mode for good"** and **"Cancel"**; success refreshes the page.

**Routes** (all `requireApiSession(['admin'])`):

- `POST /api/admin/system/reset` (`maxDuration = 60`): zod `{confirm, password, categories: (key | 'everything')[] (1–20)}`; `confirm` must match RESET; the password is checked by signing in on a throwaway anon client (no stored session, then a local sign-out), 403 "That password is not right." if not; then `reset_test_data(p_actor, p_categories)` through a service-role client carrying the `x-xt-audit` header (so the database's audit row has place and device). If the result says `auth_fallback`, left-over sign-ins with no profile are deleted with `auth.admin.deleteUser`. Then queued files are removed with the Storage API in batches of 1,000 for up to 40 s from the start. Returns `{result, files: {removed, left, failed}, signInsRemoved, summary}`.
- `POST /api/admin/system/reset/files` (`maxDuration = 60`): removes queued files for up to 45 s; audited `system.reset.files` with `{removed, left}` when it removed any.
- `POST /api/admin/system/go-live`: zod `{confirm}` must match WE ARE LIVE; `system_go_live(p_actor)` (writes the `system.go_live` audit row).

### Acceptance checks

- A supervisor opening `/admin/system` lands on `/`; supervisors and staff never see the banner.
- Ticking Staff accounts shows Clock-ins, Store visits, Daily reports, Stock counts and X Metrics ticked and disabled with "Included because you chose Staff accounts."
- Typing "reset" and the wrong password gives "That password is not right." and nothing changes.
- After a full reset only admins, products and settings remain and the Audit log shows one "system.reset" row.
- After going live the banner, the Reset card and the Go live card are gone and cannot come back.
- The page works at 390 px with no sideways scroll.

---

## 29. The shared export renderer — `src/lib/export/render.ts`

Every download in the dashboard (attendance, analytics, movement, visits, coverage, alerts, integrity, audit, X Metrics, Ask Xtend reports) builds one format-independent `Sheet` and hands it to `renderExport(format, sheet)`. The route always passes the same filter as the page, audits the download (`export.<…>.<fmt>`), and reads through the caller's session so a supervisor's file holds only their team.

`Sheet` fields: `title`, `subtitle`, optional `notes` (prose, `\n`-separated), optional `wrap`, `sheetName`, `columns`, `rows` (`{values: string[], link?: string|null}`), `widths: {xlsx: number[] (characters), pdf: number[] (points)}`, optional `linkColumn` / `linkText` / `noLinkText`, optional `statusColumn`, `fileBase`.

Formats (`format` path segment): `xlsx`, `docx`, `pdf`, `csv`; anything else → 400 "Unsupported export format".

Common to all: file name `<fileBase>-<YYYY-MM-DD>.<ext>` (UTC date of making), `Content-Disposition: attachment`, `Cache-Control: no-store`.

| Format | Layout rules |
|---|---|
| **CSV** | Header row then rows; every value in double quotes with `"` doubled; CRLF line ends; a UTF-8 BOM first (so Excel on Windows reads it as UTF-8). Links are not special: the link column holds whatever text the row has (e.g. the URL itself, or "deleted after 24h"). No title or notes. |
| **XLSX** (exceljs, creator "Xtend") | If `notes` exist, a first sheet **"Summary"** (column A width 110): the title bold 14 pt, the subtitle italic grey `#6B6B72`, a blank row, then one wrapped row per notes line. Then the data sheet named `sheetName`: header row filled brand `#C1572A` with bold white text, frozen (first row), autofilter over the header, column widths from `widths.xlsx` (default 18). Link cells become hyperlinks with `linkText` (default "Open selfie") in `#C2410C` underlined. When `statusColumn` is set, any value other than `on_site` is bold red `#B91C1C`. |
| **DOCX** (docx) | Heading 1 = title; an italic 8 pt subtitle; each non-empty notes line as a 10 pt paragraph; then a full-width table with a repeating bold 8 pt header row and 8 pt cells; link cells are hyperlinks with `linkText`. |
| **PDF** (pdf-lib, Helvetica) | A4 **landscape** (842 × 595 pt), margin 24. Each page: title bold 12 pt, subtitle 7 pt grey, then the header row in bold. **Notes on the first page only**, 9 pt, line height 12, wrapped to the page width, blank lines as half gaps. Body text 7 pt, line height 11, column widths from `widths.pdf` (default 60). Without `wrap`, and always for the header and link column, a cell is cut to fit with "…". With `wrap`, cells word-wrap (long words broken) to at most **8 lines**, the eighth ending "…", with 3 pt between rows. The link column prints `linkText` in blue with a real clickable link annotation, or `noLinkText` (default "expired") in grey. The status column prints red when not `on_site`. Text is made WinAnsi-safe: "₦" becomes "NGN ", other characters outside Latin-1 and common punctuation are dropped, whitespace collapsed. New pages start when the next row would cross the bottom margin. |

### Acceptance checks

- Every download link on every page produces a file named `<base>-<date>.<ext>` with the page's filter applied.
- An xlsx with notes opens on a "Summary" sheet; the data sheet's header is orange with white text and stays frozen while scrolling.
- A CSV with Yoruba or Igbo names opens correctly in Excel (BOM present).
- A PDF of a long attendance range continues on new landscape pages with the header repeated, and its "Map" cells are clickable.

---

## 30. The shared UI kit — `src/components/ui`

Small, unstyled-library-free components (Tailwind + `class-variance-authority`), shared by the field app and the dashboard. Colours come from CSS variables (brand orange, tint, muted, success, warning, destructive, card, canvas). Utility classes used throughout: `surface` (white rounded card with border and soft shadow), `brand-surface` (brand gradient), `hatch` (diagonal white stripes over a fill), `icon-tile`, `shadow-soft`, `shadow-lift`, `animate-fade-up`.

| Component | Variants / behaviour |
|---|---|
| `Button` (`buttonVariants`) | variants `default` (brand fill, lift shadow, hover deep brand), `deep`, `destructive`, `outline` (bordered white, tint on hover), `secondary` (tint), `ghost` (muted text, tint on hover), `onBrand` (translucent white), `link`; sizes `default` 44 px rounded-2xl, `sm` 36 px rounded-xl xs text, `lg` 48 px, `xl` 56 px, `pill` 36 px full round, `icon` 40 px square, `iconSm` 36 px square. Links styled as buttons use `buttonVariants(...)`. |
| `Badge` | `default` (tint), `brand` (filled), `success`, `warning`, `destructive` (light tinted fills with coloured text), `outline` (border, muted text), `onBrand`. Small rounded pill. |
| `Alert` | `default`, `info` (tint), `success`, `warning`, `destructive`; `role="alert"` + `aria-live="assertive"` for destructive, otherwise `role="status"` polite. |
| `Card`, `CardHeader` (p 20 px, pb 12), `CardTitle` (base bold), `CardDescription` (sm muted), `CardContent` (p 20, pt 0), `CardFooter` | Card = `surface`. |
| `Chip`, `ChipLink` | 36 px full-round pill; active = brand fill with lift shadow, inactive = tint; `aria-pressed`; press scales to 95 %. |
| `Input`, `Textarea`, `Select` (native `<select>`), `Label` | Rounded, bordered, brand focus ring. |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | Wrapped in a horizontal scroller; head cells 40 px, xs uppercase muted, wide tracking; rows bordered with a faint hover; cells px 12, py 10. |
| `Skeleton` | Pulsing muted block for loading. |

Page-level conventions built on the kit, used by almost every dashboard page:

- A page is `space-y-5`: an h1 (`text-xl font-semibold`, Overview and Movement larger) and a muted intro paragraph, then filters, figures, sections.
- Filters are a plain GET `<form>` so the URL holds the whole view and downloads match the screen; a "Quick:" row of preset pills; a "Clear" text link; a "Download:" row of four format pills (Excel, PDF, Word, CSV).
- Figures are `surface` tiles: xs muted label, xl extra-bold tabular value (red when a warning), optional 11 px note.
- "Worth a look" blocks are destructive `Alert`s headed "Worth a look" with a bullet list and links to the next page to check.
- Every page works at 390 px wide: tables turn into cards or scroll horizontally; filter fields go full width.



### Responsive navigation and summary controls (2026-10-19)

The desktop header wraps when space is tight. Mobile navigation uses a disclosure
button with aria-controls and ordinary navigation links (not an ARIA application
menu). It closes on a chosen link, outside pointer press, route change or Escape;
Escape restores trigger focus. Supervisor links remain role-filtered. Mobile
sign-out, menu links and Add staff have 44px minimum touch targets. Overview
summary notes wrap rather than truncate; below 380px the three figures stack.
