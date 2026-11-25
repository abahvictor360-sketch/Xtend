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
   - `supabase/migrations/0092_photo_flags.sql`;
   - `supabase/migrations/0094_reports_for_recent_days.sql`;
   - `supabase/migrations/0095_offline_movement_always_kept.sql`;
   - `supabase/migrations/0096_every_synced_position_kept.sql`;
   - `supabase/migrations/0097_allocate_from_store.sql`;
   - `supabase/migrations/0098_delete_for_good.sql`;
   - `supabase/migrations/0103_close_public_key.sql`;
   - `supabase/migrations/0104_ai_knowledge.sql`;
   - `supabase/migrations/0105_clock_out_window.sql`;
   - `supabase/migrations/0106_on_site_only.sql`;
   - `supabase/migrations/0107_offline_clock_day.sql`;
   - `supabase/migrations/0108_pause_on_fake_location.sql`;
   - `supabase/migrations/0109_ai_limits.sql`.
   (`0093_reset_clock_out.sql` is done: you ran it on 2026-11-18;
   0099, 0100, 0101 and 0102 are done: you ran them on 2026-11-24.)
4. **Turn off self sign-up in Supabase**: Authentication → Sign In /
   Providers → turn off **Allow new users to sign up** (self-hosted: set
   `DISABLE_SIGNUP=true` in the Supabase server's `.env` and restart). Staff
   are only ever created by you on Staff, which keeps working.
5. **Clock-out reminder fix (0069)**, if never pasted:
   ```sql
   alter table public.clock_out_reminders drop constraint if exists clock_out_reminders_stage_check;
   alter table public.clock_out_reminders add constraint clock_out_reminders_stage_check check (stage in (1, 2, 3, 4));
   ```
6. **Scheduled jobs on the new server**: check that the alerts job (every 5
   minutes) and the two nightly jobs run with the right `CRON_SECRET`. When
   the nightly job does not run, old photos are not deleted on time and
   forgotten store check-ins were not closed (0086 now covers the second).
7. **Android signing secrets** (`ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`): until they are set,
   each new APK cannot replace the old one, and phones say "App not
   installed". Staff must uninstall, then install again.
8. **New phone app builds**: several fixes below say "needs a new app build".
   Publish the latest APK (and TestFlight build) so staff get them.
9. **Add `SITE_URL=https://www.withxtend.com`** to the environment in
   Dokploy (no rebuild), so the server always knows its real address.
10. **Try fingerprint sign-in on one Android phone and one iPhone** before
   telling all staff (it could not be tested on a real phone here). Sign in
   with the password in the new app, tap **Use my fingerprint**, sign out,
   then tap **Sign in with fingerprint**.

---

## 2026-11-25

### Limits on how much each person can use the AI
- **What was done:** every AI answer is paid for by your key, so each
  person now has a limit per hour and per day: 15 an hour and 40 a day for
  the staff helper, 40 an hour and 200 a day for Ask Xtend, to start. You
  can change them on **Settings → AI keys → Limits per person**, which also
  shows how many answers were given today and to how many people. The
  counts are kept in the database, so they hold even when the server
  restarts.
- **The impact:** a phone stuck sending messages, or someone misusing an
  account, cannot run up your AI bill. Past the staff helper's limit the
  office answers the message instead; past Ask Xtend's, the person is told
  when they can ask again.
- **What you need to do:** run `supabase/migrations/0109_ai_limits.sql` in
  Supabase and redeploy. Adjust the limits if you like.

### A fake GPS app locks the person out
- **What was done:** when a phone reports that its location comes from a
  fake-GPS app (at clock-in, or from the app's positions during the
  shift), that merchandiser or marketer is paused at once. They are signed
  out on every page, their phone stops sending positions, and the login
  page says **Your account is paused. Contact your supervisor or admin.**
  They are not told why. The clock-in that showed it is kept, with its
  photo, and the "fake GPS app in use" flag is on Integrity, so you have
  the evidence when you question them. You (and their supervisor) get the
  flag alert. When you are done, open **Staff**: they show **Paused: fake
  GPS app**; press **Unpause** (admins, or their own supervisor). Lifting
  it is written to the audit log.
- **The impact:** nobody can carry on working with a fake location.
  Detection relies on the Xtend Android app (it reads Android's own
  fake-location flag); iPhones and browsers cannot report it, so they are
  not paused this way.
- **What you need to do:** run `supabase/migrations/0108_pause_on_fake_location.sql`
  in Supabase and redeploy. No new app build is needed.

### Can a clock-in happen without its location and photo? Can one be lost?
- **What was checked:** whether anyone can clock in without the server
  getting where they were and their selfie, and every way a clock-in could
  go missing between the phone and the server.
- **What I found:**
  - The server cannot store a clock-in without its position (latitude,
    longitude and accuracy are required) or without a selfie taken in the app
    just now, checked, and never used before. The only clock-ins with no photo
    are the ones a supervisor or admin enters for someone (Fix today's record),
    and each of those is in the audit log with who did it.
  - Three ways a clock-in could be lost or go wrong, now fixed:
    1. A clock-in saved with no signal was deleted after 8 failed tries to
       send it, which a weak signal can use up in minutes. Saved positions had
       the same problem. They are now kept until the server takes them.
    2. On a phone shared by two people, a clock-in one person saved with no
       signal was sent as the other person when they signed in. Each saved
       item now remembers who saved it and is only sent as them.
    3. A clock-out saved with no signal at 18:20 and sent after midnight was
       recorded on the next day. It now keeps the day it was taken (0107).
  - What remains by design: a clock-in saved with no signal must reach the
    server within 24 hours, or it cannot be accepted and the person is told
    to clock in again; a clock-in the server refuses (off site, no store
    picked) is not recorded and the person is told why; clock-in photos are
    deleted after 14 days (the place and the time stay);
    someone could still try to fake their position, which the integrity
    checks flag but cannot always prove.
- **What you need to do:** run `supabase/migrations/0107_offline_clock_day.sql`
  in Supabase and redeploy. No new app build is needed for these three.

### TECNO, Infinix and itel phones are walked through Auto-start and the lock
- **What was done:** the Xtend app now knows when it is on a TECNO, Infinix
  or itel phone. Before such a phone can clock in, Xtend shows **Auto-start
  and lock Xtend** with the steps: tap **Open Auto-start** (it opens Phone
  Master's Auto-start screen) and turn on Xtend, then open recent apps and
  pull Xtend down until a lock shows, then tap **I did both**. It is asked
  once per phone (again if the app is reinstalled). Android does not let an
  app check these two settings, so the person confirms them.
- **The impact:** on the phones that most often go quiet, staff set them up
  before they start, without you having to visit each phone.
- **What you need to do:** this is in the phone app: publish the new
  Android build and ask staff to install it. Phones on older app versions
  are not asked.

### Movement tracking: fixes for phones that went quiet
- **What was done:** I went through how movement gets from a phone to the
  office and fixed what made it go quiet or lose positions:
  1. An Android phone lying still with the screen off stopped sending,
     because its 2½-minute timer pauses while the phone sleeps. It now also
     sets a phone alarm that wakes it (in deep sleep Android may hold it to
     about 10 minutes). The same alarm restarts the tracker if the phone
     stopped it.
  2. Standing still indoors, it reused a position up to 10 minutes old or
     saved nothing. It now asks the phone for a fresh position.
  3. If the server ever refused the phone's tracking pass, the phone threw
     away every position it had saved offline. They are now kept and sent
     with the next shift.
  4. After clock-out, a phone that still had offline positions to send also
     kept collecting new ones. It now stops collecting at clock-out and only
     sends what it saved during the shift.
  5. iPhones only recorded after a 50 m move, so someone in one store all
     morning sent nothing. They now record every few minutes standing still.
  6. A position saved offline by the open app page was timed when it was
     saved, not when it was taken. Fixed.
  Positions saved with no signal were already kept and sent when the
  signal is back (that part worked; the server accepts them at any age).
- **The impact:** fewer "Updated 1 h ago" gaps; no lost offline movement;
  no tracking after clock-out.
- **What you need to do:** these are in the phone app, so publish the new
  Android build (and iPhone build) and ask staff to install it. On Tecno,
  Infinix and itel phones also turn on **Auto-start** for Xtend and lock it
  in recent apps (see the admin guide, Movement). Redeploy the website too.

### The attendance map shows each person's photo and name
- **What was done:** on Attendance → **Map**, every clock-in and clock-out
  is now the person's profile photo (or their initials if they have none)
  with their name underneath. The ring is green when they were at the
  store and orange when not, and a small **IN** / **OUT** badge says which
  it was. Tap a pin for the time and the distance from the store.
- **The impact:** you can tell at a glance who is where, instead of
  tapping each dot.
- **What you need to do:** redeploy. Staff without a profile photo show
  initials; they add one under You → Take your photo.

### Nobody can clock in off site
- **What was done:** clocking in, or checking in at a store, now only
  works at the store. Anyone who tries from somewhere else gets a pop-up,
  **You are off site**, every time they try. It names the store they must
  go to (a merchandiser's nearest store, or the store a marketer picked to
  start at), says how far away it is, and has a **Directions** button that
  opens the way in Google Maps. Once there they tap **I am at the store**
  and carry on. The phone stops them before the selfie, and the server
  refuses an off-site clock-in even if the phone is old or offline.
  Clocking out and checking out still work anywhere. The phone's accuracy
  gets up to 50 m of benefit of the doubt, so someone standing at the
  door is not shut out.
- **The impact:** no more off-site clock-ins. A store pinned in the wrong
  place will now stop everyone there, so check your store pins (Outlets →
  Check on Google Maps). Until a pin is fixed, a supervisor can clock the
  person in from their day page.
- **What you need to do:** run `supabase/migrations/0106_on_site_only.sql`
  in Supabase, then redeploy. No new phone app build is needed. To switch
  the rule off at any time:
  `update public.system_settings set block_off_site = false;`
  (`true` turns it back on).

### A retired AI model no longer stops Ask Xtend
- **What was done:** NVIDIA has also retired `openai/gpt-oss-120b`. Now,
  when the model you chose (or Xtend's default) has been retired, Xtend asks
  NVIDIA (or any OpenAI-format service) which models it offers today, picks
  the strongest one that answers, and uses it for that question and the
  ones after. Settings → AI keys shows the swap under **Now answering**.
- **The impact:** Ask Xtend and the staff helper keep answering when a
  service retires a model; you can still choose the model yourself.
- **What you need to do:** **redeploy** (your screen still shows the old
  message, so the last fixes are not live yet). Then ask Ask Xtend again.
  Afterwards, on Settings → AI keys, press **Test** next to the NVIDIA key
  and type one of the models it lists under **Which AI answers**, so the
  choice is yours rather than automatic.

### A Google Maps link now fills in the store's name and address too
- **What was done:** on Outlets, when you paste a Google Maps link of a
  store into **Or paste a Google Maps link**, Xtend now fills in the
  store's **name**, **address**, **latitude** and **longitude**. The name
  and address come from the link itself; when the link only has a
  position (a dropped pin), Xtend looks up the name and address at that
  spot on the map. Boxes you already typed in are kept, and if the link
  says something different, a **Use these** button lets you take its words.
- **The impact:** adding a store is one paste instead of typing three
  things. Always press **Check on Google Maps** before saving.
- **What you need to do:** redeploy. No migration and no new app build.

### NVIDIA retired the model Xtend used; Test now shows which ones work
- **What was done:** NVIDIA switched off `meta/llama-3.3-70b-instruct` on
  26 August 2026, and it was Xtend's NVIDIA default, so Ask Xtend got
  "error 410 … end of life". The NVIDIA default is now
  `openai/gpt-oss-120b`. When a model is unknown or retired, Ask Xtend now
  says so and tells you to press **Test**; **Test** then lists the models
  the service offers today, the strongest for Ask Xtend first.
- **The impact:** a retired model no longer leaves you guessing which name
  to type.
- **What you need to do:** redeploy. Then on Settings → AI keys, under
  **Which AI answers**, change the model for **both** Ask Xtend and the
  staff helper from `meta/llama-3.3-70b-instruct` to a current one (for
  example `openai/gpt-oss-120b`), press **Save**, then **Test**. If Test
  says it is not available, it lists names that are: copy one, Save, Test.

### Marketers' hours: 8:30 to 6:30, and they can clock out from 6:00
- **What was done:** each person can now have a **Can clock out from**
  time as well as their hours (Staff → Edit details). With hours 08:30 to
  18:30 and "can clock out from 18:00", clocking out any time from 6:00 pm
  is fine; before 6:00 pm it is marked as clocking out early. Clocking in
  after 8:30 is late, as before. Staff see "You can clock out from 18:00"
  under Your hours. Ask Xtend can set it too.
- **The impact:** marketers who finish between 6:00 and 6:30 pm are no
  longer marked as leaving early. People with no "can clock out from" time
  keep the old rule (more than 15 minutes before the end is early).
- **What you need to do:** run `supabase/migrations/0105_clock_out_window.sql`
  in Supabase, redeploy, then set the marketers' hours. Either ask Ask
  Xtend: "set all marketers to 08:30–18:30, they can clock out from 18:00"
  and press **Set hours** on the card, or change each person on Staff →
  Edit details.

### Ask Xtend works better with NVIDIA, and says what is wrong
- **What was done:** when Ask Xtend uses NVIDIA (or OpenAI, Gemini or
  OpenRouter) and the service refuses, Ask Xtend now shows what the service
  said and what to change, instead of "Something went wrong". Requests to
  NVIDIA are now shaped the way NVIDIA accepts (a shorter answer limit and
  simpler tool descriptions), and any refused question is tried once more
  in a simpler form before giving up.
- **The impact:** questions that failed with NVIDIA should now go through.
  If one still fails, the message names the cause: a key not accepted, a
  model name not known, your allowance used up, or the question refused.
- **What you need to do:** redeploy, then ask Ask Xtend again. If it still
  fails, send me the exact message it shows. On Settings → AI keys, press
  **Test** next to the NVIDIA key to check the key itself works.

## 2026-11-24

### Staff are told when the network is the problem
- **What was done:** Xtend now notices when a phone has no network or a
  weak one. Home shows **No network** or **Your network is weak**, says what
  that means (a clock-in is kept on the phone and only counts once it
  sends; store check-ins need network; the location is slower to find) and
  what to do: turn on Mobile data, check there is data on the line, move
  near the door or a window. When it comes back it says **Your network is
  back**. If a clock-in, store check-in or check-out fails because it could
  not reach the office, a pop-up says **Your network is not working**, with
  steps and a Try again button. If the location fails because the network
  is weak, it says so (**Weak network: your location is slow**) instead of
  telling them to change a phone setting. The staff guide and the AI helper
  explain it too.
- **The impact:** staff stop guessing why the app "is not working" when it
  is really their data or signal, and stop thinking a clock-in saved on the
  phone has already counted. Fewer calls to supervisors about it.
- **What you need to do:** nothing beyond redeploying. No migration and no
  new phone app build.

### The AI helper answers from a much richer staff guide, and from your notes
- **What was done:** the staff guide (You → How to use Xtend) is much
  fuller. Clock in now explains your hours and how marketers start the day
  at a store. A new **When Xtend stops you** section lists every pop-up
  (location, notifications, selfie, phone time, no stores, store not on the
  list and more) with the same steps the pop-up gives, for Android and
  iPhone. A new **Questions staff ask** section answers 19 common questions.
  The AI helper in Message support now reads this whole guide with every
  question, plus where the person is in their day (clocked in or not, the
  store they are checked in at, how many stores they have, their hours). On
  **Settings → AI keys** there is a new box, **What the AI should know**,
  where you write what the guide does not say; the helper and Ask Xtend
  both read it.
- **The impact:** once you add an AI key, staff get answers that match
  exactly what the app and the guide say, worded for their situation, and
  anything the guide and your notes do not cover goes to the office instead
  of a guess. Your notes are only ever read by the server, and every save is
  in the audit log.
- **What you need to do:** run `supabase/migrations/0104_ai_knowledge.sql`
  in the Supabase SQL editor (short, safe to run again), redeploy, then on
  Settings → AI keys add a key and fill in **What the AI should know**: who
  staff call for pay, leave or a broken phone, office hours, store rules,
  the products. Write only what staff may be told, never passwords or keys.
  No new phone app build is needed.

### Nobody can use developer tools to get into your data
- **What was done:** every browser can see two Supabase values in its
  developer tools: the project address and the public ("anon") key. That is
  normal for every Supabase app; the secret key never reaches a browser
  (checked earlier). What matters is what someone can do with the public
  key, so a copy of your database was built the way Supabase sets it up and
  attacked with it:
  - signed out, with only the public key: they read **nothing** (no staff,
    attendance, locations, photos, reports or stores), and can run nothing
    that acts with the database's own rights;
  - all photo and file storage is private;
  - one gap was found and closed: if Supabase self sign-up were left on, a
    stranger could make an account and read the store list, products, roles
    and X Metrics settings. Those now need an **active member of staff**, so
    a stranger's account, or a deactivated one, reads nothing;
  - and the public key's rights in the database are removed altogether, so
    even a future mistake cannot expose anything to it.
  A check (`scripts/check-anon-exposure.sh`) repeats this attack after
  every change.
- **The impact:** the values a hacker can see in developer tools give them
  nothing.
- **What you need to do:** run `supabase/migrations/0103_close_public_key.sql`
  in the Supabase SQL editor, then turn off self sign-up in Supabase (see
  "Waiting on you"). No redeploy needed for this one.

### Migrations 0099 to 0102 are in
- **What was done:** you ran 0099 (store check-out reminders), 0100 (working
  hours per person), 0101 (marketers start the day at a store) and 0102 (AI
  keys) in seven short parts; they are off the "Waiting on you" list.
- **The impact:** once the latest code is deployed, everything from today's
  changes works.
- **What you need to do:** redeploy if you have not since PR #109; make sure
  every marketer has stores allocated and their hours set on Staff; add an AI
  key on **AI keys** and press **Test**.

### Add AI keys yourself: OpenAI, Gemini, Anthropic, NVIDIA, OpenRouter
- **What was done:** a new admin page, **AI keys** (Setup menu). Paste a key
  for any of Anthropic (Claude), OpenAI (ChatGPT), Google Gemini, NVIDIA or
  OpenRouter (each has a **Get a key** link), press **Test** to check it
  works, then choose under **Which AI answers**:
  - **Staff helper**: answers staff in Support. It now also explains why
    something is not working and what to do (picking a store, no stores and
    sending Google Maps links, notifications, selfies, location, the phone's
    time), points them to the staff guide, and passes anything it cannot
    handle to the office;
  - **Ask Xtend**: answers you and supervisors.
  Keys are stored encrypted and never shown again (only the last 4
  characters); saving or removing one asks for your password, and each
  change is in the audit log. Photo checks and reading PDF invoices use the
  Anthropic key. The key set on the server before still works if you add
  nothing.
- **The impact:** you choose and pay for the AI you want, and staff get help
  even when the office is busy.
- **What you need to do:** run `supabase/migrations/0102_ai_providers.sql`
  in the Supabase SQL editor, redeploy, then add a key on **AI keys**.
  Optional: set `AI_KEYS_SECRET` (any long random text) on the server before
  adding keys; without it the existing service key protects them.

### Marketers start the day at a store, and the app explains every refusal
- **What was done:**
  - When a marketer opens Xtend before clocking in (or taps **Clock in**), a
    box asks **Pick the store you are starting at**, from their own stores,
    nearest first. Picking one opens the camera: the clock-in selfie also
    checks them in at that store, so their day starts there. The box says
    their day only counts once they clock in at a store.
  - A marketer can no longer clock in without picking one of their stores,
    so nobody starts the day from home.
  - A marketer with no stores sees **No stores are allocated to you yet**:
    message the office the stores they visit, with each store's Google Maps
    link, and clock in once they are added. The picker also reminds them to
    send the office the Google Maps link of any new store.
  - Whenever a clock-in, clock-out or store check-in is refused, a box
    explains why and what to do, step by step: no stores, no store picked,
    a store not on their list, notifications off, the selfie not usable, a
    place to name first, the phone's time wrong, or already recorded. Every
    box has **Not sure? Read the staff guide**.
  - The check-out reminder now comes 20 minutes after check-in (was 25).
  - Merchandisers clock in as before.
- **The impact:** each marketer's day starts with a store check-in, and
  staff are told exactly what to do when something does not work.
- **What you need to do:** run `supabase/migrations/0101_start_day_at_a_store.sql`
  in the Supabase SQL editor (after 0099 and 0100), then redeploy.
  **Before you run it, allocate every marketer their stores** (Outlets,
  **Allocate staff**), or they will be asked to send you their stores and
  cannot clock in until you do.

### Working hours belong to the person, not the store
- **What was done:** clock-in and clock-out times used to be set on each
  store. They are now set on each person: on **Staff**, **Add staff** and
  **Edit details** have **Clock in by** and **Clock out from**. A marketer due
  at 09:00 is late after 09:00 wherever their first store is; every store
  visit after that is recorded with its own check-in and check-out time, as
  before. Stores no longer have times (the form, the store cards and the
  bulk import). When you run the update, everyone keeps their home store's
  current times, so nothing changes until you change it. Staff see their
  hours on Home and on **Account**, and cannot change them. Ask Xtend can set
  them too: "set all marketers to 09:00–17:00".
- **The impact:** lateness, the 5-minute reminders, the clock-out reminders,
  the no-show alerts and every attendance report now use each person's own
  hours, including marketers with no home store.
- **What you need to do:** run `supabase/migrations/0100_shift_times_per_person.sql`
  in the Supabase SQL editor (after 0099), then redeploy. Then set each
  marketer's hours on **Staff** (or ask Ask Xtend to set them for a group).

### No more blank "Application error" screen
- **What was done:** when a screen crashed, staff saw a white page saying
  "Application error: a client-side exception has occurred". The most
  common cause is a phone still holding the old version of Xtend after an
  update. Now:
  - before Xtend even opens, the phone checks for that and quietly reloads
    onto the new version by itself;
  - if a screen still fails, staff see what happened in plain words, with
    numbered steps and the right button: **No internet connection** (turn
    on data, then Try again), **Xtend has just been updated** (Load the new
    version), **Xtend had a problem on its side** (try again in a minute),
    or anything else (Load the new version, plus a short code like
    EKDZP7F to tell support). Loading the new version keeps work saved
    without signal, the sign-in and notifications;
  - every crash is written to the server log as "app screen crashed" with
    the same code, so the cause can be found from what the person reads out.
- **The impact:** no dead white screen; staff know what to do, and crashes
  can be traced and fixed.
- **What you need to do:** redeploy. When someone reports a code, search the
  server's logs in Dokploy for it (or send it to me).

### The app now guides staff through the day
- **What was done:**
  - **Your next step** on Home always says what to do now, with a button:
    clock in; then (marketers) check in at your first store; while in a
    store, "Check out of (store) before you leave"; then the next store,
    the report and clocking out.
  - **Marketers are asked to check in straight away**: right after clocking
    in, a box pops up: "You are clocked in. Now check in at a store", with
    **Check in here**, **Pick the store** or **Later, I am on my way**.
  - **Check-out reminders**: while a marketer is checked in at a store, the
    phone gets "Still at (store)? Check out of (store) before you leave" every
    25 minutes, until they check out (at most 16 times per visit).
  - **When something stops them**, such as location off, location not
    allowed for Xtend, a weak signal indoors, or the battery/location
    settings not finished, a box pops up with numbered steps for their phone
    (Android or iPhone) and a **Try again** button, instead of a one-line
    error.
- **The impact:** staff always know the next thing to do, and marketers
  forget fewer check-outs.
- **What you need to do:** run `supabase/migrations/0099_store_checkout_reminders.sql`
  in the Supabase SQL editor, then redeploy. The reminders are sent by the
  five-minute alerts job, so make sure it runs on the server.

### Clock-in no longer stuck on "Getting your location…" inside a shop
- **What was done:** the photo in your screenshot was not being rejected:
  the camera was still waiting for a location, so the button stayed grey,
  and the line under it ("…are rejected") made it look like a refusal.
  Inside the phone app, Xtend asked only the GPS, which often cannot lock on
  inside a shop or mall, and waited up to 25 seconds each time. Now it waits
  at most 6 seconds for the GPS, then uses the phone's quick network
  location (Wi-Fi and mobile network) instead. While it waits, the camera
  says "Finding your location. The button turns on as soon as it is found",
  and after 10 seconds tells them to move near the door or a window. The
  line under the camera now reads "Take the photo live here. Photos from
  your gallery, a screen or a printed photo are not accepted." The Android
  app also asks the GPS and the network location at the same time.
- **The impact:** clock-in inside stores is much quicker and no longer looks
  like the photo is refused. The location must still be accurate to 100 m.
- **What you need to do:** redeploy (the website part reaches the phones by
  itself). Install the new Android app build from this push for the
  GPS-and-network change inside the app.

### Checked: your secret keys cannot be seen in a browser
- **What was done:** checked that nobody can find your Supabase secret key
  (`sb_secret_…`) or any other secret key (Google, Anthropic, push, cron,
  Redis, Turnstile) by opening the browser's developer tools on Xtend. Fake
  marked keys were built into a test copy of the site and nothing a browser
  downloads contained them; the code, the repository (all history) and the
  phone app builds hold no key either. The only keys a browser sees are the
  ones meant to be public: the Supabase publishable (anon) key and the
  browser Google Maps key. Two new checks now run with every change so this
  stays true.
- **The impact:** none visible; it protects the database's master key.
- **What you need to do:** nothing. Two good habits: keep the browser Google
  Maps key (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`) restricted to your
  website in Google Cloud, and if a secret key was ever pasted into a chat,
  email or screenshot, create a new one in Supabase (Project Settings → API
  Keys) and replace it on the server.

### Clock-in: camera opens at once, slow phones find location sooner, selfie lens always starts on the front
- **What was done:** the clock-in used to find the location first and only
  then open the camera, so the waits added up. Now the camera opens the
  moment someone taps Clock in, while the phone finds its location at the
  same time; the shutter stays greyed out and says "Getting your
  location..." until the location is in. The place name is looked up while
  they frame the photo instead of before it. If a phone has found nothing
  after 4 seconds (entry-level phones such as the Tecno Pop 20, or anyone
  indoors), it also listens to the phone's network location, which is quick.
  The camera now always opens on the front (selfie) lens, even if the last
  person switched to the back one; the switch button is still there. The
  camera asks for a smaller picture, so it starts faster on cheap phones.
- **The impact:** clock-in and clock-out feel quicker, and phones that
  struggled to find GPS get a location sooner. A location still has to be
  within 100 m accuracy, as before.
- **What you need to do:** redeploy Xtend in Dokploy. No migration. Phone
  apps need a new build only if you want it inside the installed app; the
  web part updates on its own.

## 2026-11-21

### Delete test accounts and stores for good
- **What was done:** a store or account with records (clock-ins, visits,
  reports, counts) could not be deleted, only deactivated. Now, when you
  click **Delete** on **Staff** or under a store on **Outlets** and it has
  records, Xtend shows what they are (for example "12 clock-ins and
  clock-outs, 3 reports"), asks **"Are you sure you want to delete it?"** and
  asks you to type the name. When you type it and click **Yes, delete for
  good** (and enter your password if asked), the account or store is removed
  with all its records and photos. **Deactivate instead** is offered beside
  it. You cannot delete your own account or the last admin, and the audit log
  keeps a note of what was removed.
- **The impact:** test users and stores added by mistake no longer clutter
  Xtend. Use it only for those: a real person's history cannot be brought
  back once deleted.
- **What you need to do:** run `supabase/migrations/0098_delete_for_good.sql`
  in the Supabase SQL editor, then redeploy.

### Allocate staff from a store on Outlets
- **What was done:** every store on **Outlets** now has an **Allocate
  staff** button under it. Click it to see who works at that store, then
  search for a marketer or merchandiser by name (or tap **Merchandisers** or
  **Marketers**) and click **Allocate**. **Remove** takes someone off that
  store. Only that store changes: the person keeps their other stores. It is
  the same allocation as on **Store allocation**, just started from the
  store. Supervisors can do it for their own team. Each store's **Staff**
  figure now also counts people allocated there, not only those whose home
  store it is.
- **The impact:** you can staff a new store straight after adding it,
  without going to another page.
- **What you need to do:** run `supabase/migrations/0097_allocate_from_store.sql`
  in the Supabase SQL editor, then redeploy. (It works before you run it
  too, using the existing allocation; the migration makes it safe when two
  people allocate at once.)

### Find a store on the map from its address or a Google Maps link
- **What was done:** when you add or edit a store on **Outlets**, type the
  address and click **Find on map** (or press Enter). Xtend searches Google
  Maps, then OpenStreetMap, and fills in the latitude and longitude. When a
  few places match, it lists them and you pick the right one. There is also a
  new box, **Or paste a Google Maps link**: paste the store's link from
  Google Maps (the share link, the link in the address bar, or just the two
  numbers like 6.6019, 3.3516) and the position fills in at once. A **Check
  on Google Maps** link then shows where the pin landed.
- **The impact:** no more copying numbers by hand, and fewer stores pinned
  in the wrong place.
- **What you need to do:** redeploy. Google search works with the
  `GOOGLE_MAPS_API_KEY` you already have ("Places API (New)" enabled) and
  counts towards the monthly lookup limit; without it, OpenStreetMap is
  used.

## 2026-11-20

### Every synced position is kept
- **What was done:** whenever a phone syncs its saved movement, the server
  now stores every position it sends, at any age and at any time of day.
  The previous change still threw some away: positions from before the
  clock-in, after the clock-out, or from a day whose clock-in had not
  reached Xtend yet. Those are now kept too. When a clock-in reaches Xtend
  after that day's positions, they are joined to it automatically, with
  their distance from the clock-in. Only a position dated in the future, a
  broken one, or a copy already stored is skipped.
- **The impact:** **Movement** shows everything the phone recorded, however
  late it is synced. Positions that arrive late never raise "left the
  store" alerts after the event.
- **What you need to do:** run `supabase/migrations/0096_every_synced_position_kept.sql`
  in the Supabase SQL editor, after 0095, then redeploy. No new app build.

### Movement saved with no signal is always kept
- **What was done:** when a phone has no signal, the Xtend app saves the
  person's positions and sends them when the signal returns. Until now
  Xtend threw away positions more than 24 hours old, and a phone that was
  offline long enough to need a fresh tracking code lost what it had saved
  at the next clock-in. Now every saved position is kept, however late it
  arrives, as long as it was taken during one of that person's shifts
  (between their clock-in and clock-out). The phone also keeps them until
  they are sent. They show on **Movement** at the time they were taken,
  marked as sent late, and do not raise "left the store" alerts after the
  event. Positions outside a shift are still ignored.
- **The impact:** a full route for days with poor network, even when the
  phone only reconnects days later.
- **What you need to do:** run `supabase/migrations/0095_offline_movement_always_kept.sql`
  in the Supabase SQL editor, then redeploy. No new app build is needed.

## 2026-11-19

### Marketers write their reports later, for the right day
- **What was done:** a marketer can now write their reports after clocking
  out: in the evening, or the next morning before clocking in. They log in
  again (clocking out signs them out, but logging back in is allowed, and
  the message after clocking out now says so). **Report** first asks
  **Which day is this report for?**: **Today**, **Yesterday**, the other
  days of the past week when they visited stores (each showing how many
  stores and how many reports already written), or **Another day** with a
  date picker, up to 7 days back. Then, as before, **the whole day** or one
  of the stores they checked in at **that day**, so 15 stores visited
  yesterday can each get their own report this morning. The report is filed
  on that day: on their record, in Marketer reports and on their day page.
  Reports, photos and documents can be changed for 7 days. A future date,
  a date more than 7 days back, or a past day they did not work is refused
  in plain words. The staff guide and the staff video were updated.
- **The impact:** no more rushed reports, and no reports landing on the
  wrong day.
- **What you need to do:** run `supabase/migrations/0094_reports_for_recent_days.sql`
  in the Supabase SQL editor, then redeploy. Until it is run, reports for
  today still work, and a report for another day says the update is needed.

### The attendance report, redesigned with charts
- **What was done:** the PDF of the attendance report (**Export → Download
  day by day → PDF**) is now a designed report:
  - **Top:** the Xpel Beauty logo, the date (or dates) and what the report
    covers.
  - **Eight figure tiles:** came in, on time, late, absent, clocked in and
    out, still on shift, away from store, usual clock-in time, each with a
    small bar.
  - **Charts:** a ring of how the day went (on time, late, away from
    store, absent, leave or day off); a bar chart of when people clocked
    in, in half-hour slots, with the late ones in a lighter orange (over
    several days: each day's turnout); and a **By store** chart of who came
    in at each store.
  - **The summary** of the day in a shaded box, then **Who needs
    attention**: a card per list (did not clock in, late, away from their
    store, network trouble, clocked in by the office, did not clock out,
    still on shift) with a coloured count. Over several days each person is
    listed once, with their days ("Ada Obi · 2 days: Fri 13 Nov (24 min
    late), Wed 18 Nov (24 min late)").
  - **The table:** everyone, clocked in first, with a coloured label (On
    time, Late, Away from store, Absent, Day off, On leave), times, hours,
    distance, notes and a **Map** link. Page numbers on every page.
  - Excel, Word and CSV keep the table layout, with the same written
    account at the top.
- **The impact:** a report you can send to management as it is.
- **What you need to do:** redeploy the latest code. No migration.

### Attendance report: the Xpel logo, a written account of the day, and no doubled rows
- **What was done:**
  - The attendance report (**Export → Download day by day**) now carries
    the **Xpel Beauty logo** and opens with a **written account of the
    day**: how many came, were on time, late or absent, who clocked in and
    out and who is still on shift, then named lists: **Did not clock in**,
    **Late** (and by how much), **Clocked in away from their store** (how
    far, and where), **Network trouble** (their clock-in reached Xtend late
    because the phone had no signal), **Clocked in by the office** (with the
    reason), **Did not clock out** and **Still on shift**. For several
    days, a "Worth a look" list follows. The table follows, people who
    clocked in first.
  - **Rows appearing twice: fixed.** The other download, "Every clock-in
    and out", listed each person twice a day (one row for the clock-in, one
    for the clock-out). It is now **Clock-ins and outs with photos (one row
    a day)**: one row per person per day, clock-in and clock-out side by
    side, each with where, how far from the store, at the store or not, and
    its photo. It carries the logo too.
  - **Clocked in and out**: the **Show:** button and the list choice for
    the people who clocked in and also clocked out that day are now called
    "Clocked in and out", for a report of only full days.
- **The impact:** a report you can send as it is: branded, with the story
  of the day on top, and each person once.
- **What you need to do:** redeploy the latest code. No migration.

### Attendance reports: merchandisers or marketers
- **What was done:** on **Attendance**, a **Role:** row of buttons, All ·
  Merchandisers · Marketers, under the **Show:** buttons. The **Role** list in
  the filters now always shows (it used to hide when only one role was in
  use) and always offers Merchandiser and Marketer, plus any roles you
  added. Combine them: for example **Marketers** + **Clocked in**, then
  **Export**, gives a report of only the marketers who clocked in. The same
  Role list is on **Analytics**.
- **The impact:** separate reports for merchandisers and marketers in two
  taps.
- **What you need to do:** redeploy the latest code. No migration.

### Attendance reports: pick who, and clocked-in staff first
- **What was done:** on **Attendance**, under the filters, a new row of
  buttons, **Show:** Everyone · Clocked in · Clocked out · Still on shift ·
  Absent. Tap one, then **Export** (Excel, PDF, Word or CSV): the report has
  exactly those people, with their status. The same choices are in the
  **Show days** list, now worded plainly ("Clocked in (everyone who came)",
  "Clocked out", "Still on shift (not clocked out yet)"). The downloaded
  report now lists each day like the page: everyone who clocked in first
  (latest clock-in at the top), then those absent, then days off and leave.
- **The impact:** a report of only the people who clocked in (or only the
  absent) in two taps, and in the full report the people who worked are at
  the top.
- **What you need to do:** redeploy the latest code. No migration.

## 2026-11-18

### The staff video now talks them through it
- **What was done:** the staff video guide has a voice-over: a clear,
  friendly voice reads each step in plain words while the screen shows
  where to tap. Each step stays on screen until it has been said, so the
  video is now 5 minutes 38 seconds (8 MB). The captions stay, so it still
  works with the sound off. The voice is made on our own computer, not by
  an outside service.
- **The impact:** staff who find reading hard can just listen and follow.
- **What you need to do:** redeploy the latest code. Send the new video to
  anyone who got the silent one (same link:
  www.withxtend.com/guide/xtend-staff-guide.mp4).

### A video guide for staff
- **What was done:** a 3 minute 49 second video, **Xtend step by step**,
  made for phones (upright, no sound needed, large captions). It walks
  through 10 steps with the app's own screens and a circle on each button
  to tap: get the app (and "App not installed"), sign in, allow location,
  camera and notifications, **finish setting up: location "Allow all the
  time" and battery "Unrestricted"** (and Auto-start on TECNO, Infinix and
  Xiaomi phones), the profile photo, clock in with a selfie, store check-in
  and check-out (marketers), the daily report, clock out, and what to do
  when something goes wrong. It opens the staff guide, on the website
  (`/guide`) and in the app (You → How to use Xtend), with a button per
  step that jumps to it and **Download the video to share**, for example on
  WhatsApp. Like the written guide, it says what to switch on, never why.
- **The impact:** staff can watch exactly where to tap instead of reading,
  and supervisors can send the video to new staff before their first day.
- **What you need to do:** redeploy the latest code. The video is at
  www.withxtend.com/guide/xtend-staff-guide.mp4 once deployed; share that
  link, or download it from the guide and send the file.

### Fix today's record: type what to do, and clearer choices
- **What was done:** on a person's day (Attendance → tap their name),
  **Fix today's record** now starts with a box, **Tell Xtend what to do**.
  Type it in your own words, for example "Clock Ada in at 8:05, phone would
  not open", "Clock out at 5pm, phone died", "Undo the clock-out, tapped by
  mistake", "Check in at Spar Lekki, GPS would not lock" or "Ask them to
  clock in again with a clear selfie", and press **Read it**. Xtend shows
  exactly what it will do (who, store, time, the reason they will see);
  press **Do it** and it is done. Tap an example to fill the box. Under it,
  the choices are now four clear groups: **Clock-in**, **Clock-out**,
  **Store check-in** and **Store check-out** (the last two for marketers).
  Every choice is always listed; one that cannot be used yet is greyed with
  the reason ("Not clocked in yet", "Not checked in at a store now").
  "Ask them to check in or out again" now lets you pick the store visit.
- **The impact:** fixing someone's day is quicker, and you can see every
  option, not only the ones that fit right now.
- **What you need to do:** redeploy the latest code. No migration.

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
