'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Search, Send } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { note as noteRule } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'

export interface CountPerson {
  id: string
  full_name: string
  role: string
}

export interface CountRequestRow {
  id: string
  requested_by: string
  requested_by_name: string
  due_date: string
  note: string | null
  created_at: string
  is_open: boolean
  people: number
  counted: number
  waiting_on: string[]
}

function dayLabel(date: string) {
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

/**
 * Asking for a store count, and seeing who has done it. Outside a request,
 * merchandisers only count in the last days of the month.
 */
export function CountRequests({
  people,
  requests,
  today,
  monthEndFrom,
  myId,
  isAdmin,
}: {
  people: CountPerson[]
  requests: CountRequestRow[]
  today: string
  monthEndFrom: string
  myId: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(people.map((p) => p.id)))
  const [due, setDue] = useState(today)
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? people.filter((p) => p.full_name.toLowerCase().includes(needle)) : people
  }, [people, search])
  const allChosen = people.length > 0 && chosen.size === people.length

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function send() {
    setError(null)
    setNotice(null)
    const problem = problemWith(noteRule(500), note)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/count-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [...chosen], due_date: due, note: note || null }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        people?: number
        notified?: number
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? 'The request could not be sent.')
      setNotice(
        `Asked ${json.people} ${json.people === 1 ? 'person' : 'people'} to count by ${dayLabel(due)}. ` +
          `${json.notified ?? 0} got a phone notification; everyone sees it when they open Xtend.`,
      )
      setNote('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function close(id: string) {
    setError(null)
    const res = await fetch(`/api/admin/count-requests/${id}/close`, { method: 'POST' })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      setError(json.error ?? 'That request could not be closed.')
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-brand" />
          Ask for a store count
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Merchandisers count when you ask, and at the end of every month (from{' '}
          {dayLabel(monthEndFrom)} this month) without being asked.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {people.length === 0 ? (
          <Alert variant="info">
            {isAdmin
              ? 'There are no active merchandisers or marketers to ask.'
              : 'Nobody is on your team yet. An admin puts people on your team from the Teams page.'}
          </Alert>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="count-due">Count by</Label>
                <Input
                  id="count-due"
                  type="date"
                  min={today}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="count-note">Note (optional)</Label>
                <Input
                  id="count-note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Before the promo starts on Monday"
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>
                  Who counts ({chosen.size} of {people.length})
                </Label>
                <button
                  type="button"
                  className="text-xs font-semibold text-brand"
                  onClick={() =>
                    setChosen(allChosen ? new Set() : new Set(people.map((p) => p.id)))
                  }
                >
                  {allChosen ? 'Clear all' : 'Select everyone'}
                </button>
              </div>
              {people.length > 8 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a person"
                    className="h-9 pl-9 text-sm"
                    aria-label="Find a person"
                  />
                </div>
              )}
              <ul className="grid max-h-60 gap-1 overflow-y-auto rounded-2xl border border-border p-1 sm:grid-cols-2">
                {visible.map((p) => (
                  <li key={p.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm',
                        chosen.has(p.id) && 'bg-tint/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 accent-[hsl(var(--brand))]"
                      />
                      <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                      <span className="text-xs text-muted-foreground">{p.role}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <Button onClick={send} disabled={busy || chosen.size === 0 || !due}>
              <Send className="h-4 w-4" />
              {busy ? 'Sending…' : `Ask ${chosen.size} to count`}
            </Button>
          </>
        )}

        {error && <Alert variant="destructive">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        {requests.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent requests
            </p>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {requests.map((r) => (
                <li key={r.id} className="space-y-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      Due {dayLabel(r.due_date)} · {r.counted} of {r.people} counted
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={r.is_open ? 'default' : 'outline'}>
                        {r.is_open ? 'Open' : 'Closed'}
                      </Badge>
                      {r.is_open && (isAdmin || r.requested_by === myId) && (
                        <Button variant="ghost" size="sm" onClick={() => close(r.id)}>
                          Close
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Asked by {r.requested_by_name}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                  {r.waiting_on.length > 0 && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Waiting on: </span>
                      {r.waiting_on.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
