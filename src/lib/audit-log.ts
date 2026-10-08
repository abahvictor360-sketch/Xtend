import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportRow, Sheet } from '@/lib/export/render'
import { formatLagos } from '@/lib/utils'

/**
 * The audit log as the Audit log page and its export read it: who did
 * what, where and on what device. Pure helpers are kept free of the
 * server so scripts/check-audit.ts can exercise them.
 */

export interface AuditDevice {
  type?: 'phone' | 'tablet' | 'computer'
  os?: string | null
  browser?: string | null
  app?: boolean
}

export interface AuditEntry {
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: string
  target_table: string | null
  target_id: string | null
  meta: Record<string, unknown> | null
  created_at: string
  ip: string | null
  user_agent: string | null
  device: AuditDevice | null
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  location_source: 'browser' | 'ip' | null
  place: string | null
  country: string | null
  vpn: boolean | null
}

export interface AuditFilter {
  person: string | null
  group: string | null
  from: string | null
  to: string | null
  q: string | null
  /** Only actions from a VPN, a new device or a new location. */
  flagged: boolean
}

/** The kinds of action, by the prefix of their name. */
export const ACTION_GROUPS: Record<string, string> = {
  user: 'Staff accounts',
  staff: 'Teams and stores',
  staff_role: 'Roles',
  outlet: 'Stores',
  place: 'Places',
  place_due: 'Places',
  store_count: 'Stock counts',
  role_store_counts: 'Stock counts',
  count_sheet: 'Stock counts',
  notification: 'Notifications',
  notification_template: 'Notifications',
  support: 'Support',
  support_reply: 'Support',
  alert: 'Alerts',
  export: 'Exports',
  xm: 'X Metrics',
}

const LABELS: Record<string, string> = {
  'user.create': 'Added a staff member',
  'user.update': 'Changed a staff member',
  'user.reset_password': 'Reset a password',
  'user.bulk_import': 'Imported staff',
  'staff.allocate_outlets': 'Allocated stores',
  'staff.assign_supervisor': 'Assigned a supervisor',
  'staff_role.create': 'Created a role',
  'staff_role.update': 'Changed a role',
  'outlet.create': 'Added a store',
  'outlet.update': 'Changed a store',
  'outlet.import': 'Imported stores',
  'place.update': 'Renamed a place',
  'place.delete': 'Deleted a place',
  'place.pin_store': 'Pinned a place to a store',
  'place.make_store': 'Made a place a store',
  'place_due.dismiss': 'Dismissed a place to name',
  'store_count.request': 'Requested a stock count',
  'role_store_counts.update': 'Changed stock count categories',
  'count_sheet.template': 'Downloaded a count sheet',
  'notification.send': 'Sent a notification',
  'notification.schedule': 'Scheduled a notification',
  'notification.cancel': 'Cancelled a scheduled notification',
  'notification_template.create': 'Saved a notification template',
  'notification_template.delete': 'Removed a notification template',
  'support.reply': 'Replied to a support issue',
  'support.close': 'Closed a support issue',
  'support.reopen': 'Reopened a support issue',
  'support.assign': 'Passed a support issue to someone',
  'support_reply.create': 'Saved a quick reply',
  'support_reply.delete': 'Removed a quick reply',
  'alert.resolve': 'Resolved an alert',
  'xm.sweep.run': 'Ran the X Metrics checks',
  'xm.store.enrol': 'Enrolled a store in X Metrics',
  'xm.store.remove': 'Removed a store from X Metrics',
  'xm.policy.publish': 'Published the scoring policy',
  'xm.expiry.acknowledge': 'Acknowledged an expiry alert',
  'xm.target.set': 'Set a sales target',
  'xm.settings.update': 'Changed X Metrics settings',
  'xm.product.create': 'Added a product',
  'xm.product.update': 'Changed a product',
  'xm.supply.log': 'Logged a supply',
  'xm.supply.import_read': 'Read a supply invoice',
  'xm.supply.import_log': 'Logged supplies from an invoice',
  'xm.grade.review': 'Reviewed a grade',
  'xm.grades.finalise': 'Finalised the grades',
}

