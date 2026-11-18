# Xtend: what changed and what it means

_The owner's record of every change to Xtend, in plain English. Newest first.
Each entry says **what was done**, **the impact** (what people notice, what it
protects or fixes) and **what you need to do** (a migration to run, a setting,
a new app build). The technical detail of every change is in
`docs/BUILD_GUIDE.md`, section 14._

_Every change to Xtend adds an entry here in the same commit (see `CLAUDE.md`)._

---

## Waiting on you

These are things only you can do. Tick them off as you go. (Claude cannot see
the live database, so it cannot tell which of these are already done.)

1. **Deploy the latest code** from the main branch before running the
   migrations below.
2. **Supabase → Authentication → Multi-Factor**: allow TOTP (needed for
   two-step sign-in, 0080).
3. **Run in the Supabase SQL editor, in this order** (each is safe to run
   again):
   - `supabase/reapply_0079_to_0085.sql` (0079, 0080, 0081, 0082, 0083,
     0085 in one file);
   - `supabase/migrations/0084_app_only.sql`;
   - `supabase/migrations/0086_close_stale_visit_on_check_in.sql`;
   - `supabase/migrations/0087_clock_in_checks_in.sql`;
   - `supabase/migrations/0088_report_per_store_or_day.sql`;
   - `supabase/migrations/0089_quick_sign_in.sql`;
   - `supabase/migrations/0090_field_corrections.sql`;
   - `supabase/migrations/0091_visit_checkout_photo.sql`;
   - `supabase/migrations/0092_photo_flags.sql`.
   (`0093_reset_clock_out.sql` is done: you ran it on 2026-11-18.)
4. **Clock-out reminder fix (0069)**, if never pasted:
   ```sql
   alter table public.clock_out_reminders drop constraint if exists clock_out_reminders_stage_check;
   alter table public.clock_out_reminders add constraint clock_out_reminders_stage_check check (stage in (1, 2, 3, 4));
   ```
5. **Scheduled jobs on the new server**: check that the alerts job (every 5
   minutes) and the two nightly jobs run with the right `CRON_SECRET`. When
   the nightly job does not run, old photos are not deleted on time and
   forgotten store check-ins were not closed (0086 now covers the second).
6. **Android signing secrets** (`ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`): until they are set,
   each new APK cannot replace the old one, and phones say "App not
   installed". Staff must uninstall, then install again.
7. **New phone app builds**: several fixes below say "needs a new app build".
   Publish the latest APK (and TestFlight build) so staff get them.
8. **Add `SITE_URL=https://www.withxtend.com`** to the environment in
   Dokploy (no rebuild), so the server always knows its real address.
9. **Try fingerprint sign-in on one Android phone and one iPhone** before
   telling all staff (it could not be tested on a real phone here). Sign in
   with the password in the new app, tap **Use my fingerprint**, sign out,
   then tap **Sign in with fingerprint**.

---

## 2026-11-18

### Migration 0093 run
- **What was done:** you ran `0093_reset_clock_out.sql` in Supabase; it is
  ticked off the "Waiting on you" list.
- **The impact:** **Undo … clock-out (back on shift)** works once the latest
  code is deployed.
- **What you need to do:** redeploy in Dokploy if you have not since PR #88.

