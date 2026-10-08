'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, Loader2, MapPinPlus, Store, UserRound } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CameraCapture } from '@/components/field/camera-capture'
import { GeoBlocked, bestFix, combineFixes, fixesAgree, haversineMetres, type SampledFix } from '@/lib/geo'
import { processReportPhoto } from '@/lib/image'
import { supabase } from '@/lib/supabase/client'
import { checkPhoto, flushOutbox } from '@/lib/offline/sync'
import { thingName } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'
import { cn } from '@/lib/utils'

const NAME = thingName(120, 'name on the store sign')

export interface PlaceDue {
  id: string
  lat: number
  lng: number
  source_kind: 'clock_in' | 'visit'
}

/**
 * Shown on every screen after a clock-in or store check-in at a spot Xtend
 * could not recognise (migration 045), until the place is named. There is
 * no "not now": other work waits until it is done. Clocking out does not.
 *
 * Naming takes two live photos from the in-app camera, never from the
 * gallery: the store sign from outside, then a selfie holding one of our
 * products. The position saved is the phone's GPS fix, read by the app
 * when the first photo is taken. Next time anyone stands there, Xtend
 * recognises the place.
 */
export function NamePlace({ due }: { due: PlaceDue }) {
  const router = useRouter()
  const [name, setName] = useState('')
  // Where the phone was when naming began, then at each photo's shutter.
  const [fix, setFix] = useState<SampledFix | null>(null)
  const [signAt, setSignAt] = useState<SampledFix | null>(null)
  const [selfieAt, setSelfieAt] = useState<SampledFix | null>(null)
  const [front, setFront] = useState<Blob | null>(null)
  const [selfie, setSelfie] = useState<Blob | null>(null)
  const [camera, setCamera] = useState<'front' | 'selfie' | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const nameProblem = name.trim() ? problemWith(NAME, name) : 'Type the name on the store sign.'

  async function takeFront() {
    setError(null)
    setStep('Locking your location')
    try {
      // The place is saved where the phone is, so take time to get it right:
      // several readings, aiming for 15 m, combined.
      setFix(await bestFix({ targetAccuracyM: 15, minSamples: 3, settleMs: 15000, timeoutMs: 30000 }))
      setFront(null)
      setSignAt(null)
      // The selfie is checked against the sign's position: take it again too.
      setSelfie(null)
      setSelfieAt(null)
      setCamera('front')
    } catch (e) {
      setError(e instanceof GeoBlocked ? e.message : 'Your location could not be read. Turn on location and try again.')
    } finally {
      setStep(null)
    }
  }

  async function upload(photo: Blob, label: string, kind: 'storefront' | 'product_selfie') {
    const client = supabase()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) throw new Error('You are signed out. Sign in and try again.')
    const path = `${user.id}/place-${label}-${crypto.randomUUID()}.jpg`
    const { error: upErr } = await client.storage
      .from('reports')
      .upload(path, await processReportPhoto(photo), { contentType: 'image/jpeg' })
    if (upErr) throw new Error(upErr.message)
    try {
      await checkPhoto('reports', path, null, kind)
    } catch (e) {
      // That photo will not do: take it again.
      if (kind === 'storefront') setFront(null)
      else setSelfie(null)
      throw e
    }
    return path
  }

  /** The place's position: the first fix and the sign photo's, combined. */
  function placePosition() {
    if (!fix) return null
    return signAt ? combineFixes([fix, signAt]) : fix
  }

  async function save() {
    const at = placePosition()
    if (!fix || !at || !front || !selfie || nameProblem) return
    setError(null)
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('You need signal to name the place. Your other work stays on the phone until then.')
      }
      setStep('Checking the photo of the sign')
      const storefront_path = await upload(front, 'sign', 'storefront')
      setStep('Checking the selfie')
      const selfie_path = await upload(selfie, 'selfie', 'product_selfie')
      setStep('Saving the place')
      const res = await fetch('/api/places/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          due_id: due.id,
          name,
          lat: at.lat,
          lng: at.lng,
          accuracy_m: at.accuracy_m,
          storefront_path,
          selfie_path,
          // Where the phone was at each step, for the server to check.
          evidence: {
            first: brief(fix),
            sign: signAt ? brief(signAt) : null,
            selfie: selfieAt ? brief(selfieAt) : null,
          },
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The place could not be saved.')
      setDone(true)
      // Anything kept on the phone while the place was waiting goes now.
      void flushOutbox().catch(() => undefined)
      router.refresh()
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'No connection. Your photos are still here; try again when you have signal.',
      )
    } finally {
      setStep(null)
    }
  }

  if (done) {
    return <Alert variant="success">Thank you. Xtend will recognise this place from now on.</Alert>
  }

  const busy = step !== null
  return (
    <section className="space-y-3 rounded-2xl border-2 border-brand bg-card p-4 shadow-lift">
      <div className="flex items-start gap-2">
        <MapPinPlus className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-bold">Add this place before you go on</p>
          <p className="text-xs text-muted-foreground">
            Xtend does not know where you {due.source_kind === 'visit' ? 'checked in' : 'clocked in'}. Add it once, standing
            outside, and Xtend will recognise it next time, for you and everyone else. Store visits, counts, sales and your
            report wait until it is done. You can still clock out.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        <li className="space-y-1.5">
          <p className="text-xs font-semibold">1. The name on the store or plaza sign</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ojota Shopping Plaza"
            maxLength={120}
            autoCapitalize="words"
            className="h-11"
            disabled={busy}
          />
        </li>
        <Step
          n={2}
          label="Photo of the building from outside, with the sign showing"
          doneLabel="Sign photo taken"
          icon={Store}
          taken={!!front}
          disabled={busy || !!nameProblem}
          onClick={() => void takeFront()}
        />
        <Step
          n={3}
          label="Selfie holding one of our products"
          doneLabel="Selfie taken"
          icon={UserRound}
          taken={!!selfie}
          disabled={busy || !front}
          onClick={() => {
            setError(null)
            setCamera('selfie')
          }}
        />
      </ol>

      {fix && (
        <p className="text-xs text-muted-foreground">
          Location locked from {fix.used} of {fix.samples} GPS reading{fix.samples === 1 ? '' : 's'}, accurate to about{' '}
          {Math.round(placePosition()?.accuracy_m ?? fix.accuracy_m)} m
          {signAt ? '; the photo of the sign was taken at the same spot' : ''}.
        </p>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="button" className="w-full" disabled={busy || !fix || !front || !selfie || !!nameProblem} onClick={() => void save()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {step ? `${step}…` : 'Save this place'}
      </Button>

      <CameraCapture
        open={camera === 'front'}
        facing="environment"
        title="The building and its sign"
        subtitle="Stand outside so the sign is in the photo"
        locate
        onCapture={(photo, at) => {
          setCamera(null)
          // The camera's own reading must agree with the one taken first;
          // if the position jumped, neither can be trusted.
          if (fix && at) {
            const { apart, agree } = fixesAgree(fix, at)
            if (!agree) {
              setError(
                `Your location jumped ${Math.round(apart)} m while you took the photo. Stand still outside, wait a moment, and take it again.`,
              )
              return
            }
          }
          setSignAt(at)
          setFront(photo)
        }}
        onClose={() => setCamera(null)}
      />
      <CameraCapture
        open={camera === 'selfie'}
        facing="user"
        title="Selfie with our product"
        subtitle="Hold the product up next to your face"
        locate
        onCapture={(photo, at) => {
          setCamera(null)
          const place = placePosition()
          if (place && at && haversineMetres(place.lat, place.lng, at.lat, at.lng) > Math.max(100, place.accuracy_m + at.accuracy_m)) {
            setError('Take the selfie at the place, next to the sign.')
            return
          }
          setSelfieAt(at)
          setSelfie(photo)
        }}
        onClose={() => setCamera(null)}
      />
    </section>
  )
}

function Step({
  n,
  label,
  doneLabel,
  icon: Icon,
  taken,
  disabled,
  onClick,
}: {
  n: number
  label: string
  doneLabel: string
  icon: typeof Camera
  taken: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <li className="space-y-1.5">
      <p className="text-xs font-semibold">
        {n}. {label}
      </p>
      <Button
        type="button"
        variant={taken ? 'secondary' : 'outline'}
        className={cn('w-full justify-start', taken && 'text-success')}
        disabled={disabled}
        onClick={onClick}
      >
        {taken ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        {taken ? `${doneLabel} (tap to retake)` : 'Open the camera'}
      </Button>
    </li>
  )
}

function brief(f: SampledFix) {
  return { lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m, captured_at: f.captured_at, samples: f.samples }
}
