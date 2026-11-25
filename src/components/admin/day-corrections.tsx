'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { DoorOpen, LogIn, LogOut, MapPin, Smartphone, Sparkles, Store, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn, formatLagos, metres } from '@/lib/utils'
import { haversineMetres } from '@/lib/geo'
import { readMapLink, validPoint } from '@/lib/map-link'
import type { Spot } from '@/components/admin/spot-picker'

// The map loads in the browser only.
const SpotPicker = dynamic(() => import('@/components/admin/spot-picker').then((m) => m.SpotPicker), { ssr: false })
import {
  CORRECTION_LABELS,
  parseCorrectionCommand,
  planCorrection,
  type CorrectionAction,
  type CorrectionPlan,
} from '@/lib/field-corrections'

export interface FixVisit {
  id: string
  name: string
  status: string
  storeId?: string | null
}

type Payload = CorrectionPlan['payload'] & {
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  place?: string | null
}

export interface FixStore {
  id: string
  name: string
  lat?: number | null
  lng?: number | null
  geofence_radius_m?: number | null
}

/** Where the office says the person is (0112). */
type Where = 'store' | 'phone' | 'map'

interface Option {
  action: CorrectionAction
  label: string
  /** Why it cannot be done now; the button is shown greyed with this. */
  off?: string
}

/** Now in Lagos, as "HH:MM" (UTC+1, no summer time). */
function lagosNow() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(),
  )
}

/**
 * "Fix today's record" on a person's day (0090, 0093). Type what to do
 * ("clock her out at 5pm, phone died") and confirm what Xtend read, or pick
 * from the four groups: clock-in, clock-out, store check-in and check-out.
 * Every one needs a reason, which the person sees; the database decides
 * who may and keeps the old record.
 */