### Undo a clock-out made by mistake
- **What was done:** when someone taps Clock out by mistake (or too early)
  and is still working, an admin, HR or their supervisor can now put them
  back on shift. On **Attendance**, tap their name, and under **Fix today's
  record** press **Undo <name>'s clock-out (back on shift)** with a reason.
  Their clock-out comes off, they are on shift again (the app shows Clock
  out again and their day carries on as normal), and they get a
  notification: "You are back on shift … Clock out again at the end of
  your shift." The old clock-out is kept in the record and the audit log.
  Ask Xtend can do it too ("Ada clocked out by mistake, put her back on
  shift"). The other choices are still there: clock them in or out
  yourself, or ask them to clock in or out again.
- **The impact:** a mistaken clock-out no longer ends someone's day: they
  show as on shift, and are reminded to clock out at the end.
- **What you need to do:** redeploy the latest code. (Migration 0093 is
  done: you ran it on 2026-11-18.)

### Attendance: who clocked in comes first
- **What was done:** in the Attendance day-by-day list, each day now shows
  everyone who clocked in first, with the latest clock-in at the top, then
  the people who did not clock in, then days off and leave. Days are still
  newest first. Tapping a column heading (Name, In, Late…) still sorts the
  list another way.
- **The impact:** no more hunting through the list to see who has and has
  not clocked in today.
- **What you need to do:** redeploy the latest code. No migration.

## 2026-11-17

### Nine more pages in the new look
- **What was done:** Marketer reports, Support, Messages, X Metrics,
  Integrity, Check an excuse, Notifications, Ask Xtend and the Admin guide
  now match the Attendance page: a clear title, figure cards with coloured
  icons and bars, headings with icons and tidy cards. New figures:
  **Marketer reports** shows store visits, stores reached, time in stores
  and reports filed (and who visited stores but filed nothing);
  **Messages** shows people, conversations, unread and people with no
  conversation yet; **Check an excuse** shows checks kept, how many fitted
  the evidence and how many were not true or doubtful. **Support**,
  **Integrity** and **Notifications** have the same figures as before in
  the new cards (tap "Needs a reply", "High, not reviewed" or
  "Notifications off" to go straight to them). The X Metrics tabs are now
  a tidy switcher, and both guides open with a card of sections to jump to.
- **The impact:** the whole dashboard reads the same way. Nothing about
  what the pages do has changed.
- **What you need to do:** redeploy the latest code. No migration.

### Eight more dashboard pages in the new look, and the top bar fixed
- **What was done:** Overview, Alerts, Movement, Store visits, Leave,
  Schedules, Outlets and Places now look like the Attendance page: a clear
  title with the date, four figure cards with coloured icons and small
  bars (tap one to see the people or records behind it), headings with
  icons, a red-edged "Worth a look" card, and the long explanations folded
  under "How … works". New figures: **Leave** shows requests waiting, who
  is away today, approved and rejected; **Schedules** shows who works
  today, who is off and who is on leave; **Outlets** shows stores with no
  location yet and stores with nobody in them; **Places** shows names to
  check and stores waiting for their location. Store and leave cards were
  redesigned too. **Top bar:** your name and role at the top are now a
  button that opens your account (two-step sign-in, fingerprint and
  passkeys, change password, sign out); on a phone it is the round button
  with your initials. **Add staff** now always opens the new-staff form and
  jumps to it, even when you are already on the Staff page. Tapping
  **Admin** under "View as" takes you back to the Overview.
- **The impact:** every page reads the same way, and what needs you stands
  out. The two top-bar buttons now do something when tapped.
- **What you need to do:** redeploy the latest code. No migration.

### The side menu, tidier and quicker to use
- **What was done:** the dashboard's side menu has a **Find a page** box at
  the top: type "stock", "leave" or "visits" and only those pages show.
  Each group (Attendance, Stock, Checks, People, Setup) now folds away with
  a tap; the group of the page you are on opens by itself, and the menu
  remembers which groups you opened. The page you are on stands out in
  orange. **Alerts** shows how many alerts are open and **Integrity** how
  many flags are waiting, with a red dot on a folded group that has some.
  At the bottom, one card with your name opens Two-step sign-in,
  Fingerprint and passkeys, Change password and Sign out. On a phone, the
  menu has the same search box and counts.
- **The impact:** a shorter, calmer menu where the things that need you
  stand out. Nothing else changes.
- **What you need to do:** redeploy the latest code. No migration.

### The Attendance page, tidied up and modernised
- **What was done:** the Attendance page has a cleaner layout. The date and
  number of people sit in the header; the filters are in one card, with the
  long explanation folded under **How attendance is counted**. The figures
  are four large cards (Came in, Absent, Late, Off site) with an icon and a
  bar showing the share, plus a strip with On time, Usual clock-in, Hours on
  shift and No clock-out. **Not clocked in today** and **Late today** show
  initials, a count and round **Call** and **Movement** buttons. **Worth a
  look** is a tidy card instead of a red block. The calendar and the day by
  day table have clear section titles.
- **Also fixed:** every table in the dashboard was losing its cell spacing
  and its column headings were not lined up with the columns. They now
  line up, on every page with a table.
- **The impact:** easier to read at a glance, on a computer and on a phone.
  Nothing changes in what is counted.
- **What you need to do:** redeploy the latest code. No migration.

### A person's day, redesigned, with every photo and a way to flag one (migration 0092)
- **What was done:** tap a name on **Attendance** to open their whole day on
  one page: their photo, role, store, team and a **Call** button, arrows for
  the day before and after, the main figures, **Photos of the day** (every
  clock-in, clock-out, store check-in and check-out photo, large, with the
  time, store, where they were, how far from the store and a map link), the
  day in order, their reports and the flags of the day. Under each photo,
  admins and the person's own supervisor can **Flag this photo** (not the
  right person, not taken at the store, a photo of a photo or a screen,
  face not clear, or something else with a note).
