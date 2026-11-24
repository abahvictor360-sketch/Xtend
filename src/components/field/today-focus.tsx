import Link from 'next/link'
import { ArrowRight, CheckCircle2, Clock3 } from 'lucide-react'
import { nextStep, type NextStepAction, type NextStepState } from '@/lib/next-step'

/**
 * "Your next step": the guide to what to do now (lib/next-step.ts). Clock
 * rules remain in ClockPanel; store check-ins and check-outs are started in
 * StoreVisits through `onAction`.
 */
export function TodayFocus({ state, onAction }: { state: NextStepState; onAction: (action: NextStepAction) => void }) {
  const step = nextStep(state)
  const complete = step.key === 'done'
  return (
    <section className="rounded-3xl border border-brand/15 bg-tint p-5" aria-labelledby="today-focus">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
        {complete ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        Your next step
      </div>
      <h1 id="today-focus" className="mt-3 text-xl font-bold tracking-tight">{step.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-tint-foreground">{step.description}</p>
      {step.action === 'report' ? (
        <Link href="/field/report" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand">
          {step.actionLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      ) : step.action ? (
        <button
          type="button"
          onClick={() => onAction(step.action)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand"
        >
          {step.actionLabel} <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </section>
  )
}
