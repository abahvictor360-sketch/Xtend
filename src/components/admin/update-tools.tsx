'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** Publishing "What's new", with an optional required update or lowest app build. */
export function PublishUpdate({ androidLatest }: { androidLatest: number | null }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [audience, setAudience] = useState<'everyone' | 'field' | 'office'>('everyone')
  const [required, setRequired] = useState(false)
  const [minAndroid, setMinAndroid] = useState('')
  const [minIos, setMinIos] = useState('')
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const num = (v: string) => (v.trim() ? Math.max(1, Math.round(Number(v))) || null : null)

  async function publish(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          notes,
          audience,
          required,
          min_android_build: num(minAndroid),
          min_ios_build: num(minIos),
          notify,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; notified?: number }
      if (!res.ok) throw new Error(json.error ?? 'It could not be published.')
      setMessage({
        ok: true,
        text: `Published.${notify ? ` Sent to ${json.notified ?? 0} phone${json.notified === 1 ? '' : 's'}.` : ''} People see it the next time Xtend opens or comes back to the screen.`,
      })
      setTitle('')
      setNotes('')
      setRequired(false)
      setMinAndroid('')
      setMinIos('')
      setNotify(false)
      router.refresh()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'It could not be published.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={publish} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="u-title">Title</Label>
        <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Location now works with the app closed" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u-notes">What changed (shown once to each person)</Label>
        <Textarea id="u-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={3000} rows={5} placeholder={'Write it for the people using it, one point per line:\n- Clock-in is faster\n- You can pick your profile photo from the gallery'} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor="u-aud">Who sees it</Label>
          <Select id="u-aud" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className="h-10 text-sm">
            <option value="everyone">Everyone</option>
            <option value="field">Field staff</option>
            <option value="office">Office (admins and supervisors)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="u-and">Lowest Android app allowed</Label>
          <Input id="u-and" inputMode="numeric" value={minAndroid} onChange={(e) => setMinAndroid(e.target.value.replace(/\D/g, ''))} placeholder={androidLatest ? `e.g. ${androidLatest}` : 'Build number'} className="h-10 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="u-ios">Lowest iPhone app allowed</Label>
          <Input id="u-ios" inputMode="numeric" value={minIos} onChange={(e) => setMinIos(e.target.value.replace(/\D/g, ''))} placeholder="Build number" className="h-10 w-40" />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--brand))]" />
        <span>
          <span className="font-medium">Required:</span> anyone still on an older version must update before they can carry on.
          Use it when the old version would record something wrong.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--brand))]" />
        <span>Also send it to their phones as a notification.</span>
      </label>
      {(minAndroid || minIos) && (
        <p className="rounded-lg bg-warning/10 p-2 text-xs">
          Anyone on an older phone app will be asked to install the new one before carrying on. Only set this when the new app
          is already on the download page.
        </p>
      )}
      {message && <p className={`text-sm ${message.ok ? 'text-success' : 'text-destructive'}`}>{message.text}</p>}
      <Button type="submit" disabled={busy || !title.trim()}>
        <Megaphone className="h-4 w-4" />
        {busy ? 'Publishing…' : 'Publish'}
      </Button>
    </form>
  )
}

export function WithdrawRelease({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Withdraw this? Its notes stop showing and any lowest app build it set no longer applies.')) return
        setBusy(true)
        await fetch(`/api/admin/updates/${id}`, { method: 'DELETE' }).catch(() => {})
        setBusy(false)
        router.refresh()
      }}
    >
      Withdraw
    </Button>
  )
}

export function RemindToUpdate({ userIds }: { userIds: string[] }) {
  const [state, setState] = useState<'ready' | 'sending' | string>('ready')
  if (!userIds.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={state === 'sending'}
        onClick={async () => {
          setState('sending')
          const res = await fetch('/api/admin/updates/remind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds }),
          }).catch(() => null)
          const json = (await res?.json().catch(() => ({}))) as { error?: string; recipients?: number; delivered?: number } | undefined
          setState(res?.ok ? `Sent to ${json?.delivered ?? json?.recipients ?? 0} phone(s).` : (json?.error ?? 'Could not send.'))
        }}
      >
        <Bell className="h-4 w-4" />
        {state === 'sending' ? 'Sending…' : `Remind ${userIds.length} to update`}
      </Button>
      {state !== 'ready' && state !== 'sending' && <span className="text-xs text-muted-foreground">{state}</span>}
    </div>
  )
}
