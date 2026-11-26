import Link from 'next/link'
import {
  BellRing,
  CalendarDays,
  Camera,
  CircleAlert,
  CircleHelp,
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
import { StaffVideo } from '@/components/staff-video'
import { TECNO_VIDEO } from '@/lib/tecno-video'
import { GUIDE_PROBLEMS, guideFor } from '@/lib/field-guide'

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
  stops: { id: 'when-xtend-stops-you', title: 'When Xtend stops you', icon: CircleAlert },
  faq: { id: 'questions', title: 'Questions staff ask', icon: CircleHelp },
  fix: { id: 'problems', title: 'Common problems', icon: Wrench },
} satisfies Record<string, GuideTopic>

const T = STAFF_TOPICS

/** How the pop-up steps are worded in the guide (lib/field-guide.ts). */
const TASK = 'clock in or check in'

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How does Xtend know which store I am clocking in at? (marketers)',
    a: (
      <>
        Your day starts at your first store. Go inside the store and tap <Ui>Clock in</Ui>: Xtend finds the store
        from where you are and opens the camera. Your selfie clocks you in and checks you in there at the same time.
        If Xtend cannot tell which store you are in, it shows your stores: pick the one you are at. If you do not
        clock in at one of your stores, today does not count.
      </>
    ),
  },
  {
    q: 'The store I am at is not on my list',
    a: (
      <>
        Only the office can add stores to your list. Message them the store&apos;s name and its Google Maps link (open
        the store in Google Maps, tap <Ui>Share</Ui>, copy the link). Until it is added, start your day at one of your
        own stores.
      </>
    ),
  },
  {
    q: 'It says no store is allocated to me',
    a: (
      <>
        You cannot clock in until your admin allocates a store to you. Go to <Ui>You</Ui>, then <Ui>Messages</Ui>, and
        ask them to; send the stores you visit with each one&apos;s Google Maps link. Clock in once a store is
        allocated.
      </>
    ),
  },
  {
    q: 'Can I clock in from home or on the way?',
    a: (
      <>
        No. Xtend only lets you clock in when you are at your store (marketers: the store you picked to start at). Away
        from it you see <Ui>You are off site</Ui>.
      </>
    ),
  },
  {
    q: 'It says “You are off site”',
    a: (
      <>
        You are not at your store yet. The box names the store you need to be at and how far it is. Tap{' '}
        <Ui>Directions</Ui> to see the way in Google Maps, go inside the store, then tap <Ui>I am at the store</Ui> and
        try again. Marketers: if you picked the wrong store, pick the one you are in.
      </>
    ),
  },
  {
    q: 'What time should I clock in?',
    a: (
      <>
        By the start time on <Ui>You</Ui>, under <Ui>Your hours</Ui>. These are your own hours, whichever store you go
        to. Clocking in after your start time shows as late. Think your hours are wrong? Message the office: only they
        can change them.
      </>
    ),
  },
  {
    q: 'I keep getting “Still at the store? Check out before you leave”',
    a: (
      <>
        While you are checked in at a store, Xtend reminds you every 20 minutes so you do not forget to check out. Still
        working there? Carry on. Leaving? Tap <Ui>Check out</Ui> first.
      </>
    ),
  },
  {
    q: 'My phone is ringing “Check out before you leave”',
    a: (
      <>
        You walked out of the store without checking out. Go back to the store, open Xtend and tap{' '}
        <Ui>Check out</Ui>; the ringing stops. Always check out before you step out of a store, when you are done
        there.
      </>
    ),
  },
  {
    q: 'I forgot to check out of a store',
    a: (
      <>
        Home shows the store with a <Ui>Check out</Ui> button. Check out, then check in at the store you are in now. You
        can only be checked in at one store at a time.
      </>
    ),
  },
  {
    q: 'I forgot to clock out',
    a: (
      <>
        Clock out as soon as you remember. If the day has already ended, message your supervisor so they can sort out
        your record.
      </>
    ),
  },
  {
    q: 'What does “Your next step” on Home mean?',
    a: (
      <>
        It always tells you what to do now: clock in, check in at a store, check out, write your report or clock out,
        with a button to do it. Do what it says and your day is in order.
      </>
    ),
  },
  {
    q: 'How do I know my clock-in worked?',
    a: (
      <>
        Home shows <Ui>Clocked in</Ui> and the time, and the first ring under <Ui>My day</Ui> closes. If you are not
        sure, pull down on Home to refresh it.
      </>
    ),
  },
  {
    q: 'Why does Xtend need a selfie?',
    a: (
      <>
        It shows it is really you clocking in. Take it in good light with your whole face in the picture. Photos from
        your gallery cannot be used.
      </>
    ),
  },
  {
    q: 'My selfie was not accepted',
    a: (
      <>
        Face a light (a window or the shop lights), hold the phone still at arm&apos;s length and keep your whole face in
        the picture. Never take a photo of a screen or a printed picture. Then try again.
      </>
    ),
  },
  {
    q: 'There is no signal in my store',
    a: (
      <>
        Step near the door or a window, or outside for a moment, and try again. Reports and stock counts wait on your
        phone and send themselves when you get signal; a store check-in or check-out needs signal, so try again when you
        have it.
      </>
    ),
  },
  {
    q: 'Home says “No network” or “Your network is weak”',
    a: (
      <>
        Your data or signal is off or too weak. Turn on Mobile data, check you have data on your line, and move near the
        door or a window, or step outside. With no network, a clock-in or clock-out is kept on your phone and only counts
        once it sends; store check-ins and check-outs need network, and your location is slower to find. When it says{' '}
        <Ui>Your network is back</Ui>, anything waiting sends by itself.
      </>
    ),
  },
  {
    q: 'I got a new phone',
    a: (
      <>
        Install Xtend from the download page, sign in, and allow Location, Camera and Notifications again, as in{' '}
        <Ui>Before your first clock-in</Ui>. Your record stays with your account, not the phone.
      </>
    ),
  },
  {
    q: 'How do I change my profile photo?',
    a: (
      <>
        Go to <Ui>You</Ui> and tap your picture (or <Ui>Take your photo</Ui>), then take a new one.
      </>
    ),
  },
  {
    q: 'I missed my daily report yesterday',
    a: (
      <>
        Open <Ui>Report</Ui> and pick <Ui>Yesterday</Ui> (or another day, up to 7 days back). After 7 days a report can no
        longer be written or changed.
      </>
    ),
  },
  {
    q: 'I am sick or need a day off',
    a: (
      <>
        Go to <Ui>You</Ui>, then <Ui>Ask for leave</Ui>, pick <Ui>Sick</Ui> or another type, the days and the reason. Call
        your supervisor too if it is the same day.
      </>
    ),
  },
  {
    q: 'Who answers when I message support?',
    a: (
      <>
        The Xtend helper answers simple questions straight away. Anything it cannot sort out goes to the office, and you
        get a notification when they reply.
      </>
    ),
  },
  {
    q: 'Where is this guide in the app?',
    a: (
      <>
        Go to <Ui>You</Ui>, then <Ui>How to use Xtend</Ui>. Every pop-up also has a link: <Ui>Not sure? Read the staff
        guide</Ui>.
      </>
    ),
  },
]

