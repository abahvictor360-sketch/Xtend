import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Activity, CheckCircle2, ClipboardCheck, HelpCircle, History, Smartphone, User, XCircle } from 'lucide-react'
import { Chip, EmptyState, Panel, PageHeader, StatCard, StatGrid } from '@/components/admin/page-kit'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PhoneCheck } from '@/components/admin/phone-check'
import { ExcuseTimeline } from '@/components/admin/excuse-timeline'
import { SaveExcuseCheck } from '@/components/admin/save-excuse-check'
import { CLAIMS, isClaim, lagosInstant, type Claim } from '@/lib/excuse'
import { checkExcuse } from '@/lib/excuse-server'
import { addDays, cn, formatLagos, lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Check an excuse — Xtend' }

interface Search {
  person?: string
  date?: string
  until?: string
  from?: string
  to?: string
  claim?: string
}

const TONE = {
  false: 'border-destructive/40 bg-destructive/10',
  doubtful: 'border-amber-500/40 bg-amber-500/10',
  fits: 'border-emerald-600/40 bg-emerald-600/10',
  unknown: 'border-border bg-muted',
} as const

const LABEL = { false: 'Not true', doubtful: 'Doubtful', fits: 'Fits the evidence', unknown: 'No evidence' }
const BADGE = { false: 'destructive', doubtful: 'warning', fits: 'success', unknown: 'outline' } as const

interface Kept {
  id: string
  user_id: string
  staff_name: string
  claim: Claim
  window_from: string
  window_to: string
  verdict: keyof typeof LABEL
  headline: string
  note: string | null
  checked_by_name: string | null
  created_at: string
}

export default async function ExcusesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession(['admin', 'supervisor'])
  const search = await searchParams
  const supabase = await createServerSupabase()

  const { data: people } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('role', ['merchandiser', 'marketer'])
    .eq('is_active', true)
    .order('full_name')

  const today = lagosDateString()
  const isDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '')
  const date = isDate(search.date) && search.date! <= today ? search.date! : today
  const until = isDate(search.until) && search.until! >= date && search.until! <= today ? search.until! : date
  const hm = (v: string | undefined, fallback: string) => (/^\d{2}:\d{2}$/.test(v ?? '') ? v! : fallback)
  const nowHm = formatLagos(new Date(), false)
  const from = hm(search.from, '08:00')
  const to = hm(search.to, until === today ? nowHm : '18:00')
  const claim: Claim = isClaim(search.claim) ? search.claim : 'no_network'
  const person = (people ?? []).find((p) => p.id === search.person)
  const windowFrom = lagosInstant(date, from)
  const windowTo = lagosInstant(until, to)

  let problem: string | null = null
  let checked: Awaited<ReturnType<typeof checkExcuse>> | null = null
  if (person) {
    checked = await checkExcuse(supabase, person.id, windowFrom, windowTo, claim)
    if (checked.error) {
      const e = checked.error as { code?: string; message: string }
      problem =
        e.code === 'PGRST202' || e.code === '42883'
          ? 'This needs the phone evidence update (026) run in Supabase.'
          : e.message
    }
  }
  const result = checked?.result ?? null

  // Kept checks: this person's, or the latest across the team.
  const since = addDays(today, -90)
  let keptQuery = supabase
    .from('excuse_check_detail')
    .select('id, user_id, staff_name, claim, window_from, window_to, verdict, headline, note, checked_by_name, created_at')
    .gte('created_at', `${since}T00:00:00+01:00`)
    .order('created_at', { ascending: false })
    .limit(person ? 50 : 15)
  if (person) keptQuery = keptQuery.eq('user_id', person.id)
  const { data: keptRows } = await keptQuery
  const kept = (keptRows ?? []) as Kept[]

  // Quick windows, keeping who and what.
  const link = (d: string, u: string, f: string, t: string) => {
    const q = new URLSearchParams({ date: d, until: u, from: f, to: t, claim })
    if (person) q.set('person', person.id)
    return `?${q.toString()}`
  }
  const yesterday = addDays(today, -1)
  const presets = [
    { label: 'This morning', href: link(today, today, '07:00', '12:00') },
    { label: 'This afternoon', href: link(today, today, '12:00', until === today ? nowHm : '18:00') },
    { label: 'Last 2 hours', href: link(today, today, formatLagos(new Date(Date.now() - 2 * 3_600_000), false), nowHm) },
    { label: 'Yesterday’s shift', href: link(yesterday, yesterday, '07:00', '19:00') },
    { label: 'Last 3 days', href: link(addDays(today, -2), today, '00:00', nowHm) },
  ]

  const verdicts = { fits: 0, false: 0, doubtful: 0, unknown: 0 }
  for (const k of kept) verdicts[k.verdict]++

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check an excuse"
        note="Bad network, phone off, location not working, at the store all along? Pick who, when and what they said: Xtend lays out what their phone did and says whether it fits. Staff are not told."
        chips={person ? <Chip icon={User}>{person.full_name}</Chip> : undefined}
      />

      <StatGrid>
        <StatCard icon={ClipboardCheck} label="Checks kept" value={String(kept.length)} note={person ? 'On their record, 90 days' : 'Latest, 90 days'} />
        <StatCard
          icon={CheckCircle2}
          label="Fit the evidence"
          value={String(verdicts.fits)}
          tone="good"
          bar={kept.length ? (verdicts.fits / kept.length) * 100 : null}
          note="The phone backs them up"
        />
        <StatCard
          icon={XCircle}
          label="Not true or doubtful"
          value={String(verdicts.false + verdicts.doubtful)}
          tone={verdicts.false + verdicts.doubtful ? 'bad' : 'muted'}
          bar={kept.length ? ((verdicts.false + verdicts.doubtful) / kept.length) * 100 : null}
          note={verdicts.false ? `${verdicts.false} plainly not true` : 'None plainly not true'}
        />
        <StatCard icon={HelpCircle} label="No evidence" value={String(verdicts.unknown)} tone="muted" note="Nothing either way" />
      </StatGrid>

      <section className="surface p-4 sm:p-5">
      <form className="space-y-3" method="get">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="person">Who</Label>
            <Select id="person" name="person" defaultValue={person?.id ?? ''} className="h-10 text-sm" required>
              <option value="" disabled>
                Pick a person
              </option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-72">
            <Label htmlFor="claim">What they said</Label>
            <Select id="claim" name="claim" defaultValue={claim} className="h-10 text-sm">
              {(Object.keys(CLAIMS) as Claim[]).map((c) => (
                <option key={c} value={c}>
                  {CLAIMS[c]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date">From day</Label>
            <Input id="date" name="date" type="date" defaultValue={date} max={today} className="h-10 w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="from">Time</Label>
            <Input id="from" name="from" type="time" defaultValue={from} className="h-10 w-28" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="until">To day</Label>
            <Input id="until" name="until" type="date" defaultValue={until} max={today} className="h-10 w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">Time</Label>
            <Input id="to" name="to" type="time" defaultValue={to} className="h-10 w-28" />
          </div>
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Check
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
          {presets.map((p) => (
            <Link key={p.label} href={p.href} className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint">
              {p.label}
            </Link>
          ))}
          <span className="text-muted-foreground">· up to 3 days</span>
        </div>
      </form>
      </section>

      {problem && <Alert variant="destructive">{problem}</Alert>}

      {person && result && (
        <section className={cn('space-y-4 rounded-2xl border-2 p-4 shadow-soft sm:p-5', TONE[result.verdict])}>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {LABEL[result.verdict]} · {person.full_name} · “{CLAIMS[claim]}” · {formatLagos(windowFrom, true)} to {formatLagos(windowTo, true)}
            </p>
            <h2 className="mt-1 text-xl font-extrabold">{result.headline}</h2>
          </div>
            {result.points.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            <SaveExcuseCheck userId={person.id} claim={claim} from={windowFrom} to={windowTo} />
        </section>
      )}

      {person && checked?.evidence && (
        <Panel icon={Activity} title="What the phone did" note={`${formatLagos(windowFrom, true)} to ${formatLagos(windowTo, true)}. Point at a mark for the detail.`}>
          <ExcuseTimeline from={windowFrom} to={windowTo} evidence={checked.evidence} more={checked.more} />
        </Panel>
      )}

      {person && (
        <Panel
          icon={Smartphone}
          title="Is the phone on right now?"
          note="Xtend sends the phone a notification (“Please open Xtend now”) and the phone reports when it arrives. If it arrives, the phone is on and has network."
        >
          <PhoneCheck userId={person.id} name={person.full_name} />
        </Panel>
      )}

      <Panel
        icon={History}
        title={person ? `${person.full_name}’s excuses, last 90 days` : 'Excuses kept, last 90 days'}
        note={person ? 'Checks kept on their record, newest first.' : 'Pick a person to check, or open one below.'}
      >
          {person && kept.length > 0 && <Pattern kept={kept} />}
          {kept.length === 0 ? (
            <EmptyState icon={ClipboardCheck}>None kept yet.</EmptyState>
          ) : (
            <ul className="grid gap-2 text-sm lg:grid-cols-2">
              {kept.map((k) => (
                <li key={k.id} className={cn('space-y-1 rounded-xl border-l-4 bg-muted/40 px-3 py-2.5', k.verdict === 'fits' ? 'border-l-success' : k.verdict === 'unknown' ? 'border-l-border' : k.verdict === 'doubtful' ? 'border-l-warning' : 'border-l-destructive')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={BADGE[k.verdict]}>{LABEL[k.verdict]}</Badge>
                    {!person && (
                      <Link
                        className="font-semibold hover:underline"
                        href={`?person=${k.user_id}&claim=${k.claim}`}
                      >
                        {k.staff_name}
                      </Link>
                    )}
                    <span className="text-muted-foreground">“{CLAIMS[k.claim]}”</span>
                    <span className="text-xs text-muted-foreground">
                      {formatLagos(k.window_from, true)} to {formatLagos(k.window_to, true)}
                    </span>
                  </div>
                  <p>{k.headline}</p>
                  <p className="text-xs text-muted-foreground">
                    Checked by {k.checked_by_name ?? 'someone'} on {formatLagos(k.created_at, true)}
                    {k.note ? ` · ${k.note}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </Panel>
    </div>
  )
}

/** How often each excuse came up, and how often it did not hold. */
function Pattern({ kept }: { kept: Kept[] }) {
  const byClaim = new Map<Claim, { total: number; notTrue: number }>()
  for (const k of kept) {
    const c = byClaim.get(k.claim) ?? { total: 0, notTrue: 0 }
    c.total += 1
    if (k.verdict === 'false' || k.verdict === 'doubtful') c.notTrue += 1
    byClaim.set(k.claim, c)
  }
  const notTrue = kept.filter((k) => k.verdict === 'false' || k.verdict === 'doubtful').length
  return (
    <div className="space-y-2">
      {notTrue >= 2 && (
        <Alert variant="warning">
          {notTrue} of their last {kept.length} excuses did not hold up. Worth a conversation.
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {[...byClaim.entries()].map(([claim, c]) => (
          <span key={claim} className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
            <span className="block font-semibold">{CLAIMS[claim]}</span>
            <span className="text-muted-foreground">
              {c.total} time{c.total === 1 ? '' : 's'}
              {c.notTrue ? `, ${c.notTrue} not true or doubtful` : ', all held up'}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
