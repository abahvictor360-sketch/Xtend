/**
 * Checks the marketer report (src/lib/marketer-report.ts): the period asked
 * for, visits and the time between stores, the day's summary, the month's
 * tiles and per-store table, the visits kept with a daily report, and that
 * the PDF, Word and Excel files come out valid.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-marketer-reports.ts [out-dir]
 *
 * With an out-dir, the sample files are written there to look at.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildMarketerReport,
  parseReportRequest,
  reportQuery,
  snapshotText,
  visitLines,
  visitTotals,
  type ReportSource,
  type SourceClock,
  type SourceSale,
  type SourceVisit,
} from '@/lib/marketer-report'
import { renderMarketerReport } from '@/lib/export/marketer-report'
import { addDays, lagosDateString } from '@/lib/utils'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

/** An ISO time for h:m Lagos on a date. */
const T = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h - 1, m)).toISOString()
}

/* ---------------- the period ---------------- */

const today = '2026-10-16'
const uid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
let r = parseReportRequest(new URLSearchParams({ user_id: uid }), today)
check(r.kind === 'day' && r.from === today && r.to === today && r.userId === uid, 'no period means today', r)
r = parseReportRequest(new URLSearchParams({ user_id: 'x; drop', period: 'day', date: '2026-10-20' }), today)
check(r.userId === null && r.from === today, 'a bad id is dropped and a future day becomes today', r)
r = parseReportRequest({ period: 'month', month: '2026-10' }, today)
check(r.from === '2026-10-01' && r.to === today, 'this month runs to today', r)
r = parseReportRequest({ period: 'month', month: '2026-02' }, today)
check(r.from === '2026-02-01' && r.to === '2026-02-28', 'a past month runs to its last day', r)
r = parseReportRequest({ period: 'month', month: '2026-12' }, today)
check(r.from === '2026-10-01', 'a future month becomes this month', r)
check(reportQuery(uid, 'month', '2026-09') === `user_id=${uid}&period=month&month=2026-09`, 'download links carry the period')

/* ---------------- sample data ---------------- */

const STORES = [
  { id: 'o1', name: 'Shoprite Ikeja City Mall', address: 'Obafemi Awolowo Way, Alausa, Ikeja' },
  { id: 'o2', name: 'Justrite Superstore Ogba', address: '15 Ogba Road, Ogba, Lagos' },
  { id: 'o3', name: 'Market Square Allen Avenue', address: '38 Allen Avenue, Ikeja' },
  { id: 'o4', name: 'Prince Ebeano Lekki', address: 'Admiralty Way, Lekki Phase 1' },
]

const visit = (date: string, store: (typeof STORES)[number] | null, inH: number, inM: number, mins: number, opts: Partial<SourceVisit> = {}): SourceVisit => ({
  outlet_id: store?.id ?? null,
  outlet_name: store?.name ?? null,
  outlet_address: store?.address ?? null,
  arrived_address: store ? null : '22 Ikorodu Road, Fadeyi, Lagos',
  store_label: store?.name ?? 'Mama Nkechi Provisions',
  visit_date: date,
  status: 'closed',
  arrived_at: T(date, inH, inM),
  departed_at: T(date, inH, inM + mins),
  minutes: mins,
  arrived_status: store ? 'on_site' : null,
  ...opts,
})

