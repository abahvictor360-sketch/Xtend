# 30 — The rules

This file explains, in plain English, every business rule Xtend enforces:
what it is, the exact numbers, why it exists, and which SQL function,
trigger or source file implements it. It does not restate DDL: the rebuilt
app applies `docs/rebuild/generated/schema.sql` verbatim, and that dump
already contains every table, constraint, trigger, function, view and RLS
policy described here. Use this file to write route handlers and screens
that call those database objects correctly, and to understand what the
database will refuse and why.

Migration numbers (`0001` to `0061`, no `0051`) say where a rule came
from. Where a function was redefined, the latest migration named is the one
in force.

---

## 0. Conventions that every rule assumes

- **Time zone of record is Africa/Lagos**, which is UTC+1 all year with no
  daylight saving. Every day boundary, "today", "late", "month end" and
  display time is Lagos time (`src/lib/utils.ts`: `TZ`, `formatLagos`,
  `lagosDateString`, `addDays`).
- **The business date** is `public.business_date()` =
  `(now() at time zone 'Africa/Lagos')::date`. The server's clock decides
  it. The phone's clock is never trusted for "which day".
- **The client sends only what it observed**: coordinates, accuracy, photo
  path, device info, capture time. `BEFORE INSERT` triggers overwrite
  `user_id`, `created_at`, `attendance_date`/`visit_date`, outlet snapshot,
  `distance_m` and `status`. Anything the client sends in those fields is
  ignored, so route handlers should not accept them at all.
- **Writes the database must police go through `SECURITY DEFINER`
  functions or triggers.** Tables such as `staff_outlets`,
  `integrity_flags`, `store_counts`, `xm_*`, `scheduled_notifications`,
  `tracking_tokens`, `photo_checks` have no insert policy for
  `authenticated`; only the named function (or the service role) writes them.
- **Errors.** A message raised on purpose by a Postgres function has
  SQLSTATE `P0001` and is written for people: pass it to the user
  (`dbErrorMessage` in `src/lib/auth.ts`). Any other database error is
  logged and replaced with "That could not be saved. Try again." A refusal
  whose `hint` is `place_naming_due` is answered with HTTP **423** and
  `{code: 'name_place'}` (`dbErrorResponse`), so the phone keeps the
  submission and resends it after the place is named.
- **Distances** are great-circle (haversine) metres from
  `public.distance_metres(lat1, lng1, lat2, lng2)` (Earth radius 6 371 000 m).
- **Accuracy ceiling: 100 m.** A GPS fix with `accuracy_m > 100` is "not
  evidence of anything" (`ACCURACY_CEILING_M` in `src/lib/geo.ts`). It is
  `flagged` on clock events and visits, and refused for counts and naming.
- **Supervisors only ever see their own team**, through RLS on the
  caller's own client (`createServerSupabase()`). The service-role client
  (`createAdminSupabase()`) is used only for writes the database cannot do
  as the user (push devices, delivery logs, photo verdicts, background
  pings) and never reaches the browser.
- **Nothing that is a record is edited or deleted**: attendance, visits,
  counts, supplies, sales, audit rows, flags. Mistakes are voided with a
  reason, superseded, or reviewed.
- **Staff are never told how they are monitored.** Messages raised to
  field staff (place naming, photo rejections, the support helper) never
  mention location tracking, integrity checks, alerts, supervisors being
  told, or anything being recorded.

---

## 1. Identity and roles

### 1.1 Profiles

- One `profiles` row per `auth.users` row (same id). `email` is mirrored
  from auth and unique case-insensitively; `phone` is unique when present
  (0002).
- Field rules (0039, `NOT VALID`, so only new or changed rows are checked):
  - `full_name`: 2 to 120 characters, starts with a letter, only letters,
    spaces, `.`, `'` and `-`, at least 2 letters. "Chidi123", "a",
    "http://spam.com" and "....." are refused.
  - `phone`: a Nigerian mobile number stored as `0` + 10 digits matching
    `^0[789][01][0-9]{8}$` (e.g. `08031234567`). `+234…`, 5-digit and
    14-digit numbers are refused by the table; the app normalises before
    saving.
- Sign-in (`src/app/api/auth/sign-in/route.ts`): an email or a phone
  number. A phone is matched against `0…`, `+234…` and `234…` variants of
  an **active** profile, turned into the email on the server, and the
  email is never returned. Every failure says "Those details are not
  correct." Rate limits per 15 minutes: **30 attempts per IP** and **10
  per identifier**, then HTTP 429 "Wait 15 minutes".

### 1.2 Roles

- Built-in roles (`user_role` enum): `merchandiser`, `marketer`,
  `supervisor`, `admin`.
- **Field roles** (`is_field_role`): merchandiser and marketer. They clock
  in and out, are tracked, are counted absent, appear in attendance and
  analytics, and are the only people a supervisor can reach.
- `FIELD_ROLES` in `src/lib/auth.ts` = merchandiser, marketer **and admin**:
  the API roles allowed to use the field app routes (admins can test the
  phone app). Field-only database rules (tracking tokens, absence, push
  requirement) still apply only to merchandiser and marketer.
- `is_admin()` = the caller's role is `admin`. `current_user_role()` returns
  the caller's role. Both are `SECURITY DEFINER` to avoid RLS recursion.
- Merchandiser: one fixed store, the daily clock. Marketer: a round of
  stores recorded as store visits; also files the daily report.
- Daily report (`can_file_report`, 0005): marketers and admins only
  (`REPORTING_ROLES`). Enforced by the insert policy and again in
  `report_enforce` ("Only marketers file the daily report").

### 1.3 Roles an admin adds (`staff_roles`, 0042, 0046)

- An added role has a display name and a `base_role` of merchandiser,
  marketer or supervisor (never admin). Everything the person can do comes
  from the base role; the name is what people see (`roleLabel`, `custom:<id>`
  in reports, `src/lib/staff-roles.ts`).
- Name: 2 to 40 characters, letters, spaces, `&`, `/`, `'`, `-`; unique
  ignoring case and repeated spaces; may not be a built-in name or plural
  (merchandiser(s), marketer(s), supervisor(s), admin(s), administrator).
- Retired with `is_active = false`, never deleted; an inactive role cannot
  be newly given to anyone (users route).
- `profiles_staff_role_sync`: setting `staff_role_id` sets `role` to its
  base; changing `role` on its own clears `staff_role_id`.
- `counts_stock` (default true) decides whether that role takes store
  counts (section 9.6).

### 1.4 Teams and reporting lines

- `profiles.supervisor_id` names the person's supervisor. Trigger
  `profiles_supervisor_check`: nobody supervises themselves ("Somebody
  cannot supervise themselves"); only a supervisor or an admin can be named
  ("That person is not a supervisor").
- `supervises_user(target)` (final form 0017) is true when **all** of:
  the caller's role is `supervisor`; target is not the caller; target is a
  field role; and at least one of:
  1. target reports to the caller (`target.supervisor_id = me`);
  2. the caller has a home outlet and target has the same home outlet;
  3. the caller has a home outlet and target is allocated to it
     (`staff_outlets`).
  Sharing an outlet with an admin or another supervisor never makes them
  your staff.
- Demotion (`release_reports_on_demotion`, 0018): when someone stops being
  supervisor or admin, everyone whose `supervisor_id` pointed at them is
  set to null (shown as unassigned).
- `available_supervisors()`: active supervisors and admins, returned only
  to admins (a supervisor gets an empty list).
- `my_staff()`: an admin gets every profile; a supervisor gets their team
  plus themselves.
- `can_create_staff(role)`: admins create any role; supervisors create
  field roles only (never supervisor or admin), and people a supervisor
  creates report to them (users route).
- `can_edit_staff(target)` = admin or `supervises_user(target)`. The users
  route is stricter for supervisors: they may edit only people whose
  `supervisor_id` is them, and only name, phone, active and a password
  reset; changing email, role, added role, store, supervisor or
  `push_exempt` is admin-only (HTTP 403).
- An admin cannot deactivate their own account or remove their own admin
  role (users route, HTTP 400).

### 1.5 What nobody changes about themselves

`profiles_self_guard` (final 0042): when a non-admin updates their own row,
`role`, `staff_role_id`, `outlet_id`, `supervisor_id`, `is_active`,
`push_exempt` and `avatar_path` are silently put back. The photo changes
only through `set_my_avatar(path)` (0037): the path must be in
`avatars/<own id>/…` ("That photo is not yours") and already uploaded
("Upload the photo first"). `finish_onboarding()` sets `onboarded_at` once
and never clears it.

### 1.6 Active and deactivated

- `is_active = false` means: cannot insert attendance (RLS insert policy
  checks active), cannot sign in by phone, is excluded from absentees,
  no-shows, notification targets, alert watchers, count requests and
  tracking tokens. Pages redirect to `/deactivated`; API returns 403
  "Account deactivated".

### 1.7 Passwords, daily re-login

- `must_change_password` defaults to **true**. While true, every page
  redirects to `/change-password` (`requireSession`).
- Temporary passwords look like `ABC-2345-DEF` (3 letters, 4 digits, 3
  letters; `generateTempPassword` in `src/lib/credentials.ts`). They are
  kept in `staff_temp_passwords` (service role only, 6–72 characters) for
  the staff login sheet, and cleared by `clear_temp_password` the moment
  `must_change_password` goes from true to false.
- **Daily re-login** (`reloginReason` in `src/lib/auth.ts`), for
  merchandisers and marketers only:
  - `new-day`: their last sign-in was before 00:00 Lagos today;
  - `clocked-out`: they have a `closing` today recorded after their last
    sign-in. The attendance route returns `sign_out: true` after a closing.
  Pages redirect to `/api/auth/expired?reason=<reason>`; API routes answer
  401 with `code: 'relogin'`. Purpose: whoever holds the phone tomorrow must
  know the password, so a colleague cannot clock in on a phone left signed in.
- Page guard order (`requireSession`): no session → `/login`; inactive →
  `/deactivated`; relogin → expired; must change password →
  `/change-password`; wrong role → `/`.

### 1.8 `push_exempt`

An admin (only) can set `profiles.push_exempt = true` for one person whose
phone genuinely cannot receive notifications. It lifts the "notifications
required to clock in" rule (section 3.8) for that person. Supervisors
cannot set it and nobody can set it on themselves.

---

## 2. Attendance (the daily clock)

### 2.1 What a clock event is

- `attendance.type` is `opening` (clock in) or `closing` (clock out).
- The client sends: type, lat, lng, accuracy_m, address, place_name,
  place_source (`outlet | known | google | osm | coordinates`), selfie_path,
  thumb_path, device_info, client_captured_at (`src/app/api/attendance/route.ts`).
- **One opening and one closing per person per Lagos day**: unique index on
  `(user_id, attendance_date, type)`. A second one fails with `23505`; the
  route answers HTTP 409 "You have already clocked in/out today."
- Attendance has no update or delete policy: it is append-only.

### 2.2 Server-set fields (`attendance_enforce`, final 0034)

- `user_id := auth.uid()`, `created_at := now()`,
  `attendance_date := business_date()`.
- **Capture window**: `client_captured_at` must be no more than **2
  minutes** in the future and no more than **24 hours** in the past, or the
  insert fails with "Invalid capture timestamp" (route: "That capture is too
  old or your phone clock is wrong"). A phone clock set ahead is therefore
  refused outright.
- **Which store it is measured against**:
  1. The nearest of the person's own stores (`outlets_for_user`: home
     outlet plus allocated stores, active only) that has a location.
  2. If the person has any own store still **waiting for its location**
     (lat/lng null, section 4.4) and either has no pinned store or is
     outside the nearest pinned store's fence, the event is **not
     measured**: no outlet, no distance, no status (except `flagged` for a
     rough fix). They may be standing in the waiting store.
  3. Otherwise, if they have no own store at all, whichever active known
     outlet's fence they are standing inside (`outlet_containing`).
  4. Otherwise no outlet.
- The outlet's lat, lng and radius are snapshotted onto the row
  (`outlet_lat`, `outlet_lng`, `outlet_radius_m`) so later edits to the
  store cannot rewrite history.
- **Status**, decided in this order:
  1. `accuracy_m > 100` → `flagged`, whatever the distance;
  2. no distance (no store, not measured) → `null` ("nowhere they were due");
  3. `distance_m <= outlet_radius_m` (150 if null) → `on_site`;
  4. otherwise `off_site`.
- Outlet geofence radius: default **150 m**, allowed **25–2000 m**
  (`outlets.geofence_radius_m`). Shift defaults: **08:00** to **18:00**.

### 2.3 Every other trigger on a clock event

BEFORE insert (alphabetical order, after enforce):
- `attendance_push_check` (0027): openings by field staff need live push
  (section 3.8).
- `selfie_check` (0022/0023): the selfie rules (section 6.1).
- `attendance_timing` (0026/0029): the time verdict (section 2.5).

AFTER insert:
- `attendance_alert` (0001): if `status <> 'on_site'` (a null status raises
  nothing), insert a `location_alerts` row: `low_accuracy` when
  accuracy > 100 m, else `off_site_clock`, with the distance.
- `attendance_integrity` (0022): location integrity flags (section 7.3).
- `attendance_learn_waiting_store` (0034): may remember the spot as a
  possible location for a waiting store (section 4.4).
- `attendance_punctuality` (0036): late / early flags (section 2.4).
- `attendance_timing_flag` (0026): flags from the time verdict.
- `attendance_zz_place_due` (0045): openings only, may require the place to
  be named (section 4.5). Named `zz` so it runs last.

The route then: pushes an "off site" / "flagged" alert to watchers (only
for those two statuses; an unmeasured event is not news), runs the IP and
native checks (section 7.4), flushes new flag alerts, and returns the outlet
name the trigger chose.

### 2.4 Late, early and absent

There are two separate notions of "late". Keep them separate:

- **Reported late** (`attendance_detail.is_late`, `admin_overview.late`,
  `staff_analytics.days_late`, `src/lib/attendance-report.ts`): an opening
  whose **server receive time** (`created_at`, Lagos) is after the store's
  `shift_start`. No grace. Minutes late in reports =
  `max(0, clock-in minutes − shift_start minutes)`.
- **Late flag** (`attendance_punctuality`, 0036): uses the moment the
  photo was taken (`client_captured_at`, or `created_at`), so a clock-in
  saved offline is not late for waiting for signal. Grace:
  `punctuality_grace_minutes()` = **15**. The store is the clock-in store,
  else the home store; skipped if it has no shift times.
  - Opening more than 15 minutes after `shift_start` → `late_clock_in`,
    severity `medium`, `high` when more than **60** minutes. Summary
    "Clocked in 40 min late at Lola Store (shift starts 08:00)"
    (`minutes_label`: "25 min", "1 h", "1 h 10 min").
  - Closing more than 15 minutes before `shift_end` → `early_clock_out`,
    same severities.
- **Day status in reports** (`buildDays`): present and off site or
  flagged → `off_site` (off site wins over late); present and late →
  `late`; present → `on_time`; not present and the day is after today,
  before the account was created, or the person is inactive → `none`;
  otherwise the person's schedule for that day (section 2.7, same order as
  `day_kind`): a day off → `off`, approved leave → `leave`, a working day →
  `absent`. `off`, `leave` and `none` are never counted (only present and
  absent days are "expected"). If the schedule cannot be read, everyone
  falls back to Monday to Saturday. There is no "Sundays count" switch any
  more.
  The first opening and the last closing of a day count. `missingOut` =
  clocked in, no clock-out, and the day is over. `sentLateMin` = minutes
  between the photo and the server receiving it.
