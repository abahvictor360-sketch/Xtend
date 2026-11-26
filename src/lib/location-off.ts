import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'
import { formatLagos, lagosDateString } from '@/lib/utils'
import { locationOffAlert } from '@/lib/location-off-words'

interface Claimed {
  spell_id: string
  user_id: string
  started_at: string
  last_lat: number | null
  last_lng: number | null
  last_place: string | null
  last_fix_at: string | null
}

/**
 * The five-minute job's part for location turned off during a shift
 * (migration 0115): anyone whose phone has had location off for the
 * office's minutes (15 unless changed) while still clocked in. Their
 * supervisor and the admins are told once per spell. Never throws.
 */
export async function flushLocationOffAlerts(now = new Date()): Promise<{ claimed: number; delivered: number }> {
  try {
    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('claim_location_off_alerts')
    if (error) {
      // Before 0115 the function does not exist: nothing to send.
      if (!/claim_location_off_alerts/.test(error.message)) console.error('claim_location_off_alerts failed', error.message)
      return { claimed: 0, delivered: 0 }
    }
    const rows = (data ?? []) as Claimed[]
    if (!rows.length) return { claimed: 0, delivered: 0 }
    const { data: people } = await admin.from('profiles').select('id, full_name').in('id', [...new Set(rows.map((r) => r.user_id))])
    const names = new Map(((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
    let delivered = 0
    for (const r of rows) {
      const words = locationOffAlert({
        name: names.get(r.user_id) ?? 'Someone',
        since: formatLagos(r.started_at, false),
        minutes: Math.max(1, Math.round((now.getTime() - Date.parse(r.started_at)) / 60000)),
        lastPlace: r.last_place,
        lastAt: r.last_fix_at ? formatLagos(r.last_fix_at, false) : null,
      })
      const sent = await notifyWatchers({
        subjectId: r.user_id,
        ...words,
        url: `/admin/tracking?person=${r.user_id}&date=${lagosDateString(new Date(r.started_at))}`,
        detail: { kind: 'location_off', spell_id: r.spell_id, last_lat: r.last_lat, last_lng: r.last_lng },
      })
      delivered += sent.delivered
    }
    return { claimed: rows.length, delivered }
  } catch (error) {
    console.error('location off alerts failed', error)
    return { claimed: 0, delivered: 0 }
  }
}