/**
 * The staff guide's content, shared by the public page (/guide) and the
 * same guide inside the app (/field/guide). Worded like the staff app.
 */
export function StaffGuide() {
  return (
    <div className="space-y-5">
      <StaffVideo />
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
              password you were given. If the page asks you to tick a box first, tick it.
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
              <Ui>High accuracy</Ui>. In the Xtend app, you also need <Ui>Battery: Unrestricted</Ui>{' '}
              (turn off battery saving for Xtend). Xtend will not let you clock in or out until both
              are set, and it shows you where to change them.
            </>,
            <>
              <Ui>Camera:</Ui> allow it when asked. Clocking in and out takes a selfie with
              the camera inside Xtend.
            </>,
            <>
              <Ui>Notifications:</Ui> tap <Ui>Turn on notifications</Ui> on the home screen.
              You cannot clock in until they are on.
            </>,
            <>
              <Ui>TECNO, Infinix or itel phone?</Ui> These phones close apps by themselves. Xtend shows{' '}
              <Ui>Auto-start and lock Xtend</Ui>: tap <Ui>Open Auto-start</Ui> and turn on Xtend, then open your
              recent apps, pull Xtend down until a lock shows, and tap <Ui>I did both</Ui>. You only do this once
              on each phone.
            </>,
          ]}
        />
        <figure className="mx-auto max-w-[260px] space-y-2">
          <video
            src={TECNO_VIDEO.src}
            poster={TECNO_VIDEO.poster}
            controls
            playsInline
            preload="none"
            className="w-full rounded-2xl bg-black"
          />
          <figcaption className="text-center text-xs text-muted-foreground">
            TECNO, Infinix or itel phone: watch the two steps ({Math.round(TECNO_VIDEO.seconds / 30) / 2} min).
          </figcaption>
        </figure>
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
          <p>
            You can only clock in, or check in at a store, when you are at the store. If you are not, Xtend shows{' '}
            <Ui>You are off site</Ui> with the store you need to go to, how far it is and a <Ui>Directions</Ui>{' '}
            button that opens the way in Google Maps. Go there, then tap <Ui>I am at the store</Ui>. Clocking out
            works anywhere.
          </p>
          <p>
            Clock in at your store, never at home or on the way. Clock in by the start time under{' '}
            <Ui>You</Ui>, then <Ui>Your hours</Ui>: clocking in after it shows as late. Only the office can change your
            hours.
          </p>
          <p>
            <Ui>Marketers:</Ui> your day starts at your first store. When you tap <Ui>Clock in</Ui>, Xtend asks{' '}
            <Ui>Pick the store you are starting at</Ui> and lists your own stores, nearest first, with{' '}
            <Ui>Here</Ui> on the one you are in. Pick it, then take the selfie: that clocks you in and checks you in at
            that store in one go. If you do not clock in at one of your stores, today does not count. See{' '}
            <Ui>Store visits</Ui> below.
          </p>
          <p>
            Home shows <Ui>Your next step</Ui> above the clock controls: it always tells you what to do now, with a
            button to do it. Use <Ui>My day</Ui> below them to see your progress and recent days.
          </p>
          <p>
            If something stops you (location off, a setting Xtend needs, a weak signal indoors), a box pops up with
            numbered steps to fix it and a <Ui>Try again</Ui> button. Do the steps in order.
          </p>
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
            <>
              Clock in at the start of your day as above. You cannot check in at a store until you have
              clocked in, and with no signal a check-in or check-out is not recorded: try again when you
              have signal.
            </>,
            <>
              Keep your phone’s location on all day. Without it, Xtend shows{' '}
              <Ui>Location required</Ui> and you cannot clock in or out, or check in or out of a
              store.
            </>,
            <>
              Start your day at your first store, never at home. When you open Xtend (or tap{' '}
              <Ui>Clock in</Ui>), it asks <Ui>Pick the store you are starting at</Ui>. Pick it, and the camera
              opens: your clock-in selfie also checks you in at that store. Your day only counts once you clock
              in at a store.
            </>,
            <>
              See <Ui>No stores are allocated to you yet</Ui>? Message the office the stores you visit, with each
              store&apos;s Google Maps link (open the store in Google Maps, tap <Ui>Share</Ui>, copy the link), and
              clock in once they are added. Do the same for any new store you visit.
            </>,
            <>
              At each next store, tap <Ui>Check in here</Ui>. If Xtend does not find the store, tap{' '}
              <Ui>Pick the store myself</Ui>: it lists only the stores on your list.
            </>,
            <>
              While you are checked in, Xtend reminds you every 20 minutes: <Ui>Still at (the store)? Check out
              of the store before you leave.</Ui> If you are still working there, carry on.
            </>,
            <>
              When you leave, tap <Ui>Check out</Ui> and take a selfie, as when you checked in,
              before you go to the next store. You can
              only be checked in at one store at a time. If you forgot to check out of a store,
              Home shows it with a <Ui>Check out</Ui> button: check out, then check in again.
              Starting your day at one of your stores? Clocking in there checks you in at that
              store too, so there is no second selfie.
            </>,
            <>
              See <Ui>That store is not on your list</Ui>? Pick one of your own stores. Working at a new store? Message
              the office its name and its Google Maps link so they can add it.
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

      <GuideSection topic={T.report} intro="If you see a Report tab at the bottom, file your report each day.">
        <Steps
          items={[
            <>
              Tap <Ui>Report</Ui>. First pick <Ui>which day</Ui> it is for: <Ui>Today</Ui>,{' '}
              <Ui>Yesterday</Ui>, another day of the last week, or <Ui>Another day</Ui> to choose a date
              (up to 7 days back). You can write your reports after you clock out: log in again in the
              evening, or the next morning before you clock in. Then pick what it is for:{' '}
              <Ui>The whole day</Ui>, or one of the stores you checked in at that day. You can write one
              for each store and one for the whole day; each shows <Ui>Filed · edit</Ui> once sent.
            </>,
            <>
              Fill in how it went, and add a photo if asked.
            </>,
            <>
              Have a price list, a display plan, an invoice or a picture for the office? Under{' '}
              <Ui>Attach documents</Ui>, tap <Ui>Choose documents</Ui> and pick them: PDF, Word,
              Excel or CSV files, or pictures. Up to 5, each 10 MB or smaller. Each one shows with
              its name and size; tap the <Ui>×</Ui> to take one off.
            </>,
            <>
              Tap <Ui>Submit report</Ui>. Your documents go with it. You can edit the report, and
              add or remove documents, for 7 days. Wait for “Updating documents…” to finish before changing another document.
            </>,
          ]}
        />
        <p>
          Marketers: the top of the report shows the store visits it covers: all of that day&apos;s for
          the whole day, or just that one for a store report, with the time in and out and how long
          you were there. They are added to your report when you save it; there is nothing to type
          for them.
        </p>
        <Tip>
          No data? Your report and its documents wait on your phone and send themselves when you
          get signal. A document you remove with no data shows <Ui>Removing…</Ui> until then. A report
          closes 7 days after the day it is for; after that it cannot be changed.
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
        <p>Xtend also reminds you 5 minutes before your shift starts and 5 minutes before it ends.</p>
        <p>
          Your working hours are yours, not the store&apos;s: you see them on <Ui>You</Ui> under{' '}
          <Ui>Your hours</Ui>. Clock in by your start time wherever your first store is. If it also says{' '}
          <Ui>You can clock out from</Ui> a time, you may clock out any time from then. Only the office can change
          your hours.
        </p>
        <p>
          You cannot clock out before your clock-out time. If you tap <Ui>Clock out</Ui> too early, Xtend says{' '}
          <Ui>Not time to clock out yet</Ui> and the time you can clock out from. Marketers: until then, keep
          checking in and out at your stores. If you must leave early (you are sick, an emergency), call your
          supervisor: the office can let you clock out now, or clock you out.
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
          account: your store, notifications, <Ui>Messages</Ui>, <Ui>Change your password</Ui> and{' '}
          <Ui>Message support</Ui>. To change your password, type your current password first, then
          the new one twice. Under <Ui>Fingerprint and passkeys</Ui> you can turn on{' '}
          <Ui>Sign in with fingerprint</Ui> in the app, so you sign in by touching the sensor instead of
          typing your password. Your fingerprint stays on your phone. Changing your password turns it
          off; turn it on again after.
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
        <p>
          To talk to your supervisor about your work (stock, the store, your shift), open{' '}
          <Ui>You</Ui>, then <Ui>Messages</Ui>. Write your message and tap <Ui>Send</Ui>. Their reply
          arrives as a notification, and the home screen shows <Ui>You have a new message</Ui> until
          you read it.
        </p>
      </GuideSection>

      <GuideSection
        topic={T.stops}
        intro="If something stops you clocking in, checking in or checking out, a box pops up saying what is wrong, with numbered steps and a button. These are the same steps, so you can read them any time."
      >
        <div className="space-y-4">
          {GUIDE_PROBLEMS.map((problem) => {
            const android = guideFor(problem, 'android', TASK)
            const iphone = guideFor(problem, 'ios', TASK)
            const sameOnIphone = iphone.steps.join('|') === android.steps.join('|')
            return (
              <div key={problem} className="space-y-2 rounded-2xl border border-border p-4">
                <h3 className="font-semibold">{android.title}</h3>
                <p className="text-sm text-muted-foreground">{android.why}</p>
                {!sameOnIphone && <p className="text-sm font-semibold">On Android:</p>}
                <Steps items={android.steps} />
                {!sameOnIphone && (
                  <>
                    <p className="text-sm font-semibold">On iPhone:</p>
                    <Steps items={iphone.steps} />
                  </>
                )}
              </div>
            )
          })}
        </div>
        <Tip>
          Still stuck after the steps? Go to <Ui>You</Ui>, then <Ui>Message support</Ui>, and say what the box said.
        </Tip>
      </GuideSection>

      <GuideSection topic={T.faq} intro="Short answers to what staff ask most.">
        <Questions items={FAQ} />
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
                  Try again near the entrance or a window, so your phone finds you. If it keeps happening,
                  call your supervisor (they can clock you in) and tell support through{' '}
                  <Ui>Message support</Ui> so your store’s location can be checked.
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
              q: 'The phone says “App not installed” or “package appears to be invalid”',
              a: (
                <>
                  Uninstall any old Xtend first (hold its icon, then <Ui>Uninstall</Ui>), then open the
                  file from the download page again and tap <Ui>Install</Ui>.
                </>
              ),
            },
            {
              q: 'Xtend says “No connection”',
              a: <>Check your data or Wi-Fi, then tap <Ui>Try again</Ui>.</>,
            },
            {
              q: 'The app would not clock me in or out',
              a: (
                <>
                  Call your supervisor. When they confirm you are at the store, they can clock you in or out
                  for you, and you get a notification. If they ask you to clock in or out again, Home shows it:
                  just do it again as usual.
                </>
              ),
            },
            {
              q: 'I forgot my password',
              a: <>Ask your supervisor or admin to reset it. You will choose a new one when you sign in.</>,
            },
            {
              q: 'It says “Turn your location back on”',
              a: (
                <>
                  Your location was switched off. Tap the message (or open your phone&apos;s settings) and turn{' '}
                  <b>Location</b> on. Keep it on from when you clock in until you clock out.
                </>
              ),
            },
            {
              q: 'It says “Install the new Xtend app”',
              a: (
                <>
                  A new Xtend app came out and you were reminded three times. Tap <b>Get the new app</b> and install
                  it; Xtend opens again straight away. Your account and anything waiting to send are kept. Update when
                  the first reminder comes, so this never stops your work.
                </>
              ),
            },
            {
              q: 'It says “Your account is paused”',
              a: <>Contact your supervisor or admin. They will tell you what to do next.</>,
            },
            {
              q: 'It says signing in is paused',
              a: (
                <>
                  After 5 wrong passwords in a row, Xtend pauses signing in on that phone for 15 minutes to
                  keep your account safe. Wait, then try again with the right password, or ask your
                  supervisor to unlock it sooner.
                </>
              ),
            },
          ]}
        />
      </GuideSection>
    </div>
  )
}
