'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Bot, CheckCircle2, ExternalLink, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/admin/page-kit'
import { confirmedFetch } from '@/components/reconfirm'
import { FEATURES, PROVIDERS, keyProblem, providerInfo, type AiFeature, type AiProvider } from '@/lib/ai/providers'
import { formatLagos } from '@/lib/utils'

export interface SavedKey {
  provider: AiProvider
  key_hint: string
  updated_at: string
}
export interface FeatureChoice {
  feature: AiFeature
  provider: AiProvider
  model: string
}

type Note = { ok: boolean; text: string } | null

/** The most the office can write for the AI (0104; the database also caps it). */
const KNOWLEDGE_MAX = 20_000

async function send(body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await confirmedFetch('/api/admin/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string }
    return { ok: res.ok && data.ok !== false, message: data.message ?? data.error ?? (res.ok ? 'Done.' : 'That did not work.') }
  } catch {
    return { ok: false, message: 'Could not reach Xtend. Check your connection.' }
  }
}

/** Settings → AI (0102): add, test and remove keys; choose the AI per feature. */
export function AiSettings({
  saved,
  choices,
  using,
  serverAnthropic,
  knowledge,
}: {
  saved: SavedKey[]
  choices: FeatureChoice[]
  using: Record<AiFeature, { provider: string; model: string } | null>
  serverAnthropic: boolean
  /** What the AI should know (0104); null before the migration is run. */
  knowledge: { body: string; updatedAt: string | null } | null
}) {
  const router = useRouter()
  const [notesText, setNotesText] = useState(knowledge?.body ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const savedBy = new Map(saved.map((k) => [k.provider, k]))
  const usable = PROVIDERS.filter((p) => savedBy.has(p.id) || (p.id === 'anthropic' && serverAnthropic))

  const [feature, setFeature] = useState<Record<AiFeature, { provider: AiProvider; model: string }>>(() => {
    const out = {} as Record<AiFeature, { provider: AiProvider; model: string }>
    for (const f of FEATURES) {
      const c = choices.find((x) => x.feature === f.id)
      const p = (c?.provider ?? (using[f.id]?.provider as AiProvider | undefined) ?? usable[0]?.id ?? 'anthropic') as AiProvider
      out[f.id] = { provider: p, model: c?.model ?? using[f.id]?.model ?? providerInfo(p)!.defaultModel }
    }
    return out
  })

  async function run(id: string, body: unknown) {
    setBusy(id)
    setNotes((n) => ({ ...n, [id]: null }))
    const r = await send(body)
    setNotes((n) => ({ ...n, [id]: { ok: r.ok, text: r.message } }))
    setBusy(null)
    if (r.ok) router.refresh()
    return r.ok
  }

  return (
    <div className="space-y-6">
      <Panel icon={Bot} title="Which AI answers" note="Only services with a saved key can be chosen.">
        <div className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => {
            const now = using[f.id]
            const sel = feature[f.id]
            return (
              <div key={f.id} className="space-y-3 rounded-2xl border border-border p-4">
                <div>
                  <p className="font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground">{f.note}</p>
                </div>
                <p className="text-xs">
                  {now ? (
                    <>
                      Now answering: <span className="font-semibold">{providerInfo(now.provider)?.label}</span> · {now.model}
                    </>
                  ) : (
                    <span className="text-destructive">No AI yet: staff messages go straight to the office, and Ask Xtend is off.</span>
                  )}
                </p>
                {usable.length > 0 && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`p-${f.id}`}>Service</Label>
                      <Select
                        id={`p-${f.id}`}
                        value={sel.provider}
                        onChange={(e) => {
                          const p = e.target.value as AiProvider
                          setFeature((x) => ({ ...x, [f.id]: { provider: p, model: providerInfo(p)!.defaultModel } }))
                        }}
                      >
                        {usable.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`m-${f.id}`}>Model</Label>
                      <Input
                        id={`m-${f.id}`}
                        value={sel.model}
                        onChange={(e) => setFeature((x) => ({ ...x, [f.id]: { ...x[f.id], model: e.target.value } }))}
                        placeholder={providerInfo(sel.provider)?.defaultModel}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Suggested: {providerInfo(sel.provider)?.defaultModel}. Any model name the service offers works.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void run(`f-${f.id}`, { action: 'set_feature', feature: f.id, ...sel })}
                      >
                        {busy === `f-${f.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void run(`f-${f.id}`, { action: 'test', provider: sel.provider, model: sel.model })}
                      >
                        Test
                      </Button>
                    </div>
                  </>
                )}
                {notes[`f-${f.id}`] && (
                  <p className={`text-xs ${notes[`f-${f.id}`]!.ok ? 'text-success' : 'text-destructive'}`}>{notes[`f-${f.id}`]!.text}</p>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel icon={KeyRound} title="Keys" note="Saving or removing a key asks for your password again. Photo checks and invoice reading use the Anthropic key.">
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const k = savedBy.get(p.id)
            const draft = drafts[p.id] ?? ''
            const problem = draft ? keyProblem(p.id, draft) : null
            return (
              <div key={p.id} className="space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.label}</p>
                    <a href={p.keysUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand underline">
                      Get a key <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {k ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> ••••{k.key_hint}
                    </Badge>
                  ) : p.id === 'anthropic' && serverAnthropic ? (
                    <Badge variant="outline">Set on the server</Badge>
                  ) : (
                    <Badge variant="outline">Not added</Badge>
                  )}
                </div>
                {k && <p className="text-[11px] text-muted-foreground">Saved {formatLagos(k.updated_at)}</p>}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!draft || problem) return
                    void run(p.id, { action: 'save_key', provider: p.id, key: draft }).then((ok) => {
                      if (ok) setDrafts((d) => ({ ...d, [p.id]: '' }))
                    })
                  }}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={k ? 'Paste a new key to replace it' : 'Paste the key'}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    aria-label={`${p.label} key`}
                  />
                  <Button type="submit" size="sm" disabled={busy !== null || !draft || Boolean(problem)}>
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </form>
                {problem && <p className="text-xs text-destructive">{problem}</p>}
                {(k || (p.id === 'anthropic' && serverAnthropic)) && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run(p.id, { action: 'test', provider: p.id })}>
                      Test
                    </Button>
                    {k && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy !== null}
                        onClick={() => {
                          if (confirm(`Remove the ${p.label} key? Anything set to use it stops using it.`)) {
                            void run(p.id, { action: 'remove_key', provider: p.id })
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </Button>
                    )}
                  </div>
                )}
                {notes[p.id] && <p className={`text-xs ${notes[p.id]!.ok ? 'text-success' : 'text-destructive'}`}>{notes[p.id]!.text}</p>}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        icon={BookOpen}
        title="What the AI should know"
        note="The staff helper already knows the whole staff guide. Add what the guide does not say: who to call for what, office hours, pay and leave rules, store rules, the products. The staff helper and Ask Xtend read this with every question. Staff do not see this box, but the helper uses it to answer them, so write only what staff may be told."
      >
        {knowledge === null ? (
          <p className="rounded-xl bg-warning/15 p-3 text-sm">Run migration 0104 in Supabase to add notes for the AI.</p>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="ai-knowledge" className="sr-only">
              What the AI should know
            </Label>
            <Textarea
              id="ai-knowledge"
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              maxLength={KNOWLEDGE_MAX}
              rows={12}
              placeholder={'For example:\nFor pay questions, staff call Mrs Ade in HR on 0800 000 0000.\nThe office is open 8am to 5pm, Monday to Saturday.\nNew stores are added within one working day.'}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {notesText.length.toLocaleString('en-GB')} / {KNOWLEDGE_MAX.toLocaleString('en-GB')} characters
                {knowledge.updatedAt ? ` · last saved ${formatLagos(knowledge.updatedAt)}` : ''}
              </span>
              <Button
                size="sm"
                disabled={busy !== null || notesText.trim() === knowledge.body.trim()}
                onClick={() => void run('knowledge', { action: 'set_knowledge', body: notesText })}
              >
                {busy === 'knowledge' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
              </Button>
            </div>
            {notes.knowledge && (
              <p className={`text-sm ${notes.knowledge.ok ? 'text-success' : 'text-destructive'}`}>{notes.knowledge.text}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Do not paste passwords, keys or anything private: the AI service reads this text.
            </p>
          </div>
        )}
      </Panel>
    </div>
  )
}
