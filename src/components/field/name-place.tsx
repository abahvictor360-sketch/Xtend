'use client'

import { useState } from 'react'
import { Camera, MapPinPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CameraCapture } from '@/components/field/camera-capture'
import { processReportPhoto } from '@/lib/image'
import { supabase } from '@/lib/supabase/client'
import { checkPhoto } from '@/lib/offline/sync'
import { check } from '@/lib/validation'

/**
 * Shown after a clock-in or check-in at a spot no map could name. What the
 * person types is remembered, so everyone after them gets the name without
 * any map lookup. Staff are deliberately not told that: to them this is
 * just recording where they are.
 *
 * The name needs a live photo of the shop front or sign, which the server
 * checks: a house is refused, so nobody can name their home "Ikeja City
 * Mall". A name that copies a store elsewhere is refused by learn_place().
 */
export function NamePlace({ lat, lng }: { lat: number; lng: number }) {
  const [name, setName] = useState('')
  const [state, setState] = useState<'asking' | 'saving' | 'saved' | 'skipped'>('asking')
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [step, setStep] = useState<string | null>(null)

  if (state === 'skipped') return null
  if (state === 'saved') {
    return (
      <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">
        Saved. Thank you.
      </p>
    )
  }

  async function save(photo: Blob) {
    setCamera(false)
    setState('saving')
    setError(null)
    try {
      setStep('Uploading the photo')
      const client = supabase()
      const {
        data: { user },
      } = await client.auth.getUser()
      if (!user) throw new Error('You are signed out. Sign in and try again.')
      const photo_path = `${user.id}/place-${crypto.randomUUID()}.jpg`
      const upload = await client.storage
        .from('reports')
        .upload(photo_path, await processReportPhoto(photo), { contentType: 'image/jpeg' })
      if (upload.error) throw new Error(upload.error.message)

      // A house, or no place at all, is refused here.
      setStep('Checking the photo')
      await checkPhoto('reports', photo_path, null, 'storefront')

      setStep('Saving the name')
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, name, photo_path }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That name could not be saved.')
      setState('saved')
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'That name could not be saved. Check your connection and try again.',
      )
      setState('asking')
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="surface space-y-2 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <MapPinPlus className="h-4 w-4 text-brand" />
        What is the name of this shop?
      </p>
      <p className="text-xs text-muted-foreground">
        Type the name on the sign, then take a photo of the shop front or sign.
      </p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mama Nkechi Provisions"
          maxLength={120}
          autoCapitalize="words"
          className="h-10"
        />
        <Button
          size="sm"
          className="h-10"
          disabled={state === 'saving' || name.trim().length < 2}
          onClick={() => {
            // The name is checked before the photo, so nobody takes it twice.
            const problem = check.placeName(name)
            setError(problem)
            if (!problem) setCamera(true)
          }}
        >
          <Camera className="h-4 w-4" />
          Photo and save
        </Button>
      </div>
      {step && <p className="text-xs text-muted-foreground">{step}…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => setState('skipped')}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Not now
      </button>
      <CameraCapture
        open={camera}
        facing="environment"
        title="Photo of the place"
        subtitle="The shop front, sign or entrance"
        onCapture={(photo) => void save(photo)}
        onClose={() => setCamera(false)}
      />
    </div>
  )
}
