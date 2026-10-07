'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Users } from 'lucide-react'
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

interface Preview {
  recipients: number
  with_devices: number
  people: { user_id: string; full_name: string; role: string; devices: number }[]
}

export function NotificationComposer({
  staff,
  outlets,
}: {
  staff: Person[]
  outlets: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('everyone')
  const [role, setRole] = useState('merchandiser')
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? '')
  const [userIds, setUserIds] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const payload = useCallback(
    (isPreview: boolean) => ({
      title: title || 'Xtend',
      body: body || '…',
      audience,
      role: audience === 'role' ? role : null,
      outlet_id: audience === 'outlet' ? outletId || null : null,
      user_ids: audience === 'users' ? userIds : undefined,
      preview: isPreview,
    }),
    [audience, body, outletId, role, title, userIds],
  )

  // Keep the recipient count honest as the audience is changed.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload(true)),
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
  }, [payload])

  async function send() {
    setError(null)
    setResult(null)
    const problem = problemWith(thingName(80, 'title'), title) ??
      problemWith(writtenText(400, 2, 'the message', true), body)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(false)),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That did not send.')
        return
      }
      setResult(
        `Sent to ${data.delivered} of ${data.recipients}.` +
          (data.no_device ? ` ${data.no_device} had no device registered.` : '') +
          (data.failed ? ` ${data.failed} failed.` : ''),
      )
      setTitle('')
      setBody('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const canSend = title.trim().length > 0 && body.trim().length > 0 && (preview?.recipients ?? 0) > 0

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        {error && <Alert variant="destructive">{error}</Alert>}
        {result && <Alert variant="success">{result}</Alert>}

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
            <Label htmlFor="n-url">Opens at (optional)</Label>
            <Input id="n-url" value="/field" disabled />
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
          <p className="text-[11px] text-muted-foreground">{body.length}/400</p>
        </div>

        <div className="space-y-2">
          <Label className="field-label">Send to</Label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((item) => (
              <Chip
                key={item.id}
                active={audience === item.id}
                onClick={() => setAudience(item.id)}
              >
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
            <Select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="max-w-xs"
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </Select>
          )}

          {audience === 'users' && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
              {staff.map((person) => {
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
                          e.target.checked
                            ? [...current, person.id]
                            : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <span className="flex-1 truncate">{person.full_name}</span>
                    <Badge variant="outline">{person.role}</Badge>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-brand" />
            {preview ? (
              <span>
                <strong>{preview.recipients}</strong> recipient
                {preview.recipients === 1 ? '' : 's'} ·{' '}
                <strong>{preview.with_devices}</strong> with notifications on
              </span>
            ) : (
              <span className="text-muted-foreground">Working out who this reaches…</span>
            )}
          </p>
          <Button onClick={send} disabled={!canSend || busy}>
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : 'Send notification'}
          </Button>
        </div>

        {preview && preview.recipients > preview.with_devices && (
          <p className="text-[11px] text-muted-foreground">
            {preview.recipients - preview.with_devices} of these have not turned notifications on
            for any device yet, so they will not receive it. They are still recorded in the log.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