- **The impact:** you can check every photo by location in one place. A
  flagged photo gets a red border and goes to **Integrity** with the other
  flags, where it can be looked at; it can be changed or removed. The
  person is never told. Every flag is in the audit log.
- **What you need to do:** run `0092_photo_flags.sql` (after 0091, in the
  list above) and redeploy.

### Store check-ins and check-outs with both photos (migration 0091)
- **What was done:** marketers now take a selfie when they check out of a
  store, as when they check in. **Attendance** rows say how many stores
  were visited and open to every check-in and check-out with the times,
  how long they stayed, how far from the store and both photos. **Store
  visits** shows the check-out photo too.
- **The impact:** you can see where marketers were both when they arrived
  and when they left each store. Photos are deleted after 14 days like the
  others. Until 0091 is run, check-outs still work, just without the photo.
- **What you need to do:** run `0091_visit_checkout_photo.sql` and redeploy.
  No new app build (it is part of the website).

### Ask Xtend can fix someone's clock-in, clock-out or store visit
- **What was done:** you can now tell **Ask Xtend** things like "clock Ada
  in at Ikeja Mall at 8:05, her phone would not open", "clock Bala out, he
  left at 6" or "ask Kemi to clock in again". It shows a card saying exactly
  what it will do (who, which store, what time, your reason). Nothing
  happens until you press the button.
- **The impact:** the same as **Fix today's record** on the person's day,
  without opening the page. The same rules apply: today only, merchandisers
  and marketers only, a supervisor only for their own team, and a reason
  every time. The person is told, it is marked **By the office**, and it is
  recorded in the audit log.
- **What you need to do:** nothing new. It needs 0090 (in the list above)
  and the latest code deployed.

### Fixing the record of someone who never clocked in
- **What was done:** on **Attendance**, the names under **Not clocked in
  today** can now be tapped, and so can the names under **Attendance
  follow-up** on the Overview. Each opens that person's day, where **Fix
  today's record** is.
- **The impact:** when the app would not let someone clock in at all, the
  office can now reach them and clock them in. Before, only people who
  already had a clock-in today had a name to tap.
- **What you need to do:** nothing new. It needs 0090 (in the list above)
  and the latest code deployed.

### The office can fix a clock-in, clock-out or store visit (migration 0090)
- **What was done:** on **Attendance → a person's day**, a new **Fix
  today's record** panel lets an admin, HR (for field staff) or the
  person's own supervisor:
  - **record it for them**: clock in or clock out at one of their stores,
    at a time today they give (never in the future), or check a marketer
    in or out of a store. It is recorded at the store, with no selfie, and
    marked **By the office** with who did it and why;
  - **ask them to do it again**: clock in again, clock out again, check in
    again or check out again. Their Home shows "The office asked you to
    clock in again" with the reason, and their next capture replaces the
    old one.
  A reason is always required. The person gets a notification each time.
- **Impact:** when a phone fails (no GPS, a broken camera, no data) staff
  are no longer marked absent, and a wrong capture can be fixed the same
  day. Nothing is lost: the old record is kept word for word under
  **Corrections today** and in the audit log, and a replaced clock-in keeps
  the day's movement trail. Only the phone checks are skipped for an office
  entry; lateness still counts from the time given. Today only; past days
  cannot be changed.
- **What you need to do:** deploy, then run 0090.

