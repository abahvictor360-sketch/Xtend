'use client'

/**
 * A first, instant look at a frame before it leaves the phone: too dark,
 * washed out, covered, or badly blurred. The thresholds are lenient on
 * purpose; the server's check decides the hard cases (a photo of a screen
 * or of a printed photo), and an honest photo should never fail here.
 */
export interface FrameQuality {
  ok: boolean
  /** Shown to the person when not ok: what to do differently. */
  problem: string | null
  brightness: number
  contrast: number
  sharpness: number
}

const SAMPLE_WIDTH = 160

export function assessFrame(source: CanvasImageSource, width: number, height: number): FrameQuality {
  const w = SAMPLE_WIDTH
  const h = Math.max(1, Math.round((height / width) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { ok: true, problem: null, brightness: 0, contrast: 0, sharpness: 0 }
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const gray = new Float32Array(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gray[i] = v
    sum += v
  }
  const brightness = sum / (w * h)
  let varSum = 0
  for (let i = 0; i < w * h; i++) varSum += (gray[i] - brightness) ** 2
  const contrast = Math.sqrt(varSum / (w * h))

  // Variance of the Laplacian: low when the whole frame is soft.
  let lapSum = 0
  let lapSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      lapSum += lap
      lapSq += lap * lap
      n++
    }
  }
  const mean = n ? lapSum / n : 0
  const sharpness = n ? lapSq / n - mean * mean : 0

  const problem =
    brightness < 35
      ? 'The photo is too dark. Move to better light, or face the light, and try again.'
      : brightness > 235
        ? 'The photo is washed out. Move away from the direct light and try again.'
        : contrast < 10
          ? 'The camera sees almost nothing. Make sure nothing is covering it.'
          : sharpness < 12
            ? 'The photo is blurry. Hold the phone still and try again.'
            : null

  return { ok: problem === null, problem, brightness, contrast, sharpness }
}
