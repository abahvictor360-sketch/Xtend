import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The location routes' side of follow live (migration 0070), with the
 * service-role client. Both answer null when nobody follows the person,
 * and also when 0070 has not been run yet: the phone then simply carries
 * on at its normal pace.
 */
export async function liveInterval(admin: SupabaseClient, userId: string): Promise<number | null> {
  const { data, error } = await admin.rpc('follow_interval_for', { p_user: userId })
  if (error) return null
  return typeof data === 'number' ? data : null
}

export interface LivePosition {
  lat: number
  lng: number
  accuracy_m: number
  heading: number | null
  speed_mps: number | null
  captured_at: string | null
  is_mock: boolean
}

/** Sends one fast position to whoever follows; never stored as a ping. */
export async function sendLivePosition(admin: SupabaseClient, userId: string, p: LivePosition): Promise<number | null> {
  const { data, error } = await admin.rpc('follow_live_position_for', {
    p_user: userId,
    p_lat: p.lat,
    p_lng: p.lng,
    p_accuracy_m: p.accuracy_m,
    p_heading: p.heading,
    p_speed_mps: p.speed_mps,
    p_captured_at: p.captured_at,
    p_is_mock: p.is_mock,
  })
  if (error) return null
  return typeof data === 'number' ? data : null
}