### "Try again" in the app no longer opens Chrome on localhost
- **What was done:** when Xtend sent a person to the login page (after
  clocking out, at the start of a new day, or when the app reopened with an
  old login, often right after **Try again** on the "No connection" page),
  the server named the address itself. Behind your server's proxy it could
  only see its own name, `localhost:3000`, so the app opened Chrome on
  "localhost refused to connect". Now the server names no address at all:
  the phone moves to the login page on the address it is already on. The
  server's own idea of the site's address also no longer settles for
  localhost when the browser reports the real one. A new setting `SITE_URL`
  pins it for good.
- **Impact:** after clock-out, at a new day and after **Try again**, staff
  land on the Xtend login page inside the app, never in Chrome. The phone's
  background tracking address and passkeys can no longer pick up localhost.
  (The app's own "No connection" page was already fixed on 10 November; a
  phone with an app installed before then still has the old button.)
- **What you need to do:** deploy. In Dokploy, add the environment
  variable `SITE_URL=https://www.withxtend.com` and redeploy (no rebuild
  needed). Anyone whose app was installed before 10 November should
  install the latest one from www.withxtend.com/download.

### Sign in with a fingerprint, face or passkey (migration 0089)
- **What was done:**
  - **In the Android and iPhone apps:** after signing in with the password,
    Xtend offers "Sign in faster next time?". With **Use my fingerprint**,
    the login screen then shows **Sign in with fingerprint**: touch the
    sensor (or look at the phone) and you are in.
  - **In a browser (phone or computer):** the login page has **Sign in with
    a passkey**, which uses the device's own fingerprint, face or screen
    lock. A passkey is added once, from the offer after signing in, from
    **You → Security** (staff) or from **Fingerprint and passkeys** in the
    office menu.
  - Everyone sees their fingerprint and passkey sign-ins in the same place,
    with when each was last used, and can remove any of them.
- **Impact:** staff, who sign in every day, no longer type their password
  each morning. Fingerprints and faces never leave the phone; Xtend only
  keeps a key that is useless on its own. The password always still works.
  All the usual rules still apply: the daily sign-in, office time limits,
  app-only accounts, the 5-wrong-tries pause, new-device alerts, and admins
  and HR still enter their 6-digit code. A password reset by the office, a
  deactivation, or the person changing their own password switches off all
  their fingerprint and passkey sign-ins at once (useful when a phone is
  lost). Every sign-in shows in the Activity log with how it was done.
- **What you need to do:** deploy, run 0089, and publish the new app build
  (the fingerprint part is inside the app). Then try it on one Android phone
  and one iPhone before telling everyone. Passkeys only work on the address
  they were made on (www.withxtend.com).

### A report for one store, or for the whole day (migration 0088)
- **What was done:** when a marketer taps **Report**, Xtend first asks
  "What is this report for?": **The whole day**, or one of the stores they
  checked in at today. Each choice shows **Filed · edit** or **Not yet**.
  They can write one report for each store and one for the whole day. A
  store report shows just that store's visit above the form; the whole-day
  report shows all of today's visits. Photos and documents go on the report
  they were added to.
- **Impact:** the office can see what happened at each store, not only a
  summary of the day. In **Marketer reports** (PDF, Word, Excel) and in the
  Attendance overview of a person's day, every report is listed with what it
  is for ("Report for Shoprite Ikeja · filed at 16:30"). Any report filed
  today, store or whole day, counts as "report filed". Reports filed before
  this change are whole-day reports. Until 0088 is run, the app keeps
  working the old way (one report a day, no choice).
- **What you need to do:** deploy, then run 0088.

### Clocking in at your store checks you in (migration 0087)
- **What was done:** when a marketer clocks in standing inside one of their
  own stores, Xtend checks them in at that store at the same moment, using
  the clock-in selfie. The clock-in message adds "You are also checked in at
  [store]: check out of it before you leave for the next store."
- **Impact:** marketers who start the day at their first store no longer
  take a second selfie or press Check in. It is not done for a store that is
  not theirs, a weak location (worse than 100 m), a clock-in sent more than
  30 minutes late, or when a check-in is already open. If anything goes
  wrong, the clock-in still stands and they check in by hand as before. In
  Store visits, that visit has no photo of its own (the selfie is on the
  clock-in in Attendance).
- **What you need to do:** deploy, then run 0087.

