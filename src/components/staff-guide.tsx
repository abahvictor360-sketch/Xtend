import Link from 'next/link'
import {
  BellRing,
  CalendarDays,
  Camera,
  ClipboardList,
  FileText,
  LifeBuoy,
  LogIn,
  LogOut,
  Palmtree,
  MapPinPlus,
  Smartphone,
  Store,
  Wrench,
} from 'lucide-react'
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

export const STAFF_TOPICS = {
  start: { id: 'get-started', title: 'Get started', icon: Smartphone },
  ready: { id: 'before-you-clock-in', title: 'Before your first clock-in', icon: BellRing },
  photo: { id: 'profile-photo', title: 'Your profile photo', icon: Camera },
  clockIn: { id: 'clock-in', title: 'Clock in', icon: LogIn },
  visits: { id: 'store-visits', title: 'Store visits (marketers)', icon: Store },
  place: { id: 'add-a-place', title: 'Adding a place', icon: MapPinPlus },
  report: { id: 'daily-report', title: 'Daily report', icon: FileText },
  count: { id: 'store-count', title: 'Stock count', icon: ClipboardList },
  clockOut: { id: 'clock-out', title: 'Clock out', icon: LogOut },
  history: { id: 'history', title: 'History and your account', icon: CalendarDays },
  leave: { id: 'leave', title: 'Days off and leave', icon: Palmtree },
  help: { id: 'help', title: 'Report a problem', icon: LifeBuoy },
  fix: { id: 'problems', title: 'Common problems', icon: Wrench },
} satisfies Record<string, GuideTopic>

const T = STAFF_TOPICS

/**
 * The staff guide's content, shared by the public page (/guide) and the
 * same guide inside the app (/field/guide). Worded like the staff app.
 */
