'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  FileText,
  History,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PlanCard } from '@/components/admin/assistant-plan-card'
import { ActionCard, PageLinks } from '@/components/admin/assistant-action-card'
import type { PageLink, ProposedAction } from '@/lib/assistant-action-types'
import {
  SUGGESTION_GROUPS,
  fromSaved,
  groupConversations,
  toSaved,
  type ChatTurnView,
  type ConversationSummary,
} from '@/lib/assistant-conversations'
import { cn, formatLagos, lagosDateString } from '@/lib/utils'
import { REPORT_FORMATS, reportDownloadUrl, type ReportSpec } from '@/lib/assistant-report-spec'
import type { ChangePlan } from '@/lib/assistant-plan'

type Turn = ChatTurnView

interface Attached {
  name: string
  type: string
  data: string
}

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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? 'That did not work.')
  return json
}

/**
 * The chat itself. On the Ask Xtend page it flows with the page, with the
 * kept conversations beside it on a wide screen; inside the floating panel
 * (`compact`) the conversation scrolls and the question box stays pinned
 * to the bottom. Every answered chat is kept for the person who asked, so
 * they can come back to it (assistant_conversations, 054).
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
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [kept, setKept] = useState<ConversationSummary[] | null>(null)
  const [keptError, setKeptError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [topic, setTopic] = useState(SUGGESTION_GROUPS[0].topic)
  const end = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const idRef = useRef<string | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (turns.length || busy) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  const loadKept = useCallback(async () => {
    try {
      const json = await call<{ conversations: ConversationSummary[] }>('/api/admin/ask/conversations')
      setKept(json.conversations)
      setKeptError(null)
    } catch (e) {
      setKeptError(e instanceof Error ? e.message : 'Earlier chats could not be loaded.')
    }
  }, [])

  // The full page shows the list straight away; the panel when it is asked for.
  useEffect(() => {
    if (configured && !compact) void loadKept()
  }, [configured, compact, loadKept])

  function keep(all: Turn[]) {
    saving.current = saving.current.then(async () => {
      try {
        const body = JSON.stringify({ turns: toSaved(all) })
        if (!idRef.current) {
          const json = await call<{ conversation: ConversationSummary }>('/api/admin/ask/conversations', { method: 'POST', body })
          idRef.current = json.conversation.id
          setConversationId(json.conversation.id)
        } else {
          await call(`/api/admin/ask/conversations/${idRef.current}`, { method: 'PATCH', body })
        }
        setSaveNote(null)
        await loadKept()
      } catch (e) {
        setSaveNote(`This chat could not be kept: ${e instanceof Error ? e.message : 'try again later'}`)
      }
    })
  }

  function newChat() {
    idRef.current = null
    setConversationId(null)
    setTurns([])
    setDraft('')
    setAttached(null)
    setError(null)
    setSaveNote(null)
    setShowHistory(false)
  }

  async function openChat(id: string) {
    if (busy) return
    setError(null)
    try {
      const json = await call<{ conversation: { id: string; turns: unknown } }>(`/api/admin/ask/conversations/${id}`)
      idRef.current = json.conversation.id
      setConversationId(json.conversation.id)
      setTurns(fromSaved(json.conversation.turns))
      setShowHistory(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That chat could not be opened.')
      void loadKept()
    }
  }

  async function renameChat(id: string, title: string) {
    const json = await call<{ conversation: ConversationSummary }>(`/api/admin/ask/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
    setKept((list) => (list ?? []).map((c) => (c.id === id ? { ...c, title: json.conversation.title } : c)))
  }

  async function deleteChat(id: string) {
    await call(`/api/admin/ask/conversations/${id}`, { method: 'DELETE' })
    setKept((list) => (list ?? []).filter((c) => c.id !== id))
    if (idRef.current === id) newChat()
  }

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
      const sent = next.slice(-HISTORY_SENT)
      // A conversation starts with a question, even when it is cut short.
      while (sent.length > 1 && sent[0].role === 'assistant') sent.shift()
      const res = await fetch('/api/admin/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: sent.map(({ role, content, file: name }, i) => ({
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
        actions?: ProposedAction[]
        links?: PageLink[]
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
      const all: Turn[] = [
        ...next,
        {
          role: 'assistant',
          content: json.answer,
          reports: json.reports,
          plans: json.plans,
          actions: json.actions,
          links: json.links,
        },
      ]
      setTurns(all)
      keep(all)
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

  const history = (
    <ChatHistory
      kept={kept}
      error={keptError}
      current={conversationId}
      busy={busy}
      onOpen={openChat}
      onRename={renameChat}
      onDelete={deleteChat}
    />
  )

  const bar = (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={newChat} disabled={busy || (turns.length === 0 && !conversationId)}>
        <Plus className="h-4 w-4" />
        New chat
      </Button>
      <Button
        type="button"
        variant={showHistory ? 'default' : 'outline'}
        size="sm"
        className={cn(!compact && 'lg:hidden')}
        onClick={() => {
          if (!showHistory && kept === null) void loadKept()
          setShowHistory((v) => !v)
        }}
        aria-expanded={showHistory}
      >
        <History className="h-4 w-4" />
        Earlier chats{kept?.length ? ` (${kept.length})` : ''}
      </Button>
      {conversationId && turns.length > 0 && (
        <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:inline">Kept in your earlier chats</span>
      )}
    </div>
  )

  const chat = (
    <div className={cn(compact ? 'flex h-full min-h-0 flex-col gap-3' : 'min-w-0 space-y-4')}>
      {bar}
      {showHistory && (
        <div className={cn('rounded-2xl border border-border bg-card p-3', compact ? 'min-h-0 flex-1 overflow-y-auto' : 'lg:hidden')}>
          {history}
        </div>
      )}
      <div
        className={cn(
          compact ? 'min-h-0 flex-1 space-y-3 overflow-y-auto pr-1' : 'space-y-4',
          compact && showHistory && 'hidden',
        )}
      >
        {turns.length === 0 && (
          <div className={cn('space-y-3', compact ? 'rounded-2xl bg-tint/60 p-3' : 'surface p-4')}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-brand" />
              Try one of these
            </p>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Topics">
              {SUGGESTION_GROUPS.map((g) => (
                <button
                  key={g.topic}
                  type="button"
                  role="tab"
                  aria-selected={topic === g.topic}
                  onClick={() => setTopic(g.topic)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold',
                    topic === g.topic ? 'border-brand bg-card text-brand' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {g.topic}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" role="tabpanel">
              {(SUGGESTION_GROUPS.find((g) => g.topic === topic) ?? SUGGESTION_GROUPS[0]).questions.map((s) => (
                <Chip key={s} onClick={() => ask(s)} disabled={busy} className="h-auto min-h-9 whitespace-normal py-2 text-left">
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
                  (turn.plans?.length || turn.actions?.length) && 'w-full max-w-full',
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
                {turn.actions?.map((action) => <ActionCard key={action.key} action={action} />)}
                {turn.earlier?.length ? <Earlier items={turn.earlier} /> : null}
                {turn.links?.length ? <PageLinks links={turn.links} /> : null}
                {turn.role === 'assistant' && <CopyButton text={turn.content} />}
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
        {saveNote && <p className="text-xs text-muted-foreground">{saveNote}</p>}
      </div>

      <div className={cn('space-y-2', compact && showHistory && 'hidden')}>
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
    </div>
  )

  if (compact) return chat

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-6">
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier chats</p>
        {history}
      </aside>
      {chat}
    </div>
  )
}

function ChatHistory({
  kept,
  error,
  current,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  kept: ConversationSummary[] | null
  error: string | null
  current: string | null
  busy: boolean
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  if (error) return <p className="text-xs text-muted-foreground">{error}</p>
  if (kept === null) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (kept.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing yet. Each chat you have is kept here, for you only.</p>
  }

  const groups = groupConversations(kept, lagosDateString(), (iso) => lagosDateString(new Date(iso)))

  async function save(id: string) {
    setProblem(null)
    try {
      await onRename(id, name)
      setEditing(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That name could not be saved.')
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return
    setProblem(null)
    try {
      await onDelete(id)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That chat could not be deleted.')
    }
  }

  return (
    <div className="space-y-3">
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((c) => (
              <li key={c.id} className={cn('group rounded-lg', c.id === current ? 'bg-tint' : 'hover:bg-muted')}>
                {editing === c.id ? (
                  <form
                    className="flex items-center gap-1 p-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void save(c.id)
                    }}
                  >
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      autoFocus
                      aria-label="Chat name"
                      className="h-8 text-xs"
                    />
                    <button type="submit" className="rounded p-1 hover:bg-card" aria-label="Save name">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 hover:bg-card" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      disabled={busy}
                      className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    >
                      <span className={cn('block truncate text-sm', c.id === current && 'font-semibold')}>{c.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatLagos(c.updated_at)} · {Math.ceil(c.turn_count / 2)} question{c.turn_count > 2 ? 's' : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(c.id)
                        setName(c.title)
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-card hover:text-foreground"
                      aria-label={`Rename ${c.title}`}
                      title="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c.id, c.title)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-card hover:text-destructive"
                      aria-label={`Delete ${c.title}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex justify-end whitespace-normal">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          } catch {
            setCopied(false)
          }
        }}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-tint hover:text-tint-foreground"
        aria-label="Copy this answer"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Earlier({ items }: { items: string[] }) {
  return (
    <div className="mt-3 whitespace-normal rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
      <p className="font-semibold">Proposed in this chat earlier</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="mt-1">Ask again to do it now; old buttons are not kept.</p>
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