### A forgotten store check-in no longer blocks the next one (migration 0086)
- **What was done:** a marketer who never checked out of a store on an
  earlier day was told "You are already checked in to a store" while the
  button still said Check in and Home showed nothing open. Home now shows a
  check-in left open from any day with its **Check out** button. A refused
  check-in names the store and switches the button to Check out. A new
  check-in also closes the person's own forgotten check-ins from earlier
  days (they show as "abandoned" in Store visits).
- **Impact:** nobody can get stuck unable to check in. Running 0086 also
  frees anyone stuck right now.
- **What you need to do:** deploy, then run 0086.

## 2026-11-13 to 2026-11-11

- **Shop search on Store allocation; stock count switches on Stock count.**
  Allocating stores to a person is quicker with many shops.
- **"Use the Xtend app" page no longer shows inside the app** for app-only
  accounts.
- **Battery step for TECNO, Infinix and itel phones:** an "I turned it off,
  continue" button where the phone cannot report the setting, and the app
  asks the phone directly. Staff on those phones are no longer stuck at the
  battery step. Needs a new app build.
- **Background movement reaches the server:** the phone was given a
  `localhost` address behind the new server, so no background movement was
  delivered. Fixed.
- **Authenticator shows "Xtend"** instead of the server address.
- **Android:** the bottom menu sits above the phone's own buttons; a splash
  screen covers the gap while the app loads. Needs a new app build.
- **Faster location fix** (stops sooner, same 100 m limit) and faster
  camera start; sign-out no longer lands on `localhost`.
- **Attendance:** click a staff name for a one-page overview of their day.
- **Movement saved with no signal is kept after the clock-out (0085).**
  Before, an offline day's trail could be lost entirely.

## 2026-11-10

### Zero trust (migration 0080)
- **What was done:**
  - **Two-step sign-in:** admins and HR enter a 6-digit code from an
    authenticator app after their password. Supervisors can turn it on;
    field staff never see it.
  - **Office sign-in limits:** an office sign-in lasts at most 12 hours and
    ends after an hour of inactivity.
  - **Password again for risky actions:** changing a role or email,
    deleting an account, a new password or deactivation for an office
    account, resetting two-step sign-in, the login sheet and the CSV import
    ask for the password if it was not given in the last 10 minutes.
  - **Origin check:** changes sent from other websites are refused.
  - **New-device alerts:** the person and every admin are told when an
    office account signs in on a new phone or computer.
- **Impact:** a stolen password alone no longer gives admin or HR power,
  even if someone bypassed the app. A computer left open at the office stops
  being usable after an hour. If an admin loses their phone, another admin
  presses **Reset two-step sign-in** on Staff.
- **What you need to do:** deploy first, then run 0080 (it is in the
  re-apply file), and allow TOTP in Supabase. Never run 0080 before the code
  is live: admins would lose their power. If no admin can sign in, run
  `update public.system_settings set mfa_roles = '{hr}';`, sign in, reset,
  then set it back to `'{admin,hr}'`.

### Field app and phone apps
- **Marketers must clock in before a store check-in**, and a check-in or
  check-out is only shown as done once the database has it. No more "looks
  absent all day" or false "checked in".
- **A clock in or out is only called done once the database has it.**
- **Admins can require the phone app instead of the website (0084)**, per
  person or for all field staff.
- **Supervisors, HR and admins can open photos** and review ones the
  automatic check could not check (0083).
- **The phone app must be allowed to run in the background** (location
  "Allow all the time", battery saving off) before a clock in or out, with
  plain steps to fix each setting. Movement is then recorded all shift.
- **Resets keep learned places (0081); everyone is told about a new app
  version (0082).**
- **Downloads work in the Android app** (login sheet, exports, documents,
  attachments).
- **Place names:** Google first again (shop names matter), and every event
  saves its place, so the next one there needs no map lookup.
- **Location required for store visits too**, like clock in and out.
- **Push fixed:** a mistyped `VAPID_SUBJECT` had stopped every push and the
  alerts job; it is now tolerated.
- **Live address is www.withxtend.com** for the apps and jobs. Needs a new
  app build.
- **Install help:** what to do when Android says "App not installed",
  and the "No connection" page's Try again now goes back to the site.

