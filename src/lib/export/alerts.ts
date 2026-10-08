import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sheet } from '@/lib/export/render'
import { ALERT_SHORT, ageText, alertLabel, byPerson, typeCounts, type AlertFilter } from '@/lib/alert-review'
import { addDays, formatLagos, metres } from '@/lib/utils'
import type { AlertDetail } from '@/lib/types'

/** Lagos midnight of a date, as an instant. */
const lagosStart = (d: string) => `${d}T00:00:00+01:00`

/**
 * Alerts matching the filter, newest first. RLS narrows them to a
 * supervisor's own team; nothing here needs to.
 */
export async function fetchAlerts(
  supabase: SupabaseClient,
  f: AlertFilter,
  limit = 500,
): Promise<{ alerts: AlertDetail[]; truncated: boolean }> {
  let query = supabase
    .from('alert_detail')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1)
  if (f.state !== 'all') query = query.eq('is_resolved', f.state === 'resolved')
  if (f.type) query = query.eq('alert_type', f.type)
  if (f.person) query = query.eq('user_id', f.person)
  if (f.from) query = query.gte('created_at', lagosStart(f.from))
  if (f.to) query = query.lt('created_at', lagosStart(addDays(f.to, 1)))
  if (f.store) {
    // alert_detail names the person's home store; match on it.
    const { data: outlet } = await supabase.from('outlets').select('name').eq('id', f.store).maybeSingle()
    if (!outlet) return { alerts: [], truncated: false }
    query = query.eq('outlet_name', outlet.name)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as AlertDetail[]
  return { alerts: rows.slice(0, limit), truncated: rows.length > limit }
}

export const ALERT_COLUMNS = [
  'Person',
  'Phone',
  'Home store',
  'What happened',
  'When',
  'Distance from the store',
  'Where',
  'Open or resolved',
  'How long',
  'Resolved by',
  'Note',
] as const

export function alertSheet(alerts: AlertDetail[], f: AlertFilter): Sheet {
  const counts = typeCounts(alerts)
  const people = byPerson(alerts)
  const open = alerts.filter((a) => !a.is_resolved).length
  const range = f.from || f.to ? `${f.from ?? 'the start'} to ${f.to ?? 'today'}` : 'all dates'
  const mix = (Object.keys(counts) as (keyof typeof counts)[])
    .filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${ALERT_SHORT[t].toLowerCase()}`)
    .join(', ')
  return {
    title: 'Xtend alerts',
    subtitle:
      `${alerts.length} alert(s), ${range} · ${open} still open · ${people.length} people` +
      `${mix ? ` · ${mix}` : ''}. Times are Africa/Lagos.`,
    notes: people.length
      ? `Most alerts:\n${people
          .slice(0, 10)
          .map((p) => `${p.name}: ${p.total} (${p.open} open) on ${p.days} day(s)`)
          .join('\n')}`
      : undefined,
    sheetName: 'Alerts',
    columns: ALERT_COLUMNS,
    rows: alerts.map((a) => ({
      values: [
        a.staff_name,
        a.staff_phone ?? '—',
        a.outlet_name ?? '—',
        alertLabel(a.alert_type),
        formatLagos(a.created_at),
        metres(a.distance_m),
        a.location_label ?? '—',
        a.is_resolved ? 'Resolved' : 'Open',
        ageText(a),
        a.is_resolved ? (a.resolved_by_name ?? 'an admin') : '—',
        a.note || '—',
      ],
    })),
    wrap: true,
    widths: {
      xlsx: [22, 16, 22, 34, 18, 14, 40, 12, 22, 20, 40],
      pdf: [70, 60, 70, 100, 62, 44, 110, 40, 66, 60, 112],
    },
    fileBase: 'xtend-alerts',
  }
}
