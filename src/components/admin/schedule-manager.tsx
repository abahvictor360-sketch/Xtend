'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarMinus, CalendarPlus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DEFAULT_WORK_DAYS, WEEKDAYS, cleanDays, patternText, samePattern, shortDay } from '@/lib/schedule'

export interface SchedulePerson {
  id: string
  name: string
  role: string
  store: string | null
  team: string | null
  /** Their own weekly pattern, or null for the default (Monday to Saturday). */
  days: number[] | null
}

export interface ScheduleChange {
  id: string
  user_id: string
  day: string
  working: boolean
  note: string
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; updated?: number }
  if (!res.ok) throw new Error(json.error ?? 'That change could not be saved.')
  return json
}

/** Seven round toggles, Monday first. */
export function WeekToggles({
  days,
  onChange,
  disabled,
  size = 'md',
}: {
  days: number[]
  onChange?: (days: number[]) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const on = new Set(days)
  return (
    <div className="flex gap-1" role="group" aria-label="Working days">
      {WEEKDAYS.map((w) => {
        const active = on.has(w.dow)
        return (
          <button
            key={w.dow}
            type="button"
            disabled={disabled || !onChange}
            aria-pressed={active}
            aria-label={`${w.long}: ${active ? 'working' : 'day off'}`}
            title={`${w.long}: ${active ? 'working' : 'day off'}`}
            onClick={() => onChange?.(cleanDays(active ? days.filter((d) => d !== w.dow) : [...days, w.dow]))}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full font-bold transition-colors disabled:cursor-default',
              size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-xs',
              active ? 'bg-brand text-primary-foreground' : 'bg-muted text-muted-foreground',
              onChange && !disabled && 'hover:ring-2 hover:ring-brand/40',
            )}
          >
            {w.short.slice(0, 2)}
          </button>
        )
      })}
    </div>
  )
}