- Patterns worth a conversation (`concerns`, `CONCERN_AT`): absent on ≥2
  days, late ≥3, off site ≥2, no clock-out ≥2, clock-in sent ≥**30**
  minutes late (`SENT_LATE_MIN`) ≥2. Ranked by count × weight (absent 5,
  off site 4, sent late 3, missing out 2, late 1).
- Report ranges: Attendance/Analytics read at most **92** days
  (`MAX_RANGE_DAYS`); the calendar grid is dropped beyond **62** days;
  trend charts go weekly beyond **45** days.
- `absentees_today()`: active field staff visible to the caller who are
  expected today (`day_kind = 'working'`, 0059) with no opening.
  `admin_overview()`: field staff totals for today (admin or supervisor
  only); `absent` counts only those expected today, `not_expected` those on
  a day off or approved leave.

### 2.5 Offline clock events and the time verdict (`clock_timing`, 0026, 0029)

A clock event can be taken with no network and sent later (the phone keeps
it up to **24 hours**, `MAX_AGE_MS` in `src/lib/offline/sync.ts`, up to 8
attempts). The phone puts `device_info.sent_at` (its clock when sending)
and `device_info.anchor_beacon` (the id of the last beacon it got through
before taking it). `clock_timing(user, captured, device, now)`:

