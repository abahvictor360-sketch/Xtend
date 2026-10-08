'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BellOff, Bot, CheckCircle2, RotateCcw, Save, Send, Trash2, UserRound } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatLagos } from '@/lib/utils'
import { writtenText } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'
import {
  fillReply,
  minutesWaiting,
  statusLabel,
  waitText,
  waitTone,
  type InboxThread,
  type SupportSender,
} from '@/lib/support-inbox'

export interface PanelMessage {
  id: string
  sender_role: SupportSender
  sender_name: string | null
  body: string
  created_at: string
}

export interface QuickReply {
  id: string
  title: string
  body: string
  created_by: string | null
}

export interface Assignee {
  user_id: string
  full_name: string
  role: string
}

async function post(url: string, body: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'That did not work. Try again.')
  return data
}

/** One support thread: the conversation, who has it, and the reply box. */
export function SupportThreadPanel({
  thread,
  messages,
  quickReplies,
  assignees,
  me,
  isAdmin,
  notificationsOn,
  backHref,
  now,
  context,
}: {
  thread: InboxThread
  messages: PanelMessage[]
  quickReplies: QuickReply[]
  assignees: Assignee[]
  me: string
  isAdmin: boolean
  /** Whether the member has a device with notifications on (null: unknown). */
  notificationsOn: boolean | null
  backHref: string
  now: string
  context: ReactNode
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // A different thread: start clean.
  useEffect(() => {
    setDraft('')
    setError(null)
    setDone(null)
    setSaving(false)
  }, [thread.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [thread.id, messages.length])

  const status = statusLabel(thread)
  const waited = minutesWaiting(thread, new Date(now))
  const closed = thread.status === 'resolved'
  const first = thread.staff_name.split(/\s+/)[0]

  async function act(key: string, run: () => Promise<unknown>, message: string) {
    setBusy(key)
    setError(null)
    setDone(null)
    try {
      await run()
      setDone(message)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function reply(close: boolean) {
    const text = draft.trim()
    const problem = problemWith(writtenText(4000, 2, 'the reply', true), text)
    if (problem) {
      setError(problem)
      return
    }
    await act(
      close ? 'reply-close' : 'reply',
      async () => {
        await post(`/api/admin/support/${thread.id}/reply`, { body: text, resolve: close })
        setDraft('')
      },
      close ? `Sent to ${first} and closed.` : `Sent. ${first} gets it in their app.`,
    )
  }

  function insertQuick(q: QuickReply) {
    const text = fillReply(q.body, thread.staff_name)
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${text}` : text))
    textRef.current?.focus()
  }

  async function saveQuick() {
    const title = saveName.trim()
    // Keep {name} in the saved copy where the member's first name was.
    const body = draft.trim().replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '{name}')
    await act(
      'save',
      async () => {
        await post('/api/admin/support/quick-replies', { title, body })
        setSaving(false)
        setSaveName('')
      },
      `Saved as “${title}”.`,
    )
  }

  const canRemove = (q: QuickReply) => isAdmin || q.created_by === me

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Link
          href={backHref}
          scroll={false}
          className="mt-0.5 rounded-full border border-border p-1.5 text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Back to the inbox"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight">{thread.subject}</h2>
          <p className="text-sm text-muted-foreground">
            {thread.staff_name}
            {thread.outlet_name ? ` · ${thread.outlet_name}` : ''} · started {formatLagos(thread.created_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={status.variant}>{status.label}</Badge>
            {waited !== null && (
              <Badge variant={waitTone(waited) === 'ok' ? 'outline' : waitTone(waited) === 'warn' ? 'warning' : 'destructive'}>
                {waitText(waited)}
              </Badge>
            )}
            {thread.assigned_name && <Badge variant="outline">With {thread.assigned_to === me ? 'you' : thread.assigned_name}</Badge>}
          </div>
        </div>
      </div>

      {context}

      <div className="max-h-[55vh] space-y-2 overflow-y-auto rounded-2xl border border-border bg-muted/40 p-3">
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.sender_role === 'staff' ? 'justify-start' : 'justify-end')}>
            <div
              className={cn(
                'max-w-[88%] rounded-2xl px-3 py-2 text-sm',
                m.sender_role === 'staff'
                  ? 'bg-card text-foreground shadow-sm'
                  : m.sender_role === 'ai'
                    ? 'bg-tint text-foreground'
                    : 'bg-brand text-white',
              )}
            >
              <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold opacity-80">
                {m.sender_role === 'staff' ? (
                  thread.staff_name
                ) : m.sender_role === 'ai' ? (
                  <>
                    <Bot className="h-3 w-3" /> Xtend helper
                  </>
                ) : (
                  <>
                    <UserRound className="h-3 w-3" /> {m.sender_name ?? 'Office'}
                  </>
                )}
                <span className="font-normal opacity-80">· {formatLagos(m.created_at)}</span>
              </span>
              <span className="whitespace-pre-wrap break-words">{m.body}</span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground" htmlFor="assign">
          Who answers
        </label>
        <Select
          id="assign"
          className="h-9 w-auto min-w-44 text-sm"
          value={thread.assigned_to ?? ''}
          disabled={busy !== null || closed}
          onChange={(e) => {
            const id = e.target.value || null
            const who = assignees.find((a) => a.user_id === id)
            void act(
              'assign',
              () => post(`/api/admin/support/${thread.id}`, { action: 'assign', user_id: id }),
              id ? (id === me ? 'You have it.' : `Passed to ${who?.full_name ?? 'them'}. They have been told.`) : 'Nobody has it now.',
            )
          }}
        >
          <option value="">Nobody yet</option>
          {assignees.map((a) => (
            <option key={a.user_id} value={a.user_id}>
              {a.user_id === me ? `Me (${a.full_name})` : `${a.full_name} · ${a.role}`}
            </option>
          ))}
          {thread.assigned_to && !assignees.some((a) => a.user_id === thread.assigned_to) && (
            <option value={thread.assigned_to}>{thread.assigned_name ?? 'Someone else'}</option>
          )}
        </Select>
        <span className="ml-auto" />
        {closed ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act('reopen', () => post(`/api/admin/support/${thread.id}`, { action: 'reopen' }), 'Reopened. It is back with the office.')
            }
          >
            <RotateCcw className="h-4 w-4" /> Reopen
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act('close', () => post(`/api/admin/support/${thread.id}`, { action: 'close' }), 'Closed without a reply.')
            }
          >
            <CheckCircle2 className="h-4 w-4" /> Close without reply
          </Button>
        )}
      </div>

      {closed ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Closed by {thread.resolved_by_name ?? 'the office'}
          {thread.resolved_at ? ` on ${formatLagos(thread.resolved_at)}` : ''}. If {first} writes again it opens by
          itself.
        </p>
      ) : (
        <div className="space-y-2">
          {quickReplies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Quick replies:</span>
              {quickReplies.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  title={fillReply(q.body, thread.staff_name)}
                  onClick={() => insertQuick(q)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold hover:border-brand hover:bg-tint"
                >
                  {q.title}
                </button>
              ))}
            </div>
          )}
          <Textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Reply to ${thread.staff_name}. They get this in their app.`}
            maxLength={4000}
            rows={4}
          />
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {notificationsOn === false ? (
              <>
                <BellOff className="h-3.5 w-3.5 text-warning" />
                {first} has notifications off, so the reply waits in Support until they next open Xtend.
              </>
            ) : (
              `${first} gets your reply as a notification on their phone.`
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void reply(false)} disabled={busy !== null || !draft.trim()}>
              <Send className="h-4 w-4" />
              {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </Button>
            <Button variant="outline" onClick={() => void reply(true)} disabled={busy !== null || !draft.trim()}>
              <CheckCircle2 className="h-4 w-4" />
              Reply and close
            </Button>
            {draft.trim().length >= 2 && !saving && (
              <Button variant="ghost" size="sm" className="h-10" onClick={() => setSaving(true)}>
                <Save className="h-4 w-4" /> Save as a quick reply
              </Button>
            )}
          </div>
          {saving && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Name it, e.g. Clock-in fixed"
                maxLength={60}
                className="h-9 w-full sm:w-64"
              />
              <Button size="sm" disabled={busy !== null || saveName.trim().length < 2} onClick={() => void saveQuick()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {first}&rsquo;s name is saved as {'{name}'} and filled in for whoever you reply to.
              </span>
            </div>
          )}
          {quickReplies.some(canRemove) && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-muted-foreground">Manage quick replies</summary>
              <ul className="mt-2 divide-y divide-border rounded-2xl border border-border">
                {quickReplies.filter(canRemove).map((q) => (
                  <li key={q.id} className="flex items-start gap-2 p-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{q.title}</span>
                      <span className="block text-muted-foreground">{q.body}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${q.title}`}
                      disabled={busy !== null}
                      onClick={() =>
                        void act('remove', () => post(`/api/admin/support/quick-replies?id=${q.id}`, null, 'DELETE'), `Removed “${q.title}”.`)
                      }
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
