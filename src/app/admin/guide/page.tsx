import Link from 'next/link'
import {
  BarChart3,
  Bell,
  ClipboardList,
  Headset,
  LayoutDashboard,
  MessageSquareText,
  PackageSearch,
  Rocket,
  Route,
  ShieldAlert,
  Smartphone,
  Store,
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
export const metadata = { title: 'Guide — Xtend' }

const T = {
  setup: { id: 'set-up', title: 'Setting up', icon: Rocket },
  places: { id: 'stores-and-places', title: 'Adding a store or place', icon: Store },
  staff: { id: 'staff', title: 'Staff and teams', icon: Users },
  apps: { id: 'apps', title: 'Getting staff on the app', icon: Smartphone },
  overview: { id: 'overview', title: 'The overview', icon: LayoutDashboard },
  attendance: { id: 'attendance', title: 'Attendance and exports', icon: ClipboardList },
  movement: { id: 'movement', title: 'Movement and store visits', icon: Route },
  alerts: { id: 'alerts', title: 'Alerts and checks', icon: ShieldAlert },
  counts: { id: 'store-counts', title: 'Stock count', icon: PackageSearch },
  support: { id: 'support', title: 'Support messages', icon: Headset },
  notify: { id: 'notifications', title: 'Notifications', icon: Bell },
  ask: { id: 'ask', title: 'Ask Xtend and analytics', icon: MessageSquareText },
  faq: { id: 'questions', title: 'Questions', icon: BarChart3 },
} satisfies Record<string, GuideTopic>

/** How to run Xtend, for admins and supervisors. Staff have /guide. */
export default async function AdminGuidePage() {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">How to use Xtend</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'For admins and supervisors. Parts marked “admins only” are hidden from supervisors.'
            : 'For supervisors. Everything here covers your own team.'}{' '}
          Staff have their own guide at{' '}
          <Link href="/guide" className="font-semibold text-brand hover:underline">
            /guide
          </Link>
          , which you can share with them.
        </p>
      </div>

      <GuideContents topics={Object.values(T)} />

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection topic={T.setup} intro="Do this once, before staff start clocking in.">
          <Steps
            items={[
              <>
                <Ui>Outlets</Ui> (admins only): add each store with its address and map position,
                its shift start time and its radius (a small kiosk needs a small radius). A store
                marked “No location yet” is pinned later from where staff clock in, on{' '}
                <Ui>Places</Ui>. See “Adding a store or place” below.
              </>,
              <>
                <Ui>Staff</Ui>: add everyone (one by one, or <Ui>Bulk import CSV</Ui>). Choose the
                role: merchandiser, marketer, supervisor or admin.
              </>,
              <>
                <Ui>Store allocation</Ui>: give each merchandiser their store, so their clock-in is
                measured against it. Marketers do not need one.
              </>,
              <>
                <Ui>Teams</Ui> (admins only): put merchandisers and marketers under a supervisor.
              </>,
            ]}
          />
        </GuideSection>

        <GuideSection
          topic={T.places}
          intro="Stores are what clock-ins are measured against. Only admins add or change them."
        >
          <p className="font-semibold">Add a store yourself</p>
          <Steps
            items={[
              <>
                Open <Ui>Outlets</Ui> and click <Ui>Add outlet</Ui>.
              </>,
              <>
                Fill in the <Ui>Name</Ui> and <Ui>Address</Ui>.
              </>,
              <>
                For the location, the easiest way is to stand inside the store and click{' '}
                <Ui>I am standing here</Ui>: Xtend fills in Latitude and Longitude (and the name and
                address if it can). Otherwise, in Google Maps press and hold on the store&apos;s
                entrance; the two numbers appear at the top (for example 6.6018, 3.3515). Copy the
                first into <Ui>Latitude</Ui> and the second into <Ui>Longitude</Ui>.
              </>,
              <>
                Set the <Ui>Geofence radius</Ui>: about 50–100 m for a kiosk or small shop, 150–300
                m for a supermarket or mall. Set <Ui>Shift start</Ui> and <Ui>Shift end</Ui>.
              </>,
              <>
                Click <Ui>Create outlet</Ui>. Then allocate staff to it on{' '}
                <Ui>Store allocation</Ui>.
              </>,
            ]}
          />
          <Tip>
            A store marked <Ui>No location yet</Ui> on Outlets can still be allocated. When its
            staff clock in there, the spot shows on <Ui>Places</Ui> under{' '}
            <Ui>Store locations to confirm</Ui>: check the photo and click{' '}
            <Ui>Confirm store location</Ui>. Or edit the store and add its location yourself.
          </Tip>

          <p className="pt-2 font-semibold">Places your staff add</p>
          <p>
            When staff clock in or check in at a shop or plaza that no store, learned place or map can
            name, they must add it before they go on. Standing outside, they type the name on the sign
            and take two photos with the camera in Xtend (never from the gallery): the building with
            its sign showing, and a selfie holding one of our products. The position is read from their
            phone&apos;s GPS, not typed: several readings are combined, the camera reads the position
            again at each photo, and the readings must agree with each other and with where they clocked
            in. Nobody is asked to add a place when the clock-in&apos;s own readings disagree, since that
            spot cannot be trusted. From then on Xtend
            recognises the place for everyone. Until it is added, that day&apos;s store visits, store
            counts, X Metrics counts and sales and daily report wait; clocking out never does.
          </p>
          <p>
            These appear on <Ui>Places</Ui> (admins only):
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <Ui>Places staff had to add</Ui>: the last 7 days, who and where, and whether each was
              added. If someone clocked in somewhere that is not a shop (a depot gate, say), click{' '}
              <Ui>Dismiss</Ui> and give the reason so they can carry on.
            </li>
            <li>
              <Ui>Names to check</Ui>: open <Ui>Photo of the place</Ui> and <Ui>Selfie with product</Ui>,
              correct the spelling if needed, then click <Ui>Save and verify</Ui> (or <Ui>Verify</Ui>).
            </li>
            <li>
              <Ui>Make it a store</Ui>: turns the place into one of your outlets, so staff can be
              allocated to it.
            </li>
            <li>Delete a place that is wrong, such as a photo that is not a shop.</li>
          </ul>
        </GuideSection>

        <GuideSection topic={T.staff} intro="People pages, under People in the menu.">
          <p>
            On <Ui>Staff</Ui>, the tabs show <Ui>All</Ui>, <Ui>Merchandisers</Ui>,{' '}
            <Ui>Marketers</Ui>, <Ui>Supervisors</Ui> or <Ui>Admins</Ui>. <Ui>Add staff</Ui> creates an account and shows a temporary
            password (Xtend also tries to send it). The person chooses their own password at first
            sign-in. From the same list you can reset a password, change someone&apos;s store or
            supervisor, or deactivate them: their history is kept.
          </p>
          {isAdmin && (
            <p>
              <Ui>Roles</Ui> (admins only): besides Merchandiser, Marketer, Supervisor and Admin,
              add a role with its own name, such as Account Receivable, and choose what it works
              like. Give it to someone with the <Ui>Role</Ui> picker on Staff; they can do what the
              base role does and show by the new name. Retire a role you no longer use.
            </p>
          )}
          {isAdmin && (
            <p>
              <Ui>Login details (Word)</Ui> on Staff downloads every merchandiser&apos;s and
              marketer&apos;s login, with their temporary password and how to install the app. It is
              built fresh on each download, so anyone added since is in it. Once someone chooses
              their own password, the sheet says <Ui>Chosen by them</Ui>.
            </p>
          )}
          <p>
            On <Ui>Teams</Ui>, pick <Ui>All</Ui>, <Ui>Merchandisers</Ui> or <Ui>Marketers</Ui>,
            tick people (or <Ui>Select all shown</Ui>), choose a supervisor and click{' '}
            <Ui>Assign to supervisor</Ui>.
          </p>
          <GuideShot src="/guide/admin-add-staff.png" alt="The Add staff form" width={1932} height={504} caption="Staff → Add staff" />
          <GuideShot src="/guide/admin-teams.png" alt="The Teams page with category tabs" width={2000} height={1216} caption="Teams: pick a category, tick people, assign" />
          <Tip>
            Supervisors can add merchandisers and marketers, who join their own team, and reset their
            passwords. Only admins create supervisors and admins or move people between teams.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.apps} intro="Staff use the Android or iPhone app, or Chrome.">
          <Steps
            items={[
              <>
                Share{' '}
                <Link href="/download" className="font-semibold text-brand hover:underline">
                  the download page
                </Link>{' '}
                with your staff (it has a QR code for computers), and{' '}
                <Link href="/guide" className="font-semibold text-brand hover:underline">
                  the staff guide
                </Link>
                .
              </>,
              <>
                Each person signs in, chooses a password, allows location and camera, and turns on
                notifications. Clocking in needs notifications on; the Staff page shows who has them.
              </>,
              <>
                New staff see a short welcome walkthrough the first time they open Xtend: what a day
                looks like, their profile photo, location, notifications and how to clock in.
                Their photo then shows beside their name and on the Movement map.
              </>,
            ]}
          />
        </GuideSection>

        <GuideSection topic={T.overview} intro="The first page you see each day.">
          <p>
            The week&apos;s clock-ins (point at a day for its figures), today&apos;s clocked in,
            late and not-in-store counts, who has not clocked in yet, open alerts, location
            coverage and everyone on shift. The tip card suggests the next thing worth doing. Use
            the search box at the top to find anyone on the Staff page.
          </p>
          <GuideShot src="/guide/admin-overview.png" alt="The overview page" width={2880} height={1800} caption="The overview, before anyone has clocked in" />
        </GuideSection>

        <GuideSection topic={T.attendance} intro="Every clock-in and clock-out, with filters.">
          <p>
            On <Ui>Attendance</Ui>, filter by dates, person, outlet, status and type, then export
            the same view as <Ui>Excel</Ui>, <Ui>Word</Ui>, <Ui>PDF</Ui> or <Ui>CSV</Ui>. Records
            cannot be edited or deleted. Times are Lagos time.
          </p>
        </GuideSection>

        <GuideSection topic={T.movement} intro="Where people are during their shift.">
          <p>
            <Ui>Movement</Ui> shows everyone on shift on a map, with how many are in a store, away
            from it, or not heard from. Pick a person and up to 7 days (or tap <Ui>Yesterday</Ui>,{' '}
            <Ui>Last 3 days</Ui>, <Ui>Last 7 days</Ui>) to see their journey: the stops they made (at
            their store or somewhere else, by name), the travel between them, and the times nothing
            was heard. A strip per day shows it at a glance, with totals for time at stores, elsewhere,
            travelling and silent. <Ui>Worth a look</Ui> points out impossible jumps (faster than
            150 km/h, which a fake-location app makes), long silences (with a link to check an excuse
            for them) and long stays away. The journey downloads as Excel, PDF, Word or CSV.{' '}
            <Ui>Store visits</Ui> lists each person&apos;s rounds: which stores, for how long, and
            downloads as PDF, Word or Excel.
          </p>
          <p>
            <Ui>Audit log</Ui> (admins) lists every change an admin or supervisor makes: who, what,
            when, where they were (from the browser when allowed, otherwise roughly from the IP
            address, named after the store or place it falls in) and on what device (phone or
            computer, system, browser, the Xtend app or the web), with the IP address. Actions from a
            VPN, a new device or a new location are marked. Filter by person, kind of action, dates
            or a search; tick <Ui>Only VPN, new device or new location</Ui> to see just those; open a
            row for the full detail; download it as Excel, PDF, Word or CSV.
          </p>
        </GuideSection>

        <GuideSection topic={T.alerts} intro="Things that need a look.">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Ui>Alerts</Ui>: someone left their store during a shift, clocked in away from it,
              or had location off. Check, then resolve each one.
            </li>
            <li>
              <Ui>Integrity</Ui>: signs of a fake-location app, a rooted phone, a VPN, or store
              counts that do not add up. A flag is a reason to ask, not proof; mark it reviewed with
              what you found.
            </li>
            <li>
              <Ui>Check an excuse</Ui>: someone says their network was bad, their phone was off, their
              location would not work, they were at the store all along, or the app would not let them
              clock in? Pick who, what they said and when (or tap a quick window such as{' '}
              <Ui>Yesterday&apos;s shift</Ui>; up to 3 days). Xtend says whether it holds up, and shows a
              timeline of what their phone did: when it had network, what it kept offline, where it was
              against their store, what went wrong, and the battery. Click <Ui>Keep on record</Ui> with a
              note to build up their history; the page warns when several excuses have not held up.
            </li>
          </ul>
        </GuideSection>

        <GuideSection topic={T.counts} intro="Stock in each store.">
          <p>
            Merchandisers count against the Xpel stock count sheet at the end of every month, and
            whenever you request a count on <Ui>Stock count</Ui>. For each product they enter the
            back store and shop floor numbers (Xtend adds the total), the expiry date and how
            many sold, with a shelf photo.
          </p>
          <p>
            The sheet can also be downloaded as Excel, named for the month (for example “October
            2026 stock count sheet”), with the store&apos;s name on it. Sheets filled on paper come
            back as the Excel file, a PDF or a photo, and are listed under{' '}
            <Ui>Count sheets</Ui>.
          </p>
        </GuideSection>

        <GuideSection topic={T.support} intro="Problems staff raise in the app.">
          <p>
            The Xtend helper answers simple questions. Anything marked{' '}
            <Ui>With the office</Ui> needs a person: open it on <Ui>Support</Ui> and reply. The
            staff member gets your reply in their app.
          </p>
        </GuideSection>

        <GuideSection topic={T.notify} intro="Reach staff phones directly.">
          <p>
            On <Ui>Notifications</Ui>, write a message and send it.{' '}
            {isAdmin
              ? 'Admins can reach everyone, one role, one outlet, or named people.'
              : 'As a supervisor you reach the staff at your own outlet.'}
          </p>
        </GuideSection>

        <GuideSection topic={T.ask} intro="Answers without digging.">
          <p>
            <Ui>Ask Xtend</Ui> answers plain questions such as “who clocked in late today?” or
            “who has not clocked out?”. <Ui>Analytics</Ui> shows lateness and attendance over a
            period, measured against each store&apos;s shift start.
          </p>
          <p>
            Ask it to do something and it prepares it for you: “remind everyone who has not clocked in
            to clock in now”, “ask all merchandisers for a stock count by Friday”, “check Ada&apos;s
            phone”, “mark those flags reviewed”, “set Ikeja Mall&apos;s target to 500 units for
            October”, “deactivate Bala”, or “show me Ada&apos;s movement yesterday”. A card says
            exactly what will happen, to whom, and any catch (such as people with notifications off).
            Nothing is done until you press its button, and it goes through the same checks as the
            button on the page, so a supervisor can only act on their own team. It is recorded in the
            audit log like any other change.
          </p>
        </GuideSection>

        <GuideSection topic={T.faq}>
          <Questions
            items={[
              {
                q: 'Someone cannot clock in',
                a: (
                  <>
                    Most often notifications or location are off on their phone; the staff guide
                    walks them through it. Check they are active on Staff and, for a merchandiser,
                    that they have a store on Store allocation.
                  </>
                ),
              },
              {
                q: 'Someone forgot their password',
                a: <>Reset it on the Staff page. They choose a new one when they sign in.</>,
              },
              {
                q: 'Someone left the company',
                a: <>Deactivate them on the Staff page. Their attendance history stays.</>,
              },
              {
                q: 'A store’s location is wrong',
                a: (
                  <>
                    An admin corrects it on Outlets, or confirms the right spot on Places from
                    where staff actually clock in.
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