export function StaffGuide() {
  return (
    <div className="space-y-5">
          <GuideContents topics={Object.values(T)} />

      <GuideSection topic={T.start} intro="Your admin or supervisor creates your account and gives you a password.">
        <Steps
          items={[
            <>
              Get the Xtend app for your phone from{' '}
              <Link href="/download" className="font-semibold text-brand hover:underline">
                the download page
              </Link>
              , or open Xtend in Chrome on your phone.
            </>,
            <>
              Sign in with the <Ui>email or phone number</Ui> your admin registered, and the
              password you were given.
            </>,
            <>
              The first time, Xtend asks you to <Ui>choose your own password</Ui>. Pick
              something only you know.
            </>,
          ]}
        />
        <Tip>Using Chrome instead of the app? Tap the menu, then “Install app” or “Add to Home screen”, so Xtend opens like an app.</Tip>
      </GuideSection>

      <GuideSection topic={T.ready} intro="Xtend needs three things switched on before you can clock in. You only do this once per phone.">
        <Steps
          items={[
            <>
              <Ui>Location:</Ui> when asked, tap Allow (choose <Ui>Allow all the time</Ui> or{' '}
              <Ui>Always</Ui> if your phone offers it). In your phone’s settings, set location to{' '}
              <Ui>High accuracy</Ui>.
            </>,
            <>
              <Ui>Camera:</Ui> allow it when asked. Clocking in and out takes a selfie with
              the camera inside Xtend.
            </>,
            <>
              <Ui>Notifications:</Ui> tap <Ui>Turn on notifications</Ui> on the home screen.
              You cannot clock in until they are on.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection topic={T.photo} intro="New to Xtend? The welcome steps ask for your photo first.">
        <Steps
          items={[
            <>
              The profile menu closes when you tap outside it or press Escape. Go to <Ui>You</Ui> and tap <Ui>Take your photo</Ui> (or the camera on your picture).
            </>,
            <>Face the camera in good light and take the photo. Tap it again any time to retake it.</>,
          ]}
        />
        <GuideShot src="/guide/staff-photo.png" alt="The profile photo on the You page" width={748} height={456} phone />
      </GuideSection>

      <GuideSection topic={T.clockIn} intro="Do this when you arrive at your store, once a day.">
        <Steps
          items={[
            <>Open Xtend while you are inside your store. If Home cannot load, check your connection and tap <Ui>Try again</Ui>.</>,
            <>
              Below your shift status, tap <Ui>Clock in with selfie</Ui> and take a clear photo of your face.
            </>,
            <>
              Wait while Xtend checks your location and the photo. When it is done, the home
              screen shows <Ui>Clocked in</Ui>.
            </>,
          ]}
        />
        <GuideShot
          src="/guide/staff-home.png"
          alt="The home screen before clocking in"
          width={780}
          height={1112}
          caption="Your home screen: your shift, the week, and your day's progress."
          phone
        />
        <GuideShot src="/guide/staff-clock.png" alt="The Clock in with selfie button" width={748} height={160} phone />
      </GuideSection>

      <GuideSection topic={T.visits} intro="Marketers who move between stores check in at each one.">
        <Steps
          items={[
            <>Clock in at the start of your day as above.</>,
            <>
              At each store, tap <Ui>Check in here</Ui>. If Xtend does not find the store, tap{' '}
              <Ui>Pick the store myself</Ui>: it lists only the stores on your list.
            </>,
            <>
              When you leave, tap <Ui>Check out</Ui> before you go to the next store. You can
              only be checked in at one store at a time.
            </>,
            <>
              See <Ui>No stores are allocated to you yet</Ui> or{' '}
              <Ui>This store is not on your list</Ui>? Ask your supervisor to add the store.
            </>,
            <>
              If Xtend does not know the place, you must <Ui>add it</Ui> before you go on. See{' '}
              <Ui>Adding a place</Ui> below.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection
        topic={T.place}
        intro="When you clock in or check in at a shop or plaza Xtend does not know yet, you must add it before you carry on. You only do this once: after that, Xtend recognises the place for you and everyone else."
      >
        <p>
          You will see <Ui>Add this place before you go on</Ui> at the top of the screen. Until you
          add it, store visits, stock counts, X Metrics counts and sales, and your daily report
          wait. You can still clock out at any time.
        </p>
        <Steps
          items={[
            <>
              Go outside and stand where you can see the building and its sign. Keep location on.
            </>,
            <>
              Type the name exactly as it is written on the sign, for example “Ojota Shopping
              Plaza” or “Mama Nkechi Provisions”.
            </>,
            <>
              Under <Ui>Photo of the building from outside, with the sign showing</Ui>, tap{' '}
              <Ui>Open the camera</Ui>. Stand still for a few seconds, then take the photo. Take it
              at the place itself; if Xtend asks you to take it again, stay where you are and retake
              it.
            </>,
            <>
              Under <Ui>Selfie holding one of our products</Ui>, tap <Ui>Open the camera</Ui>{' '}
              and take a selfie with the product held up next to your face.
            </>,
            <>
              Tap <Ui>Save this place</Ui> and wait while Xtend checks both photos. When you see{' '}
              <Ui>Xtend will recognise this place from now on</Ui>, you are done.
            </>,
          ]}
        />
        <p>
          <Ui>Marketers:</Ui> if Xtend does not recognise the store when you check in, tap{' '}
          <Ui>Pick the store myself</Ui> and choose it from the list. Stores marked{' '}
          <Ui>Here</Ui> are the ones you are standing in.
        </p>
        <Tip>
          Both photos are taken with the camera in Xtend. You cannot upload a picture from your
          gallery. The building photo must show a shop or plaza, not a house or the inside of a
          room. The selfie must show your face and one of our products. If a photo is not
          accepted, Xtend tells you why: tap the photo again to retake it.
        </Tip>
        <Tip>
          Clocked in somewhere that is not a shop, such as the depot gate? Ask the office: they can
          let you carry on without adding it.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.report} intro="If you see a Report tab at the bottom, file one report each day.">
        <Steps
          items={[
            <>
              Tap <Ui>Report</Ui>, fill in how the day went, and add a photo if asked.
            </>,
            <>
              Have a price list, a display plan, an invoice or a picture for the office? Under{' '}
              <Ui>Attach documents</Ui>, tap <Ui>Choose documents</Ui> and pick them: PDF, Word,
              Excel or CSV files, or pictures. Up to 5, each 10 MB or smaller. Each one shows with
              its name and size; tap the <Ui>×</Ui> to take one off.
            </>,
            <>
              Tap <Ui>Submit report</Ui>. Your documents go with it. You can edit the report, and
              add or remove documents, until midnight.
            </>,
          ]}
        />
        <p>
          Marketers: the top of the report shows today&apos;s store visits: each store, the time in
          and out, how long you were there, and the total. They are added to your report when you
          save it; there is nothing to type for them.
        </p>
        <Tip>
          No data? Your report and its documents wait on your phone and send themselves when you
          get signal. A document you remove with no data shows <Ui>Removing…</Ui> until then. If it
          only gets through after midnight, the report has closed and the document stays on it.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.count} intro="When a stock count is due, a Count tab appears and the home screen tells you.">
        <Steps
          items={[
            <>
              Tap <Ui>Count</Ui>. You see the Xpel stock count sheet: every product, with its
              barcode. Search by name or barcode to find one quickly.
            </>,
            <>
              Tap a product you have and enter how many are in the <Ui>Back store</Ui> and on
              the <Ui>Shop floor</Ui>. Xtend adds up the <Ui>Total</Ui>. Add the{' '}
              <Ui>Expiry date</Ui> and how many were <Ui>Sold</Ui> since your last count. Leave
              out products you do not have.
            </>,
            <>
              A product that is not on the sheet goes under <Ui>Products not on the sheet</Ui>.
            </>,
            <>
              Tap <Ui>Submit count</Ui> and take a <Ui>photo of the shelf</Ui> showing the
              products you counted.
            </>,
          ]}
        />
        <Tip>
          Counts are done when your supervisor asks, and at the end of every month. Prefer paper?
          Under <Ui>Count on paper</Ui>, download the month&apos;s sheet for your store, fill it
          in, and upload it back as the Excel file, a PDF or a photo.
        </Tip>
        <Tip>
          The stock count sheet is also on your profile, any day: tap <Ui>You</Ui>, then under{' '}
          <Ui>Stock count sheet</Ui> tap <Ui>Download</Ui> to get this month&apos;s sheet for
          your store as Excel. Fill it in, then tap <Ui>Upload filled sheet</Ui> and send the
          Excel file, a PDF or a photo of it. What you sent this month is listed underneath.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.clockOut} intro="At the end of your shift.">
        <Steps
          items={[
            <>
              Marketers: <Ui>Check out</Ui> of your last store first.
            </>,
            <>
              Tap <Ui>Clock out with selfie</Ui> and take the photo.
            </>,
            <>
              That is your day done: one clock-in and one clock-out per day. You sign in again
              the next working day.
            </>,
          ]}
        />
        <p>
          When your shift ends, Xtend reminds you to clock out: a message on your phone and a{' '}
          <Ui>Clock out</Ui> button at the top of the home screen. If you are still checked in at a
          store, check out of it first, then clock out.
        </p>
        <GuideShot
          src="/guide/staff-progress.png"
          alt="The day's progress: clock in, daily report, clock out"
          width={780}
          height={586}
          caption="Under My day, each step's ring closes when it is done."
          phone
        />
      </GuideSection>

      <GuideSection topic={T.history} intro="Your own record and settings.">
        <p>
          <Ui>History</Ui> shows your attendance day by day. <Ui>You</Ui> shows your
          account: your store, notifications, <Ui>Change your password</Ui> and{' '}
          <Ui>Message support</Ui>.
        </p>
        <p>The week on the home screen and the calendar in History are coloured:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A dot: you clocked in that day.</li>
          <li>
            <Ui>Missed</Ui> (red): a working day you did not clock in.
          </li>
          <li>
            <Ui>Off</Ui> (grey): a day off on your schedule.
          </li>
          <li>
            <Ui>Leave</Ui> (soft orange): approved leave.
          </li>
        </ul>
      </GuideSection>

      <GuideSection topic={T.leave} intro="Your supervisor sets which days you work. Ask for leave in the app.">
        <Steps
          items={[
            <>
              Open <Ui>You</Ui>, then <Ui>Ask for leave</Ui> (it is also on the home screen, under
              the week).
            </>,
            <>
              Pick the type (<Ui>Annual</Ui>, <Ui>Sick</Ui>, <Ui>Casual</Ui> or <Ui>Other</Ui>),
              your first and last day, write the reason, and tap <Ui>Send request</Ui>. You can ask
              for days up to 7 days back.
            </>,
            <>
              Your request shows as <Ui>Pending</Ui> until your supervisor answers. You get a message
              when it is <Ui>Approved</Ui> or <Ui>Rejected</Ui>. You can cancel it while it is still
              pending.
            </>,
          ]}
        />
        <Tip>
          On a day off the home screen says <Ui>Day off today</Ui>. Working that day anyway? Clock in
          as usual.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.help} intro="Something not working, or a complaint? Tell the office from inside Xtend.">
        <Steps
          items={[
            <>
              Go to <Ui>You</Ui>, then <Ui>Message support</Ui>.
            </>,
            <>
              Say what happened, where and when, for example: “my clock-in keeps saying off site at
              Ikeja City Mall this morning”. One problem per message is easiest to sort out.
            </>,
            <>
              The Xtend helper answers simple questions straight away. Anything it cannot sort out
              goes to the office, and their reply arrives as a notification. Open{' '}
              <Ui>Message support</Ui> again to read it or add more.
            </>,
          ]}
        />
        <Tip>Urgent and on shift? Call your supervisor as well.</Tip>
      </GuideSection>

      <GuideSection topic={T.fix}>
        <Questions
          items={[
            {
              q: 'It says my location is blocked',
              a: (
                <>
                  Open your phone’s Settings, then Apps (or Privacy on iPhone), then Xtend or
                  Chrome, and allow Location. Set location to High accuracy, then go back to
                  Xtend.
                </>
              ),
            },
            {
              q: 'My location is not accurate enough',
              a: (
                <>
                  Turn location on with High accuracy, step outside or near a window for a
                  moment, then tap Try again.
                </>
              ),
            },
            {
              q: 'It says I am off site, but I am in my store',
              a: (
                <>
                  Try again near the entrance or a window. If it keeps happening, tell support
                  through <Ui>Message support</Ui> so your store’s location can be checked.
                </>
              ),
            },
            {
              q: 'Notifications are blocked',
              a: (
                <>
                  In the app: open your phone’s Settings, then Apps (or Notifications on
                  iPhone), then Xtend, and turn Notifications on. In Chrome: tap the lock icon
                  next to the web address, choose Notifications and set it to Allow. On
                  iPhone without the app, add Xtend to your home screen first (Share, then
                  “Add to Home Screen”) and open it from there.
                </>
              ),
            },
            {
              q: 'The camera does not open',
              a: (
                <>
                  Allow the camera for Xtend in your phone’s settings, close other apps using
                  the camera, and try again.
                </>
              ),
            },
            {
              q: 'A banner says something is waiting to send',
              a: (
                <>
                  It sends by itself when you have signal. Keep working, and do not sign out until it
                  has gone.
                </>
              ),
            },
            {
              q: 'I forgot my password',
              a: <>Ask your supervisor or admin to reset it. You will choose a new one when you sign in.</>,
            },
          ]}
        />
      </GuideSection>
    </div>
  )
}
