'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, CheckCircle2, Headset, Send, ShieldQuestion } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatLagos } from '@/lib/utils'
import { writtenText } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'

export interface AdminThread {
  id: string
  staff_name: string
  staff_role: string
  subject: string
  status: 'open' | 'ai_answered' | 'escalated' | 'resolved'
  outlet_name: string | null
  created_at: string
  last_message_at: string
  resolved_by_name: string | null
  message_count: number
}

export interface AdminMessage {
  id: string
  thread_id: string
  sender_role: 'staff' | 'ai' | 'admin' | 'supervisor'
  body: string
  created_at: string
}

const STATUS: Record<AdminThread['status'], { label: string; cls: string }> = {
  escalated: { label: 'With the office', cls: 'bg-destructive/10 text-destructive' },
  open: { label: 'Waiting', cls: 'bg-warning/15 text-foreground' },
  ai_answered: { label: 'Helper answered', cls: 'bg-brand/10 text-brand' },
  resolved: { label: 'Resolved', cls: 'bg-muted text-muted-foreground' },
}

export function SupportThreads({
  threads,
  messages,
  me,
}: {
  threads: AdminThread[]
  messages: AdminMessage[]
  me: string
}) {
  const router = useRouter()
  const [show, setShow] = useState<'needs' | 'all'>('needs')
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const needsAttention = (t: AdminThread) => t.status === 'escalated' || t.status === 'open'
  const visible = useMemo(
    () => threads.filter((t) => (show === 'all' ? true : needsAttention(t))),
    [threads, show],
  )
  const needCount = threads.filter(needsAttention).length

  async function reply(threadId: string, resolve: boolean) {
    const text = (drafts[threadId] ?? '').trim()
    if (!text) return
    const problem = problemWith(writtenText(4000, 2, 'the reply', true), text)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(threadId)
    setError(null)
    try {
      const res = await fetch(`/api/admin/support/${threadId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, resolve }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'That could not be sent.')
      setDrafts((d) => ({ ...d, [threadId]: '' }))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be sent.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip active={show === 'needs'} onClick={() => setShow('needs')}>
          Needs attention ({needCount})
        </Chip>
        <Chip active={show === 'all'} onClick={() => setShow('all')}>
          All ({threads.length})
        </Chip>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {visible.length === 0 ? (
        <Alert variant="success">Nothing waiting. New issues from the field appear here.</Alert>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => {
            const isOpen = open === t.id
            const thread = messages.filter((m) => m.thread_id === t.id)
            const s = STATUS[t.status]
            return (
              <li key={t.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                <button
                  className="flex w-full items-start gap-3 p-4 text-left"
                  onClick={() => setOpen(isOpen ? null : t.id)}
                >
                  <span className="icon-tile shrink-0">
                    <Headset className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.subject}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.staff_name} · {t.staff_role}
                      {t.outlet_name ? ` · ${t.outlet_name}` : ''} · {formatLagos(t.last_message_at)}
                    </span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', s.cls)}>
                    {s.label}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-border p-4">
                    <ul className="space-y-2">
                      {thread.map((m) => (
                        <li
                          key={m.id}
                          className={cn('flex', m.sender_role === 'staff' ? 'justify-start' : 'justify-end')}
                        >
                          <div
                            className={cn(
                              'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                              m.sender_role === 'staff'
                                ? 'bg-muted text-foreground'
                                : m.sender_role === 'ai'
                                  ? 'bg-tint text-foreground'
                                  : 'bg-brand text-white',
                            )}
                          >
                            <span className="mb-0.5 flex items-center gap-1 text-xs font-semibold opacity-80">
                              {m.sender_role === 'staff' ? (
                                t.staff_name
                              ) : m.sender_role === 'ai' ? (
                                <>
                                  <Bot className="h-3 w-3" /> Xtend helper
                                </>
                              ) : (
                                <>
                                  <ShieldQuestion className="h-3 w-3" /> Office
                                </>
                              )}
                            </span>
                            <span className="whitespace-pre-wrap break-words">{m.body}</span>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {t.status === 'resolved' ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Resolved by {t.resolved_by_name ?? 'the office'}.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <Textarea
                          value={drafts[t.id] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                          placeholder={`Reply to ${t.staff_name}. They get this in their app.`}
                          maxLength={4000}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() => void reply(t.id, false)}
                            disabled={busy === t.id || !(drafts[t.id] ?? '').trim()}
                          >
                            <Send className="h-4 w-4" />
                            Send reply
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void reply(t.id, true)}
                            disabled={busy === t.id || !(drafts[t.id] ?? '').trim()}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Reply and resolve
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="sr-only">Signed in as {me}</p>
    </div>
  )
}
