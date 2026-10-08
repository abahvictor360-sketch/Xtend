'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Loader2, Pencil } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PolicyText } from '@/components/metrics/policy'
import { xmCall } from '@/components/admin/xm/widgets'

/** Writes the next version of the scoring policy, with a preview. */
export function PolicyEditor({ title: startTitle, body: startBody }: { title: string; body: string }) {
  const router = useRouter()
  const [title, setTitle] = useState(startTitle)
  const [body, setBody] = useState(startBody)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const unchanged = title.trim() === startTitle.trim() && body.trim() === startBody.trim()

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          await xmCall('/api/admin/metrics/policy', 'POST', { title, body, change_note: note })
          setNotice('Published. Staff see this version now and are asked to read it.')
          setNote('')
          router.refresh()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'It could not be published')
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="pol-title">Title</Label>
        <Input id="pol-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="pol-body">Policy and scoring guidelines</Label>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>
            {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {preview ? 'Edit' : 'Preview'}
          </Button>
        </div>
        {preview ? (
          <div className="rounded-2xl border border-border p-4">
            <PolicyText body={body} />
          </div>
        ) : (
          <Textarea
            id="pol-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            maxLength={20000}
            className="font-mono text-sm"
          />
        )}
        <p className="text-xs text-muted-foreground">
          Leave a blank line between paragraphs. Start a line with “- ” for a bullet point; a short line just before bullets
          becomes their heading. No links. The weights and bands are shown to staff automatically from Settings, so you do
          not need to repeat the numbers.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pol-note">What changed (optional)</Label>
        <Input id="pol-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Counts now due every Monday" />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <Button type="submit" disabled={busy || unchanged}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Publish new version
      </Button>
    </form>
  )
}