export function DayCorrections({
  personId,
  personName,
  date,
  marketer,
  clockedIn,
  clockedOut,
  stores,
  homeStoreId,
  visits,
  lastPhone = null,
}: {
  personId: string
  personName: string
  /** Today's date, 'YYYY-MM-DD' (Lagos). */
  date: string
  marketer: boolean
  clockedIn: boolean
  clockedOut: boolean
  stores: FixStore[]
  homeStoreId: string | null
  visits: FixVisit[]
  /** Where their phone last reported today (0112). */
  lastPhone?: { lat: number; lng: number; accuracy_m: number; at: string } | null
}) {
  const router = useRouter()
  const first = personName.split(' ')[0]
  const openVisit = visits.find((v) => v.status === 'open') ?? null
  const redoInVisits = visits.filter((v) => v.status !== 'abandoned')
  const redoOutVisits = visits.filter((v) => v.status === 'closed')

  // The typed command, and what Xtend read from it.
  const [command, setCommand] = useState('')
  const [plan, setPlan] = useState<CorrectionPlan | null>(null)

  // A picked option and its form.
  const [action, setAction] = useState<CorrectionAction | null>(null)
  const [visitId, setVisitId] = useState('')
  const [storeId, setStoreId] = useState(homeStoreId && stores.some((s) => s.id === homeStoreId) ? homeStoreId : (stores[0]?.id ?? ''))
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  // 0112: where they are: the store's pin, their phone's last spot, or one picked.
  const [where, setWhere] = useState<Where>('store')
  const [spot, setSpot] = useState<Spot | null>(null)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const day = useMemo(
    () => ({
      name: personName,
      role: marketer ? 'marketer' : 'merchandiser',
      active: true,
      homeStoreId,
      stores,
      clockedIn,
      clockedOut,
      visits: visits.map((v) => ({ id: v.id, storeId: v.storeId ?? null, name: v.name, status: v.status })),
    }),
    [personName, marketer, homeStoreId, stores, clockedIn, clockedOut, visits],
  )

  const groups: { title: string; icon: LucideIcon; options: Option[] }[] = [
    {
      title: 'Clock-in',
      icon: LogIn,
      options: [
        { action: 'office_clock_in', label: clockedIn ? 'Clock them in again (replace)' : 'Clock them in' },
        {
          action: 'redo_clock_in',
          label: 'Ask them to clock in again',
          off: !clockedIn ? 'Not clocked in yet' : clockedOut ? 'Already clocked out: clock them in yourself' : undefined,
        },
      ],
    },
    {
      title: 'Clock-out',
      icon: LogOut,
      options: [
        {
          action: 'office_clock_out',
          label: clockedOut ? 'Clock them out again (replace)' : 'Clock them out',
          off: !clockedIn ? 'Not clocked in yet' : undefined,
        },
        { action: 'reset_clock_out', label: 'Undo the clock-out (back on shift)', off: !clockedOut ? 'Not clocked out yet' : undefined },
        { action: 'redo_clock_out', label: 'Ask them to clock out again', off: !clockedOut ? 'Not clocked out yet' : undefined },
      ],
    },
    ...(marketer
      ? [
          {
            title: 'Store check-in',
            icon: Store,
            options: [
              {
                action: 'office_check_in' as const,
                label: 'Check them in at a store',
                off: !clockedIn
                  ? 'Not clocked in yet'
                  : clockedOut
                    ? 'Clocked out for the day'
                    : openVisit
                      ? `Still checked in at ${openVisit.name}`
                      : undefined,
              },
              { action: 'redo_check_in' as const, label: 'Ask them to check in again', off: redoInVisits.length ? undefined : 'No store check-in today' },
            ],
          },
          {
            title: 'Store check-out',
            icon: DoorOpen,
            options: [
              {
                action: 'office_check_out' as const,
                label: openVisit ? `Check them out of ${openVisit.name}` : 'Check them out of the store',
                off: openVisit ? undefined : 'Not checked in at a store now',
              },
              { action: 'redo_check_out' as const, label: 'Ask them to check out again', off: redoOutVisits.length ? undefined : 'No store check-out today' },
            ],
          },
        ]
      : []),
  ]

  const needsStore = action === 'office_clock_in' || action === 'office_clock_out' || action === 'office_check_in'
  const needsTime = action === 'office_clock_in' || action === 'office_clock_out'
  const needsVisit = action === 'redo_check_in' || action === 'redo_check_out'
  const needsWhere = needsStore || action === 'office_check_out'
  // The store they are recorded against, for the map and the distance.
  const whereStore: FixStore | null =
    action === 'office_check_out'
      ? (stores.find((s) => s.id === openVisit?.storeId) ?? null)
      : (stores.find((s) => s.id === storeId) ?? null)
  const storePoint =
    whereStore?.lat != null && whereStore.lng != null
      ? { lat: whereStore.lat, lng: whereStore.lng, name: whereStore.name, radius_m: whereStore.geofence_radius_m }
      : null
  const chosen: Spot | null = where === 'phone' && lastPhone ? lastPhone : where === 'map' ? spot : null
  const away = chosen && storePoint ? haversineMetres(chosen.lat, chosen.lng, storePoint.lat, storePoint.lng) : null
  const awayOff = away !== null && storePoint ? away > (storePoint.radius_m ?? 150) : false

  function readPasted() {
    setPasteError(null)
    const reading = readMapLink(pasted)
    if (reading.short) {
      setPasteError('That is a short link. Open it, copy the full address from the browser, or tap the map instead.')
      return
    }
    const p = reading.point ? validPoint(reading.point.lat, reading.point.lng) : null
    if (!p) {
      setPasteError('No position found. Paste a Google Maps link or "6.6019, 3.3516", or tap the map.')
      return
    }
    setSpot(p)
  }
  const visitChoices = action === 'redo_check_in' ? redoInVisits : redoOutVisits

  function reset() {
    setError(null)
    setNotice(null)
  }

  function pick(next: CorrectionAction) {
    reset()
    setPlan(null)
    setAction(next)
    setReason('')
    setTime('')
    setWhere('store')
    setSpot(null)
    setPasted('')
    setPasteError(null)
    const choices = next === 'redo_check_in' ? redoInVisits : redoOutVisits
    setVisitId(choices[choices.length - 1]?.id ?? '')
  }

  function read(event: React.FormEvent) {
    event.preventDefault()
    reset()
    setAction(null)
    try {
      const ask = parseCorrectionCommand(command, [...stores, ...visits.filter((v) => v.storeId).map((v) => ({ id: v.storeId!, name: v.name }))])
      setPlan(planCorrection(personId, day, ask, date, lagosNow()))
    } catch (e) {
      setPlan(null)
      setError(e instanceof Error ? e.message : 'That could not be read. Try other words, or pick below.')
    }
  }

  async function send(payload: Payload, label: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/field-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'That did not work. Try again.')
        return
      }
      setNotice(`${label}. ${first} has been told.`)
      setAction(null)
      setPlan(null)
      setCommand('')
      router.refresh()
    } catch {
      setError('No connection. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault()
    if (!action) return
    if (needsWhere && where === 'map' && !spot) {
      setError('Tap the map where they are, or paste a Google Maps link.')
      return
    }
    const place =
      where === 'phone' && lastPhone
        ? `Where their phone was at ${formatLagos(lastPhone.at, false)}`
        : where === 'map'
          ? 'Picked on the map by the office'
          : null
    // A time typed as HH:MM is today's, in Lagos (UTC+1, no summer time).
    void send(
      {
        user_id: personId,
        action,
        reason,
        outlet_id: needsStore ? storeId : null,
        at: needsTime && time ? `${date}T${time}:00+01:00` : null,
        visit_id: needsVisit ? visitId || null : null,
        ...(needsWhere && chosen
          ? {
              lat: chosen.lat,
              lng: chosen.lng,
              accuracy: where === 'phone' && lastPhone ? Math.min(100, Math.max(1, Math.round(lastPhone.accuracy_m))) : 25,
              place,
            }
          : {}),
      },
      CORRECTION_LABELS[action],
    )
  }

  const examples = [
    `Clock ${first} in at 8:05, phone would not open`,
    'Undo the clock-out, tapped by mistake',
    'Clock out at 5pm, phone died',
    ...(marketer ? [`Check in at ${stores[0]?.name ?? 'the store'}, GPS would not lock`] : []),
    'Ask them to clock in again with a clear selfie',
  ]

  return (
    <section className="surface space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="icon-tile">
          <Wrench className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-tight">Fix today&apos;s record</h2>
          <p className="text-sm text-muted-foreground">
            Type what to do, or pick it below. Record it for {first} once you are sure they are at the store, ask them to
            do it again, or undo a clock-out made by mistake. They are told, and the old record is kept.
          </p>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {/* Type a command. */}
      <form onSubmit={read} className="space-y-2 rounded-2xl bg-tint/60 p-3 sm:p-4">
        <Label htmlFor="fix-command" className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="h-4 w-4 text-brand" /> Tell Xtend what to do
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="fix-command"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setPlan(null)
            }}
            maxLength={300}
            autoComplete="off"
            placeholder={`e.g. Clock ${first} out at 5pm, phone died`}
            className="h-11 flex-1 bg-card"
          />
          <Button type="submit" className="h-11" disabled={busy || command.trim().length < 3}>
            Read it
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {examples.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setCommand(e)
                setPlan(null)
              }}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:border-brand/40 hover:text-foreground"
            >
              {e}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Say clock in, clock out, check in or check out; add a store, a time (8:05, 5pm) and why after a comma or
          &ldquo;because&rdquo;. &ldquo;Ask them to …&rdquo; asks them to do it again; &ldquo;undo the clock-out&rdquo; puts them back on shift.
        </p>
      </form>

      {plan && (
        <div className="space-y-2 rounded-2xl border-2 border-brand/40 bg-card p-3 sm:p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Xtend will</p>
          <p className="text-base font-bold">{plan.title}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {plan.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {plan.warning && <p className="text-sm font-semibold text-warning">{plan.warning}</p>}
          <div className="flex gap-2 pt-1">
            <Button disabled={busy} onClick={() => void send(plan.payload, CORRECTION_LABELS[plan.payload.action])}>
              {busy ? 'Saving…' : 'Do it'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPlan(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Or pick. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-2xl border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <g.icon className="h-4 w-4 text-brand" /> {g.title}
            </p>
            <div className="space-y-1.5">
              {g.options.map((o) => (
                <button
                  key={o.action}
                  type="button"
                  disabled={Boolean(o.off) || busy}
                  onClick={() => pick(o.action)}
                  className={cn(
                    'flex min-h-11 w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    action === o.action ? 'border-brand bg-tint font-semibold' : 'border-border hover:border-brand/40 hover:bg-tint/50',
                    o.off && 'cursor-not-allowed opacity-55 hover:border-border hover:bg-transparent',
                  )}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.off && <span className="text-xs text-muted-foreground">{o.off}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {action && (
        <form onSubmit={submitForm} className="space-y-3 rounded-2xl border-2 border-brand/40 p-3 sm:p-4">
          <p className="text-base font-bold">{CORRECTION_LABELS[action].replace('by the office', `for ${first}`)}</p>
          {action === 'reset_clock_out' && (
            <p className="rounded-xl bg-tint px-3 py-2 text-xs text-tint-foreground">
              Their clock-out is taken off and they are on shift again: their location is followed again and they are
              reminded to clock out. They get a notification asking them to clock out at the end of the shift. The old
              clock-out is kept in the record.
            </p>
          )}
          {needsStore && (
            <div className="space-y-1">
              <Label htmlFor="fix-store">Store</Label>
              {stores.length ? (
                <Select id="fix-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-destructive">They have no store with a location. Set one on Outlets first.</p>
              )}
            </div>
          )}
          {needsWhere && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Where is {first}?</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { id: 'store', icon: Store, label: whereStore ? `At ${whereStore.name}` : 'At the store', note: 'The store\'s pin' },
                    {
                      id: 'phone',
                      icon: Smartphone,
                      label: 'Where their phone was',
                      note: lastPhone ? `At ${formatLagos(lastPhone.at, false)} today` : 'No location from their phone today',
                      off: !lastPhone,
                    },
                    { id: 'map', icon: MapPin, label: 'Pick on the map', note: 'Tap the spot, or paste a link' },
                  ] as { id: Where; icon: LucideIcon; label: string; note: string; off?: boolean }[]
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={o.off || busy}
                    onClick={() => setWhere(o.id)}
                    className={cn(
                      'flex min-h-11 flex-col items-start rounded-xl border px-3 py-2 text-left text-sm',
                      where === o.id ? 'border-brand bg-tint font-semibold' : 'border-border hover:border-brand/40',
                      o.off && 'cursor-not-allowed opacity-55',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <o.icon className="h-4 w-4 text-brand" /> {o.label}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">{o.note}</span>
                  </button>
                ))}
              </div>
              {where === 'map' && (
                <div className="space-y-2">
                  <SpotPicker
                    store={storePoint}
                    phone={lastPhone ? { lat: lastPhone.lat, lng: lastPhone.lng, label: `Their phone at ${formatLagos(lastPhone.at, false)}` } : null}
                    value={spot}
                    onPick={setSpot}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder="Or paste a Google Maps link or 6.6019, 3.3516"
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" onClick={readPasted} disabled={pasted.trim().length < 3}>
                      Use this
                    </Button>
                  </div>
                  {pasteError && <p className="text-xs text-destructive">{pasteError}</p>}
                </div>
              )}
              {away !== null && (
                <p className={cn('rounded-xl px-3 py-2 text-xs', awayOff ? 'bg-warning/10 text-warning' : 'bg-tint text-tint-foreground')}>
                  {metres(away)} from {storePoint?.name}.{' '}
                  {awayOff ? 'It will be recorded there, as off site.' : 'Inside the store area: recorded as on site.'}
                </p>
              )}
            </div>
          )}
          {needsVisit && (
            <div className="space-y-1">
              <Label htmlFor="fix-visit">Which store visit</Label>
              <Select id="fix-visit" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
                {visitChoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {needsTime && (
            <div className="space-y-1">
              <Label htmlFor="fix-time">Time today (leave empty for now)</Label>
              <Input id="fix-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-[10rem]" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="fix-reason">Why (they see this)</Label>
            <Input
              id="fix-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                action === 'reset_clock_out'
                  ? 'e.g. Clocked out by mistake; still at the store until 6 pm'
                  : action.startsWith('redo')
                    ? 'What they should do, e.g. clock in with your selfie at the store'
                    : 'e.g. Phone would not open; I called them at the store'
              }
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || (needsStore && !storeId) || (needsVisit && !visitId)}>
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
