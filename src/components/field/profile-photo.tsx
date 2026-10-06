'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { processSelfie } from '@/lib/image'
import { CameraCapture } from '@/components/field/camera-capture'
import { cn } from '@/lib/utils'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

/**
 * The person's profile photo, taken with the camera inside Xtend (no
 * gallery), so it is a current picture of them. Saved to their own folder
 * in the avatars bucket, then set with set_my_avatar (migration 037).
 */
export function ProfilePhoto({
  name,
  url,
  size = 'md',
  onSaved,
}: {
  name: string
  url: string | null
  size?: 'md' | 'lg'
  onSaved?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const shown = preview ?? url

  async function save(photo: Blob) {
    setOpen(false)
    setBusy(true)
    setError(null)
    try {
      const client = supabase()
      const { data: auth } = await client.auth.getUser()
      if (!auth.user) throw new Error('You are signed out. Sign in and try again.')
      const { full } = await processSelfie(photo)
      const path = `${auth.user.id}/${Date.now()}.jpg`
      const { error: upload } = await client.storage
        .from('avatars')
        .upload(path, full, { contentType: 'image/jpeg', upsert: false })
      if (upload) throw new Error('The photo could not be saved. Check your connection and try again.')
      const { error: set } = await client.rpc('set_my_avatar', { p_path: path })
      if (set) throw new Error('The photo could not be saved. Try again.')
      setPreview(URL.createObjectURL(full))
      onSaved?.()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const box = size === 'lg' ? 'h-32 w-32 text-3xl' : 'h-20 w-20 text-xl'

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          aria-label={shown ? 'Retake your profile photo' : 'Take your profile photo'}
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-tint font-bold text-tint-foreground ring-4 ring-card',
            box,
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(name)
          )}
        </button>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute flex items-center justify-center rounded-full bg-brand text-white ring-[3px] ring-card',
            size === 'lg' ? 'bottom-0.5 right-0.5 h-9 w-9' : '-bottom-1 -right-1 h-7 w-7',
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="rounded-full bg-card px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-tint"
      >
        {busy ? 'Saving…' : shown ? 'Retake photo' : 'Take your photo'}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <CameraCapture
        open={open}
        title="Your profile photo"
        subtitle="Face the camera in good light"
        onCapture={(photo) => void save(photo)}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
