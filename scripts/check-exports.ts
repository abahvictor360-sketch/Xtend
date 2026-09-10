/**
 * Generates one of every export format from fabricated rows and checks the
 * bytes look like the file they claim to be. Run it after touching the
 * renderers; it needs no database.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-exports.ts
 */
import { renderExport, type Sheet } from '@/lib/export/render'
import { attendanceSheet, EXPORT_COLUMNS } from '@/lib/export/data'
import { visitSheet, VISIT_COLUMNS, type VisitExportRow } from '@/lib/export/visits'

const LABEL = 'Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos 23401, Lagos'

const visits: VisitExportRow[] = Array.from({ length: 60 }, (_, i) => ({
  id: String(i),
  staff_name: i % 2 ? 'Grace Nnadi' : 'Bala Yusuf',
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
  selfie_path: i % 3 === 0 ? null : `u/${i}.jpg`,
}))

const visitRows = visits.map((v, i) => ({
  link: i % 3 === 0 ? null : `https://example.test/s/${i}`,
  values: [
    v.staff_name,
    v.visit_date,
    v.outlet_name,
    '09:00',
    v.departed_at ? '10:12' : 'still there (open)',
    String(v.minutes),
    v.arrived_status ?? '—',
    `${v.arrived_distance_m} m`,
    v.departed_status ?? '—',
    `${v.departed_distance_m} m`,
    v.arrived_label ?? '—',
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
    v.outlet_name,
    LABEL,
    '16 m',
    '12 m',
    v.arrived_status ?? '—',
    'link',
  ],
}))

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
