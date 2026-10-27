import Link from 'next/link'
import {
  Bell,
  CalendarCheck,
  ClipboardList,
  CalendarDays,
  FileDown,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  Route,
  ShieldAlert,
  UserCog,
  Users,
} from 'lucide-react'
import { requireSession } from '@/lib/auth'
import { GuideContents, GuideSection, Questions, Steps, Tip, Ui, type GuideTopic } from '@/components/guide'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Supervisor guide — Xtend' }

const T = {
  team: { id: 'your-team', title: 'Your team in the dashboard', icon: Users },
  daily: { id: 'every-day', title: 'Every day', icon: CalendarCheck },
  overview: { id: 'overview', title: 'Overview and Ask Xtend', icon: LayoutDashboard },
  attendance: { id: 'attendance', title: 'Attendance and Analytics', icon: ClipboardList },
  movement: { id: 'movement', title: 'Movement and Store visits', icon: Route },
  alerts: { id: 'alerts-support', title: 'Alerts and Support', icon: Bell },
  stock: { id: 'stock', title: 'Stock count and X Metrics', icon: Gauge },
  checks: { id: 'checks', title: 'Integrity and Check an excuse', icon: ShieldAlert },
  people: { id: 'people', title: 'Your staff, stores and messages', icon: UserCog },
  schedules: { id: 'schedules-leave', title: 'Schedules and leave', icon: CalendarDays },
  reports: { id: 'marketer-reports', title: 'Marketer reports', icon: FileDown },
  faq: { id: 'questions', title: 'Questions', icon: HelpCircle },
} satisfies Record<string, GuideTopic>

/**
 * How a supervisor runs their own team from the dashboard. Shown in the
 * menu to supervisors; admins can open it to see what supervisors read.
 * How tracking and the checks work is in the admin guide only.
 */
