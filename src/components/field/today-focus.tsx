import Link from 'next/link'
import { ArrowRight, CheckCircle2, Clock3 } from 'lucide-react'

/** A presentation-only guide to the next daily task; clock rules remain in ClockPanel. */
export function TodayFocus({ clockedIn, clockedOut, reportRequired, reportFiled, offDay, openVisit, onVisit }: {
  clockedIn: boolean
  clockedOut: boolean
  reportRequired: boolean
  reportFiled: boolean
  offDay: boolean
  openVisit: boolean
  onVisit?: () => void
}) {
  const reportDue = reportRequired && !reportFiled
  const title = offDay && !clockedIn ? 'Enjoy your time off' : !clockedIn ? 'Ready to start your day?' : openVisit ? 'Your store visit is in progress' : reportDue ? 'Your daily report is next' : clockedOut ? 'Your day is complete' : 'You’re on shift'
  const description = offDay && !clockedIn ? 'You are not scheduled to work today.' : !clockedIn ? 'Use the clock controls below when you are ready.' : openVisit ? 'Check out of the store when your visit is finished.' : reportDue ? 'Add your work for today while it is fresh.' : clockedOut ? 'You can review today’s activity below.' : 'Keep your day up to date. Clock out when your shift ends.'
  const href = openVisit ? '#stores' : clockedIn && reportDue ? '/field/report' : '#clock'
  const complete = clockedOut && !reportDue
  return <section className="rounded-3xl border border-brand/15 bg-tint p-5" aria-labelledby="today-focus">
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
      {complete ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
      Your next step
    </div>
    <h1 id="today-focus" className="mt-3 text-xl font-bold tracking-tight">{title}</h1>
    <p className="mt-2 text-sm leading-relaxed text-tint-foreground">{description}</p>
    {!complete && !(offDay && !clockedIn) && <Link href={href} onClick={openVisit ? onVisit : undefined} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand">
      {openVisit ? 'View your visit' : clockedIn && reportDue ? 'Open daily report' : 'Clock controls'} <ArrowRight className="h-4 w-4" />
    </Link>}
  </section>
}