export function actionGroup(action: string) {
  const prefix = action.split('.')[0]
  return ACTION_GROUPS[prefix] ?? 'Other'
}

/** "Exported visits (Excel)" and friends, for actions not listed by name. */
export function actionLabel(action: string) {
  if (LABELS[action]) return LABELS[action]
  const format = { xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' } as Record<string, string>
  const parts = action.split('.')
  if (parts[0] === 'export') {
    const fmt = format[parts[parts.length - 1]] ?? parts[parts.length - 1]
    const what = parts.length > 2 ? parts.slice(1, -1).join(' ').replace(/^xm_/, 'X Metrics ').replace(/_/g, ' ') : 'attendance'
    return `Exported ${what} (${fmt})`
  }
  if (parts[0] === 'xm' && parts[parts.length - 1] === 'void') return `Voided a ${parts[1].replace(/_/g, ' ')}`
  return action.replace(/[._]/g, ' ')
}

export function deviceLabel(d: AuditDevice | null) {
  if (!d) return null
  const kind = d.app ? 'Xtend app' : d.browser
  return [kind, d.os].filter(Boolean).join(' on ') || null
}

const deviceKey = (e: AuditEntry) =>
  e.device ? `${e.device.type}|${e.device.os?.split(' ')[0]}|${e.device.app ? 'app' : e.device.browser?.split(' ')[0]}` : null

/** Great-circle distance in km. */
export function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(h))
}

/** How far from all their earlier spots counts as somewhere new. */
export const NEW_PLACE_KM = 30

/**
 * Marks, for each entry, whether the person had not used that device
 * before, or had not been within NEW_PLACE_KM of that spot before, judged
 * against their older entries in `history` (newest first, as fetched).
 * A person's very first entry is never flagged: there is nothing to
 * compare it with.
 */
export function markNew(history: AuditEntry[]) {
  const seenDevice = new Map<string, Set<string>>()
  const seenSpots = new Map<string, { lat: number; lng: number }[]>()
  const result = new Map<string, { newDevice: boolean; newPlace: boolean }>()
  for (const e of [...history].reverse()) {
    const who = e.actor_id ?? 'system'
    const devices = seenDevice.get(who) ?? new Set<string>()
    const spots = seenSpots.get(who) ?? []
    const key = deviceKey(e)
    const newDevice = key != null && devices.size > 0 && !devices.has(key)
    // IP-based locations are too rough to call a new place by.
    const precise = e.lat != null && e.lng != null && e.location_source === 'browser'
    const newPlace = precise && spots.length > 0 && spots.every((s) => km(s.lat, s.lng, e.lat!, e.lng!) > NEW_PLACE_KM)
    if (key) devices.add(key)
    if (precise) spots.push({ lat: e.lat!, lng: e.lng! })
    seenDevice.set(who, devices)
    seenSpots.set(who, spots)
    result.set(e.id, { newDevice, newPlace })
  }
  return result
}

export function parseAuditFilter(params: URLSearchParams | Record<string, string | undefined>): AuditFilter {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k]
    return v && v !== 'all' ? v.slice(0, 120) : null
  }
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(get(k) ?? '') ? get(k) : null)
  const person = get('person')
  return {
    person: person && /^[0-9a-f-]{36}$/i.test(person) ? person : null,
    group: get('group'),
    from: date('from'),
    to: date('to'),
    q: get('q'),
    flagged: get('flagged') === '1',
  }
}

export function auditQueryString(f: AuditFilter) {
  const p = new URLSearchParams()
  if (f.person) p.set('person', f.person)
  if (f.group) p.set('group', f.group)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.q) p.set('q', f.q)
  if (f.flagged) p.set('flagged', '1')
  return p.toString()
}

/** Lagos midnight of a date, as an instant. */
const lagosStart = (d: string) => `${d}T00:00:00+01:00`

/**
 * The filtered entries, newest first, plus the flags. The flags need the
 * person's earlier entries too, so the history is fetched a little wider
 * than the filter and trimmed after.
 */