export default async function SupervisorGuidePage() {
  const session = await requireSession(['admin', 'supervisor'])
  const isAdmin = session.profile.role === 'admin'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Supervisor guide</h1>
        <p className="text-sm text-muted-foreground">
          How to look after your team from the dashboard, page by page. Everything you see covers your
          own team only. Your staff have a short guide of their own at{' '}
          <Link href="/guide" className="font-semibold text-brand hover:underline">
            /guide
          </Link>
          , which you can share with them. Times are Lagos time.
        </p>
        {isAdmin && (
          <p className="mt-2 rounded-lg bg-tint p-2 text-xs text-tint-foreground">
            You are an admin: this is the guide supervisors see. Yours is the{' '}
            <Link href="/admin/guide" className="font-semibold underline">
              Admin guide
            </Link>
            .
          </p>
        )}
      </div>

      <GuideContents topics={Object.values(T)} />

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection topic={T.team} intro="What you can see and do.">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              You see the merchandisers and marketers an admin has put on your team, and the stores they
              work. Nobody else&apos;s.
            </li>
            <li>
              You can add merchandisers and marketers (they join your team), reset their passwords,
              allocate their stores, ask them for stock counts, send them notifications, answer their
              support messages, check excuses and review integrity flags.
            </li>
            <li>
              An admin does the rest: adding supervisors and admins, moving people between teams, adding
              or changing stores, resolving alerts and changing X Metrics. Ask your admin when you need one
              of these.
            </li>
            <li>Every change you make is recorded, with who made it and when.</li>
          </ul>
        </GuideSection>

        <GuideSection topic={T.daily} intro="Ten minutes each morning, and a look before close.">
          <Steps
            items={[
              <>
                <Ui>Overview</Ui>: who on your team has clocked in, who is late, who has not come in yet.
              </>,
              <>
                Call or message anyone not in yet. <Ui>Notifications</Ui> reaches the whole team at once.
              </>,
              <>
                <Ui>Alerts</Ui>: follow up anyone who left their store or clocked in away from it.
              </>,
              <>
                <Ui>Messages</Ui>: read and answer what your team wrote to you. Unread ones are in bold.
              </>,
              <>
                <Ui>Support</Ui>: answer your team&apos;s problems with the app, longest waiting first.
              </>,
              <>
                <Ui>Leave</Ui>: answer pending leave requests so people know where they stand.
              </>,
              <>
                Before close: <Ui>Attendance</Ui> for anyone who has not clocked out (Xtend also
                reminds them at the end of their shift), and <Ui>Store visits</Ui> for stores your
                marketers did not reach.
              </>,
            ]}
          />
          <Tip>
            Short on time? Ask Xtend: “who on my team has not clocked in?”, “who was late this week?”.
          </Tip>
        </GuideSection>

        <GuideSection topic={T.overview} intro="The top of the menu. On a phone, tap the page name at the top to open navigation. Tap outside it or press Escape to close it.">
          <p>Start with <Ui>Start here</Ui> on Overview, then tap a summary card to open its page. Attendance follow-up lists missing clock-ins. Expand <Ui>Live locations &amp; coverage</Ui> for details. On Alerts, expand <Ui>Filters &amp; downloads</Ui> to narrow results; notification settings are at the bottom.</p>
          <p>
            <Ui>Overview</Ui> shows your team today: clocked in, late, not in their store, not in yet, and
            open alerts, with the week at a glance.
          </p>
          <p>
            <Ui>Ask Xtend</Ui> answers plain questions about your team (“who forgot to clock out
            yesterday?”, “show today&apos;s stock counts”) and makes reports to download. Ask it to do
            something, such as “remind everyone who has not clocked in to clock in now” or “ask my team
            for a stock count by Friday”, and it shows a card saying exactly what will happen; nothing is
            done until you press the card&apos;s button. Your chats are kept under <Ui>Earlier chats</Ui>.
          </p>
        </GuideSection>

        <GuideSection topic={T.attendance} intro="Who came in, when, and where.">
          <p>
            <Ui>Attendance</Ui> shows each person&apos;s day: clock-in and clock-out, on time or late, at
            their store or not. Pick dates or a quick range and narrow by person, store or kind of day. The
            calendar shows a square per person per day; open one to see the photo, the map and how far from
            the store they were. <Ui>Worth a look</Ui> names repeat absences, lateness and missing
            clock-outs.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Late means after the store&apos;s shift start.</li>
            <li>
              Xtend reminds your team 5 minutes before their shift starts (if they have not clocked in on
              a working day) and 5 minutes before it ends, then again at the end if they are still clocked
              in. These show in Notifications history as automatic alerts.
            </li>
            <li>
              Days off and approved leave never count as absent. In the calendar a day off shows
              grey “–” and leave soft orange “Lv”.
            </li>
            <li>Off site means outside the store&apos;s area; flagged means the location was unclear.</li>
            <li>Records cannot be changed by anyone.</li>
          </ul>
          <p>
            <Ui>Analytics</Ui> compares a period with the one before: who improved, who slipped, and how
            well each store was covered.
          </p>
        </GuideSection>

        <GuideSection topic={T.movement} intro="Where your team is during the shift.">
          <p>
            <Ui>Movement</Ui> shows your team on shift on a map, each as their profile photo; click a photo
            to follow that person. Pick a person and up to 7 days to see where
            they went: the places they stopped, the time at their store and away, and when nothing came in.
            <Ui> Worth a look</Ui> points out what needs a question.
          </p>
          <p>
            <Ui>Follow live</Ui> (next to each name under <Ui>On shift now</Ui>, or at the top of their
            journey) shows one person on your team moving on the map a few seconds behind, like a delivery
            app. You can only follow someone who is clocked in. It lasts 30 minutes (press{' '}
            <Ui>Keep following</Ui> for 30 more), and stops when they clock out, when you press{' '}
            <Ui>Stop</Ui> or when you close the page. <Ui>Call</Ui> rings them. Only a few people can be
            followed at once across Xtend; if it says to try again, wait a few minutes.
          </p>
          <p>
            <Ui>Store visits</Ui> shows your marketers&apos; rounds: which stores, when and for how long,
            with the check-in photo. <Ui>Store coverage</Ui> shows stores nobody has visited for a while.
          </p>
          <Tip>Use what you see to ask, not to accuse: a phone with no network or no battery looks quiet too.</Tip>
        </GuideSection>

        <GuideSection topic={T.alerts} intro="What needs following up.">
          <p>
            <Ui>Alerts</Ui> shows when someone on your team left their store during a shift, clocked in away
            from it, or had location off. Each alert links to their movement that day, a phone check and a
            call. Follow up, then tell your admin what you found; admins resolve alerts.
          </p>
          <p>
            <Ui>Messages</Ui> is your chat with each merchandiser and marketer on your team: stock, the
            store, their shift, anything about the work. They write from <Ui>You</Ui> →{' '}
            <Ui>Messages</Ui> in the app and you get a notification; open their name, read, and reply. Your
            reply reaches their phone straight away. Admins and HR can read and reply in these chats too.
            Anyone with no messages yet is under <Ui>Start a conversation</Ui>.
          </p>
          <p>
            <Ui>Support</Ui> holds your team&apos;s problems and complaints from the app. The Xtend helper
            answers simple ones; the rest wait for you, longest waiting first. Reply in your own words or
            with a quick reply, pass it to an admin under <Ui>Who answers</Ui> when it needs one (a password,
            a store, a change to someone&apos;s account), and close it when sorted. Your reply reaches their
            phone.
          </p>
        </GuideSection>

        <GuideSection topic={T.stock} intro="What is in your stores.">
          <Steps
            items={[
              <>
                On <Ui>Stock count</Ui>, click to request a count: pick people, all merchandisers or
                marketers on your team, and a due date. They are told on their phones.
              </>,
              <>
                Watch who has counted. Each count shows every product with back store, shop floor, total,
                expiry and sold, and a shelf photo.
              </>,
              <>Close a request early if you no longer need it.</>,
            ]}
          />
          <p>
            Some count on paper: they download the month&apos;s Xpel sheet, fill it and send it back as
            Excel, PDF or a photo. Those sheets are under <Ui>Count sheets</Ui> on Stock count, with what
            each was for: a requested count, the month-end count, or <Ui>Sent any time</Ui> (staff can
            send one from their profile on any day).
          </p>
          <p>
            Everyone also counts at the end of each month without being asked. <Ui>X Metrics</Ui> shows
            your stores&apos; stock, sales against target, expiry alerts and your team&apos;s grades; an
            admin sets it up and changes it. An admin can switch parts of it off for a while: they leave
            your menu until they are back on, and nothing is lost.
          </p>
        </GuideSection>

        <GuideSection topic={T.checks} intro="When something does not add up.">
          <p>
            <Ui>Integrity</Ui> lists things about your team worth a second look. A flag is a reason to ask,
            not proof. <Ui>Who to look at first</Ui> puts the people with the most to ask about at the top.
            Talk to the person, then mark the flag reviewed with what you found (tick several to review them
            together).
          </p>
          <p>
            <Ui>Check an excuse</Ui>: someone says their network was bad, their phone was off, or the app
            would not let them clock in? Pick who, what they said and when. Xtend says whether it holds up,
            with a timeline. <Ui>Keep on record</Ui> with a note when it matters.
          </p>
          <Tip>Staff do not see flags, checks or excuses kept on record. Keep it that way.</Tip>
        </GuideSection>

        <GuideSection topic={T.people} intro="Your staff, their stores, and reaching them.">
          <p>
            <Ui>Staff</Ui>: <Ui>Add staff</Ui> creates a merchandiser or marketer on your team with a
            temporary password; they choose their own at first sign-in. You can also reset a password, fix
            a name or phone number, or deactivate someone who has left (their history stays).
          </p>
          <p>
            <Ui>Store allocation</Ui>: choose which stores each person works. A merchandiser&apos;s clock-in
            is measured against their store, so keep it right. Once someone has stores allocated, they
            can only check in at those (and their home store), and the app lists only those.
          </p>
          <p>
            <Ui>Notifications</Ui>: write a message to your team or named people, check <Ui>See who</Ui>,
            and send now or later. The history shows who got it and who read it; <Ui>Send again</Ui>{' '}
            reaches those it missed.
          </p>
          <p>
            <Ui>Outlets</Ui> lists your stores with their hours and areas. To add a store or change one,
            ask an admin.
          </p>
        </GuideSection>

        <GuideSection topic={T.schedules} intro="Which days each person works, and time off.">
          <p>
            <Ui>Schedules</Ui> (People menu): set which weekdays each person on your team works.
            Everyone starts on Monday to Saturday. Use the tabs to show merchandisers or marketers, and{' '}
            <Ui>Mon–Sat</Ui> or <Ui>Own week</Ui> to see who works the usual week. Tick several people to
            give them the same week at once, or use the <Ui>Schedule</Ui> link on the Staff page. Add a one-off change for a single
            date (an extra day in or an extra day off), with a note.
          </p>
          <p>
            <Ui>Leave</Ui> (People menu): your team&apos;s requests, pending first. Approve or reject
            with an optional note; the person is told on their phone either way. You cannot decide leave
            for anyone outside your team.
          </p>
          <Tip>Pending leave does not excuse a day. Answer requests before the day comes.</Tip>
        </GuideSection>

        <GuideSection topic={T.reports} intro="Each marketer's day or month, ready to send.">
          <p>
            <Ui>Marketer reports</Ui> (Attendance menu) lists your team. Pick <Ui>A day</Ui> or{' '}
            <Ui>A month</Ui> and download each person&apos;s report as PDF, Word or Excel: clock-in and
            clock-out, every store visit with the time spent there, their daily report, stock counts and
            sales. From <Ui>Store visits</Ui> → <Ui>By person</Ui>, <Ui>Day report</Ui> or{' '}
            <Ui>Month report</Ui> opens the same thing.
          </p>
          <p>
            Marketers can attach up to five documents to a daily report (PDF, Word, Excel, CSV or
            pictures). Under <Ui>Documents attached</Ui> on the same page, tap <Ui>Download</Ui> to open
            one; long document names wrap on your phone. The PDF, Word and Excel reports list them by name.
          </p>
          <p>
            Reports are never deleted. Clock-in photos, and report photos or documents that never made it
            onto a report, are deleted after 14 days; the evening before, you get a notification saying how
            many from your team go tomorrow, so you can download anything you need that day.
          </p>
        </GuideSection>

        <GuideSection topic={T.faq}>
          <Questions
            items={[
              {
                q: 'Someone on my team cannot clock in',
                a: (
                  <>
                    Usually location or notifications are off on their phone; the staff guide shows them how
                    to turn them on. Check on Staff that they are active and, for a merchandiser, that they
                    have a store on Store allocation.
                  </>
                ),
              },
              {
                q: 'Someone forgot their password',
                a: <>Reset it on Staff. They choose a new one when they sign in.</>,
              },
              {
                q: 'Someone left the company',
                a: <>Deactivate them on Staff. Their history stays.</>,
              },
              {
                q: 'I need someone moved to my team, or a new store added',
                a: <>Ask an admin: moving people between teams and adding stores are for admins.</>,
              },
              {
                q: 'A store’s area seems wrong (people show off site inside it)',
                a: <>Tell an admin which store; they can correct its location or area.</>,
              },
            ]}
          />
        </GuideSection>
      </div>
    </div>
  )
}
