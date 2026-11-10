'use client'

/**
 * Saves a file the page built itself (a Blob). In a browser that is a
 * download link; inside the Android app, whose WebView cannot download a
 * blob, the app's window.XtendFiles bridge writes it to Downloads.
 */
interface XtendFilesBridge {
  save(base64: string, name: string, mimeType: string): boolean
}

function bridge(): XtendFilesBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { XtendFiles?: XtendFilesBridge }).XtendFiles
  return candidate && typeof candidate.save === 'function' ? candidate : null
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** Starts a download of a file the server serves at `url` (same site). */
export function downloadUrl(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** True once the file was handed over; false if the app could not save it. */
export async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  const app = bridge()
  if (app) return app.save(await toBase64(blob), name, blob.type || 'application/octet-stream')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
