'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellOff, CalendarClock, Save, Send, Trash2, Users } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { thingName, writtenText } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'
import { formatLagos, lagosDateString } from '@/lib/utils'
import { OPEN_PAGES, lagosAt, scheduleChoices, scheduleProblem } from '@/lib/notification-log'

type Audience = 'everyone' | 'role' | 'outlet' | 'users'

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'role', label: 'By role' },
  { id: 'outlet', label: 'By outlet' },
  { id: 'users', label: 'Specific people' },
]

interface Person {
  id: string
  full_name: string
  role: string
  outlet_id: string | null
}

export interface Template {
  id: string
  title: string
  body: string
  created_by: string | null
}

interface Preview {
  recipients: number
  with_devices: number
  people: { user_id: string; full_name: string; role: string; outlet_name: string | null; devices: number }[]
}

export function NotificationComposer({
  staff,
  outlets,
  templates,
  me,
  isAdmin,
  initial,
}: {
  staff: Person[]
  outlets: { id: string; name: string }[]
  templates: Template[]
  me: string
  isAdmin: boolean
  /** Copied from an earlier notification ("Use again"); give the composer a new key to change it. */
  initial?: { title: string; body: string; url: string | null } | null
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [url, setUrl] = useState(initial?.url && OPEN_PAGES.some((p) => p.url === initial.url) ? initial.url : '/field')
  const [audience, setAudience] = useState<Audience>('everyone')
  const [role, setRole] = useState('merchandiser')
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? '')
  const [userIds, setUserIds] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [showPeople, setShowPeople] = useState(false)
  const [later, setLater] = useState(false)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('07:45')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const choices = useMemo(() => scheduleChoices(new Date()), [])
  useEffect(() => {
    if (later && !day) {
      setDay(choices[0].date)
      setTime(choices[0].time)
    }
  }, [later, day, choices])

  const payload = useCallback(
    (isPreview: boolean) => ({
      title: title || 'Xtend',
      body: body || '…',
      url,
      audience,
      role: audience === 'role' ? role : null,
      outlet_id: audience === 'outlet' ? outletId || null : null,
      user_ids: audience === 'users' ? userIds : undefined,
      preview: isPreview,
    }),
    [audience, body, outletId, role, title, url, userIds],
  )

  // Keep the recipient count honest as the audience is changed. Only the
  // audience matters for this, so typing does not re-run it.
  const audienceKey = JSON.stringify([audience, role, outletId, userIds])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload(true), title: 'Xtend', body: '…' }),
        })
        const data = await res.json()
        if (!cancelled) setPreview(res.ok ? (data as Preview) : null)
      } catch {
        if (!cancelled) setPreview(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey])

  const sendAt = later && day && time ? new Date(lagosAt(day, time)) : null

  async function send() {
    setError(null)
    setResult(null)
    const problem =
      problemWith(thingName(80, 'title'), title) ??
      problemWith(writtenText(400, 2, 'the message', true), body) ??
      (later ? scheduleProblem(sendAt ?? new Date(NaN), new Date()) : null)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(false), send_at: later && sendAt ? sendAt.toISOString() : null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That did not send.')
        return
      }
      setResult(
        data.scheduled_id
          ? `Scheduled for ${formatLagos(data.send_at)} to ${data.recipients} ${data.recipients === 1 ? 'person' : 'people'}. You can cancel it below until then.`
          : `Sent to ${data.delivered} of ${data.recipients}.` +
              (data.no_device ? ` ${data.no_device} had notifications off.` : '') +
              (data.failed ? ` ${data.failed} failed.` : ''),
      )
      setTitle('')
      setBody('')
      setLater(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function saveTemplate() {
    setError(null)
    setResult(null)
    const problem = problemWith(thingName(80, 'title'), title) ?? problemWith(writtenText(400, 2, 'the message', true), body)
    if (problem) {
      setError(problem)
      return
    }
    const res = await fetch('/api/admin/notifications/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error ?? 'That could not be saved.')
    else {
      setResult(`Saved “${title}” as a template.`)
      router.refresh()
    }
  }

  async function removeTemplate(t: Template) {
    const res = await fetch(`/api/admin/notifications/templates?id=${t.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error ?? 'That could not be removed.')
    else router.refresh()
  }

  const canSend =
    title.trim().length > 0 && body.trim().length > 0 && (preview?.recipients ?? 0) > 0 && (!later || Boolean(sendAt))
  const shownStaff = find.trim()
    ? staff.filter((p) => p.full_name.toLowerCase().includes(find.trim().toLowerCase()))
    : staff
  const off = preview ? preview.people.filter((p) => p.devices === 0) : []
  const mine = templates.filter((t) => isAdmin || t.created_by === me)

  return (
    <Card id="compose">
      <CardContent className="space-y-4 pt-5">
        {error && <Alert variant="destructive">{error}</Alert>}
        {result && <Alert variant="success">{result}</Alert>}

        {templates.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Start from a template</p>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.body}
                  onClick={() => {
                    setTitle(t.title)
                    setBody(t.body)
                  }}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold hover:border-brand hover:bg-tint"
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="n-title">Title</Label>
            <Input
              id="n-title"
              maxLength={80}
              value={title}
              placeholder="Stock delivery today"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-url">Opens at</Label>
            <Select id="n-url" value={url} onChange={(e) => setUrl(e.target.value)}>
              {OPEN_PAGES.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="n-body">Message</Label>
          <Textarea
            id="n-body"
            maxLength={400}
            value={body}
            placeholder="The Ikeja delivery lands at 2pm. Please be on the floor to receive it."
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{body.length}/400</p>
            {title.trim() && body.trim().length >= 2 && (
              <button
                type="button"
                onClick={() => void saveTemplate()}
                className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                <Save className="h-3.5 w-3.5" /> Save as a template
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="field-label">Send to</Label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((item) => (
              <Chip key={item.id} active={audience === item.id} onClick={() => setAudience(item.id)}>
                {item.label}
              </Chip>
            ))}
          </div>

          {audience === 'role' && (
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-xs">
              <option value="merchandiser">Merchandisers</option>
              <option value="marketer">Marketers</option>
              <option value="supervisor">Supervisors</option>
              <option value="admin">Admins</option>
            </Select>
          )}

          {audience === 'outlet' && (
            <Select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="max-w-xs">
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </Select>
          )}

          {audience === 'users' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Find a name"
                  className="h-9 w-full sm:w-60"
                />
                <span className="text-xs text-muted-foreground">{userIds.length} picked</span>
                {userIds.length > 0 && (
                  <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setUserIds([])}>
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
                {shownStaff.map((person) => {
                  const checked = userIds.includes(person.id)
                  return (
                    <label
                      key={person.id}
                      className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-tint"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--brand))]"
                        checked={checked}
                        onChange={(e) =>
                          setUserIds((current) =>
                            e.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                          )
                        }
                      />
                      <span className="flex-1 truncate">{person.full_name}</span>
                      <Badge variant="outline">{person.role}</Badge>
                    </label>
                  )
                })}
                {shownStaff.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No one by that name.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="field-label">When</Label>
          <div className="flex flex-wrap gap-2">
            <Chip active={!later} onClick={() => setLater(false)}>
              Now
            </Chip>
            <Chip active={later} onClick={() => setLater(true)}>
              Later
            </Chip>
          </div>
          {later && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="n-day">Day</Label>
                  <Input
                    id="n-day"
                    type="date"
                    value={day}
                    min={lagosDateString()}
                    onChange={(e) => setDay(e.target.value)}
                    className="h-10 w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="n-time">Time</Label>
                  <Input id="n-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10 w-28" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
                {choices.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => {
                      setDay(c.date)
                      setTime(c.time)
                    }}
                    className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Goes out within five minutes of the time, Lagos time. Who gets it is fixed now, with the people this
                audience reaches today.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-brand" />
            {preview ? (
              <span>
                <strong>{preview.recipients}</strong> recipient{preview.recipients === 1 ? '' : 's'} ·{' '}
                <strong>{preview.with_devices}</strong> with notifications on
              </span>
            ) : (
              <span className="text-muted-foreground">Working out who this reaches…</span>
            )}
            {preview && preview.recipients > 0 && (
              <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setShowPeople((s) => !s)}>
                {showPeople ? 'Hide names' : 'See who'}
              </button>
            )}
          </div>
          <Button onClick={send} disabled={!canSend || busy}>
            {later ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {busy ? (later ? 'Scheduling…' : 'Sending…') : later ? 'Schedule' : 'Send notification'}
          </Button>
        </div>

        {showPeople && preview && (
          <ul className="grid max-h-60 gap-x-4 overflow-y-auto rounded-2xl border border-border p-2 text-sm sm:grid-cols-2">
            {preview.people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2 px-2 py-1">
                <span className="min-w-0 flex-1 truncate">
                  {p.full_name}
                  {p.outlet_name ? <span className="text-xs text-muted-foreground"> · {p.outlet_name}</span> : null}
                </span>
                {p.devices === 0 && (
                  <Badge variant="warning">
                    <BellOff className="h-3 w-3" /> Off
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {off.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {off.length} of these {off.length === 1 ? 'has' : 'have'} not turned notifications on for any device, so they
            will not receive it. They are still recorded in the history, and you can
            send it again to them later.
          </p>
        )}

        {mine.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-muted-foreground">Manage templates</summary>
            <ul className="mt-2 divide-y divide-border rounded-2xl border border-border">
              {mine.map((t) => (
                <li key={t.id} className="flex items-start gap-2 p-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t.title}</span>
                    <span className="block text-muted-foreground">{t.body}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.title}`}
                    onClick={() => void removeTemplate(t)}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
