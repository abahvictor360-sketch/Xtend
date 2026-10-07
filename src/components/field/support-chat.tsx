'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, CheckCircle2, ChevronDown, Headset, Send, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { cn, formatLagos } from '@/lib/utils'
import { checkText } from '@/lib/validation'

export interface SupportThread {
  id: string
  subject: string
  status: 'open' | 'ai_answered' | 'escalated' | 'resolved'
  created_at: string
  last_message_at: string
}

export interface SupportMessage {
  id: string
  thread_id: string
  sender_role: 'staff' | 'ai' | 'admin' | 'supervisor'
  body: string
  created_at: string
}

const STATUS: Record<SupportThread['status'], { label: string; cls: string }> = {
  open: { label: 'Waiting', cls: 'bg-muted text-muted-foreground' },
  ai_answered: { label: 'Answered', cls: 'bg-brand/10 text-brand' },
  escalated: { label: 'With the office', cls: 'bg-warning/15 text-foreground' },
  resolved: { label: 'Resolved', cls: 'bg-success/15 text-success' },
}

export function SupportChat({
  threads,
  messages,
  staffName,
}: {
  threads: SupportThread[]
  messages: SupportMessage[]
  staffName: string
}) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(threads[0]?.id ?? null)
  const [replies, setReplies] = useState<Record<string, string>>({})

  async function send() {
    if (!body.trim()) return
    const problem =
      checkText(body, { max: 4000 }) ?? (subject.trim() ? checkText(subject, { max: 160, what: 'subject' }) : null)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim() || undefined, body: body.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not send your message.')
      setSubject('')
      setBody('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your message.')
    } finally {
      setBusy(false)
    }
  }

  async function reply(threadId: string) {
    const text = (replies[threadId] ?? '').trim()
    if (!text) return
    const problem = checkText(text, { max: 4000 })
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/support/${threadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not send your message.')
      setReplies((r) => ({ ...r, [threadId]: '' }))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* New message */}
      <div className="surface space-y-3 p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Headset className="h-4 w-4 text-brand" />
          Tell us what is wrong
        </p>
        <p className="text-xs text-muted-foreground">
          The Xtend helper answers straight away. Anything it cannot sort out goes to the office.
        </p>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short title (optional)"
          maxLength={160}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe the problem. For example: my clock-in keeps saying off site at my store."
          maxLength={4000}
        />
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button className="w-full" onClick={() => void send()} disabled={busy || !body.trim()}>
          <Send className="h-4 w-4" />
          {busy ? 'Sending…' : 'Send message'}
        </Button>
      </div>

      {/* Past threads */}
      {threads.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No messages yet. Anything you send shows here with the reply.
        </p>
      ) : (
        <ul className="space-y-3">
          {threads.map((t) => {
            const isOpen = open === t.id
            const thread = messages.filter((m) => m.thread_id === t.id)
            const s = STATUS[t.status]
            return (
              <li key={t.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                <button
                  className="flex w-full items-center gap-2 p-3 text-left"
                  onClick={() => setOpen(isOpen ? null : t.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.subject}</span>
                    <span className="text-xs text-muted-foreground">{formatLagos(t.last_message_at)}</span>
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', s.cls)}>
                    {s.label}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-border p-3">
                    <ul className="space-y-2">
                      {thread.map((m) => (
                        <li
                          key={m.id}
                          className={cn('flex', m.sender_role === 'staff' ? 'justify-end' : 'justify-start')}
                        >
                          <div
                            className={cn(
                              'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                              m.sender_role === 'staff'
                                ? 'bg-brand text-white'
                                : m.sender_role === 'ai'
                                  ? 'bg-tint text-foreground'
                                  : 'bg-muted text-foreground',
                            )}
                          >
                            {m.sender_role !== 'staff' && (
                              <span className="mb-0.5 flex items-center gap-1 text-xs font-semibold opacity-80">
                                {m.sender_role === 'ai' ? (
                                  <>
                                    <Bot className="h-3 w-3" /> Xtend helper
                                  </>
                                ) : (
                                  <>
                                    <ShieldQuestion className="h-3 w-3" /> Office
                                  </>
                                )}
                              </span>
                            )}
                            <span className="whitespace-pre-wrap break-words">{m.body}</span>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {t.status === 'resolved' ? (
                      <p className="flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Marked resolved by the office.
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          value={replies[t.id] ?? ''}
                          onChange={(e) => setReplies((r) => ({ ...r, [t.id]: e.target.value }))}
                          placeholder="Write a reply"
                          maxLength={4000}
                          className="flex-1"
                        />
                        <Button
                          size="icon"
                          onClick={() => void reply(t.id)}
                          disabled={busy || !(replies[t.id] ?? '').trim()}
                          aria-label="Send reply"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="sr-only">Signed in as {staffName}</p>
    </div>
  )
}
