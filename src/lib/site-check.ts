/**
 * Before "You are off site" is shown (0114): asks the server whether Google
 * puts the store where they stand (its pin may be wrong). False when it
 * cannot tell: offline, slow (8 s), or no Google answer.
 */
export async function googleSaysAtStore(
  storeId: string,
  fix: { lat: number; lng: number; accuracy_m: number | null },
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch('/api/site-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m }),
      signal: controller.signal,
    })
    if (!res.ok) return false
    return Boolean(((await res.json()) as { at_store?: boolean }).at_store)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
