import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PhoneCheck } from '@/components/admin/phone-check'
import { CLAIMS, judgeExcuse, lagosInstant, type Claim, type ExcuseEvidence } from '@/lib/excuse'
import { cn, formatLagos, lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Check an excuse — Xtend' }

interface Search {
  person?: string
  date?: string
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.date ?? '') ? search.date! : today
  const hm = (v: string | undefined, fallback: string) => (/^\d{2}:\d{2}$/.test(v ?? '') ? v! : fallback)
  const nowHm = formatLagos(new Date(), false)
  const from = hm(search.from, '08:00')
  const to = hm(search.to, date === today ? nowHm : '18:00')
  const claim: Claim = search.claim === 'phone_off' ? 'phone_off' : 'no_network'
  const person = (people ?? []).find((p) => p.id === search.person)

  let problem: string | null = null
  let result: ReturnType<typeof judgeExcuse> | null = null
  if (person) {
    const { data, error } = await supabase.rpc('check_excuse', {
      p_user: person.id,
      p_from: lagosInstant(date, from),
      p_to: lagosInstant(date, to),
    })
    if (error) {
      problem =
        error.code === 'PGRST202' || error.code === '42883'
          ? 'This needs the phone evidence update (026) run in Supabase.'
          : error.message
    } else {
      result = judgeExcuse(data as ExcuseEvidence, claim)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Check an excuse</h1>
        <p className="text-sm text-muted-foreground">
          Someone says their network was bad or their phone was off? Pick who, when, and what they
          said. Xtend shows everything it heard from their phone in that time: the app opening,
          its network, battery and location, and any clock-in it saved offline. Staff are not told
          any of this is recorded.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
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
        <div className="space-y-1.5">
          <Label htmlFor="date">Day</Label>
          <Input id="date" name="date" type="date" defaultValue={date} max={today} className="h-10 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="time" defaultValue={from} className="h-10 w-28" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="time" defaultValue={to} className="h-10 w-28" />
        </div>
        <div className="w-full space-y-1.5 sm:w-64">
          <Label htmlFor="claim">What they said</Label>
          <Select id="claim" name="claim" defaultValue={claim} className="h-10 text-sm">
            {(Object.keys(CLAIMS) as Claim[]).map((c) => (
              <option key={c} value={c}>
                {CLAIMS[c]}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
          Check
        </button>
      </form>

      {problem && <Alert variant="destructive">{problem}</Alert>}

      {person && result && (
        <Card className={cn('border', TONE[result.verdict])}>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {LABEL[result.verdict]} · {person.full_name}, {from} to {to}
            </p>
            <CardTitle>{result.headline}</CardTitle>
          </CardHeader>
          {result.points.length > 0 && (
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {person && (
        <Card>
          <CardHeader>
            <CardTitle>Is the phone on right now?</CardTitle>
            <p className="text-sm text-muted-foreground">
              If they say their phone is off or has no network now, check it. Xtend sends the phone
              a notification (&ldquo;Please open Xtend now&rdquo;), and the phone reports when it
              arrives. If it arrives, the phone is on and has network.
            </p>
          </CardHeader>
          <CardContent>
            <PhoneCheck userId={person.id} name={person.full_name} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
