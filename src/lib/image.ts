'use client'

export const SELFIE_WIDTH = 640
export const SELFIE_MAX_BYTES = 150 * 1024
export const THUMB_SIZE = 200

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to the <img> path on older Android WebViews.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('That image could not be read.'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function draw(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  targetW: number,
  targetH: number,
  cover: boolean,
) {
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable on this device.')

  if (cover) {
    const scale = Math.max(targetW / sw, targetH / sh)
    const w = sw * scale
    const h = sh * scale
    ctx.drawImage(source, (targetW - w) / 2, (targetH - h) / 2, w, h)
  } else {
    ctx.drawImage(source, 0, 0, targetW, targetH)
  }
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))),
      'image/jpeg',
      quality,
    ),
  )
}

export interface ProcessedSelfie {
  full: Blob
  thumb: Blob
}

/**
 * 640px wide under a 150kb ceiling, plus a 200x200 thumbnail. Both are
 * produced on the handset: staff pay for their own data.
 */
export async function processSelfie(file: File): Promise<ProcessedSelfie> {
  const bitmap = await loadBitmap(file)
  const sw = 'width' in bitmap ? bitmap.width : 0
  const sh = 'height' in bitmap ? bitmap.height : 0
  if (!sw || !sh) throw new Error('That image could not be read.')

  const width = Math.min(SELFIE_WIDTH, sw)
  const height = Math.round((sh / sw) * width)

  const fullCanvas = draw(bitmap as CanvasImageSource, sw, sh, width, height, false)
  let quality = 0.82
  let full = await toBlob(fullCanvas, quality)
  while (full.size > SELFIE_MAX_BYTES && quality > 0.35) {
    quality -= 0.12
    full = await toBlob(fullCanvas, quality)
  }

  const thumbCanvas = draw(bitmap as CanvasImageSource, sw, sh, THUMB_SIZE, THUMB_SIZE, true)
  const thumb = await toBlob(thumbCanvas, 0.7)

  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close()
  return { full, thumb }
}

/** Report photos: same compression, a little wider. */
export async function processReportPhoto(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  const sw = 'width' in bitmap ? bitmap.width : 0
  const sh = 'height' in bitmap ? bitmap.height : 0
  if (!sw || !sh) throw new Error('That image could not be read.')

  const width = Math.min(900, sw)
  const height = Math.round((sh / sw) * width)
  const canvas = draw(bitmap as CanvasImageSource, sw, sh, width, height, false)

  let quality = 0.78
  let out = await toBlob(canvas, quality)
  while (out.size > 220 * 1024 && quality > 0.35) {
    quality -= 0.12
    out = await toBlob(canvas, quality)
  }
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close()
  return out
}
