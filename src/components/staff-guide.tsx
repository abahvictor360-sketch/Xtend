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
  MapPinPlus,
  Smartphone,
  Store,
  WifiOff,
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
  count: { id: 'store-count', title: 'Store count', icon: ClipboardList },
  clockOut: { id: 'clock-out', title: 'Clock out', icon: LogOut },
  offline: { id: 'no-network', title: 'No network', icon: WifiOff },
  history: { id: 'history', title: 'History and your account', icon: CalendarDays },
  help: { id: 'help', title: 'Getting help', icon: LifeBuoy },
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
              <Ui>Location:</Ui> when asked, tap Allow. In your phone’s settings, set location
              to <Ui>High accuracy</Ui>.
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
              Go to <Ui>You</Ui> and tap <Ui>Take your photo</Ui> (or the camera on your picture).
            </>,
            <>Face the camera in good light and take the photo. Tap it again any time to retake it.</>,
          ]}
        />
        <GuideShot src="/guide/staff-photo.png" alt="The profile photo on the You page" width={748} height={456} phone />
      </GuideSection>

      <GuideSection topic={T.clockIn} intro="Do this when you arrive at your store, once a day.">
        <Steps
          items={[
            <>Open Xtend while you are inside your store.</>,
            <>
              Tap <Ui>Clock in with selfie</Ui> and take a clear photo of your face.
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
        <Tip>Keep location on and Xtend open during your shift. On the app, it carries on in the background.</Tip>
      </GuideSection>

      <GuideSection topic={T.visits} intro="Marketers who move between stores check in at each one.">
        <Steps
          items={[
            <>Clock in at the start of your day as above.</>,
            <>
              At each store, tap <Ui>Check in here</Ui>.
            </>,
            <>
              When you leave, tap <Ui>Check out</Ui> before you go to the next store. You can
              only be checked in at one store at a time.
            </>,
            <>
              If Xtend does not know the place, it asks you to <Ui>name it</Ui> and take a
              photo of the shop front.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection
        topic={T.place}
        intro="Sometimes Xtend does not know the shop you are in. It then asks you for its name."
      >
        <Steps
          items={[
            <>
              After you clock in or check in, look for <Ui>What is the name of this shop?</Ui> on
              the home screen.
            </>,
            <>
              Type the name exactly as it is written on the shop&apos;s sign, for example “Mama
              Nkechi Provisions”.
            </>,
            <>
              Tap <Ui>Photo and save</Ui> and take a clear photo of the <Ui>shop front, sign or
              entrance</Ui>, standing outside so the sign can be read.
            </>,
            <>
              Wait while Xtend checks the photo. When you see <Ui>Saved. Thank you.</Ui>, you are
              done.
            </>,
          ]}
        />
        <p>
          <Ui>Marketers:</Ui> if Xtend does not recognise the store when you check in, tap{' '}
          <Ui>Pick the store myself</Ui> and choose it from the list. Stores marked{' '}
          <Ui>Here</Ui> are the ones you are standing in.
        </p>
        <Tip>
          The photo must show a shop. A photo of a house or the inside of a room is not accepted. If
          the shop has no sign, photograph the entrance and type the name people know it by.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.report} intro="If you see a Report tab at the bottom, file one report each day.">
        <Steps
          items={[
            <>
              Tap <Ui>Report</Ui>, fill in how the day went, and add a photo if asked.
            </>,
            <>
              Tap <Ui>Submit report</Ui>. You can edit it until midnight.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection topic={T.count} intro="When a store count is due, a Count tab appears and the home screen tells you.">
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
        <GuideShot
          src="/guide/staff-progress.png"
          alt="The day's progress: clock in, daily report, clock out"
          width={780}
          height={586}
          caption="Under My day, each step's ring closes when it is done."
          phone
        />
      </GuideSection>

      <GuideSection topic={T.offline} intro="Weak signal or no data is fine.">
        <p>
          Keep working as normal. What you do is <Ui>saved on your phone</Ui> and sent by
          itself when you are back online. A banner shows anything still waiting to send.
        </p>
        <Tip>Do not sign out or clear Xtend while something is waiting to send.</Tip>
      </GuideSection>

      <GuideSection topic={T.history} intro="Your own record and settings.">
        <p>
          <Ui>History</Ui> shows your attendance day by day. <Ui>You</Ui> shows your
          account: your store, notifications, <Ui>Change your password</Ui> and{' '}
          <Ui>Message support</Ui>.
        </p>
      </GuideSection>

      <GuideSection topic={T.help} intro="Stuck? Ask from inside Xtend.">
        <Steps
          items={[
            <>
              Go to <Ui>You</Ui>, then <Ui>Message support</Ui>.
            </>,
            <>
              Describe the problem, for example: “my clock-in keeps saying off site at my
              store”.
            </>,
            <>
              The Xtend helper replies, and the office steps in when needed. Replies arrive as
              notifications.
            </>,
          ]}
        />
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
              q: 'I forgot my password',
              a: <>Ask your supervisor or admin to reset it. You will choose a new one when you sign in.</>,
            },
          ]}
        />
      </GuideSection>
    </div>
  )
}