export async function fetchAudit(supabase: SupabaseClient, f: AuditFilter, limit = 500) {
  let query = supabase
    .from('audit_log_detail')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit * 3, 3000))
  if (f.person) query = query.eq('actor_id', f.person)
  if (f.to) query = query.lt('created_at', lagosStart(addDay(f.to)))

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const history = (data ?? []) as AuditEntry[]
  const flags = markNew(history)

  const prefixes = f.group && f.group !== 'Other'
    ? Object.entries(ACTION_GROUPS).filter(([, g]) => g === f.group).map(([p]) => p)
    : null
  const q = f.q?.toLowerCase()
  const since = f.from ? new Date(lagosStart(f.from)).getTime() : null
  const rows = history.filter((e) => {
    if (since != null && new Date(e.created_at).getTime() < since) return false
    if (prefixes && !prefixes.includes(e.action.split('.')[0])) return false
    if (f.group === 'Other' && actionGroup(e.action) !== 'Other') return false
    if (q) {
      const hay = [e.action, actionLabel(e.action), e.actor_name, e.target_table, e.place, e.ip, deviceLabel(e.device), JSON.stringify(e.meta ?? {})]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.flagged) {
      const fl = flags.get(e.id)
      if (!e.vpn && !fl?.newDevice && !fl?.newPlace) return false
    }
    return true
  })
  return { rows: rows.slice(0, limit), flags, truncated: rows.length > limit }
}

function addDay(d: string) {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

export function locationText(e: AuditEntry) {
  if (e.lat == null || e.lng == null) return e.country ? `Somewhere in ${e.country}` : 'Unknown'
  const where = e.place ?? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`
  return e.location_source === 'ip' ? `About ${where} (from IP)` : where
}

export function mapLink(e: AuditEntry) {
  return e.lat != null && e.lng != null ? `https://www.google.com/maps?q=${e.lat},${e.lng}` : null
}

const META_HIDE = new Set(['_context'])

/** The meta as "key: value" pairs, short enough for a cell. */
export function metaText(meta: Record<string, unknown> | null) {
  return Object.entries(meta ?? {})
    .filter(([k, v]) => !META_HIDE.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('; ')
}

export const AUDIT_COLUMNS = ['When', 'Who', 'Role', 'Action', 'Target', 'Location', 'Accuracy', 'Device', 'IP', 'VPN', 'Flags', 'Detail', 'Map'] as const

export function auditSheet(rows: AuditEntry[], flags: ReturnType<typeof markNew>, f: AuditFilter): Sheet {
  const exportRows: ExportRow[] = rows.map((e) => {
    const fl = flags.get(e.id)
    return {
      values: [
        formatLagos(e.created_at),
        e.actor_name ?? 'System',
        e.actor_role ?? '',
        actionLabel(e.action),
        e.target_table ?? '',
        locationText(e),
        e.accuracy_m != null ? (e.location_source === 'ip' ? '~25 km' : `±${Math.round(e.accuracy_m)} m`) : '',
        deviceLabel(e.device) ?? '',
        e.ip ?? '',
        e.vpn ? 'Yes' : e.vpn === false ? 'No' : '',
        [fl?.newDevice && 'New device', fl?.newPlace && 'New location'].filter(Boolean).join(', '),
        metaText(e.meta),
        mapLink(e) ? 'Open map' : '',
      ],
      link: mapLink(e),
    }
  })
  const range = f.from || f.to ? `${f.from ?? 'the start'} to ${f.to ?? 'today'}` : 'All dates'
  return {
    title: 'Audit log',
    subtitle: `${range} · ${rows.length} action${rows.length === 1 ? '' : 's'}`,
    notes:
      'Each action with who did it, where (from the browser when allowed, otherwise roughly from the IP address) and on what device. ' +
      '"New device" and "New location" mark the first time a person acted from that device or more than 30 km from anywhere they had before.',
    wrap: true,
    sheetName: 'Audit log',
    columns: AUDIT_COLUMNS,
    rows: exportRows,
    widths: {
      xlsx: [18, 20, 12, 30, 16, 32, 10, 26, 16, 6, 18, 50, 10],
      pdf: [60, 60, 40, 84, 46, 90, 36, 74, 60, 24, 48, 130, 38],
    },
    linkColumn: 12,
    linkText: 'Open map',
    noLinkText: '',
    fileBase: 'xtend-audit-log',
  }
}
