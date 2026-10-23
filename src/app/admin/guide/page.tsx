import Link from 'next/link'
import {
  BarChart3,
  Bell,
  CalendarCheck,
  ClipboardList,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  Rocket,
  Route,
  Settings2,
  ShieldAlert,
  Smartphone,
  Users,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import {
  GuideContents,
  GuideSection,
  Questions,
  Steps,
  Tip,
  Ui,
  GuideShot,
  type GuideTopic,
} from '@/components/guide'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin guide — Xtend' }

const T = {
  start: { id: 'first-week', title: 'Your first week', icon: Rocket },
  daily: { id: 'every-day', title: 'Every day', icon: CalendarCheck },
  overview: { id: 'overview', title: 'Overview, Ask Xtend and the guide', icon: LayoutDashboard },
  attendance: { id: 'attendance', title: 'Attendance and Analytics', icon: ClipboardList },
  movement: { id: 'movement', title: 'Movement and Store visits', icon: Route },
  alerts: { id: 'alerts-support', title: 'Alerts and Support', icon: Bell },
  stock: { id: 'stock', title: 'Stock count and X Metrics', icon: Gauge },
  checks: { id: 'checks', title: 'Integrity and Check an excuse', icon: ShieldAlert },
  people: { id: 'people', title: 'Staff, teams, roles and notifications', icon: Users },
  setup: { id: 'setup', title: 'Outlets, places, audit and activity logs, updates, test mode', icon: Settings2 },
  apps: { id: 'apps', title: 'Staff phones and the app', icon: Smartphone },
  analytics: { id: 'exports', title: 'Downloads and records', icon: BarChart3 },
  faq: { id: 'questions', title: 'Questions', icon: HelpCircle },
} satisfies Record<string, GuideTopic>

/**
 * How to run the Xtend dashboard, page by page. Admins only: it covers
 * how location, checks and the phone app work, which staff and
 * supervisors are not shown. Staff have their own guide at /guide.
 */
export default async function AdminGuidePage() {
  await requireSession(['admin'])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin guide</h1>
        <p className="text-sm text-muted-foreground">
          How to use the dashboard, page by page, in the order of the menu. Only admins can see this
          guide. Staff have a short guide of their own at{' '}
          <Link href="/guide" className="font-semibold text-brand hover:underline">
            /guide
          </Link>{' '}
          (clocking in and out, stock counts, using the app and reporting a problem), which you can
          share with them. Times everywhere are Lagos time.
        </p>
      </div>

      <GuideContents topics={Object.values(T)} />

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection topic={T.start} intro="Do these once, in this order, before staff start clocking in.">
          <Steps
            items={[
              <>
                <Ui>Outlets</Ui>: add every store with its address, its map position, its shift start
                and end, and its radius (50–100 m for a kiosk or small shop, 150–300 m for a
                supermarket or mall). See <Ui>Outlets, places, audit and activity logs, updates</Ui> below.
              </>,
              <>
                <Ui>Staff</Ui>: add everyone, one by one or with <Ui>Bulk import CSV</Ui>, choosing
                merchandiser, marketer, supervisor or admin.
              </>,
              <>
                <Ui>Store allocation</Ui>: give each merchandiser their store. Their clock-in is measured
                against it. Marketers move between stores and do not need one.
              </>,
              <>
                <Ui>Teams</Ui>: put merchandisers and marketers under their supervisor. Supervisors then
                see only their own team everywhere in the dashboard.
              </>,
              <>
                Share the download page and the staff guide (see <Ui>Staff phones and the app</Ui>), and
                download <Ui>Login details (Word)</Ui> from Staff to hand out sign-ins.
              </>,
              <>
                Optional: set up <Ui>X Metrics</Ui> (products, stores, targets) if you score stock and
                sales, and publish the scoring policy.
              </>,
            ]}
          />
        </GuideSection>

        <GuideSection topic={T.daily} intro="Ten minutes each morning keeps on top of the field.">
          <Steps
            items={[
              <>
                <Ui>Overview</Ui>: who has clocked in, who is late, who has not come in yet, and open
                alerts.
              </>,
              <>
                <Ui>Alerts</Ui>: deal with anything open (someone left their store, clocked in away from
                it, or had location off), oldest first.
              </>,
              <>
                <Ui>Support</Ui>: answer the threads that need a person, longest waiting first.
              </>,
              <>
                <Ui>Integrity</Ui>: look at <Ui>Who to look at first</Ui> and review new high flags.
              </>,
              <>
                Late in the day: <Ui>Attendance</Ui> for missing clock-outs, and <Ui>Store visits</Ui>{' '}
                for short visits and stores nobody reached.
              </>,
            ]}
          />
          <Tip>
            Short on time? Ask Xtend: “who has not clocked in today?”, “anything I should look at
            today?”, “who forgot to clock out yesterday?”.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.overview} intro="The top of the menu. On a phone, tap the page name at the top to open navigation. Tap outside it or press Escape to close it.">
          <p>
            <Ui>Overview</Ui> is the first page each day: the week&apos;s clock-ins (point at a day for its
            figures), today&apos;s clocked in, late and not-in-store counts, who has not clocked in yet,
            open alerts, location coverage and everyone on shift. The tip card suggests the next thing
            worth doing. The search box at the top finds anyone on the Staff page.
          </p>
          <GuideShot src="/guide/admin-overview.png" alt="The overview page" width={2880} height={1800} caption="The overview, before anyone has clocked in" />
          <p>
            <Ui>Ask Xtend</Ui> answers plain questions about attendance, visits, stock counts, alerts,
            support, notifications, X Metrics and integrity, and makes downloadable reports (“make this
            week&apos;s attendance report”). Attach a list or a photo of a sheet and it prepares store
            allocations or team changes. Ask it to do something (“remind everyone who has not clocked in
            to clock in now”, “ask all merchandisers for a stock count by Friday”, “check Ada&apos;s
            phone”, “set Ikeja Mall&apos;s target to 500 units for October”, “deactivate Bala”, “show me
            Ada&apos;s movement yesterday”) and it shows a card saying exactly what will happen and to
            whom. Nothing happens until you press the card&apos;s button, and it is recorded in the audit
            log. Chats are kept under <Ui>Earlier chats</Ui>, for you alone.
          </p>
          <p>
            <Ui>Guide</Ui> is this page.
          </p>
        </GuideSection>

        <GuideSection topic={T.attendance} intro="Who came in, when, and where.">
          <p>
            <Ui>Attendance</Ui> shows each person&apos;s day: clock-in and clock-out, on time or late, at
            their store or not, and whether they clocked out. Pick a quick range or dates, then narrow by
            person, store, team, role or kind of day. The cards add it up; <Ui>Worth a look</Ui> names
            repeat absences, lateness, off-site clock-ins and missing clock-outs. The calendar has one
            square per person per day; tap one, or open a row, to see the photo, the map, the distance
            from the store and the phone used, with links to Movement and Check an excuse for that day.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Late means after the store&apos;s shift start. Off site means outside the store&apos;s
              radius; flagged means the location was not clear enough to tell.
            </li>
            <li>
              A working day without a clock-in counts as absent. Each person&apos;s schedule decides
              their working days; days off (grey “–”) and approved leave (soft orange “Lv”) never count
              as absent, here, in Analytics, the downloads, Ask Xtend or the 09:30 no-show message.
            </li>
            <li>Records cannot be edited or deleted, by anyone.</li>
          </ul>
          <p>
            <Ui>Analytics</Ui> compares any period with the same number of days just before it: trends,
            on time by weekday, clock-in times, leaderboards by person, store or team, and how well each
            store was covered.
          </p>
        </GuideSection>

        <GuideSection topic={T.movement} intro="Where staff are during their shift.">
          <p>
            <Ui>Movement</Ui> opens on a live map of everyone on shift, shown as their profile photo, with
            how many are in a store, away from it, or not heard from in 15 minutes. Click a photo to follow
            that person&apos;s movement. Pick a person and up to 7 days to see their journey:
            the stops they made (at their store or elsewhere, by name), the travel between them and the
            times nothing was heard, with a strip per day and totals. <Ui>Worth a look</Ui> points out
            impossible jumps (faster than 150 km/h, which a fake-location app makes), long silences
            (linked to Check an excuse) and long stays away.
          </p>
          <p>
            <Ui>Store visits</Ui> shows marketers&apos; rounds: where they checked in and out, for how long,
            how far from the store, with the check-in photo while it is kept. It points out very short
            visits, check-ins away from the store and visits too far apart to be real. <Ui>By store</Ui>,{' '}
            <Ui>By person</Ui> and <Ui>Store coverage</Ui> (stores nobody visited in 7, 14 or 30 days)
            add it up.
          </p>
          <p className="font-semibold">How location is recorded (not shown to staff)</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              From clock-in to clock-out the phone sends its position every few minutes, and at every
              clock-in, check-in and check-out.
            </li>
            <li>
              In the Xtend app it keeps coming even when the app is closed. On Android a small{' '}
              <Ui>Xtend · On shift</Ui> notification shows meanwhile, and it resumes after the phone
              restarts when location is set to <Ui>Allow all the time</Ui>. On iPhone, Apple only wakes a
              closed app when the phone moves about 500 m, so someone standing still with the app closed
              shows as a silence until they move or open it.
            </li>
            <li>
              Without network, positions are kept on the phone and sent later, at the time they were
              taken. A position sent after clock-out is refused.
            </li>
            <li>
              In a browser instead of the app, Xtend must stay open on screen. Some Android phones stop
              apps to save battery; the app asks staff to change that setting, without saying why.
            </li>
          </ul>
        </GuideSection>

        <GuideSection topic={T.alerts} intro="What needs a person today.">
          <p>
            <Ui>Alerts</Ui>: someone left their store during a shift, clocked in away from it, or had
            location off. Filter by kind, open or resolved, person, store and dates. Each alert shows how
            long it has been open and links to Movement, Check an excuse, a phone check and a call. People
            with three or more alerts are listed at the top. Tick several and resolve them together with one
            note; each is still written to the audit log.
          </p>
          <p>
            <Ui>Support</Ui>: problems and complaints staff send from the app. The Xtend helper answers the
            simple ones; the rest wait for a person, longest waiting first. Open a thread to see who they
            are, their store and supervisor and whether they clocked in today. Reply in your own words or
            with a quick reply (<Ui>{'{name}'}</Ui> becomes their first name), pass it to a colleague under{' '}
            <Ui>Who answers</Ui>, and close it when sorted; it reopens if they write again. Your reply
            reaches their phone.
          </p>
        </GuideSection>

        <GuideSection topic={T.stock} intro="What is in each store, and how staff are scored.">
          <p>
            <Ui>Stock count</Ui>: merchandisers count against the Xpel stock count sheet at the end of
            every month and whenever you ask. Request a count for named people, a whole role or a team, with
            a due date; they are told on their phones. For each product they enter back store and shop
            floor (Xtend adds the total), the expiry date and how many sold, with a shelf photo. Paper
            sheets come back as Excel, PDF or a photo under <Ui>Count sheets</Ui>. Staff whose role takes
            stock counts can also download the month&apos;s sheet from their profile (the <Ui>You</Ui> tab)
            and send it back on any day, even when no count is due; the <Ui>For</Ui> column says whether a
            sheet was for a requested count, the month-end count or <Ui>Sent any time</Ui>. A sheet sent
            any time counts towards nothing; its figures are never in the totals.
          </p>
          <p>
            <Ui>X Metrics</Ui> scores stock, sales and expiry for the stores you enrol:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <Ui>Products &amp; stores</Ui>: the products counted and sold, and which stores are in X
              Metrics.
            </li>
            <li>
              <Ui>Targets</Ui>: a monthly target in units for a person or a store.
            </li>
            <li>
              <Ui>Supplies</Ui>: every delivery, in units or cartons, logged by hand or imported from an
              invoice or supply sheet (CSV, Excel, PDF or Word). A mistake is voided with a reason, never
              edited.
            </li>
            <li>
              <Ui>Expiry alerts</Ui>: each batch as it nears expiry; “consider pulling” means it will not
              sell in time.
            </li>
            <li>
              <Ui>Grades</Ui>: each person monthly, on sales against target, stock accuracy, reporting
              and expiry handling. Review, then finalise.
            </li>
            <li>
              <Ui>Scoring policy</Ui>: what staff are scored by. They read it beside their own score.{' '}
              <Ui>Settings</Ui> holds the weights and bands.
            </li>
          </ul>
          <p>
            <Ui>Switching parts off</Ui>: not using part of X Metrics yet? Open <Ui>X Metrics → Settings</Ui>{' '}
            and use the <Ui>Features</Ui> switches at the top. Each one saves at once and is kept in the
            history and the audit log. Turning a part off hides it and stops its work; nothing it recorded
            is deleted, and turning it back on carries on from there.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <Ui>X Metrics</Ui>: the whole module. Off, it leaves the menu for supervisors and the staff
              app; you still see it in the menu marked “off”, opening Settings.
            </li>
            <li>
              <Ui>Expiry</Ui>: the expiry date box on staff counts, expiry alerts and their pushes, the
              Expiry page and expiry in grades. Dates already known for a batch are kept.
            </li>
            <li>
              <Ui>Supplies</Ui>: the Supplies page and invoice imports.
            </li>
            <li>
              <Ui>Grading</Ui>: the Grades and Scoring policy pages, finalising, and the score staff see.
            </li>
            <li>
              <Ui>Sales</Ui>: the daily sales form for staff, sales figures, targets and the Targets page.
            </li>
          </ul>
          <p>
            Checking counts against what was expected (last count + supplied − sold) needs both Supplies and
            Sales on; with either off, counts still come in but nobody is flagged for a gap. When both are
            back on, counts are only compared with counts taken since, so the weeks nobody logged supplies or
            sales are never held against anyone. Grades leave out what is off and weigh the rest. Staff are
            not told: the part simply is not there. A switched-off page reached by a link says so.
          </p>
        </GuideSection>

        <GuideSection topic={T.checks} intro="When something does not look right. Staff never see these.">
          <p>
            <Ui>Integrity</Ui> flags signs of a fake-location app, a rooted phone, a VPN, a phone clock
            changed, photos taken at home, and stock counts that do not add up. A flag is a reason to ask,
            not proof. Pick dates (up to 120 days) and narrow by person, store, kind, severity and whether
            reviewed. <Ui>Who to look at first</Ui> ranks people by their open flags and says why in one
            line. Open a flag to read it in plain words, see the GPS point on a map, or check whether their
            phone is on now. Tick several and mark them reviewed with one note.
          </p>
          <p>
            <Ui>Check an excuse</Ui>: someone says their network was bad, their phone was off, their
            location would not work, they were at the store all along, or the app would not let them clock
            in. Pick who, what they said and when (up to 3 days). Xtend says whether it holds up and shows a
            timeline of what their phone did. <Ui>Keep on record</Ui> with a note builds their history; the
            page warns when several excuses have not held up.
          </p>
        </GuideSection>

        <GuideSection topic={T.people} intro="The People part of the menu.">
          <p>
            <Ui>Staff</Ui>: tabs for all, merchandisers, marketers, supervisors and admins.{' '}
            <Ui>Add staff</Ui> creates an account with a temporary password; the person picks their own at
            first sign-in. From the list you reset a password, change a store or supervisor, or deactivate
            someone (their history stays). <Ui>Login details (Word)</Ui> downloads every field worker&apos;s
            sign-in with how to install the app.
          </p>
          <GuideShot src="/guide/admin-add-staff.png" alt="The Add staff form" width={1932} height={504} caption="Staff → Add staff" />
          <p>
            <Ui>Teams</Ui>: pick a category, tick people (or <Ui>Select all shown</Ui>), choose a supervisor
            and click <Ui>Assign to supervisor</Ui>. <Ui>Roles</Ui>: add a role with its own name (such as
            Account Receivable) that works like one of the built-in ones. <Ui>Store allocation</Ui>: which
            stores each person works. Once someone has any store allocated, a check-in at a store that is
            not theirs is refused, whether they picked it or Xtend recognised it by location; people with
            no allocation can check in anywhere, as before.
          </p>
          <p>
            <Ui>Schedules</Ui>: which weekdays each person works (Monday to Saturday unless changed; tabs
            for merchandisers and marketers, and chips for the usual week or their own), and
            one-off changes for single dates (60 days back to a year ahead). A day is decided by approved
            leave first, then a one-off change, then the weekly pattern. <Ui>Leave</Ui>: staff ask in the
            app (Annual, Sick, Casual or Other; up to 7 days back, a year ahead, 60 days per request, no
            overlaps). Admins decide anyone&apos;s, supervisors their own team&apos;s, nobody their own; the
            office gets a push when someone asks and the person gets one with the answer. Pending leave
            does not excuse a day. Changes are in the audit log as <Ui>schedule.pattern</Ui>,{' '}
            <Ui>schedule.override</Ui>, <Ui>leave.approve</Ui> and <Ui>leave.reject</Ui>.
          </p>
          <GuideShot src="/guide/admin-teams.png" alt="The Teams page with category tabs" width={2000} height={1216} caption="Teams: pick a category, tick people, assign" />
          <p>
            <Ui>Notifications</Ui>: write a message (or start from a template), check <Ui>See who</Ui>, and
            send now or <Ui>Later</Ui>. You can reach everyone, one role, one store or named people. The
            history shows who got it, who read it and who has notifications off; <Ui>Send again</Ui> reaches
            the people it missed.
          </p>
          <Tip>
            Supervisors see and act on their own team only. They can add merchandisers and marketers (who
            join their team) and reset their passwords; only admins create supervisors and admins, move
            people between teams, and see Places, Roles, Teams, the audit log, Updates and this guide.
            Supervisors have their own guide.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.setup} intro="The Setup part of the menu.">
          <p className="font-semibold">Add a store (Outlets)</p>
          <Steps
            items={[
              <>
                Click <Ui>Add outlet</Ui> and fill in the <Ui>Name</Ui> and <Ui>Address</Ui>.
              </>,
              <>
                Standing inside the store, click <Ui>I am standing here</Ui> to fill in the position.
                Otherwise press and hold on the entrance in Google Maps and copy the two numbers into{' '}
                <Ui>Latitude</Ui> and <Ui>Longitude</Ui>.
              </>,
              <>
                Set the <Ui>Geofence radius</Ui>, <Ui>Shift start</Ui> and <Ui>Shift end</Ui>, click{' '}
                <Ui>Create outlet</Ui>, then allocate staff to it.
              </>,
            ]}
          />
          <Tip>
            A store with <Ui>No location yet</Ui> can still be allocated. When its staff clock in there, the
            spot appears on <Ui>Places</Ui> under <Ui>Store locations to confirm</Ui>.
          </Tip>
          <p className="pt-2">
            <Ui>Places</Ui>: when staff clock in or check in at a shop or plaza Xtend cannot name, they must
            add it, standing outside with two photos taken in the app (the building with its sign, and a
            selfie holding one of our products). The position comes from several GPS readings that must
            agree with each other and with the clock-in. Here you check the names and photos (
            <Ui>Save and verify</Ui>), turn a place into a store (<Ui>Make it a store</Ui>), delete a wrong
            one, or <Ui>Dismiss</Ui> one that is not a shop (a depot gate) so the person can carry on.
          </p>
          <p>
            <Ui>Audit log</Ui>: every change an admin or supervisor makes, with when, where they were and on
            what device and IP address. Actions from a VPN, a new device or a new location are marked.
          </p>
          <p>
            <Ui>Activity log</Ui>: what everyone does in Xtend — staff, supervisors and admins. It shows when
            each person signed in and out, opened the app (at most once every 30 minutes per phone or
            browser), clocked in and out, checked in and out of stores, filed the daily report, sent a stock
            count or X Metrics count or sales, asked for or cancelled leave, wrote to Support, and changed
            their password or profile photo. Each line has the Lagos time, the device, whether it was the
            Android app, the iPhone app or the web, and the IP address where it was recorded (sign-ins,
            sign-outs, app opens and account changes). Pick <Ui>Today</Ui>, <Ui>Yesterday</Ui>,{' '}
            <Ui>Last 7 days</Ui> or <Ui>Last 30 days</Ui>, or your own dates (up to 92 days), one person and one
            kind of activity. The cards count who was active, sign-ins and app opens and name the most active
            person; <Ui>By person</Ui> gives each person&apos;s first and last activity, their counts and their
            last device, with links to their <Ui>Movement</Ui> and <Ui>Attendance</Ui> for the same days; the
            timeline lists everything day by day. Download it as Excel, PDF, Word or CSV exactly as filtered
            (each download is in the audit log). Only admins see this page, and staff are not told about it.
            Sign-ins, app opens and account changes are kept for 180 days; clock-ins, visits and the rest
            come from their own records. If the page says it needs migration 062, run that file in Supabase.
          </p>
          <p>
            <Ui>Updates</Ui>: Xtend updates itself. Anyone with Xtend open is told when a newer version is
            live and moves to it with one tap. Publish a short <Ui>What&apos;s new</Ui> (each person sees it
            once); tick <Ui>Required</Ui> when an old version must not be used; set the lowest Android or
            iPhone build to make people install a new phone app. The page shows who is on which version and
            reminds those on an older app.
          </p>
          <p>
            <Ui>System</Ui> (admins only): <strong>test mode</strong>, for a test run before real work. While
            it is on, a dark orange strip across the top of the dashboard says <Ui>Test mode: records can be
            reset</Ui>. Supervisors and staff see nothing of it, and staff are not told it is a test.
          </p>
          <Steps
            items={[
              <>
                <strong>Test.</strong> Set up stores and staff and use Xtend in the places you want to try it,
                exactly as you would for real.
              </>,
              <>
                <strong>Reset.</strong> On <Ui>System</Ui>, tick what to clear: <Ui>Clock-ins and locations</Ui>,{' '}
                <Ui>Store visits and places</Ui>, <Ui>Daily reports</Ui>, <Ui>Stock counts and count sheets</Ui>,{' '}
                <Ui>X Metrics records</Ui>, <Ui>Leave and schedules</Ui>, <Ui>Support chats</Ui>,{' '}
                <Ui>Notifications</Ui>, <Ui>Activity log</Ui>, <Ui>Ask Xtend chats</Ui>,{' '}
                <Ui>Teams and store allocations</Ui>, <Ui>Stores (outlets)</Ui>, <Ui>Staff accounts</Ui> or{' '}
                <Ui>Audit log</Ui> — or <Ui>Select everything (start completely fresh)</Ui>. Some bring others
                with them, and the page shows which: <Ui>Staff accounts</Ui> also clears everything those people
                recorded; <Ui>Stores</Ui> also clears the visits, counts, X Metrics records and allocations for
                those stores (clock-ins and reports are kept without a store name).
              </>,
              <>
                Click <Ui>Review what will be deleted</Ui>. Check the two lists — what goes and what stays — then
                type <Ui>RESET</Ui> and your own password and click <Ui>Reset now</Ui>. It takes up to a minute.
                The result shows how many records went from each area. Photos and documents are removed too; if
                there were very many, click <Ui>Finish removing files</Ui> until none are left.
              </>,
              <>
                <strong>Go live.</strong> When the test run is over and reset, click{' '}
                <Ui>We are live — turn off test mode</Ui> and type <Ui>WE ARE LIVE</Ui>. The strip and the reset
                disappear for good.
              </>,
            ]}
          />
          <Tip>
            A reset cannot be undone, and test mode cannot be turned back on once it is off — not by any admin,
            not even directly in the database. What always stays: admin accounts (with their sign-ins and
            profile photos), the product list, X Metrics settings and switches, the scoring policy, roles and
            which roles count stock, notification templates, support quick replies, the count sheet template and
            Updates. Admins&apos; own activity (clock-ins, chats, notifications, audit rows) is cleared with the
            rest when you tick it. The audit log keeps one row for every reset (who, when, where, what and how
            many); when you clear the audit log, that row is all it holds. Staff whose accounts are removed are
            signed out and must be added again.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.apps} intro="Getting staff set up, and what their phones need.">
          <Steps
            items={[
              <>
                Share{' '}
                <Link href="/download" className="font-semibold text-brand hover:underline">
                  the download page
                </Link>{' '}
                (it has a QR code for computers) and{' '}
                <Link href="/guide" className="font-semibold text-brand hover:underline">
                  the staff guide
                </Link>
                .
              </>,
              <>
                Each person signs in, picks a password, adds a profile photo, and allows location, camera
                and notifications. Clocking in is blocked until notifications are on; the Staff page shows who
                has them.
              </>,
              <>
                The Android app installs from the download page. The iPhone app needs the Apple steps in the
                project&apos;s mobile README before it can be offered.
              </>,
            ]}
          />
          <Tip>
            The staff guide and the app tell staff only what they need to do. How tracking, checks and
            alerts work is in this guide only.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.analytics} intro="Getting the numbers out.">
          <p>
            Almost every list downloads as <Ui>Excel</Ui>, <Ui>PDF</Ui>, <Ui>Word</Ui> or <Ui>CSV</Ui>,
            exactly as filtered on screen: attendance, analytics, movement, store visits, alerts,
            integrity, the audit log and X Metrics. Ask Xtend makes written reports with a summary on top.
            Every download is itself recorded in the audit log.
          </p>
          <p>
            <Ui>Marketer reports</Ui> (Attendance menu): pick a day or a month and download each
            person&apos;s report as a designed PDF, Word or Excel. It has eight summary tiles (days worked,
            stores, visits, time in stores, average visit, on-time clock-ins, missing clock-outs, reports
            filed), clock-in and clock-out with their status, every visit with arrival and the time between
            stores, the daily report, stock counts and X Metrics sales; the month adds a day-by-day table,
            a per-store table and each day&apos;s details. The daily report keeps a copy of that day&apos;s
            visits written by the database each time it is saved, so the phone cannot change it.
          </p>
          <p>
            <Ui>Report documents</Ui>: whoever files the daily report can attach up to five documents
            (PDF, Word, Excel, CSV or pictures, 10 MB each) and remove them until midnight, when the
            report locks. They are kept privately; only you, the person&apos;s supervisor and the person
            can open them. <Ui>Documents attached</Ui> on Marketer reports lists them for the period with a{' '}
            <Ui>Download</Ui> link (each office download is recorded in the audit log as{' '}
            <Ui>report_file.download</Ui>); the PDF, Word and Excel reports and Ask Xtend&apos;s field
            reports list them by name. Long document names wrap so you can read them on your phone. A document or photo uploaded from a phone but never put on a report
            (its report never arrived) is deleted by the nightly clean-up 14 days later.
          </p>
          <p>
            <Ui>What Xtend deletes, and when</Ui>: reports, and the photos and documents on a report, are
            never deleted. The nightly clean-up deletes only clock-in and store-visit photos (the time,
            place and distance stay) and report photos and documents that are on no report, each{' '}
            <strong>14 days</strong> after it was taken or uploaded, never sooner. The evening before, you
            get a notification (push and Notifications history) saying how many go tomorrow and from which
            date, with a link to Attendance or Marketer reports: open or download anything you need that
            day. You get everything; each supervisor gets their own team&apos;s; at most one notice a day,
            and only when something is due. Staff are not told. Each night&apos;s deletions are recorded in
            the audit log as <Ui>retention.purge</Ui> with how many went, and the Overview shows how many
            clock photos are held. Device reports and phone checks are kept 60 days and the activity log
            180 days.
          </p>
          <p>
            <Ui>Clock-out reminders</Ui>: anyone still clocked in when their store&apos;s shift ends
            (18:00 without a store) gets a push, and a second one an hour later if they still have not
            clocked out; never more than two a day and none after midnight. They show in Notifications
            history.
          </p>
        </GuideSection>

        <GuideSection topic={T.faq}>
          <Questions
            items={[
              {
                q: 'Someone cannot clock in',
                a: (
                  <>
                    Most often notifications or location are off on their phone; the staff guide walks them
                    through it. Check they are active on Staff and, for a merchandiser, that they have a store
                    on Store allocation.
                  </>
                ),
              },
              {
                q: 'Someone says they clocked in but nothing shows',
                a: (
                  <>
                    Without network the clock-in waits on their phone and arrives when they are back online,
                    at the time it was taken. Use Check an excuse with “the app would not let me clock in” to
                    see what their phone did.
                  </>
                ),
              },
              {
                q: 'A person shows long silences on Movement',
                a: (
                  <>
                    Their phone was off, had no network, or (on iPhone) the app was closed and they did not
                    move. Check an excuse for that window tells you which.
                  </>
                ),
              },
              {
                q: 'Someone forgot their password',
                a: <>Reset it on the Staff page. They choose a new one when they sign in.</>,
              },
              {
                q: 'Someone left the company',
                a: <>Deactivate them on the Staff page. Their history stays.</>,
              },
              {
                q: 'A store’s location is wrong',
                a: <>Correct it on Outlets, or confirm the right spot on Places from where staff clock in.</>,
              },
              {
                q: 'A supervisor wants this guide',
                a: (
                  <>
                    It is for admins only. Supervisors have their own{' '}
                    <Link href="/admin/supervisor-guide" className="font-semibold text-brand hover:underline">
                      Supervisor guide
                    </Link>{' '}
                    in their menu, covering their own team and what to ask an admin for. It leaves out how
                    location and the checks work.
                  </>
                ),
              },
            ]}
          />
        </GuideSection>
      </div>
    </div>
  )
}
