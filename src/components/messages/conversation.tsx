'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { Alert } from '@/components/ui/alert'
import { addDays, cn, formatLagos, lagosDateString, longDate } from '@/lib/utils'
import { MESSAGE_MAX, type ChatMessage } from '@/lib/messages'

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_REALTIME_DISABLED === '1'

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  )
}

/** "Today", "Yesterday", else the full date. */
function dayLabel(date: string) {
  const today = lagosDateString()
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  return longDate(date)
}

/** Messages split into day groups, each day labelled. */
function byDay(messages: ChatMessage[]) {
  const groups: { date: string; label: string; items: ChatMessage[] }[] = []
  for (const m of messages) {
    const date = lagosDateString(new Date(m.created_at))
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.items.push(m)
    else groups.push({ date, label: dayLabel(date), items: [m] })
  }
  return groups
}

/**
 * One conversation between a staff member and the office (0073), for both
 * sides, styled as a chat: messages in day groups, the sender's bubbles on
 * the right, the other side's on the left with their initials, and a rounded
 * compose bar. New messages arrive live: staff hear their own private topic
 * (0058), the office follows the messages table through RLS; a slow poll
 * covers a dropped socket.
 */
export function Conversation({
  messages,
  staffId = null,
  userId,
  emptyText,
  placeholder,
}: {
  messages: ChatMessage[]
  /** The staff member's conversation, for the office. */
  staffId?: string | null
  userId: string
  emptyText: string
  placeholder: string
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement | null>(null)
  const latest = messages[messages.length - 1]?.id
  const groups = useMemo(() => byDay(messages), [messages])

  // Mark it read when opened and whenever a new message shows.
  useEffect(() => {
    void fetch('/api/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId }),
    }).catch(() => {})
    end.current?.scrollIntoView({ block: 'end' })
  }, [latest, staffId])

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 60_000)
    if (REALTIME_DISABLED || !userId) return () => window.clearInterval(poll)
    let channel: ReturnType<ReturnType<typeof supabase>['channel']> | null = null
    try {
      const client = supabase()
      channel = staffId
        ? client
            .channel(`messages:${staffId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () =>
              router.refresh(),
            )
            .subscribe()
        : client
            .channel(`field:${userId}`, { config: { private: true } })
            .on('broadcast', { event: 'change' }, ({ payload }) => {
              if ((payload as { table?: string } | undefined)?.table === 'messages') router.refresh()
            })
            .subscribe()
    } catch {
      // Realtime unavailable: the poll and sending still refresh.
    }
    return () => {
      window.clearInterval(poll)
      if (channel) void supabase().removeChannel(channel)
    }
  }, [router, staffId, userId])

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return setError('Write your message first.')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId, body: text }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Your message was not sent. Try again.')
      setBody('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your message was not sent. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div
        className="flex-1 space-y-1 overflow-y-auto rounded-2xl bg-muted/30 p-3 sm:p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          groups.map((group) => (
            <Fragment key={group.date}>
              <div className="flex justify-center py-2">
                <span className="rounded-full bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-soft">
                  {group.label}
                </span>
              </div>
              {group.items.map((m, i) => {
                const prev = group.items[i - 1]
                const next = group.items[i + 1]
                const startsRun = !prev || prev.mine !== m.mine
                const endsRun = !next || next.mine !== m.mine
                return (
                  <div
                    key={m.id}
                    className={cn('flex items-end gap-2', m.mine ? 'justify-end' : 'justify-start', startsRun ? 'mt-2' : 'mt-0.5')}
                  >
                    {!m.mine &&
                      (endsRun ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-[10px] font-bold text-tint-foreground">
                          {initials(m.sender_name)}
                        </span>
                      ) : (
                        <span className="h-7 w-7 shrink-0" aria-hidden />
                      ))}

                    <div className={cn('max-w-[80%] sm:max-w-[72%]', m.mine ? 'items-end' : 'items-start')}>
                      {!m.mine && startsRun && (
                        <p className="mb-0.5 pl-1 text-[11px] font-semibold text-muted-foreground">{m.sender_name}</p>
                      )}
                      <div
                        className={cn(
                          'px-3.5 py-2 text-sm leading-snug shadow-soft',
                          m.mine
                            ? 'rounded-2xl bg-brand text-white'
                            : 'rounded-2xl bg-card text-foreground',
                          // A flat corner nearest the speaker, on the last of a run.
                          endsRun && (m.mine ? 'rounded-br-md' : 'rounded-bl-md'),
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                      {endsRun && (
                        <p
                          className={cn(
                            'mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground',
                            m.mine ? 'justify-end' : 'justify-start',
                          )}
                        >
                          {formatLagos(m.created_at, false)}
                          {m.mine && <Check className="h-3 w-3" aria-label="Sent" />}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </Fragment>
          ))
        )}
        <div ref={end} />
      </div>

      {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}

      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <div className="flex flex-1 items-end rounded-2xl border border-border bg-card px-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <textarea
            aria-label="Your message"
            rows={1}
            maxLength={MESSAGE_MAX}
            placeholder={placeholder}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (body.trim() && !busy) void send(e as unknown as React.FormEvent)
              }
            }}
            className="max-h-36 min-h-[44px] flex-1 resize-none bg-transparent px-2.5 py-3 text-sm leading-snug outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !body.trim()}
          aria-label={busy ? 'Sending' : 'Send'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-[18px] w-[18px]" />
        </button>
      </form>
    </div>
  )
}
