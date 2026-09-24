'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Textarea } from '@/components/ui/textarea'
import { PlanCard } from '@/components/admin/assistant-plan-card'
import { cn } from '@/lib/utils'
import { REPORT_FORMATS, reportDownloadUrl, type ReportSpec } from '@/lib/assistant-report-spec'
import type { ChangePlan } from '@/lib/assistant-plan'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** The name of a file attached to this question, for display. */
  file?: string
  reports?: ReportSpec[]
  plans?: ChangePlan[]
}

interface Attached {
  name: string
  type: string
  data: string
}

const SUGGESTIONS = [
  'Who has not clocked in today?',
  'Who is still on shift and has not clocked out?',
  'Who clocked in late today?',
  'Who clocked in away from their store today?',
  'Who forgot to clock out yesterday?',
  'Who was late most often this week?',
  "Make today's attendance report",
  'Weekly attendance report for this week',
  "Summarise this week's field reports",
  "Show today's store counts",
]

/** Only the most recent turns go back to the server; older ones add cost, not answers. */
const HISTORY_SENT = 12
const MAX_FILE_BYTES = 3 * 1024 * 1024
const ACCEPT = '.csv,.tsv,.txt,.xlsx,.pdf,image/png,image/jpeg,image/webp,image/gif'

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/**
 * The chat itself. On the Ask Xtend page it flows with the page; inside the
 * floating panel (`compact`) the conversation scrolls and the question box
 * stays pinned to the bottom.
 */
export function AttendanceAssistant({
  configured,
  compact = false,
}: {
  configured: boolean
  compact?: boolean
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [attached, setAttached] = useState<Attached | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  async function attach(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is over 3 MB. Split it, or save it as CSV, and attach it again.')
      return
    }
    try {
      setAttached({ name: file.name, type: file.type, data: await readAsBase64(file) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  async function ask(question: string) {
    const file = attached
    const text =
      question.trim() || (file ? 'Read the attached file and prepare the store allocations in it.' : '')
    if (!text || busy) return
    const next: Turn[] = [...turns, { role: 'user', content: text, file: file?.name }]
    setTurns(next)
    setDraft('')
    setAttached(null)
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-HISTORY_SENT).map(({ role, content, file: name }, i, sent) => ({
            role,
            // Only the newest question carries its file; earlier ones just say there was one.
            content: name && i < sent.length - 1 ? `${content}\n(attached: ${name})` : content,
          })),
          attachment: file,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        answer?: string
        reports?: ReportSpec[]
        plans?: ChangePlan[]
        error?: string
      }
      if (!res.ok || !json.answer) {
        throw new Error(
          json.error ??
            (res.status === 413
              ? 'That file is too big to send. Save it as CSV and try again.'
              : 'The assistant did not answer.'),
        )
      }
      setTurns([
        ...next,
        { role: 'assistant', content: json.answer, reports: json.reports, plans: json.plans },
      ])
    } catch (e) {
      // Put the unanswered question, and its file, back so it can be resent.
      setTurns(turns)
      setDraft(question)
      setAttached(file)
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
    <div className={cn(compact ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4')}>
      <div className={cn(compact ? 'min-h-0 flex-1 space-y-3 overflow-y-auto pr-1' : 'space-y-4')}>
        {turns.length === 0 && (
          <div className={cn('space-y-3', compact ? 'rounded-2xl bg-tint/60 p-3' : 'surface p-4')}>
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
            <p className="text-xs text-muted-foreground">
              To allocate stores, attach a spreadsheet, PDF or photo of the list with the paperclip,
              or paste the list in the box. You check the changes before anything is saved.
            </p>
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
                  turn.plans?.length && 'w-full max-w-full',
                )}
              >
                {turn.file && (
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs opacity-90">
                    <Paperclip className="h-3.5 w-3.5" />
                    {turn.file}
                  </span>
                )}
                {turn.content}
                {turn.reports?.map((report, r) => <ReportCard key={r} report={report} />)}
                {turn.plans?.map((plan, p) => <PlanCard key={p} plan={plan} />)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-soft">
                {turns[turns.length - 1]?.file ? 'Reading the file…' : 'Checking…'}
              </div>
            </div>
          )}
          <div ref={end} />
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}
      </div>

      <div className="space-y-2">
        {attached && (
          <div className="flex items-center gap-2 rounded-xl bg-tint px-3 py-2 text-xs font-medium text-tint-foreground">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{attached.name}</span>
            <button
              type="button"
              onClick={() => setAttached(null)}
              aria-label="Remove attachment"
              className="rounded-md p-0.5 hover:bg-white/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(draft)
          }}
        >
          <input ref={picker} type="file" accept={ACCEPT} className="hidden" onChange={attach} />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => picker.current?.click()}
            disabled={busy}
            aria-label="Attach a file"
            title="Attach a spreadsheet, PDF or photo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask(draft)
              }
            }}
            placeholder={
              attached
                ? 'Say what to do with the file, or just send it'
                : "Ask anything, e.g. who hasn't clocked out yet?"
            }
            rows={2}
            maxLength={20000}
            className="min-h-[56px]"
            disabled={busy}
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || (!draft.trim() && !attached)}
            aria-label="Ask"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

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

function ReportCard({ report }: { report: ReportSpec }) {
  return (
    <div className="mt-3 whitespace-normal rounded-xl border border-border bg-tint/50 p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        {report.title}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {REPORT_FORMATS.map((format) => (
          <a
            key={format.id}
            href={reportDownloadUrl(report, format.id)}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-semibold text-primary-foreground hover:bg-brand-deep"
          >
            <Download className="h-3.5 w-3.5" />
            {format.label}
          </a>
        ))}
      </div>
    </div>
  )
}