## 2026-11-08

### Several app containers and Redis
- **What was done:** Xtend can run as two or more copies behind the
  server's load balancer, sharing one Redis for attempt limits and cached
  answers.
- **Impact:** more staff can use it at once and an update replaces copies
  one by one, so no downtime. Without Redis everything still works.
- **What you need to do:** nothing unless you want several copies
  (`deploy/DOCKER.md` §7).

## 2026-11-05 to 2026-11-03

- **Security fixes (0079):** a supervisor can no longer reset the password of
  someone promoted above them; message attachments only open for the people
  in the conversation; report photos can never be overwritten; per-person
  hourly limits on photo checks, place lookups, the support helper and Ask
  Xtend; plain-English errors that reveal nothing about the system.
- **Saving cost:** Ask Xtend and common lookups are cached, so fewer paid
  AI and map calls.
- **Sign-in lockout (0077):** five wrong passwords pause signing in **on the
  device guessing**, not the account, so nobody can lock a colleague out by
  knowing their phone number. Staff shows who is paused, with **Unlock**.
- **Ready for Dokploy or Coolify (0078)** with a security pass; quieter
  response headers that do not advertise what Xtend is built with; bots and
  search engines blocked.
- **"A new version is ready" no longer comes back after Update** on the new
  server.

## 2026-10-28 to 2026-10-27

- **HR role and Messages (0071 to 0073):** HR handles people and
  attendance; each field worker has one conversation with their supervisor,
  with pictures and PDFs (0075) and the supervisor's name and photo (0076).
- **Office stock counts and supplies through Ask Xtend (0074):** type it or
  attach the sheet or invoice.
- **Follow live (0070):** follow one person moving on the map.
- **Ask Xtend can set work schedules.**
- **Location required to clock in or out**, including when the phone's GPS
  itself is off.

## 2026-10-23 to 2026-10-19

- **Test mode and reset (0066):** records from the trial can be cleared
  safely before going live.
- **View as:** an admin can try the app as a merchandiser or marketer.
- **Documents on the daily report and the stock count sheet on the You page
  (0064, 0065); report photos and documents survive a bad connection, files
  kept 14 days (0067).**
- **X Metrics can be switched off in parts (0063); Activity log (0062).**
- **iPhone app through TestFlight; Hostinger server deployment.**
- **Redesigned office overview, Movement map held to Nigeria, profile
  photos on the live map, larger tap targets and readability fixes.**

## 2026-10-16 to 2026-10-12

- **Work schedules and leave (0059); marketers limited to their stores and
  the Marketer reports page (0060); clock-out reminders (0061).**
- **The 5-minute alerts job moved to GitHub** (Vercel's plan refused it).
- **Updates banner and What's new (0057); live field dashboard (0056,
  0058); load test for 5,000 staff; admins can delete a staff account or an
  outlet; speed fixes.**
- **The rebuild pack** (`docs/rebuild/`) and the build guide, supervisor
  guide and admin guide.

## 2026-10-08 and earlier

- **2026-10-08 (0045 to 0055):** place naming, GPS from several readings, X
  Metrics dashboard, supplies, Ask Xtend proposing actions, Movement over
  several days, Audit log with location and device, location all shift with
  the app closed, advanced Attendance, Analytics, Alerts and Integrity.
- **2026-10-07 (0039 to 0044):** field rules, Xpel count sheet, staff login
  sheet, custom roles, X Metrics and its scoring.
- **2026-10-06 (0035 to 0038):** guides, onboarding, profile photos, paper
  count sheets, supervisor alerts, push hardening.
- **2026-10-05 (0030 to 0033):** VPN checks, support messages, Android and
  iPhone apps, download page.
- **2026-09-25 (0022 to 0029, 0034):** integrity flags, photo checks,
  learned places, excuse evidence, notifications required, movement trail,
  offline positions.
- **2026-09-24 (0019 to 0021):** Ask Xtend, store counts and count requests.
- **2026-09-10 to 11 (0009 to 0018):** live locations, store visits,
  allocation, photo retention, supervisors and teams.
- **2026-09-09 (0001 to 0008):** first build: clock in and out, dashboard,
  marketer role, push, no-show alerts, place names.
