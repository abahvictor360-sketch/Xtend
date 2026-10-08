/**
 * Generates one of every export format from fabricated rows and checks the
 * bytes look like the file they claim to be. Run it after touching the
 * renderers; it needs no database.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-exports.ts
 */
import { renderExport, type Sheet } from '@/lib/export/render'
import { attendanceSheet, EXPORT_COLUMNS } from '@/lib/export/data'
import { coverageSheet, visitSheet, COVERAGE_COLUMNS, VISIT_COLUMNS, type VisitExportRow } from '@/lib/export/visits'
import { alertSheet, ALERT_COLUMNS } from '@/lib/export/alerts'
import { parseAlertFilter } from '@/lib/alert-review'
import { coverage } from '@/lib/visit-review'
import type { AlertDetail } from '@/lib/types'

const LABEL = 'Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos 23401, Lagos'

const visits: VisitExportRow[] = Array.from({ length: 60 }, (_, i) => ({
  id: String(i),
  user_id: i % 2 ? 'grace' : 'bala',
  staff_name: i % 2 ? 'Grace Nnadi' : 'Bala Yusuf',
  outlet_id: null,
  outlet_name: ['Ikeja City Mall', 'Wuse Market Kiosk', 'Port Harcourt Mall'][i % 3],
  outlet_address: 'Lagos',
  visit_date: '2026-09-10',
  status: i % 7 === 0 ? 'open' : 'closed',
  arrived_at: '2026-09-10T09:00:00Z',
  departed_at: i % 7 === 0 ? null : '2026-09-10T10:12:00Z',
  minutes: 72,
  arrived_status: i % 5 === 0 ? 'off_site' : 'on_site',
  departed_status: 'on_site',
  arrived_distance_m: i % 5 === 0 ? 901 : 16,
  departed_distance_m: 16,
  arrived_label: LABEL,
  store_label: i % 4 === 0 ? 'Justrite Superstore Bariga' : 'Ikeja City Mall',
  store_label_source: i % 4 === 0 ? 'map' : 'outlet',
  selfie_path: i % 3 === 0 ? null : `u/${i}.jpg`,
}))

const visitRows = visits.map((v, i) => ({
  link: i % 3 === 0 ? null : `https://example.test/s/${i}`,
  values: [
    v.staff_name,
    v.visit_date,
    v.store_label ?? v.outlet_name ?? '—',
    v.store_label_source === 'map' ? 'the map' : 'their own store record',
    v.outlet_name ?? '—',
    '09:00',
    v.departed_at ? '10:12' : 'still there (open)',
    String(v.minutes),
    v.arrived_status ?? '—',
    `${v.arrived_distance_m} m`,
    v.departed_status ?? '—',
    `${v.departed_distance_m} m`,
    v.arrived_label ?? '—',
    v.departed_at ? LABEL : '—',
    i % 5 === 0 ? 'Far from the store' : '—',
    i % 3 === 0 ? 'expired' : 'link',
  ],
}))

const attendanceRows = visits.map((v, i) => ({
  link: i % 3 === 0 ? null : `https://example.test/a/${i}`,
  values: [
    v.staff_name,
    v.visit_date,
    i % 2 ? 'opening' : 'closing',
    '09:00',
    v.outlet_name ?? '—',
    LABEL,
    '16 m',
    '12 m',
    v.arrived_status ?? '—',
    'link',
  ],
}))

const alerts: AlertDetail[] = Array.from({ length: 40 }, (_, i) => ({
  id: String(i),
  user_id: i % 3 ? 'grace' : 'bala',
  staff_name: i % 3 ? 'Grace Nnadi' : 'Bala Yusuf',
  staff_phone: '08030000000',
  outlet_name: 'Ikeja City Mall',
  place_name: null,
  address: null,
  lat: 6.6,
  lng: 3.35,
  location_label: LABEL,
  alert_type: (['left_geofence', 'low_accuracy', 'permission_denied', 'off_site_clock'] as const)[i % 4],
  distance_m: 420,
  is_resolved: i % 2 === 0,
  note: i % 2 === 0 ? 'Called her, she was at the back entrance' : null,
  created_at: '2026-09-10T09:00:00Z',
  resolved_at: i % 2 === 0 ? '2026-09-10T11:30:00Z' : null,
  resolved_by_name: i % 2 === 0 ? 'Ngozi Eze' : null,
  attendance_id: null,
}))

const stores = coverage(
  Array.from({ length: 30 }, (_, i) => ({
    outlet_id: String(i),
    name: `Store ${i}`,
    address: LABEL,
    lat: 6.6,
    lng: 3.35,
    is_active: true,
    staff_assigned: i % 3,
    last_visit_at: i % 4 ? '2026-09-0' + ((i % 9) + 1) + 'T09:00:00Z' : null,
    last_visit_date: i % 4 ? '2026-09-0' + ((i % 9) + 1) : null,
    last_visit_user_id: null,
    last_visit_by: i % 4 ? 'Grace Nnadi' : null,
    visits_30d: i,
  })),
  '2026-09-10',
  true,
)

/** The first bytes of each container, so a corrupt file is caught here. */
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  csv: (b) => b.subarray(0, 3).toString('hex') === 'efbbbf',
  xlsx: (b) => b.subarray(0, 2).toString() === 'PK',
  docx: (b) => b.subarray(0, 2).toString() === 'PK',
  pdf: (b) => b.subarray(0, 5).toString() === '%PDF-',
}

let failures = 0

function check(condition: boolean, label: string) {
  if (!condition) failures += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'}: ${label}`)
}

async function run(name: string, sheet: Sheet, columns: readonly string[]) {
  check(sheet.widths.xlsx.length === columns.length, `${name}: an Excel width per column`)
  check(sheet.widths.pdf.length === columns.length, `${name}: a PDF width per column`)
  check(
    sheet.rows.every((r) => r.values.length === columns.length),
    `${name}: every row has one value per column`,
  )

  for (const format of ['csv', 'xlsx', 'docx', 'pdf'] as const) {
    const res = await renderExport(format, sheet)
    const body = Buffer.from(await res.arrayBuffer())
    const disposition = res.headers.get('content-disposition') ?? ''
    check(body.length > 500, `${name}: ${format} is not empty (${body.length} bytes)`)
    check(MAGIC[format](body), `${name}: ${format} starts with the right signature`)
    check(disposition.includes(`.${format}"`), `${name}: ${format} downloads with that extension`)
  }
}

async function main() {
  await run('store visits', visitSheet(visits, visitRows), VISIT_COLUMNS)
  await run('attendance', attendanceSheet(attendanceRows), EXPORT_COLUMNS)
  await run('alerts', alertSheet(alerts, parseAlertFilter({ state: 'all' })), ALERT_COLUMNS)
  await run('store coverage', coverageSheet(stores, '2026-09-10'), COVERAGE_COLUMNS)

  try {
    await renderExport('exe', visitSheet(visits, visitRows))
    check(false, 'an unknown format is refused')
  } catch (error) {
    check((error as Error).message.includes('Unsupported'), 'an unknown format is refused')
  }

  console.log(failures === 0 ? '\nALL EXPORTS OK' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