1. `offset_s` = phone `sent_at` − server now (seconds).
2. `taken` = `client_captured_at` − offset (the real moment, on the
   server's clock).
3. If `now − taken <= 2 minutes` → **`live`**.
4. Otherwise, in order:
   - the anchor beacon was received more than 2 minutes after `taken` →
     **`backdated`** (`how: 'anchor'`): the phone was in touch after the
     moment it claims;
   - a beacon with `outbox_count = 0` arrived between `taken + 10 min`
     and `now − 30 s` → **`backdated`** (`how: 'nothing_waiting'`): the
     phone said nothing was waiting, so the event was made later;
   - any beacon, or any **live** (not offline) ping, between
     `taken + 10 min` and `now − 10 min` → **`network_was_available`**;
   - any beacon or ping in the day before `taken` (up to `taken + 2 min`)
     → **`offline_confirmed`**; none → **`offline_unproven`**.
5. If `|offset_s| > 300` (5 minutes) and the verdict is not `backdated`
   → **`phone_clock_wrong`**.

Stored in `attendance.time_verdict` and `time_detail` (`offset_s`,
`taken_at`, `lag_s`, `contact_at`/`last_contact_at`, `how`).
`attendance_timing_flag` raises: `backdated` → `backdated_clock` (high);
`phone_clock_wrong` → `phone_clock_wrong` (medium, "N minutes ahead/behind");
`network_was_available` → `late_sync_with_network` (low).

### 2.6 Daily reports (marketers)

- One per person per Lagos day (`reports_one_per_day`); `user_id`,
  `report_date`, `outlet_id` server-set (`report_enforce`).
- Editable only on the day filed ("Reports can only be edited on the day
  they were filed"); owner and date can never change.
- At most **5** photos per report (`report_photo_limit`).
- `body`, `sales_summary` and `stock_status` must each "say something":
  `text_has_words(text, 10)` = at least 10 characters, at least 2 letters,
  no character repeated 6+ times. No field may hold a link or control
  characters (`text_is_clean`: no `http(s)://`, `www.`, or bare domains
  ending `.com .net .org .ng .io .co .xyz .info .biz .me .link .click .top
  .site .online .shop .app .ru .cn`).
- Blocked while a place is waiting to be named (section 4.5).
- **The day's visits are kept with the report** (0060):
  `reports.store_visits jsonb` (default `[]`) is filled by trigger
  `trg_report_visits` (`report_capture_visits`, before insert or update,
  after `report_enforce` by trigger-name order) from
  `report_visits_snapshot(user, date)`: that person's `store_visit_detail`
  rows for the report date, by arrival, each `{store, outlet_name,
  address (store's, else arrival address), arrived_at, departed_at,
  minutes, status, arrived_status}`. Whatever the client sends for it is
  overwritten; saving again refreshes it, and it cannot be cleared.
  `report_visits_snapshot` is callable by nobody but the trigger (it would
  read another person's day).

### 2.7 Work schedules and leave (0059)

Who is expected at work on which day. Mirrored for the dashboard and the
staff calendars by `src/lib/schedule.ts` (pure; checked by
`scripts/check-schedules-leave.ts`) and read through the user's session by
`loadSchedule` / `loadScheduleSafe` (`src/lib/schedule-server.ts`).

- **Tables** (RLS: read your own rows; admins all; a supervisor their team
  via `supervises_user`; **nobody writes directly**, only the functions
  below):
  - `work_patterns(user_id pk, days smallint[], updated_by, updated_at)`:
    the weekdays worked, as `extract(dow)`: 0 = Sunday … 6 = Saturday.
  - `schedule_overrides(id, user_id, day, working, note ≤ 300, created_by,
    created_at)`, unique per person and date: `working = true` an extra day
    in, `false` an extra day off.
  - `leave_requests(id, user_id, kind, from_date, to_date, reason, status,
    decided_by, decided_at, decision_note ≤ 500, cancelled_at, created_at)`:
    kind `annual | sick | casual | other`; status `pending | approved |
    rejected | cancelled` (default pending); reason 3–1000 characters
    after trimming; `to_date ≥ from_date`. View `leave_request_detail`
    (security invoker) adds staff name, role, store, supervisor, who
    decided and `days` (both ends counted).
- **The default week** is Monday to Saturday (`default_work_days()` =
  `{1,2,3,4,5,6}`): anyone with no pattern works Mon–Sat and has Sunday off.
- **`day_kind(user, day)`** → `'leave' | 'off' | 'working'`, in this order:
  1. **approved** leave covering the day → `leave` (pending, rejected and
     cancelled requests change nothing);
  2. else a one-off change on that date → `working` or `off`;
  3. else the weekly pattern (or the default) → `working` or `off`.
  No permission check; only other `SECURITY DEFINER` functions and the
  service role may call it.
- **`is_working_day(user, day)`**: `day_kind = 'working'` for yourself, an
  admin, a supervisor of that person, or the service role; null for anyone
  else.
- **`my_calendar(from, to)`**: the caller's own days (at most 93: `to` is
  capped at `from + 92`), each `{day, kind, clocked_in, missed}`.
  `clocked_in` = an opening that day. `missed` = a working day **before
  today**, on or after the Lagos date the account was made, with no
  opening. Today is never missed yet; nothing before the account is.
- **Who manages a schedule** (`can_manage_schedule`, `schedule_guard`):
  only admins and supervisors ("Only admins and supervisors set
  schedules"); only for merchandisers and marketers ("Schedules are for
  merchandisers and marketers"; unknown person "That person was not
  found"); a supervisor only for their own team ("You can only set
  schedules for your own team"). Staff never set their own.
- **`set_work_pattern(users[], days[])`** → number changed: 1–**500**
  people ("Pick at least one person", "Set at most 500 people at a time");
  days within 0–6 ("Days of the week run from Sunday (0) to Saturday (6)"),
  kept once each in order; `days = null` puts them back on the default.
  **All or nothing**: every person is checked first, so one outside the
  team refuses the whole list and changes nobody. One audit row per person,
  `schedule.pattern` on `profiles`/<user> with `{days, default, before,
  people}`.
- **`set_schedule_override(user, day, working, note)`** → id: a date from
  **60 days back** ("That date is too far in the past") to **366 days
  ahead** ("Pick a date within the next year"); note ≤ 300 ("Keep the note
  under 300 characters"); replaces any change already on that date. Audit
  `schedule.override` with `{day, working, note, override_id}`.
- **`remove_schedule_override(id)`**: same guard ("That date change was not
  found"); the weekly pattern applies again. Audit
  `schedule.override_remove` with `{day, working, note}`.
- **`apply_leave(kind, from, to, reason)`** → id, for the signed-in person:
  - must be active ("Sign in again to ask for leave") and a merchandiser or
    marketer ("Leave requests are for merchandisers and marketers");
  - kind one of the four ("Pick the type of leave");
  - both dates ("Pick the first and last day of your leave"); last not
    before first ("The last day cannot be before the first day");
  - first day at most **7 days back** ("Leave can start at most 7 days
    ago": sick leave is often asked for afterwards); last day at most
    **365 days ahead** ("Pick dates within the next year"); at most **60
    days** in one request ("One request can cover at most 60 days");
  - reason at least 3 characters ("Say why you need the leave"), at most
    1000 ("Keep the reason under 1000 characters");
  - no overlap with the person's own **pending or approved** requests ("You
    already have leave asked for or approved on some of those days");
    cancelled and rejected ones do not block. The profile row is locked
    first, so two requests sent together cannot both pass.
  - Starts `pending`. Not audited (staff action).
- **`cancel_leave(id)`**: only the person who asked ("That request was not
  found") and only while pending ("Only a request still waiting can be
  cancelled"); sets `cancelled`, `cancelled_at`.
- **`decide_leave(id, approve, note)`** → `{id, user_id, status, kind,
  from_date, to_date, note}`: admins and supervisors only ("Only admins and
  supervisors decide leave"); approve must be given ("Approve or reject the
  request"); never your own ("You cannot decide your own leave"); a
  supervisor only for their team ("You can only decide leave for your own
  team"); not a cancelled one ("That request was cancelled") nor one already
  decided ("That request has already been decided"); note ≤ 500 ("Keep the
  note under 500 characters"). Audit `leave.approve` / `leave.reject` on
  `leave_requests`/<id> with `{user_id, kind, from, to, note}`. A decision
  cannot be changed by deciding again.
- **Routes** (thin; the functions decide): `POST /api/leave` (field roles;
  zod: kind, from, to as YYYY-MM-DD, reason `writtenText(1000, 3)`) then
  `notifyWatchers` ("<name> asked for leave"); `POST
  /api/leave/[id]/cancel`; `POST /api/admin/leave/[id] {decision, note ≤
  500}` then `notifyUsers` to the person ("Leave approved" / "Leave not
  approved"); `POST /api/admin/schedules {user_ids 1–500, days | null}`;
  `POST /api/admin/schedules/overrides {user_id, day, working, note ≤ 300}`;
  `DELETE /api/admin/schedules/overrides/[id]`. Bad ids → 404; database
  refusals → 400 with the message.
- **Absence follows the schedule.** Nobody is a no-show, an absentee or
  counted absent on a day off or a day of approved leave:
  `staff_no_show()`, `absentees_today()` and `admin_overview()` keep only
  people whose `day_kind(today) = 'working'` (section 9.3), and the reports
  use the same order (section 2.4). Clocking in on a day off or on leave is
  still allowed and counts as a day worked.

### 2.8 Clock-out reminders (0061)

When someone is clocked in today and has not clocked out by the end of
their shift, their phone is told to clock out.

- **Shift end** (`shift_end_for(user)`): the `shift_end` of the store on
  their profile (home outlet), else **18:00** Lagos.
- **Two stages** per person per Lagos day: **1** at the shift end ("Time to
  clock out"), **2** sixty minutes later ("You have not clocked out yet").
  Never more than these two; never to someone not clocked in today or
  already clocked out; never after **midnight Lagos** (the day is read from
  the moment the job runs, and only that day's clock-in counts). A late job
  still sends: the first if past the shift end, **only the second** if an
  hour or more past it (one push, not two at once); stage 1 is never sent
  once stage 2 has gone.
- **`clock_out_reminders(user_id, reminder_date, stage 1|2, shift_end,
  claimed_at)`**, primary key (user, date, stage). RLS read: own, admins, a
  supervisor's team; nobody writes directly.
- **`claim_clock_out_reminders(p_now default now())`**, **service role
  only** (`p_now` is for the tests): returns each due reminder `{user_id,
  reminder_date, stage, shift_end 'HH:MM'}` and records it in the same
  statement (`on conflict do nothing`), so two runs at once, or a run every
  five minutes, never send one twice.
- **Sending** (`flushClockOutReminders`, `src/lib/clock-out-reminders.ts`,
  called by `/api/cron/alerts` every 5 minutes): groups the claimed rows by
  stage, shift end and date and sends each group with `notifyUsers` (web and
  native), wording from `reminderMessage()` (`src/lib/clock-out-reminder.ts`):
  stage 1 "Your shift ended at HH:MM. Clock out with a selfie before you
  leave.", stage 2 "Your shift ended at HH:MM. Please clock out with a
  selfie now.", both opening `/field`; detail `{kind: 'clock_out_reminder',
  system: true, stage, shift_end, date}`, so the history shows them as
  automatic alerts. Never throws; before 0061 is run the missing function
  is ignored. The job's JSON reply carries `clock_out_reminders: {claimed,
  delivered}`.
- The phone shows the same thing on screen from the shift end to midnight
  (`clockOutDue`, the home screen prompt, `10-field-app.md` §5.9). Staff
  are only asked to clock out; nothing says the reminder is recorded.

---

## 3. Location during the shift

### 3.1 Heartbeat pings

- While the field app is open on shift it sends a ping every **5 minutes**
  (`HEARTBEAT_INTERVAL_MS`) to `POST /api/pings` with lat, lng, accuracy.
- `ping_enforce` (final 0029): `user_id := auth.uid()`; `received_at :=
  now()`; `created_at := now()` unless it is an offline insert (3.4). It
  anchors to that day's **opening** and sets `distance_m` = distance from
  **where they clocked in** (not from the outlet). No opening that day →
  no distance. `gap_seconds` = seconds since the person's previous ping
  that Lagos day (null for the first).
- Coverage (`tracking_coverage(user, date)`): shift = first opening to
  first closing (or now). Each ping in the shift covers
  `min(gap_seconds, 360)` seconds; a first ping counts 360 (the 5-minute
  cadence plus slack), so a two-hour gap stays two hours uncovered.
  Returns `shift_seconds`, `tracked_seconds`, `ping_count`,
  `longest_gap_seconds`, `last_ping_at`, `coverage_pct` (capped 100).
  Readable by the person, admins and their supervisor.

### 3.2 Leaving the store (`ping_alert`, 0029)

- A **live** ping with `distance_m > 300` (`HEARTBEAT_GEOFENCE_M`) raises a
  `left_geofence` alert, **at most one per person per 30 minutes**.
- Offline pings never raise it (an hour-old breach is stale).
- The pings route checks whether the trigger actually raised one for this
  ping; only then does it name the spot (one map lookup, at most once per
  30 minutes per person), store it in `location_pings.place_name`, and push
  "<name> left the outlet: Now at <place>, N m from where they clocked in"
  to watchers. The background tracker route does the same.

### 3.3 Location blocked (`log_location_block`, 0002)

When the app cannot get a location it calls `/api/location-block`.
Reason `low_accuracy` → `low_accuracy` alert, anything else →
`permission_denied` alert. At most **one per person per kind per 15
minutes**, so retry loops do not flood the queue.

### 3.4 Positions kept offline (`record_offline_pings`, 0029)

- The phone queues pings it could not send and sends them in a batch with
  its clock at sending (`p_sent_at`). At most **500** per call.
- Each point's time is corrected by the phone's clock offset. Kept only if
  the corrected time is within the last **24 hours** and not more than **2
  minutes** in the future, and lat/lng/accuracy are valid numbers.
- A point whose time is before a beacon that said "nothing waiting"
  (`outbox_count = 0`, received more than 10 minutes after the point and
  more than 30 seconds before now) is **refused**; if any were refused, one
  `backdated_clock` flag (high, `detail.source = 'offline_positions'`) per
  person per day.
- A point within ±1 second of an existing ping is a resend and skipped.
- Stored with `offline = true` at the time taken; `received_at` is when it
  arrived. No `left_geofence` alert; location integrity checks still run.
- `|offset| > 300 s` → one `phone_clock_wrong` flag (medium) per person
  per day.
- Offline positions prove the phone was **on**, not that it had network:
  they are excluded from "the phone had network" in clock timing and
  excuse checks.

### 3.5 Background tracking with the app closed (0050, 0055)

- The Android foreground service / iOS location service has no web
  session, so at clock-in the app calls `POST /api/track/token`
  → `issue_tracking_token(platform)`:
  - only active merchandisers and marketers ("Only field staff use this");
  - platform `android` or `ios`;
  - revokes that person's earlier tokens **for the same platform** (one
    phone tracks at a time);
  - token = 64 hex characters; only its SHA-256 is stored;
  - expires **18 hours** after issue ("long enough for the longest shift,
    never into the next one").
- The tracker posts to `POST /api/track/device` with
  `Authorization: Bearer <64 hex>`, `sent_at`, and up to 500 points
  (`lat`, `lng`, `accuracy_m`, `captured_at`, optional `is_mock`). The route
  calls `record_background_pings(token, points, sent_at)` with the service
  role:
  - unknown, revoked or expired token, or inactive person → `ok: false`;
    route answers 401 `{stop: true}`;
  - **0055: the shift is checked first.** If there is no opening today, or
    there is a closing today, the token is revoked and the answer is
    `{ok: false, stop: true, shift_open: false}`; nothing is stored;
  - points are time-corrected by the phone's offset; skipped if more than
    24 h old, more than 2 min in the future, or taken more than **5
    minutes before the token was issued**; resends within ±1 s skipped;
  - a point taken within the last **2 minutes** is stored live (can raise
    `left_geofence`); older ones are stored as offline at their time;
  - any `is_mock: true` point → one `mock_location_confirmed` flag (high,
    `detail.source = 'background'`) per person per day;
  - returns `kept`, `shift_open`, and any new `left_geofence` alert, which
    the route pushes to watchers.
- `revoke_tracking_tokens()` (`POST /api/track/stop`) revokes all the
  caller's tokens at clock-out. The phone must stop when told `stop: true`.

### 3.6 Live locations and the movement trail

- `live_locations()`: one row per visible field person with an opening and
  no closing today: clock-in time, label and status, last ping today, minutes
  since it, last position (ping, else clock-in), distance from their **home**
  outlet and whether that is inside its fence. A merchandiser sees nothing.
- `movement_trail(user, date)` (0028/0029): admins and the person's
  supervisor only ("You can only follow your own team"). Points in time
  order: `clock_in`, `clock_out`, `location`, `location_offline`,
  `visit_in`, `visit_out`, `app` (beacons), plus the stores that matter
  (own, allocated, visited) with their fences.
- Reading a trail (`src/lib/movement.ts`): readings rougher than **100 m**
  (`ROUGH_M`) are shown but not measured; distance ignores jitter below
  `max(accuracy_a, accuracy_b, 20 m)`; time outside every store counts each
  stretch up to **60 minutes**; a silence of **20 minutes** or more
  (`GAP_MINUTES`, not counting after a clock-out) is a gap; a stop is
  readings within **150 m** (`STOP_RADIUS_M`) for **8 minutes**
  (`STOP_MINUTES`); faster than **150 km/h** (`JUMP_KMH`) is not a real
  journey. The Movement page covers at most **7** days.

### 3.7 Phone beacons (`record_beacon`, 0026)

- The app quietly reports when opened, made visible or hidden, back online,
  and on an interval: reason (`open | visible | hidden | online | interval`,
  anything else becomes `interval`), connection, battery %, charging,
  outbox count, oldest queued time, device time, offline since, position.
  Invalid values are dropped, not refused.
- Several beacons with the same reason within **15 seconds** are one
  beacon (the existing id is returned). Returns `{id, server_time}`; the
  phone keeps the id as its "anchor" for offline clock events.
- Readable only by admins and the person's supervisor. Deleted after **60
  days** by the nightly job.

### 3.8 Notifications are required to clock in (0027, 0033, 0038)

- `attendance_push_check`: an **opening** by a merchandiser or marketer who
  is not `push_exempt` is refused with "Turn on Xtend notifications before
  clocking in" unless `has_live_push(user)`.
- `has_live_push`: an active `push_subscriptions` row whose endpoint is a
  real push service (`https://fcm.googleapis.com/`,
  `android.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, `*.notify.windows.com`) or a native app token
  `native-fcm:<token>` / `native-apns:<token>` with at least 20 characters
  of `[A-Za-z0-9_:-]`.
- Clocking **out** is never blocked, so nobody is stuck on shift.
- Why: "Check the phone now" (section 8.3) only works on a phone that
  receives notifications.

---

## 4. Places

### 4.1 Outlets (stores)

- `outlets`: name, address, lat/lng, radius (default 150 m, 25–2000 m),
  shift start/end (default 08:00/18:00), `is_active`. Everyone signed in
  reads them; only admins write (RLS).
- **Both coordinates or neither** (`outlets_location_whole`, 0034). A store
  with no location is "waiting for its location".
- `outlet_containing(lat, lng)`: the nearest active outlet whose fence
  contains the point (waiting stores never contain anything).

### 4.2 Place names on clock events

The app names where someone is (`src/lib/geocode.ts`): inside their store →
the outlet; else a known place; else Google Places (if configured) or
OpenStreetMap; else coordinates (`place_source`). Labels read "premises,
street" and fall back to the address, then `lat, lng` to 5 decimals
(`location_label` in `attendance_detail`).

### 4.3 Known places Xtend learns (0024, 0025, 0026)

- `known_places`: name 2–120 chars, radius default **50 m** (15–500),
  source `google | osm | staff | admin | clock_in`, `verified`, times seen,
  who named it, visitors, photos.
- Only admins read the table directly (it records who was where). Staff
  only learn a name through `known_place_at(lat, lng)`: the place whose
  radius covers the point, verified first, then nearest.
- `learn_place(lat, lng, name, address, source, photo_path)`:
  - source must be `google`, `osm` or `staff`; name collapsed to single
    spaces, **2 to 120 characters**;
  - inside a store → returns null (the store names it);
  - an existing place covers the spot → `times_seen + 1`, caller added to
    `visitors`, return it (same spot, whatever name a map gives);
  - for `staff` names only:
    1. **No house passed off as a shop**: a name that overlaps (whole
       words, both keys ≥ 6 characters after `place_key` lowercasing and
       stripping punctuation) an active outlet's or a verified place's name
       that is more than **0.5 km** away is refused: "That name does not
       match where you are standing. Type the name on the sign here". A
       single common word ("Mall Road Pharmacy") is not a clash; next to
       the store itself its name may be used.
    2. A shop-front photo is required: in the `reports` bucket, own folder,
       uploaded within **30 minutes**, checked as kind `storefront` with
       verdict pass or unchecked ("Take a photo of the shop front or sign").
    3. One photo names one place ("Take a new photo here").
    4. At most **10** new staff names per person per rolling 24 hours ("No
       more place names can be added today").
  - map names need no photo and have no limit.
- `note_place_visit(place)`: a staff-named, unverified place whose namer is
  its **only** visitor, seen **3 or more** times, raises `own_named_place`
  (medium) **once per place**. The Places page shows `only_namer_visits`.

### 4.4 Stores pinned from clock-ins (0034)

- A store can be added before its location is known. Nobody is measured
  against it: clock-ins and visits there are neither on nor off site and
  raise no alert; store counts there are refused ("This store's location
  is still being confirmed").
- `attendance_learn_waiting_store`: after a clock-in with no status and no
  outlet, accuracy **≤ 50 m**, not inside any store, by someone who has
  waiting stores, the spot becomes (or joins) a known place with source
  `clock_in`, named "Clock-in spot: <store names>", with
  `store_candidates` = their waiting stores and the person in `visitors`.
  A rough fix teaches nothing.
- `pin_store_from_place(place, outlet)`: **admin only**; the store must
  still have no location ("That store already has a location"); the store
  takes the place's position (and address if it has one); the place is
  deleted and the store removed from other places' candidates. Never
  automatic: somebody could clock in at home on day one.

### 4.5 Naming an unknown place is mandatory (0045)

- **When it is raised** (`raise_place_due`): on an **opening**, and on a
  store visit with no outlet. Not raised when:
  - the fix is missing or `accuracy > 100 m`;
  - the phone sent a shutter-time position (`device_info.position.shutter`)
    that is more than `max(30 m, accuracy_first + accuracy_shutter)` from
    the first fix (the spot is uncertain);
  - either reading is recognised: inside a store or within a known place
    whose source is not `clock_in` (`place_is_recognised`);
  - the person already has an un-named due today within **150 m** (a
    dismissal there holds for the rest of the day).
  The surer of the two readings is saved as the due spot.
- **While one is open today** (`my_place_due`), `place_due_guard` refuses
  inserts into `store_visits`, `store_counts`, `xm_counts`, `xm_sales` and
  `reports` with "Name the place you clocked in at first…" and hint
  `place_naming_due` (route: HTTP 423). Clocking out is never blocked. The
  rule lasts only for that business date.
- **Naming it** (`name_place(due, name, lat, lng, accuracy, storefront_path,
  selfie_path, evidence)`):
  - only the person it is due for; already named or dismissed → returns
    the existing place;
  - name 2–120 characters ("Type the name on the store sign");
  - accuracy ≤ 100 m;
  - standing within **200 m** of the due spot ("Name the place from where
    you clocked in: you are N m away");
  - if the phone sent `evidence.sign`, it must be within
    `max(30 m, accuracy + sign accuracy)` ("Your location moved while you
    took the photo of the sign");
  - if it sent `evidence.selfie`, within `max(100 m, accuracy + selfie
    accuracy)` ("Take the selfie at the place, next to the sign");
  - two fresh photos (reports bucket, own folder, ≤ 30 minutes, pass or
    unchecked): a `storefront` photo of the sign and a `product_selfie` of
    them holding a product; neither used by any place before;
  - name clash with an outlet or verified place more than **500 m** away
    refused;
  - a `clock_in` guess at that spot is upgraded to a real staff place;
    another place already there is reused; otherwise `learn_place`.
  - Every open due of theirs within 200 m is marked named.
- **Dismissing** (`dismiss_place_due(due, reason)`): an admin or the
  person's supervisor only, reason at least 3 characters ("Say why").
  Staff cannot let themselves off.

---

## 5. Store visits, allocation and coverage

### 5.1 Who records visits

`can_visit_stores()` (0016): marketers and admins always; a merchandiser
only when they have **more than one** store (`outlets_for_user` count > 1),
because one daily clock can no longer say which.

### 5.2 Checking in (`store_visit_enforce`, final 0060)

- Server sets user, times, `visit_date := business_date()`, `status :=
  'open'`, clears any departure fields.
- **One open visit per person** (unique partial index): a second check-in
  without checking out fails with `23505`.
- **Allocated stores only** (0060). `has_allocated_stores(user)` = at
  least one `staff_outlets` row for an active store. Once true, a visit
  must be to one of their stores (`outlets_for_user`: allocated plus home):
  - a store **picked by hand** that is not theirs is refused;
  - **left out**, the nearest of their own stores whose fence covers the
    spot is used; if none of theirs does but some other store's fence does
    (`outlet_containing`), it is refused; if no fence covers it at all, the
    visit stands alone (no outlet).
  Both refusals: **"This store is not on your list. Ask your supervisor to
  add it."** (`POST /api/visits` answers **403** with that text), and no
  visit row is left behind.
- Without any allocation the old rule stands exactly: outlet optional; left
  out → the store whose fence they stand in (`outlet_containing`), any
  active outlet. Still none → recorded against **no outlet**, status null
  (or `flagged` when accuracy > 100 m): a shop Xtend does not know is a
  perfectly good visit (place naming, 0045).
- `my_visit_stores()` (0060): the stores the phone offers under "Pick the
  store myself": the caller's own stores (id, name, address, lat, lng,
  geofence radius, by name) when they have an allocation, otherwise
  **none** (the phone says to ask their supervisor).
- Outlet named (or found): must exist and be active; snapshot taken;
  status `flagged` (accuracy > 100 m), null (waiting store), `on_site`
  (within its radius) or `off_site`. Naming a store you are not at is
  still off site.
- Same capture window as clock events (≤ 2 min ahead, ≤ 24 h old).
- Selfie optional on visits, but if given it must pass the selfie rules.
- `store_visit_alert`: accuracy > 100 m → `low_accuracy`; `off_site` →
  `off_site_clock`. A visit to an unknown shop raises nothing.

### 5.3 Checking out (`end_store_visit`, 0016)

Only the owner, only an open visit ("That visit is already closed"). Status
is judged the same way against the snapshot; no snapshot → null (or
flagged). Returns minutes in store. Visits still open from an earlier day
are marked `abandoned` by the nightly job (`close_abandoned_visits`).

### 5.4 Store labels (`store_visit_detail`, 0016, 0052)

`store_label` = the outlet's name when on site; else the map's place name;
else the address; else the outlet name; else "Unnamed place".
`store_label_source` = `outlet` or `map`. 0052 adds the departure position,
label and the store's own point.

### 5.5 Allocation (`staff_outlets`, 0011)

- A person's stores = home outlet (`profiles.outlet_id`) plus allocated
  stores, active only (`outlets_for_user`). With no allocation they have
  exactly their home store.
- `can_allocate_outlets(target)` = admin, or a supervisor who
  `supervises_user(target)` and target is field staff. Supervisors never
  allocate to admins, other supervisors or outside their team. Allocating
  someone to the supervisor's own outlet puts them on the team.
- `set_staff_outlets(user, outlet_ids[])` writes the **whole set** in one
  statement: missing ones dropped, new ones added with `assigned_by`. Any
  unknown or inactive store refuses the whole call and changes nothing.
  Every call writes an `audit_log` row `staff.allocate_outlets` directly
  (supervisors may call it).
- The daily clock measures against the nearest allocated store (section
  2.2), and the event is attributed to that store.
- Store visits are limited to these stores as soon as one is allocated
  (section 5.2, 0060).

### 5.6 Store coverage and visit review

- `store_coverage` (0052, security invoker): per store, field staff whose
  home or allocated store it is (`staff_assigned`), last visit time, date
  and who, and visits in the last **30 days** (`visit_date >= today − 29`).
- `staff_day(date)`: per person, clock-in/out times and places, stores
  visited, minutes in store, store they are in now.
- Visit review (`src/lib/visit-review.ts`): a closed visit shorter than
  **10 minutes** is short; arriving off site **300 m** or more from the
  store is worth a look; two consecutive visits more than **1000 m** apart
  at faster than **80 km/h** are an impossible hop; coverage gaps are shown
  at **7, 14 and 30** days.

---

## 6. Photos

### 6.1 Selfies on clock events and visits (`selfie_check`, 0022/0023)

Skipped for the service role (no signed-in user). Otherwise:
- attendance needs a selfie ("A clock-in needs a selfie taken in the app");
- verdict `reject` → "That selfie was rejected. Take a new one, live, of
  your face"; no verdict → "The selfie has not been checked";
- `photo_is_fresh`: in the `selfies` bucket, path under the caller's own id
  folder, uploaded within **30 minutes**, verdict pass or unchecked (same
  for the thumbnail) → else "The selfie must be taken in the app just now";
- never used before by any attendance or visit, full or thumbnail ("That
  selfie has already been used").
Images are resized in the app to **640 px** wide, at most **150 KB**, with a
**200 px** thumbnail (`src/lib/image.ts`).

### 6.2 The photo check (`POST /api/photo-check`, `src/lib/photo-check.ts`)

- Every selfie, shelf photo, storefront and product selfie is uploaded and
  then checked before use. Kinds: `selfie` (selfies bucket), `shelf`,
  `storefront`, `product_selfie` (reports bucket).
- Claude judges the image and returns pass or reject, a problem (`screen`,
  `printed_photo`, `no_face`, `face_unclear`, `not_a_shelf`,
  `not_a_business`, `no_product`, `blurry`, `too_dark`, `other`), a message
  to the worker, and the setting (`shop | market | street | office | home |
  unclear`). Reject only clear problems; when unsure, pass. Messages never
  mention supervisors, checks or recording.
- The verdict is written to `photo_checks` by the service role (same
  verdict for the thumbnail). A retry returns the stored verdict.
- If the checker is not configured or fails, the verdict is `unchecked`
  and the photo is allowed, so an outage never stops anyone.
- Flags raised by the route: reject → `photo_rejected` (high for `screen`
  or `printed_photo`, else low); unchecked while the checker is configured
  → `photo_unchecked` (low); a passed selfie whose setting is `home` →
  `selfie_at_home` (medium).
- A rejected photo is answered with HTTP 422 and the message.

### 6.3 Retention: clock photos live 24 hours (0012)

- Both images (full and thumbnail) of every attendance row and store visit
  are deleted **24 hours** after the row's `created_at`
  (`SELFIE_RETENTION_HOURS`). The row itself, with time, place, distance and
  status, is kept forever.
- Storage objects can only be removed through the Storage API, so the
  server: lists `expired_selfie_paths(24)`, deletes the objects, then calls
  `forget_expired_selfies(24)` to null both paths (`src/lib/retention-server.ts`).
- Throttle: `claim_selfie_sweep(10)` lets one caller sweep at most every
  **10 minutes** (`job_runs` row `purge_selfies`). Every heartbeat ping
  tries it; the nightly cron (`/api/cron/purge-selfies`, **02:20 UTC**)
  sweeps outright.
- `selfie_retention_status()` (admins only): last run, result, photos
  held, photos overdue.

---

## 7. Integrity flags

### 7.1 What a flag is

- `integrity_flags`: person, kind, severity (`low | medium | high`),
  summary, detail, outlet, `flag_date` (Lagos), review fields,
  `notified_at`. Readable by admins and the person's supervisor.
- **Flags never block anything.** Only rules (photo freshness, being in the
  store to count, capture windows) refuse a submission.

### 7.2 Every kind (the CHECK constraint, 22 kinds)

| Kind | Severity | Raised by | When |
|---|---|---|---|
| `repeated_exact_location` | high | `flag_location` on clock events | lat and lng equal, to 6 decimals, a clock event on another day |
| `perfect_accuracy` | medium | `flag_location` on clock events | accuracy under **2 m** |
| `impossible_journey` | high | `flag_location` on clock events and pings | more than **3 km** from the previous position in the last **6 h**, at more than **150 km/h**; at most one per person per hour |
| `count_units_missing` | high | `check_store_count` | units left < last count − sold by more than `max(2, 10% of last count)` |
| `count_identical` | medium | `check_store_count` | ≥ 2 products and every figure equals the previous count |
| `count_round_numbers` | low | `check_store_count` | ≥ 4 lines, every figure a multiple of 10, at least one non-zero |
| `photo_rejected` | high (screen / printed) or low | photo-check route | the check rejected a photo |
| `photo_unchecked` | low | photo-check route | the checker failed while configured |
| `own_named_place` | medium | `note_place_visit` | own-named place, only visitor, seen ≥ 3 times; once per place |
| `selfie_at_home` | medium | photo-check route | passed selfie, background looks like a home |
| `backdated_clock` | high | `attendance_timing_flag`, `record_offline_pings` | time verdict `backdated`; offline positions made up afterwards (once a day) |
| `phone_clock_wrong` | medium | `attendance_timing_flag`, `record_offline_pings` | phone clock more than 5 minutes off |
| `late_sync_with_network` | low | `attendance_timing_flag` | verdict `network_was_available` |
| `vpn_suspected` | high | attendance route → `flag_own_integrity` | IP is a proxy/VPN or hosting/datacentre address |
| `ip_location_mismatch` | high | attendance route | GPS and IP location more than **400 km** apart (**800 km** for a mobile carrier IP) |
| `timezone_mismatch` | medium | attendance route | phone zone not `Africa/*`, or offset not UTC+1 |
| `gps_mock_fingerprint` | medium | attendance route | fix has no altitude, speed and heading |
| `mock_location_confirmed` | high | attendance route (native), `record_background_pings` | the OS said the location is from a mock provider |
| `device_integrity_failed` | high | attendance route (native) | rooted Android / jailbroken iPhone |
| `late_clock_in` | medium, high > 60 min | `attendance_punctuality` | more than 15 min after shift start |
| `early_clock_out` | medium, high > 60 min | `attendance_punctuality` | more than 15 min before shift end |
| `stock_discrepancy` | medium, high > 4 × tolerance | `xm_reconcile_pending` | X Metrics count off expected by more than tolerance |

Flag kinds are grouped for display (`FLAG_AREAS` in `src/lib/integrity.ts`):
location, phone and clock, photos, stock counts, punctuality.

### 7.3 Location flags (`flag_location`, 0022)

Run after every clock event (with the repeat and accuracy checks) and every
ping (journey check only). `outlet_id` is set for clock events. Walking
round a store is never a journey because of the 3 km floor.

### 7.4 VPN, IP and native signals (`src/lib/integrity-signals.ts`, 0030, 0032)

- Evaluated in the attendance route after the insert, never blocking, best
  effort (a failure is swallowed). Recorded through
  `flag_own_integrity(kind, severity, summary, detail, outlet)`, which:
  pins the user to `auth.uid()`; accepts only `vpn_suspected`,
  `ip_location_mismatch`, `timezone_mismatch`, `gps_mock_fingerprint`,
  `mock_location_confirmed`, `device_integrity_failed`; coerces bad
  severities to medium; keeps **one per person per kind per hour**; trims
  the summary to 300 characters.
- Client IP (`src/lib/client-ip.ts`): read from the **end** of
  `X-Forwarded-For`, skipping `TRUSTED_PROXY_HOPS` (default 1; 2 behind
  Cloudflare), else `X-Real-IP`. Private addresses are ignored.
- IP lookup (`src/lib/ip-geo.ts`): ip-api.com (`proxy`, `hosting`,
  `mobile`, lat/lng, country), HTTPS paid endpoint when `IP_API_KEY` is set,
  custom `IP_GEO_URL` must be HTTPS, `IP_GEO_DISABLED=1` turns it off,
  **2.5 s** timeout, falls back to Vercel's geo headers (no VPN flag).
- Native shell signals come in `device_info.native`: `is_mock` and
  `compromised`, with `platform`.

### 7.5 Telling supervisors (`claim_flag_alerts`, 0036; `src/lib/flag-alerts.ts`)

- Every **medium or high** flag that is unreviewed, un-notified and less
  than **1 day** old is handed over **once** (`notified_at` set in the same
  statement, `for update skip locked`, up to 200 per call). Low flags are
  never pushed. Flags that existed before 0036 were marked notified.
- `flushFlagAlerts()` pushes each to the watchers (section 10.2) as
  "<name>: <headline>" (`FLAG_HEADLINE` in `src/lib/flag-labels.ts`) with
  the summary and store, linking to `/admin/integrity`. It is called after
  every clock event, ping, photo check, background batch, count, and by the
  5-minute cron.

### 7.6 Review

- `review_integrity_flag(id, note)`: admin, or the person's supervisor;
  "That flag is not yours to review" otherwise (including your own flags).
  Note trimmed, blank stored as null, ≤ 500 characters.
- `review_integrity_flags(ids[], note)` (0054): admins and supervisors only;
  **1 to 200** ids ("Pick at least one flag"); note ≤ 500; only unreviewed
  flags the caller may review are changed; an already-reviewed flag keeps
  its first reviewer and note. Returns how many were reviewed.
- Who to look at first (`personRisk` in `src/lib/integrity-review.ts`), over
  unreviewed flags: score = Σ severity weight (high 5, medium 2, low 1),
  halved for flags older than 7 days, plus 5 for each "proof" flag
  (`mock_location_confirmed`, `device_integrity_failed`, `backdated_clock`).
  "Act now" when there is any proof flag or score ≥ 10; "Keep an eye" at
  score ≥ 4; else "Minor". The page reads at most 120 days, default 30.

---

## 8. Excuses and phone checks

### 8.1 The evidence (`check_excuse`, `check_excuse_more`, 0048)

- Admins and the person's supervisor only ("You can only check your own
  team"); the window must have `to > from` and be at most **72 hours**
  ("Pick a time window of up to 3 days").
- `check_excuse(user, from, to)` returns:
  - `contacts`: everything that reached Xtend in the window, in time order,
    at most 300: beacons (`app_<reason>`, with battery, charging,
    connection, outbox, position, phone clock offset), **live** pings,
    clock-ins/outs, store visits, delivered phone checks;
  - `offline_positions` (pings stored offline in the window);
  - `offline_records`: clock events taken in the window and received more
    than 2 minutes later, with their time verdict;
  - `before` / `after`: the nearest beacon within **12 hours** either side
    (battery); `place_before` / `place_after`: the nearest position within
    12 hours either side;
  - `phone_checks` sent in the window; `has_push`; `ever_reported`.
- `check_excuse_more(user, from, to)` adds: the person's pinned stores
  (name, radius); up to 500 positions (pings `tracking`/`offline`, beacons
  `app`, clock events), each with accuracy and distance to the nearest of
  their stores; location problems (their `location_alerts`); refused photos
  (`photo_checks` rejects); work queued on the phone (max outbox count,
  oldest queued time); clock events and visits.

### 8.2 Claims and verdicts (`judgeExcuse` in `src/lib/excuse.ts`)

Claims: `no_network` ("My network was bad / no data"), `phone_off` ("My
phone was off / battery died"), `gps_failed`, `at_store`, `app_failed`.
Verdicts: `false` (not true), `doubtful`, `fits`, `unknown`.

- Any offline clock event in the window with verdict `backdated` → **false**
  ("the time on the phone was changed"), for no_network and phone_off.
- **no_network**: anything reached Xtend in the window → **false**; else
  offline clock events or offline positions → **fits** (on, no network,
  saved work); else **unknown**.
- **phone_off**: anything heard, offline clock event, or offline position →
  **false** (the phone was on); else battery before ≤ **10%** → **fits**;
  else battery before ≥ **25%**, after known, not charging after, and after
  ≥ before − **15** points → **doubtful** ("switched off"); else **unknown**.
- **gps_failed**: positions with accuracy ≤ 100 m exist → **false**, or
  **doubtful** if a `permission_denied`/`low_accuracy` problem was also
  reported; no good positions but such problems → **fits**; only positions
  rougher than 100 m → **fits**; else **unknown**.
- **at_store**: no pinned store → **unknown**; a good position is "at the
  store" when its distance ≤ radius + min(accuracy, 100) + **25 m**; no
  placeable good position → **unknown**; all at the store → **fits**; some
  away → **false** if the furthest is more than radius + **300 m**, else
  **doubtful**.
- **app_failed**: a clock-in went through → **false**; permission off,
  rough location, refused selfie or work queued → **fits**; the app was
  open (contacts) with none of those → **doubtful**; else **unknown**.
- `unknown` explanations add "this phone has not reported yet" when it never
  sent a beacon and "notifications are off" when it has no push.
- Supporting points: phone clock more than 5 minutes off; last and next
  positions more than 500 m apart; battery before and after.

### 8.3 Keeping the check (`record_excuse_check`)

Same permission. Stores claim, window, verdict, headline (≤ 500), note
(≤ 500, blank → null) and who checked, in `excuse_checks`, so a pattern of
excuses shows (`excuse_check_detail`). Staff cannot keep checks on each
other.

### 8.4 "Check the phone now" (0026)

- `request_phone_check(user)`: admin or the person's supervisor only. If a
  check for that person was created in the last **2 minutes** it is reused
  (one at a time). The route (`POST /api/admin/phone-check`, needs push
  configured) pushes "Please open Xtend now." with the check id and a
  secret token and records how many devices it reached.
- The phone answers `POST /api/phone-check/ack` with id, token and stage
  `delivered` or `opened`; no login needed; accepted only within **24
  hours** of the check; each time is set once. Delivered means on, with
  network, at that moment.

---

## 9. Alerts (`location_alerts`)

### 9.1 Kinds and who raises them

| Kind | Raised by |
|---|---|
| `off_site_clock` | clock event or store visit off site (not unknown shops) |
| `low_accuracy` | clock event or visit with accuracy > 100 m; `log_location_block('low_accuracy')` |
| `left_geofence` | live ping more than 300 m from the clock-in point, max one per 30 min |
| `permission_denied` | `log_location_block` with any other reason, max one per 15 min |

Labels: `ALERT_LABEL` / `ALERT_SHORT` in `src/lib/alert-review.ts`.
`alert_detail` adds the place where a clock-related alert happened.

### 9.2 Reading and resolving

- Admins read and write all alerts; supervisors read their team's.
- `resolve_alert(id, note)`: **admins only** ("Admins only"); sets
  resolved, by, at, note; writes audit `alert.resolve`.
- `resolve_alerts(ids[], note)` (0052): admins only; empty list → 0; more
  than **500** refused; only alerts still open are resolved (one already
  resolved keeps its own note); **one audit row per alert resolved**
  (`alert.resolve`, with `together_with`). Returns the count resolved.
- Alerts review: open alerts older than **24 hours** are stale
  (`STALE_HOURS`); **3** or more for one person in the period is a pattern
  (`REPEAT_AT`).

### 9.3 Absence sweep (no-show)

- `staff_no_show(grace_minutes default 30)` (final 0059): active field
  staff whose active home outlet's `shift_start + grace` has passed today
  (Lagos), who are **expected today** (`day_kind = 'working'`: not a day
  off, not approved leave, section 2.7) and who have no opening today;
  outlets without a shift time are skipped. Returns minutes late.
- `/api/cron/absence-sweep` runs at **08:30 UTC (09:30 Lagos) every day**
  (`"30 8 * * *"` in `vercel.json`; Sundays included since 0059, because
  the schedule, not the weekday, decides who is expected), grace 30 minutes
  (overridable with `?grace=`). For each
  no-show not already reported today (`no_show_already_reported`:
  a notification with `audience_detail.kind = 'no_show'` and that
  `subject_id` created today Lagos), it pushes "<name> has not clocked in:
  N min after the HH:MM start at <store>. Call <phone>." to watchers with
  `detail.kind = 'no_show'`. Idempotent; safe to run hourly.

---

## 10. Notifications

### 10.1 Audiences and reach (`resolve_notification_targets`, 0006)

- Senders: admins and supervisors (`can_send_notifications`). Anyone else
  resolves **no** targets at all.
- Only active people. An **admin reaches everyone** (field staff,
  supervisors, other admins, themselves). A **supervisor reaches only field
  staff they supervise**, never themselves, supervisors or admins.
- Audiences: `everyone`; `role` (`detail.role`); `outlet` (home outlet =
  `detail.outlet_id`); `users` (`detail.user_ids`, max 500). Each target
  comes with its active device count.
- Message rules (route `src/app/api/admin/notifications/route.ts` and
  table checks): title **1–80**, body **1–400** characters; `url` must be a
  page inside Xtend (starts with a single `/`, at most 300 chars). Preview
  mode resolves and counts without sending; `resend_of` resends to those
  not reached.

### 10.2 Alert watchers (`alert_watchers`, final 0036)

Who is told about a person automatically: every active admin, plus every
active supervisor who supervises them (reports to them, shares their home
outlet, or has them allocated to the supervisor's outlet), never the person
themselves. Used by `notifyWatchers` (`src/lib/notify.ts`), which writes a
`notifications` row with `sender_id = null`, `audience = 'users'`,
`audience_detail` carrying `system: true`, `subject_id`, `user_ids` and a
`kind`, pushes to their devices, and records deliveries. It never throws.

### 10.3 Push channels (`src/lib/push.ts`, `src/lib/push-native.ts`)

- Web push (VAPID keys) to browser subscriptions, TTL **12 hours**, urgency
  high. Android app: Firebase Cloud Messaging HTTP v1
  (`FIREBASE_SERVICE_ACCOUNT`). iPhone app: APNs HTTP/2 with a token key
  (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` default
  `ng.xpelbeauty.xtend`, `APNS_SANDBOX`).
- Native devices are stored as `native-fcm:<token>` / `native-apns:<token>`
  (token `^[A-Za-z0-9_:-]{20,4096}$`).
- **Endpoint guard** (0038, and `src/lib/push-endpoint.ts`): the table
  refuses any endpoint that is not one of the real push hosts or a native
  token (max 4200 chars). This stops a user making the server POST to
  `127.0.0.1`, metadata addresses or ports. The sender re-checks before
  sending and retires anything else.
- A web 404/410 or an invalid native token marks the subscription inactive.

### 10.4 Deliveries and reading

- `notification_deliveries.status`: `sent` (reached at least one device),
  `failed` (tried, none succeeded), `no_device` (no active device, or push
  not configured). `notifications.delivered` and `failed` are totals.
- Readable by the recipient, admins, and (0053) the sender
  (`notification_sent_by_me`).
- `my_notifications(limit)`: the caller's `sent` deliveries, newest first,
  limit 1–100 (default 20). `mark_notifications_read()` marks all of the
  caller's unread sent deliveries read.
- `notification_log` kind: `support` when `audience_detail.kind` starts
  with "support"; `alert` when there is no sender, `system` is true, or a
  `kind` is present; otherwise `message`. Summary rates: delivery rate =
  delivered ÷ recipients, read rate = read ÷ delivered.

### 10.5 Templates and quick replies

`notification_templates` (title 1–80, body 1–400) and
`support_quick_replies` (title 1–60, body 1–1000): any admin or supervisor
reads and adds their own; edits/deletes by the creator or any admin. Starter
sets (created_by null): 4 templates, 5 quick replies (quick replies use a
`{name}` placeholder).

### 10.6 Scheduling (0053)

- `schedule_notification(title, body, url, audience, detail, send_at)`:
  admins and supervisors only; `send_at` at least **2 minutes** ahead ("Pick
  a time at least a few minutes from now"; the form asks for **5**,
  `MIN_AHEAD_MIN`) and within **60 days**; the audience is resolved **now**
  with the sender's reach and frozen in `user_ids` (empty → "That audience
  matches nobody").
- `cancel_scheduled_notification(id)`: the sender or an admin; only while
  `scheduled` ("It has already gone or been cancelled").
- `claim_scheduled_notification(id)` ("send now"): same permission; moves it
  to `sending` and returns it; can only happen once.
- `claim_due_notifications(limit)`: the cron's side. First marks any row
  stuck in `sending` for more than **15 minutes** as `failed` (never sent
  twice), then claims up to `limit` (1–100, default 20) due rows.
- Quick picks in the composer: next 07:45, 08:00, 13:00 and 16:00 Lagos.

### 10.7 Scheduled jobs

All need `Authorization: Bearer $CRON_SECRET` (`vercel.json`):
- `/api/cron/purge-selfies` — 02:20 UTC daily: photo sweep, abandoned
  visits, beacons older than 60 days deleted, activity log rows older than
  180 days (`purge_user_activity()`, 0062).
- `/api/cron/absence-sweep` — 08:30 UTC daily (`"30 8 * * *"`): no-shows
  (only people expected that day, 0059), then flag alerts.
- `/api/cron/alerts` — every 5 minutes, run by
  `.github/workflows/alerts-cron.yml` (Vercel Hobby allows only daily
  crons; on Pro it can move back to `vercel.json`): unsent flag alerts, due
  scheduled notifications, clock-out reminders (section 2.8, 0061), and in
  the first 5 minutes of each hour the X Metrics sweep (`runMetricsSweep`:
  reconcile, expiry scan, push expiry alerts).
- `/api/cron/metrics` — optional hourly X Metrics sweep on its own.

---

## 11. Stock counts (store counts)

### 11.1 When counting is open (`store_count_status`, 0020, 0046)

- Not allowed for this person (`can_count_stock` false) →
  `{open: false, reason: 'not_allowed'}`.
- An open request naming them (not closed, due date ≥ today; the soonest
  due wins) → `{open: true, reason: 'request', request_id, due_date, note,
  requested_by}`.
- **Month end**: the last **3** days of every month
  (`month_end_count_days() = 3`; `is_month_end_window(d)` is
  `d > last_day − 3`), e.g. 28–30 September, 26–28 February in a 28-day
  February, 29–31 December → `{open: true, reason: 'month_end'}`.
- Otherwise `{open: false, reason: 'none', next_month_end}`. Counting
  outside these is refused: "No store count is due…".

### 11.2 Requests (`request_store_count`, `close_count_request`)

- Asked by an active supervisor or admin only. At least one person; due
  date not in the past and within **60 days**; every person must be an
  active merchandiser or marketer, in a role that counts, and (for a
  supervisor) on their team. A person named twice is asked once. Audit
  `store_count.request`.
- Closed early by whoever asked, or an admin ("…not yours to close").
- `count_request_progress` shows people asked, how many counted, and who is
  still waiting; sending a count sheet counts as counted.

### 11.3 Submitting (`submit_store_count`, final 0040)

`submit_store_count(outlet, lines, lat, lng, accuracy, photo_path)`:
- caller may count (`can_count_stock`) and counting is open;
- the store is one of theirs (home or allocated) and has a location;
- accuracy ≤ 100 m and within the store's radius + **25 m** ("You must be
  in the store to submit its count (you are N m away)");
- a shelf photo in the reports bucket, own folder, uploaded within **30
  minutes**, verdict pass or unchecked, not used by another count (re-using
  it for the same person, store and day is allowed);
- 1 to **500** lines; each product name 1–120 characters; figures whole
  numbers **0 to 1 000 000**; each line must have `back_store` and/or
  `shop_floor`, or `in_store` (older phones); `sold` defaults to 0;
  `expiry_date` a real `YYYY-MM-DD` between 2000-01-01 and 2100-12-31; no
  product twice (compared by `product_key`: trimmed, single-spaced,
  lower case).
- `in_store` = back store + shop floor when either is given. A product
  typed for the first time is created, tidied; a known one is reused
  however it is typed. Counting the same product again the same day
  replaces the figures. The count is stored against person, store, product
  and Lagos date, with the request (if any), position, distance and photo.
- "Sold" means sold since the last count.

### 11.4 Count checks (`check_store_count`, 0040)

Compared with the same person's previous count at the same store. First,
today's unreviewed `count_*` flags for that store are deleted, so a
correction later the same day clears them. Then the three checks in the
table in section 7.2 (missing units, identical, round numbers). More units
than before is a delivery, not a problem.

### 11.5 The Xpel count sheet (0035, 0040)

- Products with a `sheet_order` (233 seeded, with 8–14 digit barcodes) are
  the list the phone shows.
- Paper / file sheets (`submit_count_sheet(outlet, path, file_name)`): a
  count must be open; the store must be theirs; the file in the reports
  bucket, own folder, uploaded within **30 minutes**; type read from
  storage: Excel (`.xlsx`), PDF, JPG or PNG; size above 0 and at most **10
  MB**; the same file only once. Its figures are not read into Xtend.
- The blank sheet (`set_count_sheet_template`): admin only, a PDF, at most
  10 MB, from the admin's own folder within 30 minutes.

### 11.6 Which roles count (`role_store_counts`, 0046)

`person_counts_stock(user)`: admins always; merchandisers and marketers as
their added role's `counts_stock`, else the built-in row in
`role_store_counts` (one row each for merchandiser and marketer, admins
update only), default true. A role set not to count sees the form closed
and cannot be asked to count ("does not take store counts"). X Metrics is
separate (`xm_can_submit`: active merchandiser, marketer or admin).

### 11.7 Counted product names

`counted_product_names()` offers names already counted as suggestions.

---

## 12. X Metrics (0043, 0044, 0047)

### 12.1 Settings (`xm_settings`, one row, every change kept)

| Setting | Default | Allowed |
|---|---|---|
| `tolerance_pct` | 5 | 0–100 |
| `weight_sales` / `weight_accuracy` / `weight_consistency` / `weight_expiry` | 40 / 30 / 20 / 10 | each 0–100, **sum must be 100** |
| `band_poor_below` | 40 | 1–99, below `band_strong_from` |
| `band_strong_from` | 70 | 2–100 |
| `alert_windows_days` | {730, 365, 180, 90, 30} | 1–10 values, each 1–3650 |
| `velocity_days` | 30 | 7–365 |
| `count_interval_days` | 7 | 1–31 |
| `sales_grace_hours` | 12 | 0–72 |
| `sales_photo_required` | true | |

Only admins update; `xm_settings_keep` copies the old row into
`xm_settings_history` with who changed it.

### 12.2 Products and stores

- Products gain `category` (1–60), `unit` (default "unit", 1–30), unique
  SKU ignoring case, `units_per_carton` (1–100 000).
- `xm_set_store(outlet, active)`: admin only; a store joins or leaves X
  Metrics, keeping its history.

### 12.3 Supplies (`xm_log_supply`, final 0047)

- Admin only; store enrolled and active; product active; `supplied_on` not
  in the future; expiry not before the supply date.
- In cartons: cartons 1–100 000 × units per carton (given, else the
  product's; "Say how many units are in a carton of <product>" if neither);
  a product with no carton size learns it from the first supply that says.
  Both cartons and units are kept. In units: as given.
- Quantity must end up 1 to 1 000 000 units.
- Imports: `xm_create_supply_import(file_name, kind csv|xlsx|pdf|docx,
  read_by table|claude, supplier, invoice_no, invoice_date, rows)` records
  the file first; `xm_log_supply_import(import, rows)` logs 1–500 checked
  lines **all or nothing** ("Line N: <reason>"). Admin only. Files up to
  **10 MB** (`MAX_IMPORT_BYTES`).

### 12.4 Batch counts (`xm_submit_count`)

- Who: `xm_can_submit`; store enrolled and active and one of theirs.
- Captured within the last **72 hours** and not more than 2 minutes ahead
  ("Invalid capture time: it must be within the last 3 days"); the phone
  keeps X Metrics work offline up to 72 hours.
- Accuracy ≤ 100 m; within radius + 25 m (skipped for a store waiting for
  its location).
- Shelf photo in the caller's folder with verdict pass or unchecked; each
  photo used by one count only.
- 1–500 lines: active product, `on_shelf` and `in_backroom` whole 0–1 000 000,
  batch ≤ 60 characters, optional expiry; no product+batch twice (batch
  compared trimmed and lower case).
- `count_date` = Lagos date of the capture. The first non-voided count at a
  store is its **opening stock** (`is_opening`).
- `xm_my_store_batches()`: batches last counted with units > 0 at the
  caller's stores (no figures), the starting point of the next count.

### 12.5 Daily sales (`xm_submit_sales`)

Same who/store/capture rules; `sale_date` from today − 3 to today; a photo
(in the caller's folder, pass/unchecked) is required while
`sales_photo_required`; 1–500 lines of active products with whole units
0–1 000 000, no product twice. Sending a day again **supersedes** the
earlier report (`superseded_by`), which is kept. Only the latest,
non-voided version counts (`xm_live_sale_lines`).

### 12.6 Reconciliation (`xm_reconcile_pending`)

- Admin or the service role (cron). Takes counts dated **before today**, not
  reconciled, not voided, oldest first.
- Per product in the count: previous non-voided count of that product at
  the same store (any person), earlier by date then time. None → this one
  is the baseline, no row.
- supplied = non-voided supplies with `supplied_on` in (previous date,
  this date]; sold = live sales with `sale_date` in the same range.
- **expected = previous units + supplied − sold**; variance = actual −
  expected; `variance_pct = round(100 × |actual − expected| /
  max(|expected|, actual, 1), 2)`.
- `variance_pct > tolerance_pct` → `stock_discrepancy` flag on the person
  who counted, at the store, dated the count date; severity **high** when
  above 4 × tolerance, else medium. Summary "100 units of XM Body Oil
  missing at <store>: expected 400, counted 300".
- One `xm_reconciliations` row per count and product, written once; the
  count is marked reconciled.

### 12.7 Expiry (`xm_expiry_scan`)

- Stock on hand = each batch in the latest non-voided count of each
  product at each store, with units > 0 and an expiry date.
- `days_left = expiry − today`. Expired → window 0; else the smallest alert
  window ≥ days_left; beyond the largest window → nothing.
- Daily velocity = live units sold in the last `velocity_days` ÷
  `velocity_days`. `days_to_sell = units ÷ velocity` (1 dp) when velocity
  > 0. **Consider pulling** when there are no sales or `days_to_sell >
  max(days_left, 0)`.
- One alert per store, product, batch, expiry and window (so each window
  alerts once). New alerts are handed out once (`xm_claim_expiry_alerts`)
  and pushed to active admins. `xm_acknowledge_expiry(alert, note)`: admin,
  once.

### 12.8 Targets

`xm_set_target(month, user, outlet, units)`: admin only; exactly one of
person or store; person must be field staff; 1–100 000 000 units; month
stored as its first day. The newest target for a month wins
(`xm_current_targets`); older ones are kept.

### 12.9 Monthly grade (`xm_grade(user, month)`, 0044)

Visible to the person themselves, admins and their supervisor ("You can
only see grades for your own team"). Each factor is 0–100, or null when
there is nothing to judge:

- **Sales**: units sold (live sales by the person in the month) ÷ their own
  target × 100, capped at 100. With no personal target: units sold at
  their stores that have store targets ÷ the sum of those targets.
- **Accuracy**: share of their reconciliations in the month (non-voided
  counts) that were not flagged.
- **Consistency**: over days they clocked in from the 1st to
  min(month end, yesterday): a day scores a sales point if a non-voided
  sales report for that day was **captured** before midnight Lagos at the
  end of that day plus `sales_grace_hours` (12 h) (sent later is not late),
  and a count point if they made a non-voided count dated within the
  `count_interval_days` (7) ending that day. Score = 100 × (sales points +
  count points) ÷ (2 × days present).
- **Expiry**: over their count lines in the month: 50 × (lines with an
  expiry date ÷ lines) + 50 × (1 − lines expired on the shelf ÷ lines),
  where expired on the shelf = expiry before the count date and
  `on_shelf > 0`.
- **Score** = Σ(factor × weight) ÷ Σ(weights of the factors present), 1
  decimal. **Band**: below 40 "Poor", below 70 "Average", else "Strong".
  Example: sales 50, accuracy 0, no consistency, expiry 100 →
  (50×40 + 0×30 + 100×10) ÷ 80 = **37.5, Poor**.
- `xm_month_grades(month)`: everyone visible who clocked in, counted or
  sold that month.
- `xm_finalise_month(month)`: admin; only once the month has ended (the 1st
  of the next month ≤ today; "once it has ended"); keeps each grade once
  (a month already kept is not changed). `xm_review_grade(grade, note)`:
  admin, note ≤ 1000.

### 12.10 Scoring policy versions (0044)

`xm_publish_policy(title 3–120, body 20–20 000, note ≤ 300)`: admin only;
each publish is a new version and the newest is current
(`xm_current_policy`); old versions are kept. A starter version exists.
`xm_mark_policy_read(policy)`: any signed-in person; recorded once.

### 12.11 Voids (`xm_void(kind, id, reason)`)

Admin only; kind `supply`, `count` or `sales`; reason at least 3
characters (≤ 300; "Say why it is being voided"); once only ("already
voided"). The record stays, with who, when and why, and drops out of every
calculation.

### 12.12 Feature switches (0063)

- `xm_settings` gains `enabled`, `expiry_enabled`, `supplies_enabled`,
  `grading_enabled`, `sales_enabled` (all `true` by default, so nothing
  changes on migrate) and `reconcile_from date`.
- `xm_feature_on(part)`: `xmetrics` = enabled; `expiry`, `supplies`,
  `grading`, `sales` = enabled and their own switch; `reconcile` = enabled
  and supplies and sales; anything else false.
- `xm_set_features(enabled, expiry, supplies, grading, sales)`: admin only
  ("Only an admin can do that in X Metrics"); null refused ("Say whether
  each part is on or off"); returns the switches and `reconcile_from`. The
  existing `xm_settings_keep` keeps the earlier row in
  `xm_settings_history`; the route audits `xm.features.update`.
- `trg_xm_settings_resume`: when reconciliation goes from off to on,
  `reconcile_from := business_date()`.
- `xm_feature_guard` (before insert): `xm_counts` with X Metrics off →
  "Stock counts are not being collected here at the moment"; `xm_sales`
  with sales off → "Sales are not being collected at the moment";
  `xm_supplies`, `xm_supply_imports` with supplies off → "Supplies are
  switched off in X Metrics. An admin can turn them on in X Metrics →
  Settings"; `xm_targets` with sales off → "Sales and targets are switched
  off…"; `xm_monthly_grades` (insert or update) with grading off →
  "Grading is switched off in X Metrics. An admin can turn it on in X
  Metrics → Settings".
- `xm_reconcile_pending` returns 0 and leaves counts unreconciled while
  reconciliation is off; afterwards a count is only compared with a
  previous count dated on or after `reconcile_from` (otherwise it is a new
  baseline, marked reconciled, no row, no flag).
- `xm_expiry_scan` returns 0 and `xm_claim_expiry_alerts` hands out nothing
  while expiry is off. Expiry dates on count lines are kept as sent.
- `xm_grade` raises "Grading is switched off in X Metrics" while grading is
  off; otherwise leaves out sales (sales off), accuracy (reconciliation off)
  and expiry (expiry off), and with sales off consistency counts only
  counts (`sales_on_time` null); adds `parts {sales, accuracy, expiry}`.
  `xm_month_grades` lists nobody and `xm_finalise_month` refuses while
  grading is off.
- Switching off deletes nothing; switching back on resumes.

---

## 13. Support

### 13.1 Threads and statuses (0031, 0053)

- A field member opens a thread with a subject (≤ 160, default "Issue from
  the field") and a first message (1–4000 characters)
  (`open_support_thread`). The thread records their home outlet.
- `post_support_message(thread, body)`: the role is decided from the
  caller, never the client: the owner → `staff`; an admin → `admin`; the
  owner's supervisor → `supervisor`; anyone else refused.
- Statuses:
  - `open`: new, or the member wrote again;
  - `ai_answered`: the helper replied without escalating, **or** a person
    in the office replied;
  - `escalated`: the helper passed it to the office, or the office
    reopened a closed thread;
  - `resolved`: closed by an admin or the member's supervisor
    (`resolve_support_thread`), explicitly; nothing auto-resolves.
- `reopen_support_thread`: admin or supervisor of the member; only a
  resolved thread ("That thread is not closed"); goes back to `escalated`
  and waiting.
- Assignment (`assign_support_thread(thread, person|null)`): admin or the
  member's supervisor; the assignee must be one of the member's watchers
  (`support_assignees`): an admin or a supervisor who supervises them, never
  the member. The assignee (if not the one assigning) is notified.
- `support_inbox.waiting_since`: for open or escalated threads, the oldest
  member message after the last office reply (helper replies do not stop
  the clock), else the escalation time, else the last message time; null
  when nothing is waiting. Long wait **60 minutes**, late **240 minutes**
  (`src/lib/support-inbox.ts`).
- Office replies (`/api/admin/support/[id]/reply`) may resolve in the same
  step, are audited (`support.reply`), and reach the member as "Reply from
  the office" (`audience_detail.kind = 'support_reply'`).

### 13.2 The helper (`src/lib/support-assistant.ts`)

- Runs after **every** member message (new thread or reply), with the
  service role, reading the whole thread; forced to call one tool
  `respond {reply, escalate, reason}`.
- It may answer alone: how to clock in/out (Location, Camera and
  Notifications allowed; selfie in the app), installing the app (Add to
  Home screen; Safari on iPhone), what results mean ("off site" = GPS
  outside the store area; "flagged" = location unclear, wait outside and
  retry), permission or weak GPS, changing password, daily report, stock
  count, reassurance.
- It **must escalate** for account, store, outlet, team or password-reset
  changes; pay, disputes, being marked absent/off site wrongly, complaints
  about a person; store, stock or safety problems; a broken or lost phone
  or the app not loading; anything it is not confident about.
- It must not mention location checks during the shift or with the app
  closed, alerts or messages to the office, phone or integrity checks,
  VPN or fake-location detection, or recording/review. Asked about
  location, it says only that Xtend uses location to confirm they are at
  their store while on shift and it must stay on. It never invents a
  policy, time, name or decision.
- When escalating it still replies, saying the office will follow up.
- No API key, no tool answer, or any error → escalate with a canned reply.
- On escalation: status `escalated`, `escalated_at` set, watchers pushed
  "<name>: issue needs the office" (`kind: 'support_escalated'`).

---

## 14. Audit

### 14.1 Writing (`write_audit`, final 0049; `src/lib/audit.ts`)

- `write_audit(action, target_table, target_id, meta, context)`: admins and
  **active supervisors** only ("Admins and supervisors only"); `actor_id`
  is always `auth.uid()`, never from the client.
- Every admin or supervisor change in a route calls `audit()`, which sends
  the request context.
- Some functions write audit rows themselves (supervisors cannot be trusted
  to call it): `set_staff_outlets` (`staff.allocate_outlets`),
  `request_store_count` (`store_count.request`), `resolve_alert` /
  `resolve_alerts` (`alert.resolve`), and (0059) `set_work_pattern`
  (`schedule.pattern`, one row per person), `set_schedule_override`
  (`schedule.override`), `remove_schedule_override`
  (`schedule.override_remove`), `decide_leave` (`leave.approve` /
  `leave.reject`), each in the same transaction as the change.
- Marketer report downloads are audited by their route as
  `export.marketer_report.<pdf|docx|xlsx>` on `profiles`/<person> with
  `{period, from, to, visits, days_worked}`.
- Only admins read the audit log (`audit_admin_read`; `audit_log_detail`).

### 14.2 Context (`audit_context_columns`, `audit_fill_context`, 0049)

- Columns: `ip` (≤ 64), `user_agent` (≤ 500), `device` (object: type
  phone/tablet/computer, os, browser, app), `lat`, `lng`, `accuracy_m`,
  `location_source` (`browser` or `ip`), `place` (the store or known place
  the point falls in, not `clock_in` guesses), `country` (≤ 8), `vpn`.
- Malformed context is dropped field by field; the action is still
  recorded. Accuracy and source are kept only with a valid position.
- Three ways the context arrives:
  1. `write_audit(…, p_context)` from routes (`auditContext()` in
     `src/lib/audit-context.ts`);
  2. **direct inserts** by the service role put it in `meta._context`; the
     trigger moves it into the columns and strips `_context` from `meta`;
  3. rows written **inside SQL functions** read the `x-xt-audit` request
     header (base64 JSON) that the server sends on every request; a garbled
     header is ignored.
- Location: the browser's position from the `xt_loc` cookie
  (`lat,lng,accuracy,epochMs`), accepted if accuracy ≤ 5000 m and taken in
  the last **2 hours** (not more than 5 minutes ahead); otherwise the IP's
  rough position. IP lookups are cached **6 hours**; `vpn` = proxy or
  hosting.
- The Audit log page flags actions from a VPN, a new device, or a place
  more than **30 km** from all the person's earlier spots (`NEW_PLACE_KM`).

---

## 15. Ask Xtend (`src/lib/assistant*.ts`)

- For admins and supervisors (`requireApiSession(['admin','supervisor'])`).
  Claude answers by calling **read-only tools** that query through the
  **caller's own Supabase client, so RLS decides what it can see**: a
  supervisor's assistant only knows that supervisor's people. At most
  **10** tool rounds per question; date ranges at most **62** days.
- **Days off and leave are not absences** (0059). The tools read the
  schedule (`loadScheduleSafe`): `attendance_on_day` lists people not
  clocked in who were expected separately from `day_off` and `on_leave`;
  `staff_history` labels each day "working day", "day off" or "on approved
  leave"; `attendance_summary` counts working days, days off, leave days and
  absent days (past working days, on or after the account was made, with no
  clock-in). The system prompt forbids calling a day off or approved leave
  an absence.
- `field_reports` includes the visits kept with each report (0060) as one
  line of text and the total minutes.
- Read tools: `attendance_on_day`, `staff_history`, `attendance_summary`,
  `field_reports`, `store_visits`, `store_counts`, `integrity_flags`,
  `integrity_risk`, `location_alerts`, `support_threads`,
  `notifications_sent`, `x_metrics`, `store_coverage`, `check_excuse`,
  `count_requests`, `match_names`.
- Output tools: `create_report` (kinds `daily_attendance`,
  `attendance_summary`, `staff_history`, `field_reports`, `store_visits`,
  `store_counts`; formats PDF, Excel, Word, CSV). A report carries no rows:
  the download route rebuilds it from the database for whoever clicks.
  `open_page` links only to `/admin…` pages.
- Action tools only **propose**: `propose_changes` (store allocations and
  team changes as a plan), `propose_notification`,
  `propose_count_request`, `propose_close_count_request`,
  `propose_phone_check`, `propose_flag_review`, `propose_sales_target`,
  `propose_xmetrics_store`, `propose_outlet_hours`, `propose_deactivate`.
  The person sees the card and presses **Apply**. `/api/admin/ask/act`
  re-validates the payload (`actionSchema`) and calls **the same route the
  dashboard button uses**, in the same request with the same session: same
  permission checks, pushes and audit rows. `/api/admin/ask/apply` applies a
  plan through `set_staff_outlets` and the admin-only supervisor
  assignment, each person succeeding or failing alone. Nothing in Ask Xtend
  decides a permission.
- Saved conversations (`assistant_conversations`, 0054): only admins and
  supervisors create them; each person sees, renames and deletes only their
  own (not even a supervisor sees another's); owner and creation time never
  change; `turns` is a JSON array up to **1.5 MB**, at most **200** turns;
  title 1–120 (default from the first question, about 60 characters).
  Proposed actions and plans are saved as **words only**, so reopening a
  chat can never re-send a notification.

---

## 16. Updates (0057, `src/lib/app-update.ts`)

- `app_releases`: "What's new" notes by admins: title 1–120, notes ≤ 3000,
  audience `everyone | field | office`, `required`, optional
  `min_android_build` and `min_ios_build` (> 0), `withdrawn_at`. Everyone
  reads releases that are not withdrawn; admins insert (as themselves) and
  update.
- `app_minimum_builds`: the **highest** minimum build set by any
  non-withdrawn release, per platform. Withdrawing a release removes its
  minimum.
- `report_app_install(platform android|ios|web, version, build, web_build)`:
  one row per person per platform; rewritten at most once a minute unless
  the build changes (a new build is recorded at once). Readable by the
  person, admins and their supervisor.
- Deciding what to show (`decideUpdate`): the site is newer when the
  server's build id differs from the page's; then `required` if the latest
  release says so, else `available`. The phone app is `required` when its
  build is below the minimum, `available` when below the latest build, and
  never asked for when there is no download URL. Release notes are shown
  only if under **14 days** old (`NOTES_FRESH_DAYS`).

---

## 16a. Realtime (0056, 0058)

- **Who hears what.** A change to a field member's own `attendance`,
  `store_visits`, `support_threads` or `notification_deliveries` row, or a
  new or changed `support_messages` row in their thread, is announced on
  their private topic `field:<their uid>` (`field_topic()`), by AFTER-row
  triggers `realtime_broadcast` → `realtime_notify_field_owner()` /
  `realtime_notify_support_message()` (SECURITY DEFINER, 0058).
- **What it says.** Only `{ "table": <name>, "op": INSERT|UPDATE|DELETE }`,
  event `change`, private. Never row data; the app re-reads through RLS.
- **Who may listen.** RLS on `realtime.messages` (policy "Field members read
  their own topic"): `realtime.topic() = field_topic(auth.uid())`. Nobody can
  subscribe to another member's topic.
- **When the app listens.** The field dashboard holds a socket only while the
  member is on shift; a jittered safety poll covers the rest, and
  `NEXT_PUBLIC_REALTIME_DISABLED=1` turns sockets off for everyone.
- **Dashboard.** The office alert feed uses Postgres Changes on
  `location_alerts` (0002 publication), filtered by RLS.
- **Tests.** `rules.sql`: announcements reach the owner's topic, carry only
  table and op, cover clock-ins and support replies. `rls_counts.sql`: a
  member reads their own topic and nothing on anyone else's.

## 17. Rule checklist

Testable statements, grouped by area. They mirror the assertions in
`supabase/tests/rules.sql`; a rebuild passes when every one holds.

### Clock events
- A fix inside the fence is `on_site`; the distance is computed from the outlet, not taken from the client.
- `user_id` comes from the session and `attendance_date` is the Lagos business date, whatever the client sends.
- The outlet's radius is snapshotted onto the row.
- A second opening the same day fails with a unique violation.
- A fix outside the fence is `off_site` with the real distance, and raises exactly one `off_site_clock` alert.
- Accuracy worse than 100 m is `flagged` even at the outlet, and raises a `low_accuracy` alert.
- A capture more than 24 h old, or more than 2 min in the future, fails with "Invalid capture timestamp".
- Clocking in at an allocated (non-home) store is `on_site`, attributed to and measured against that store.
- With no store of their own, clocking in inside a known store attributes it and reads `on_site`; clocking in nowhere known records no store, no status and raises no alert.
- Away from a pinned store while having a store waiting for its location: no status, no outlet, no distance, no alert; inside the pinned store: `on_site`.

### Heartbeat and alerts
- A ping near the clock-in point is close and raises nothing; one beyond 300 m raises one `left_geofence`; a second within 30 min does not.
- Only the first ping of the day has no `gap_seconds`; a ping covers at most 6 minutes of tracking.
- Repeated permission denials within 15 minutes collapse into one alert.
- Only admins resolve alerts; resolving writes `alert.resolve` with the admin as actor.
- Bulk resolve: admins only; counts only open alerts; each gets the note; one already resolved keeps its note; one audit row per alert resolved; an empty list resolves nothing.

### Reports
- A merchandiser cannot file a daily report; a marketer can; owner, date and outlet are server-set.
- A report is editable the same day only; at most 5 photos.
- Saving a report keeps the day's visits with it (store, address, times and minutes, in order), ignores any visits the phone sent, and saving again refreshes them and cannot clear them.

### Read models
- `my_day` tells a merchandiser they cannot file, shows today's opening and outlet.
- `admin_overview` counts clock-ins, off-site openings and open alerts; `absentees_today` lists field staff (marketers too) with no opening.
- `absentees_today` leaves out people on a day off or on leave; `admin_overview` counts them as `not_expected`, not `absent`.
- Location labels read "name, street" and fall back to coordinates.
- `staff_analytics` counts one present day per opening.
- `live_locations` lists people still on shift with distance and inside-fence; a merchandiser sees nobody.
- `alert_detail` carries the location of off-site alerts.

### Audit
- Field staff cannot write audit rows ("Admins and supervisors only"); supervisors can.
- Context records IP, device, location and the store it was in; malformed context is dropped and the action kept.
- Direct inserts fill the columns from `meta._context` and strip it; SQL-function rows read the `x-xt-audit` header; a garbled header is ignored.

### No-shows and watchers
- Someone who clocked in is never a no-show; a field member who did not is reported with minutes late.
- Nobody on a day off or on approved leave is a no-show; someone working today with no clock-in is.
- Admins are always watchers; a supervisor is a watcher of their team (even from another store) and not of others; nobody watches themselves.
- Flags created before alerting existed are not sent; each new medium/high flag is claimed once.

### Store visits and allocation
- A marketer can visit stores; a merchandiser with one store cannot; one with two stores can.
- Arriving inside the fence is `on_site` and measured against that store; the visit is `open` until checkout; two open visits are impossible.
- Checkout at the store is `on_site`, closes the visit, and cannot happen twice.
- Arriving away from a named store is `off_site` and alerts; standing in any known store with no allocation attributes the visit; an unknown shop has no outlet, no status, no alert, and the map names it; with nothing at all it is "Unnamed place".
- Inside their own fence the store label is the outlet (`outlet`); elsewhere the map name (`map`).
- With no allocation a person has only their home store; allocations add to it, record who made them, replace the set, audit every call; an unknown store changes nothing.
- A supervisor reaches people allocated to their outlet, can then change their stores, never an admin's.
- A visit to a waiting store is neither on nor off site.
- `staff_day` reports stores visited, clock-in, minutes in store; a marketer sees only their own day.
- Store coverage shows last visit, who, visits in 30 days and staff assigned; an unvisited store says so.
- With no allocation, the store picker (`my_visit_stores`) offers nothing, a store picked by hand is allowed and standing in a known store is recognised.
- With a store allocated, the picker lists only their own stores; picking their own store is allowed; standing in their own store is recognised and `on_site`; a store picked by hand that is not theirs, or standing in one, is refused ("This store is not on your list. Ask your supervisor to add it.") and leaves no visit behind.

### Schedules and leave
- Without a pattern, Monday to Saturday are working days and Sunday is off; Monday to Friday means Saturday is off; only field staff have schedules (a supervisor has none).
- Pattern days are kept once each, in order; a supervisor sets one pattern for several of their team at once, with one audit row per person changed; one person outside the team refuses the whole list and nobody on it is changed; staff cannot set their own schedule; a supervisor cannot set or read one outside their team.
- An extra day in makes a day off a working day; an extra day off makes a working day off; a second change on the same date replaces the first; removing it puts the pattern back; a date more than a year ahead is refused; date changes are audited (`schedule.override`, `schedule.override_remove`).
- A request starts pending; only the four types are accepted; a reason is required; the last day cannot be before the first; a start exactly 7 days back is accepted, more is refused; a request overlapping one still waiting, or approved leave, is refused; cancelled and rejected requests do not block asking again.
- Only a pending request can be cancelled, and only by the person; an approved one cannot.
- Staff cannot decide leave; nobody decides their own (not even an admin); a supervisor cannot decide outside their team; a decided request cannot be decided again; the decision is audited (`leave.approve` / `leave.reject`).
- A pending or rejected request does not change the day; approved leave makes each of its days `leave`, and the day after it is working again.
- `my_calendar`: a day with a clock-in shows it; a past working day with no clock-in is missed; today is not missed yet; nothing is missed before the account was made; approved leave shows as leave.

### Clock-out reminders
- The shift end is the home store's, or 18:00 with no store.
- Nobody is reminded before their shift ends; the first goes at the shift end, not to anyone not clocked in or already out, and to everyone else whose shift has ended; claiming again hands back nothing the second time.
- The second does not go before an hour has passed and goes an hour after the shift end; never more than two a day; none after they clock out; somebody with no store is not reminded at 17:00 but is at 18:00.
- A late job sends one reminder, the second, not both at once, and the first is not sent after it.

### Activity log (0062)
- `user_activity` holds sign-ins, sign-outs, app opens, password and profile photo changes; the kind is checked (`sign_in`, `sign_out`, `app_open`, `password_changed`, `photo_changed`), platform is `web`/`android`/`ios` or null. Append-only: nobody (not even an admin or the service role) inserts, updates or deletes directly.
- Only `record_activity()` (service role only) and `set_my_avatar()` write it. An unknown kind is refused ("Unknown activity: …"); an unknown platform is read from the browser string (`XtendApp` + Android/iPhone, else web).
- An app open is kept at most once per person per platform in 30 minutes (`record_activity` returns false otherwise); a different platform is its own row.
- A new profile photo is recorded inside `set_my_avatar` with the IP (`cf-connecting-ip`, `x-real-ip`, else the first `x-forwarded-for`) and browser string from the request headers.
- Admins read every row; staff (even their own) and supervisors read none.
- `activity_feed(from, to, user, kinds, limit)` is admins only ("Only admins can see the activity log" for anyone else); Lagos days (a sign-out at 23:30 Lagos is on that day, not the next); end before start is refused; at most a year; newest first; limit kept (max 5000). It adds clock-ins/outs (`attendance`), store check-ins/outs (`store_visits`), daily reports, stock counts (one per person, store and day), X Metrics counts and sales, leave asked for and cancelled, and support messages the person wrote (not office replies), each with a plain-English label.
- `purge_user_activity()` (service role only, nightly) deletes rows older than 180 days and keeps newer ones.

### Teams
- A supervisor with no shared outlet and no reporting line does not supervise someone; naming them as supervisor does; they may edit that person but not an admin; sharing an outlet with an admin is not supervision.
- A supervisor creates merchandisers and marketers only; an admin creates anyone; a merchandiser nobody.
- Only supervisors/admins can be named supervisor; nobody supervises themselves.
- Demoting a supervisor releases their reports; supervisors are not offered the supervisor list.

### Retention
- Both images of an expired clock event are listed; a photo taken today is not; forgetting nulls both paths and keeps the row; nothing is listed twice; visit photos follow the same rule.
- The sweep throttle allows one run per period; admins alone see retention status; SQL deletes on storage are refused.

### Stock counts
- The same product name twice (any case or spacing) is refused.
- Month end is the last 3 days of each month (28–30 Sep, 26–28 Feb, 31 Dec).
- Outside month end with no request, counting is closed and refused.
- Only supervisors/admins request; a supervisor only their own team; due dates not past; supervisors are not asked; duplicates collapse; only the requester or an admin closes.
- Counting: whole numbers 0 up, named products, no duplicates, own stores only, supervisors cannot submit; new names are created tidied; same-day recount replaces; counts link to the request; suggestions offered.
- A count must be in the store (radius + 25 m) with accuracy ≤ 100 m and a fresh, checked, unused shelf photo.
- Units missing beyond the threshold are flagged for that product only; a same-day correction clears the flag; identical and round-number counts are flagged; more units is a delivery.
- Sheet lines keep back store, shop floor and expiry with in_store as their total; blank figures are not counted; off-sheet products still count; half units, empty lines and bad dates are refused.
- Count sheets: only when a count is open, own store, own folder, Excel/PDF/JPG/PNG, ≤ 10 MB, once; sending one counts as counted. The template is an admin's PDF.
- A role set not to count cannot count or be asked; it can still send X Metrics; built-in roles can be turned off and on; admins always count.

### Photos and integrity
- A selfie never uploaded, older than 30 minutes, someone else's, already used, rejected, unchecked-by-the-server, or missing is refused; one the checker could not check (service down) is accepted.
- The same GPS point as another day and 1 m accuracy are flagged; walking round the store is not a journey; Lagos to Abuja in seconds is.
- Nobody reviews their own flags; an admin reviews with a note.
- Bulk review: a supervisor reviews only their team's; a reviewed flag keeps its first review; an admin reviews anyone's; a blank note is null; empty list refused; field staff refused.
- Every kind raised by triggers and routes is allowed by the CHECK constraint.

### Places
- A staff-named place is found by the next person 15 m away, tidied; 1 km away it is not.
- The same spot is recognised whatever a map calls it, counted again, visitors remembered; inside a store nothing is learned; one-letter names refused.
- A store's name 17 km away, or containing it, is refused; next to the store it is allowed; a common word is not a clash.
- Naming needs a fresh checked storefront photo (not a shelf, not a house), and one photo names one place.
- An own-named place visited only by its namer is flagged once on the third visit; one others visit is not.
- At most 10 staff names a day; map names unlimited and need no photo.
- A good clock-in spot near a waiting store is kept with only waiting stores as candidates; a rough one is not; a second person joins it. Only an admin pins; the store takes the position, the place goes, a pinned store is not re-pinned, and clock-ins there are then `on_site`.
- Mandatory naming: rough fixes and disagreeing shutter positions ask nothing; when they agree the surer reading is kept; other work waits; the selfie must hold a product; naming must be from the spot, accurate, with sign and selfie positions close; once named nothing waits; the next person is recognised; staff cannot dismiss.

### Phone evidence and excuses
- No clock-in with notifications off; only real push services and real app tokens count; nobody excuses themselves; an admin can.
- Beacons are recorded, deduplicated within 15 s, and give the server time.
- Clock timing: live; phone clock 2 h out; offline unproven; offline confirmed; backdated by anchor; network was available; backdated by nothing waiting. A wrong phone clock is stored and flagged with its minutes.
- `check_excuse` lists every contact and the battery before; `check_excuse_more` lists positions, problems, refused photos and queued work; windows up to 3 days; checks are kept with verdict, checker and note; staff cannot check or push each other; a phone check is reused within 2 minutes.
- Movement trail: a supervisor sees a team member's day in time order with clock-in and store geofence; staff cannot follow each other.
- Offline positions: kept at their time, marked offline, raise no alert, resends skipped, wrong clocks corrected, nothing older than a day, made-up ones refused and flagged; they count as "phone on" in excuses and appear on the route.

### Profiles and roles
- A photo changes only through `set_my_avatar`, from one's own uploaded file; onboarding is remembered.
- Names must be names and phones Nigerian mobiles.
- Text rules: links and bare domains are not clean; two letters, dots or one key held are not a report section.
- Temporary passwords are kept until the person picks their own.
- Added roles: unique names, no built-in names, never admin-like; setting one sets the base role; changing role alone clears it; nobody changes their own.

### X Metrics
- SKUs are unique; stores must be enrolled by an admin; counts must be in the store with their own checked photo, whole numbers, captured within 3 days.
- The first count is opening stock dated when taken; supplies record who logged them, cannot be future-dated, admin only.
- Sales need a photo while the setting is on; resending a day supersedes and keeps the first.
- Reconciliation is admin-only; expected = last count + supplied − sold; a 25% gap with 5% tolerance is a high `stock_discrepancy`; a first-counted product is its own baseline; each count once.
- Expiry: 100 days left → 180-day window, selling fast → not pulled; 20 days left with no sales → 30-day window, consider pulling; each window once; alerts handed out once.
- Settings history is kept; weights must sum to 100.
- Grade 37.5 Poor from sales 50, accuracy 0, expiry 100; the latest target counts; a day present with on-time sales and a count is fully consistent; finalising needs the month ended; staff see their own grade only.
- Policies: staff cannot publish; reads recorded once; new versions current, old kept.
- Voids need a reason and happen once.
- Cartons: a size is needed; 10 × 24 = 240 units with cartons kept; the product learns its size; units still allowed. Imports log all or nothing, report the failing line, tie supplies to the file, admin only.
- Switches (0063): all on after migrate; only admins switch (staff and supervisors refused, directly or through the function); each change kept in history with who; supplies off refuses supplies and imports; sales off refuses staff sales (plain words) and targets; reconciliation skips with supplies or sales off and the counts wait; expiry off raises no alerts and keeps dates; grades leave out what is off; grading off refuses grades, lists nobody, refuses finalising and keeping grades; X Metrics off turns every part off, refuses counts in plain words and the sweep does nothing; nothing deleted; back on, waiting counts are settled as baselines with nobody flagged, sales, expiry alerts, full grades and supplies resume; other setting changes keep the restart date.

### Background tracking
- Only field staff get a token; only its hash is kept; positions are stored as the person's (fresh live, older offline at their time); mock positions flagged; resends skipped; unknown tokens refused; nothing from before the token; a new token retires the old; clocking out stops the token; after clock-out the phone is told to stop and the token ends.

### Support and notifications
- A new thread waits; the wait runs from the member's message, not the helper's; a person answering clears the wait; writing again restarts it.
- Threads go to the member's supervisor or an admin, never the member or outsiders; staff cannot assign; reopened threads go back waiting; only closed threads reopen; members cannot reopen.
- Starter quick replies (≥ 5) and templates (≥ 4) exist.
- A supervisor's schedule reaches only their team; no past times; staff cannot schedule; only the sender or an admin cancels, once; the job claims a due schedule once and marks it sending; one stuck over 15 minutes becomes failed; "send now" works once.
- The log names the sender, counts reads, recognises the sender, and separates alerts and support replies from messages.
- Push targeting: everyone reaches all active staff for an admin; role, outlet and named-people audiences reach exactly those; a merchandiser reaches nobody.

### Ask Xtend
- An admin keeps a chat as their own with turns counted; nobody else (not even a supervisor) sees, renames or deletes it; the owner renames (and it stays theirs) and deletes it; field staff cannot keep chats.

### Updates
- The minimum app build is the highest any live release set; withdrawing a release removes its minimum; each phone reports one row per platform; a new build is recorded at once.
