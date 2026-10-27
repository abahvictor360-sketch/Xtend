'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert } from '@/components/ui/alert'
import { cn, formatLagos } from '@/lib/utils'
import { MESSAGE_MAX, type ChatMessage } from '@/lib/messages'

const REALTIME_DISABLED = process.env.NEXT_PUBLIC_REALTIME_DISABLED === '1'

/**
 * One conversation between a staff member and the office (0073), for both
 * sides. Staff pass no staffId: they always write in their own. New
 * messages arrive live: staff hear their own private topic (0058), the
 * office follows the messages table through RLS. A slow poll covers a
 * dropped socket.
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
    <div className="space-y-3">
      <div className="space-y-2" aria-live="polite">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
                  m.mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-muted text-foreground',
                )}
              >
                {!m.mine && <p className="mb-0.5 text-xs font-semibold opacity-80">{m.sender_name}</p>}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={cn('mt-1 text-[11px]', m.mine ? 'text-white/80' : 'text-muted-foreground')}>
                  {formatLagos(m.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={end} />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <form onSubmit={send} className="flex items-end gap-2">
        <Textarea
          aria-label="Your message"
          className="min-h-[48px] flex-1"
          rows={2}
          maxLength={MESSAGE_MAX}
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button type="submit" disabled={busy || !body.trim()} className="h-12 shrink-0" aria-label="Send">
          <Send className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">{busy ? 'Sending…' : 'Send'}</span>
        </Button>
      </form>
    </div>
  )
}
