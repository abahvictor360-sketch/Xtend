import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { askGoogleAboutStore } from '@/lib/geocode'
import { googleAgrees, needsLookup, type GooglePoint } from '@/lib/store-check'
import { tooFar } from '@/lib/on-site'
import { haversineMetres } from '@/lib/geo'
import { notifyUsers } from '@/lib/notify'

/**
 * Before "You are off site" stands (migration 0114): where Google puts the
 * store. Looked up once and saved (store_google_spots), again when its name
 * or address changes or after 90 days (a week for an answer that did not
 * confirm it). The database decides whether it lets someone through; this
 * only fills in Google's answer. Never throws.
 */
export async function confirmedStoreSpot(storeId: string): Promise<GooglePoint | null> {
  try {
    const db = createAdminSupabase()
    const [{ data: store }, { data: saved }] = await Promise.all([
      db.from('outlets').select('id, name, address').eq('id', storeId).maybeSingle(),
      db
        .from('store_google_spots')
        .select('name_used, address_used, lat, lng, confirmed, looked_up_at')
        .eq('outlet_id', storeId)
        .maybeSingle(),
    ])
    const s = store as { id: string; name: string; address: string | null } | null
    if (!s) return null
    const row = saved as
      | { name_used: string; address_used: string; lat: number | null; lng: number | null; confirmed: boolean; looked_up_at: string }
      | null
    if (!needsLookup(row, s)) {
      return row?.confirmed && row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null
    }
    const address = (s.address ?? '').trim()
    if (!address) return null
    const answer = await askGoogleAboutStore(s.name, address)
    if (!answer) return null // No Google key, or the month's limit reached: nothing saved.
    const spot = googleAgrees(answer, address)
    const where = spot ?? answer.places ?? answer.geocode
    await db.rpc('save_store_google_spot', {
      p_outlet: s.id,
      p_name: s.name,
      p_address: address,
      p_lat: where?.lat ?? null,
      p_lng: where?.lng ?? null,
      p_confirmed: spot != null,
      p_detail: answer,
    })
    return spot
  } catch (error) {
    console.error('store Google check failed', error)
    return null
  }
}

/** Whether someone at this spot is inside the store's area around Google's spot. */
export async function googlePutsThemAtStore(
  storeId: string,
  fix: { lat: number; lng: number; accuracy_m: number | null },
  radius: number | null,
): Promise<boolean> {
  const spot = await confirmedStoreSpot(storeId)
  if (!spot) return false
  return !tooFar(haversineMetres(fix.lat, fix.lng, spot.lat, spot.lng), radius ?? 150, fix.accuracy_m)
}

/**
 * Tells the admins, at most once a day per store, that someone was let in
 * at Google's spot and the store's pin should be checked on Outlets.
 */
export async function tellOfficeToCheckPin(storeId: string): Promise<void> {
  try {
    const db = createAdminSupabase()
    const { data: due } = await db.rpc('claim_pin_check_notice', { p_outlet: storeId })
    if (!due) return
    const [{ data: store }, { data: admins }] = await Promise.all([
      db.from('outlets').select('name').eq('id', storeId).maybeSingle(),
      db.from('profiles').select('id').eq('role', 'admin').eq('is_active', true),
    ])
    const name = (store as { name?: string } | null)?.name ?? 'A store'
    await notifyUsers(
      ((admins ?? []) as { id: string }[]).map((a) => a.id),
      {
        title: `Check the pin for ${name}`.slice(0, 80),
        body: `Someone clocked in at ${name} where Google puts the store, far from its pin. Open Outlets and use Google's spot if the pin is wrong.`,
        url: '/admin/outlets',
        detail: { kind: 'store_pin_check', system: true, outlet_id: storeId },
      },
    )
  } catch (error) {
    console.error('pin check notice failed', error)
  }
}

/**
 * The database refused with "off site" (0106): true when Google's spot for
 * that store has someone at this fix inside its area, so the same insert
 * may be sent once more (the database then lets it through, 0114).
 */
export async function worthAskingGoogle(
  error: { hint?: string | null; details?: string | null },
  fix: { lat: number; lng: number; accuracy_m: number | null },
): Promise<string | null> {
  if (error.hint !== 'off_site') return null
  let store: string | null = null
  let radius: number | null = null
  try {
    const d = JSON.parse(error.details ?? '{}') as { store?: { id?: string }; radius_m?: number }
    store = d.store?.id ?? null
    radius = typeof d.radius_m === 'number' ? d.radius_m : null
  } catch {
    return null
  }
  if (!store) return null
  return (await googlePutsThemAtStore(store, fix, radius)) ? store : null
}