const clock = (date: string, type: 'opening' | 'closing', h: number, m: number, opts: Partial<SourceClock> = {}): SourceClock => ({
  attendance_date: date,
  type,
  created_at: T(date, h, m),
  local_time: `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  outlet_name: 'Shoprite Ikeja City Mall',
  shift_start: '08:00:00',
  status: 'on_site',
  is_late: type === 'opening' && h * 60 + m > 8 * 60 + 15,
  location_label: 'Shoprite, Obafemi Awolowo Way, Alausa, Ikeja',
  ...opts,
})

const events: SourceClock[] = []
const visits: SourceVisit[] = []
const reports: ReportSource['reports'] = []
const sales: SourceSale[] = []
for (let d = '2026-10-01'; d <= today; d = addDays(d, 1)) {
  const n = Number(d.slice(8))
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) continue // Sundays off
  if (n === 7) continue // a day away
  events.push(clock(d, 'opening', 8, n % 5 === 0 ? 34 : 2 + (n % 7)))
  if (n !== 9 && d !== today) events.push(clock(d, 'closing', 17, 20 + (n % 30)))
  visits.push(visit(d, STORES[0], 8, 20, 95))
  visits.push(visit(d, STORES[n % 2 ? 1 : 2], 10, 25 + (n % 3) * 5, 70 + n))
  if (n % 3 === 0) visits.push(visit(d, null, 13, 10, 25))
  if (n % 4 === 0) visits.push(visit(d, STORES[3], 14, 40, 55, { arrived_status: 'off_site' }))
  if (n !== 10)
    reports.push({
      report_date: d,
      created_at: T(d, 17, 5),
      updated_at: T(d, 17, 12),
      body: 'Footfall was steady from midday. The new serum display at the front of the store pulled a lot of questions, and two shoppers came back for the toner after trying the tester.',
      sales_summary: `Sold ${10 + n} units in all: Vitamin C serum (6), Hydrating toner (4), and the rest body lotion. Best seller was the serum.`,
      stock_status: n % 2 ? 'Serum running low at Ogba, about 8 left. Toner is fine.' : 'All lines on the shelf. Body lotion delivery arrived this morning.',
      competitor_activity: n % 2 ? 'Nivea has a buy two get one free on body lotion at the entrance.' : '',
      issues: n % 5 === 0 ? 'The shelf strip at Allen Avenue is broken and the price tags fall off. Please send a new one.' : '',
    })
}
// Today: still checked in at the second store.
visits.push(visit(today, STORES[1], 16, 0, 40, { status: 'open', departed_at: null }))
sales.push({ sale_date: today, outlet_name: STORES[0].name, product_name: 'Vitamin C Brightening Serum 30ml', units: 6 })
sales.push({ sale_date: today, outlet_name: STORES[0].name, product_name: 'Hydrating Rose Toner 200ml', units: 4 })

const person = { name: 'Chidinma Obi', role: 'Marketer', supervisor: 'Ngozi Eze', homeStore: 'Shoprite Ikeja City Mall' }
const counts: ReportSource['counts'] = [
  { count_date: '2026-10-12', outlet_name: STORES[1].name, product_name: 'Vitamin C Brightening Serum 30ml', in_store: 8, sold: 5 },
  { count_date: '2026-10-12', outlet_name: STORES[1].name, product_name: 'Hydrating Rose Toner 200ml', in_store: 14, sold: 3 },
]

const src = (kind: 'day' | 'month', from: string, to: string): ReportSource => ({
  kind,
  person,
  from,
  to,
  today,
  generatedAt: T(today, 18, 5),
  events,
  visits,
  reports,
  counts,
  sales,
})

/* ---------------- a day ---------------- */

const day = buildMarketerReport(src('day', '2026-10-12', '2026-10-12'))
const d = day.days[0]
check(day.days.length === 1 && d.date === '2026-10-12', 'a day report has one day')
check(d.visits.length === 4 && d.stores === 4, 'four visits to four stores (one a shop not on the list)', d.visits.map((v) => v.store))
check(d.visits[0].inTime === '08:20' && d.visits[0].outTime === '09:55' && d.visits[0].minutesText === '1 h 35 min', 'times are Lagos and minutes read as hours', d.visits[0])
check(d.visits[0].gapText === 'First store' && d.visits[1].gapBefore === 30 && d.visits[3].gapBefore === 65, 'the time between stores is from check-out to the next check-in', d.visits.map((v) => v.gapBefore))
check(d.visits[2].arrival === 'Shop not on the store list' && d.visits[3].arrival === 'Away from the store', 'arrival reads in words')
check(d.minutesInStores === 95 + 82 + 25 + 55, 'total time in stores adds up', d.minutesInStores)
check(d.clockIn?.statusText === 'On time, at the store' && d.clockOut?.time === '17:32', 'clock in and out are named', [d.clockIn, d.clockOut])
check(d.report?.fields.length === 5 && d.report.fields[3].empty === true && d.report.filedAt === '17:12', 'the daily report has every field', d.report)
check(d.counts.length === 2, 'stock counts of the day are listed')
check(/^Clocked in at 08:07, on time; visited 4 stores, 4 h 17 min in stores; filed the daily report; clocked out at 17:32\.$/.test(d.summary), 'the day reads in one sentence', d.summary)
check(day.tiles.find((t) => t.label === 'On-time clock-ins')?.value === '1 of 1', 'a day has its own tiles')
check(day.fileBase === 'xtend-report-chidinma-obi-2026-10-12', 'the file is named after the person and day', day.fileBase)

const now = buildMarketerReport(src('day', today, today)).days[0]
check(now.visits.at(-1)?.outTime === 'Still checked in' && now.outText === 'Still on shift', 'today: still checked in, still on shift', now.visits.at(-1))
check(now.sales.length === 2, 'X Metrics sales of the day are listed')
const away = buildMarketerReport(src('day', '2026-10-07', '2026-10-07')).days[0]
check(!away.active && away.summary.startsWith('Nothing recorded'), 'a day with nothing says so', away.summary)
const noOut = buildMarketerReport(src('day', '2026-10-09', '2026-10-09')).days[0]
check(noOut.missingOut && noOut.outText === 'Not clocked out' && noOut.summary.endsWith('did not clock out.'), 'a missing clock-out is called out', noOut.summary)
const late = buildMarketerReport(src('day', '2026-10-05', '2026-10-05')).days[0]
check(late.late && late.clockIn?.statusText === '34 min late, at the store', 'a late clock-in says by how much', late.clockIn)

/* ---------------- a month ---------------- */

const month = buildMarketerReport(src('month', '2026-10-01', '2026-10-31'))
check(month.days.length === 16 && month.days.at(-1)?.date === today, 'a month lists every day up to today', month.days.length)
check(month.totals.daysWorked === 13, 'days worked: every day with a clock-in or visit', month.totals.daysWorked)
check(month.totals.missingClockOuts === 1, 'one missing clock-out (today does not count)', month.totals.missingClockOuts)
check(month.totals.onTimeClockIns === 10 && month.totals.clockIns === 13, 'on-time clock-ins counted', month.totals)
check(month.totals.reportsFiled === 12, 'reports filed counted', month.totals.reportsFiled)
check(month.stores.length === 5 && month.stores[0].store === STORES[0].name && month.stores[0].visits === 13, 'per store: visits and total time, busiest first', month.stores.map((s) => [s.store, s.visits]))
const all = visitTotals(visits)
check(month.totals.visits === all.visits && month.totals.minutesInStores === all.minutes, 'month totals match the visits', [month.totals, all])
check(month.tiles.length === 8 && month.tiles[0].note === 'of 14 working days', 'eight tiles, days worked out of working days', month.tiles[0])
check(month.summary.startsWith('Worked 13 of 14 working days, visited 5 stores'), 'the month reads in one sentence', month.summary)
check(month.activeDays.length === 13, 'details for each day with something recorded')

/* ---------------- lines and snapshot ---------------- */

const lines = visitLines([visit(today, STORES[0], 9, 0, 30), visit(today, STORES[1], 9, 50, 20, { status: 'open', departed_at: null })], today)
check(lines[1].gapText === '20 min after the last store' && lines[1].outTime === 'Still checked in', 'the report form shows time between stores and an open visit', lines)
const snap = snapshotText([
  { store: 'Shoprite Ikeja', outlet_name: 'Shoprite Ikeja', address: null, arrived_at: T(today, 9, 0), departed_at: T(today, 9, 50), minutes: 50, status: 'closed', arrived_status: 'on_site' },
  { store: 'Ogba', outlet_name: 'Ogba', address: null, arrived_at: T(today, 10, 15), departed_at: null, minutes: 12, status: 'open', arrived_status: 'on_site' },
])
check(snap.count === 2 && snap.minutes === 62 && snap.text === 'Shoprite Ikeja 09:00–09:50 (50 min); Ogba 10:15–still in (12 min). Total 1 h 2 min.', 'the visits kept with a report read in one cell', snap)
check(snapshotText(null).text === 'No store visits', 'a report without visits says so')

/* ---------------- the files ---------------- */

async function files(outDir: string | null) {
  const magic = {
    pdf: (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-',
    docx: (b: Buffer) => b.subarray(0, 2).toString() === 'PK',
    xlsx: (b: Buffer) => b.subarray(0, 2).toString() === 'PK',
  }
  const empty = buildMarketerReport({ ...src('month', '2026-09-01', '2026-09-30'), events: [], visits: [], reports: [], counts: [], sales: [] })
  for (const [name, rep] of [['day', day], ['today', buildMarketerReport(src('day', today, today))], ['month', month], ['empty', empty]] as const) {
    for (const format of ['pdf', 'docx', 'xlsx'] as const) {
      const res = await renderMarketerReport(format, rep)
      const body = Buffer.from(await res.arrayBuffer())
      const disposition = res.headers.get('Content-Disposition') ?? ''
      check(magic[format](body) && body.length > 2000, `${name} ${format} is a real file (${body.length} bytes)`)
      check(disposition.includes(`${rep.fileBase}.${format}`), `${name} ${format} is named ${rep.fileBase}.${format}`, disposition)
      if (format === 'pdf') {
        const { PDFDocument } = await import('pdf-lib')
        const pdf = await PDFDocument.load(body)
        const pageCount = pdf.getPageCount()
        const size = pdf.getPage(0).getSize()
        check(Math.round(size.width) === 595 && Math.round(size.height) === 842, `${name} pdf is A4 portrait`, size)
        if (name === 'month') check(pageCount >= 3, `month pdf runs to several pages (${pageCount})`, pageCount)
      }
      if (outDir) writeFileSync(join(outDir, `sample-${name}.${format}`), body)
    }
  }
}

files(process.argv[2] ?? null)
  .then(() => {
    check(lagosDateString(new Date(T(today, 0, 30))) === today, 'the sample times are Lagos times')
    if (failed) {
      console.log(`\n${failed} check(s) FAILED`)
      process.exit(1)
    }
    console.log('\nALL MARKETER REPORT CHECKS PASSED')
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