export function ScheduleManager({
  people,
  changes,
  today,
  focus,
}: {
  people: SchedulePerson[]
  changes: ScheduleChange[]
  today: string
  /** A person to start on (from the Staff page's Schedule link). */
  focus: string | null
}) {
  const router = useRouter()
  const focused = people.find((p) => p.id === focus) ?? null
  const [search, setSearch] = useState(focused?.name ?? '')
  const [chosen, setChosen] = useState<Set<string>>(new Set(focused ? [focused.id] : []))
  const [drafts, setDrafts] = useState<Record<string, number[]>>({})
  const [bulk, setBulk] = useState<number[]>([...DEFAULT_WORK_DAYS])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [who, setWho] = useState(focused?.id ?? people[0]?.id ?? '')
  const [day, setDay] = useState(today)
  const [working, setWorking] = useState<'off' | 'working'>('off')
  const [note, setNote] = useState('')
  const [changeFilter, setChangeFilter] = useState<'focus' | 'all'>(focused ? 'focus' : 'all')

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return people
    return people.filter((p) =>
      [p.name, p.store ?? '', p.team ?? '', p.role].some((v) => v.toLowerCase().includes(needle)),
    )
  }, [people, search])
  const allChosen = visible.length > 0 && visible.every((p) => chosen.has(p.id))
  const shownChanges = changes
    .filter((c) => changeFilter === 'all' || c.user_id === who)
    .sort((a, b) => a.day.localeCompare(b.day))

  function toggle(id: string) {
    setChosen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run(work: () => Promise<string>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(await work())
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const savePattern = (ids: string[], days: number[] | null) =>
    run(async () => {
      const json = await send('/api/admin/schedules', 'POST', { user_ids: ids, days })
      const n = json.updated ?? ids.length
      setDrafts((d) => {
        const next = { ...d }
        for (const id of ids) delete next[id]
        return next
      })
      const label = days ? patternText(days) : 'Mon–Sat (the usual week)'
      return n === 1 && ids.length === 1
        ? `${nameOf.get(ids[0]) ?? 'Their'} schedule is now ${label}.`
        : `${n} people now work ${label}.`
    })

  const addChange = () =>
    run(async () => {
      if (!who) throw new Error('Pick a person')
      await send('/api/admin/schedules/overrides', 'POST', { user_id: who, day, working: working === 'working', note })
      setNote('')
      return `${nameOf.get(who)}: ${shortDay(day)} is now ${working === 'working' ? 'a working day' : 'a day off'}.`
    })

  const removeChange = (c: ScheduleChange) =>
    run(async () => {
      await send(`/api/admin/schedules/overrides/${c.id}`, 'DELETE')
      return `${nameOf.get(c.user_id)}: ${shortDay(c.day)} follows the weekly pattern again.`
    })

  return (
    <div className="space-y-6">
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <section className="surface space-y-4 p-4">
        <div>
          <h2 className="text-base font-bold">Weekly days on and off</h2>
          <p className="text-sm text-muted-foreground">
            Orange days are working days; grey days are days off. Everyone starts on Monday to Saturday. Tick several
            people to give them all the same week at once.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, store or team"
              className="h-10 pl-9 text-sm"
              aria-label="Search staff"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            onClick={() =>
              setChosen((cur) => {
                const next = new Set(cur)
                for (const p of visible) {
                  if (allChosen) next.delete(p.id)
                  else next.add(p.id)
                }
                return next
              })
            }
          >
            {allChosen ? 'Clear shown' : `Tick all shown (${visible.length})`}
          </Button>
        </div>

        {chosen.size > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl bg-tint p-3 text-tint-foreground sm:flex-row sm:flex-wrap sm:items-center">
            <p className="text-sm font-semibold">
              {chosen.size} ticked · give them
            </p>
            <WeekToggles days={bulk} onChange={setBulk} disabled={busy} />
            <span className="text-xs">{patternText(bulk)}</span>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button type="button" size="sm" disabled={busy} onClick={() => void savePattern([...chosen], bulk)}>
                Apply to {chosen.size}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void savePattern([...chosen], null)}>
                <RotateCcw className="h-3.5 w-3.5" /> Back to Mon–Sat
              </Button>
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody matches.</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((p) => {
              const saved = p.days ?? [...DEFAULT_WORK_DAYS]
              const draft = drafts[p.id] ?? saved
              const changed = !samePattern(draft, saved)
              return (
                <li key={p.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 py-3', p.id === focus && 'rounded-xl bg-tint/50 px-2')}>
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`Tick ${p.name}`}
                    className="h-4 w-4 accent-[hsl(var(--brand))]"
                  />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.role, p.store ?? 'No store', p.team].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WeekToggles
                      days={draft}
                      size="sm"
                      disabled={busy}
                      onChange={(days) => setDrafts((d) => ({ ...d, [p.id]: days }))}
                    />
                    <span className="w-24 text-xs text-muted-foreground">
                      {patternText(draft)}
                      {!p.days && !changed && <span className="block text-[10px]">usual week</span>}
                    </span>
                    {changed && (
                      <span className="flex gap-1">
                        <Button type="button" size="sm" disabled={busy} onClick={() => void savePattern([p.id], draft)}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            setDrafts((d) => {
                              const next = { ...d }
                              delete next[p.id]
                              return next
                            })
                          }
                        >
                          Undo
                        </Button>
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="surface space-y-4 p-4">
        <div>
          <h2 className="text-base font-bold">One-off changes</h2>
          <p className="text-sm text-muted-foreground">
            Make one date an extra day in (for example a Sunday stock count) or an extra day off (a swap or a public
            holiday). It replaces the weekly pattern for that date only. Approved leave is on the Leave page.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="change-who">Person</Label>
            <Select id="change-who" value={who} onChange={(e) => setWho(e.target.value)} className="h-10 text-sm">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-day">Date</Label>
            <Input id="change-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-kind">Make it</Label>
            <Select
              id="change-kind"
              value={working}
              onChange={(e) => setWorking(e.target.value as 'off' | 'working')}
              className="h-10 text-sm"
            >
              <option value="off">A day off</option>
              <option value="working">A working day</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-note">Note (optional)</Label>
            <Input
              id="change-note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Public holiday, swap…"
              className="h-10 text-sm"
            />
          </div>
          <Button type="button" className="h-10" disabled={busy || !who || !day} onClick={() => void addChange()}>
            {working === 'working' ? <CalendarPlus className="h-4 w-4" /> : <CalendarMinus className="h-4 w-4" />}
            Add
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-muted-foreground">Show:</span>
          <button
            type="button"
            onClick={() => setChangeFilter('focus')}
            className={cn('rounded-full px-3 py-1', changeFilter === 'focus' ? 'bg-brand text-white' : 'bg-muted')}
          >
            {nameOf.get(who) ?? 'This person'}
          </button>
          <button
            type="button"
            onClick={() => setChangeFilter('all')}
            className={cn('rounded-full px-3 py-1', changeFilter === 'all' ? 'bg-brand text-white' : 'bg-muted')}
          >
            Everyone
          </button>
        </div>

        {shownChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one-off changes from the last 60 days onwards.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shownChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="w-28 font-semibold tabular-nums">{shortDay(c.day)}</span>
                <span className="min-w-0 flex-1 basis-32 truncate">{nameOf.get(c.user_id) ?? 'Someone'}</span>
                {c.working ? <Badge variant="default">Extra day in</Badge> : <Badge variant="outline">Day off</Badge>}
                {c.day < today && <span className="text-xs text-muted-foreground">past</span>}
                {c.note && <span className="w-full truncate text-xs text-muted-foreground sm:w-auto sm:flex-1">{c.note}</span>}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void removeChange(c)}
                  aria-label={`Remove the change on ${shortDay(c.day)} for ${nameOf.get(c.user_id) ?? 'this person'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
