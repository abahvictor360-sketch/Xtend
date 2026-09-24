'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Who has not clocked in today?',
  'Who is still on shift and has not clocked out?',
  'Who clocked in late today?',
  'Who clocked in away from their store today?',
  'Who forgot to clock out yesterday?',
  'Who was late most often this week?',
]

/** Only the most recent turns go back to the server; older ones add cost, not answers. */
const HISTORY_SENT = 12

export function AttendanceAssistant({ configured }: { configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    const next = [...turns, { role: 'user' as const, content: text }]
    setTurns(next)
    setDraft('')
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-HISTORY_SENT) }),
      })
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string }
      if (!res.ok || !json.answer) throw new Error(json.error ?? 'The assistant did not answer.')
      setTurns([...next, { role: 'assistant', content: json.answer }])
    } catch (e) {
      // Drop the unanswered question back into the box so it can be resent.
      setTurns(turns)
      setDraft(text)
      setError(e instanceof Error ? e.message : 'The assistant did not answer.')
    } finally {
      setBusy(false)
    }
  }

  if (!configured) {
    return (
      <Alert variant="warning">
        The assistant is not set up yet. Add <code>ANTHROPIC_API_KEY</code> to the environment and
        redeploy.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {turns.length === 0 && (
        <div className="surface space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand" />
            Try one of these
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} onClick={() => ask(s)} disabled={busy}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm',
                turn.role === 'user'
                  ? 'bg-brand text-primary-foreground'
                  : 'border border-border bg-card text-foreground shadow-soft',
              )}
            >
              {turn.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-soft">
              Checking attendance…
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(draft)
            }
          }}
          placeholder="Ask about attendance, e.g. who hasn't clocked out yet?"
          rows={2}
          maxLength={4000}
          className="min-h-[56px]"
          disabled={busy}
        />
        <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Ask">
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {turns.length > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setTurns([])
            setError(null)
          }}
          disabled={busy}
        >
          Start a new conversation
        </button>
      )}
    </div>
  )
}
