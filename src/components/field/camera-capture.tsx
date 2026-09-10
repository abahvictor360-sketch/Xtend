'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, MapPin, RefreshCw, SwitchCamera, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Facing = 'user' | 'environment'

/**
 * In-app camera. The selfie is taken here, from a live stream, and never
 * chosen from the gallery: there is deliberately no file input anywhere in
 * this flow, so a saved photo cannot be submitted as a clock-in.
 */
export function CameraCapture({
  open,
  title,
  subtitle,
  onCapture,
  onClose,
}: {
  open: boolean
  title: string
  /** Where the location was read as, shown so it can be checked before the shot. */
  subtitle?: string | null
  onCapture: (photo: Blob) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<Facing>('user')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setReady(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setReady(false)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot open the camera. Use Chrome on your phone.')
      return
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      stream.current = media
      if (video.current) {
        video.current.srcObject = media
        await video.current.play().catch(() => {})
      }
      setReady(true)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission is off. Allow the camera for this site, then try again.'
          : name === 'NotFoundError'
            ? 'No camera found on this device.'
            : 'The camera could not start. Close other apps using it and try again.',
      )
    }
  }, [facing])

  useEffect(() => {
    if (!open) {
      stop()
      return
    }
    void start()
    return stop
  }, [open, start, stop])

  // Freeze the current frame and hand it back as a JPEG.
  const shoot = useCallback(() => {
    const el = video.current
    if (!el || !ready) return

    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = el.videoWidth
      canvas.height = el.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')

      // The preview is mirrored for the front camera; the saved frame is not,
      // so the admin sees the face the right way round.
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          setBusy(false)
          if (!blob) {
            setError('That frame could not be saved. Try again.')
            return
          }
          stop()
          onCapture(blob)
        },
        'image/jpeg',
        0.92,
      )
    } catch {
      setBusy(false)
      setError('That frame could not be saved. Try again.')
    }
  }, [onCapture, ready, stop])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true">
      <div className="safe-top flex items-center justify-between px-4 py-3 text-white">
        <button type="button" aria-label="Cancel" onClick={onClose} className="rounded-xl bg-white/15 p-2">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 px-2 text-center">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && (
            <p className="flex items-center justify-center gap-1 truncate text-[11px] text-white/70">
              <MapPin className="h-3 w-3 shrink-0" />
              {subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Switch camera"
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
          className="rounded-xl bg-white/15 p-2"
        >
          <SwitchCamera className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />

        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting the camera…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-8 text-center">
            <p className="text-sm text-white">{error}</p>
            <Button onClick={() => void start()} variant="onBrand">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        )}
      </div>

      <div className="safe-bottom flex items-center justify-center bg-black px-6 pb-6 pt-5">
        <button
          type="button"
          aria-label="Take the photo"
          disabled={!ready || busy}
          onClick={shoot}
          className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/70 bg-white/10 transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white">
            <Camera className="h-6 w-6 text-black" />
          </span>
        </button>
      </div>

      <p className="safe-bottom bg-black pb-4 text-center text-[11px] text-white/60">
        Taken live in the app. Photos from your gallery cannot be used.
      </p>
    </div>
  )
}
