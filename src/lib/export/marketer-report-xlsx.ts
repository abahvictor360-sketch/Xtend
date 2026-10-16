/**
 * The marketer's day or month report as an Excel workbook: a Summary sheet
 * (the person, the tiles, the summary), then one sheet each for the days,
 * the store visits, the stores, the daily reports, and stock and sales.
 */
import { minutesText, type MarketerReport } from '@/lib/marketer-report'
import { XPEL_LOGO_PNG, XPEL_LOGO_RATIO } from '@/lib/export/brand-logo'

const BRAND = 'FFD1511A'
const DEEP = 'FF9B3517'
const DARK = 'FF52281A'
const TRACK = 'FFF6E4D8'
const STRIPE = 'FFFCF3ED'
const MUTED = 'FF7C6C63'

export async function marketerReportXlsx(report: MarketerReport): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default
  type Sheet = ReturnType<InstanceType<typeof ExcelJS.Workbook>['addWorksheet']>
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Xtend'
  wb.created = new Date()
  wb.title = `${report.person.name} — ${report.kindLabel}, ${report.periodLabel}`

  /* ---------------- Summary ---------------- */
  const s = wb.addWorksheet('Summary', { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 } })
  s.getColumn(1).width = 26
  s.getColumn(2).width = 22
  s.getColumn(3).width = 26
  s.getColumn(4).width = 22
  const logo = wb.addImage({ buffer: Buffer.from(XPEL_LOGO_PNG) as unknown as ArrayBuffer, extension: 'png' })
  s.addImage(logo, { tl: { col: 3.2, row: 0.2 }, ext: { width: Math.round(56 * XPEL_LOGO_RATIO), height: 56 } })
  s.getRow(1).height = 24
  s.getCell('A1').value = 'MARKETER REPORT'
  s.getCell('A1').font = { bold: true, size: 10, color: { argb: BRAND } }
  s.getCell('A2').value = report.periodLabel
  s.getCell('A2').font = { bold: true, size: 18, color: { argb: DARK } }
  s.getRow(2).height = 28
  s.getCell('A3').value = `${report.kindLabel} · Lagos time · generated ${report.generatedLabel}`
  s.getCell('A3').font = { size: 9, color: { argb: MUTED } }

  const info: [string, string][] = [
    ['Name', report.person.name],
    ['Role', report.person.role],
    ['Supervisor', report.person.supervisor ?? 'No supervisor'],
    ['Home store', report.person.homeStore ?? '—'],
    ['Period', report.kind === 'day' ? report.from : `${report.from} to ${report.to}`],
  ]
  let row = 5
  for (const [k, v] of info) {
    s.getCell(row, 1).value = k
    s.getCell(row, 1).font = { bold: true, color: { argb: MUTED } }
    s.getCell(row, 2).value = v
    s.getCell(row, 2).font = { bold: k === 'Name', size: k === 'Name' ? 12 : 11, color: { argb: DARK } }
    s.mergeCells(row, 2, row, 4)
    row++
  }

  row++
  s.getCell(row, 1).value = 'Summary'
  s.getCell(row, 1).font = { bold: true, size: 13, color: { argb: BRAND } }
  row++
  // Tiles, two to a row: label then value.
  report.tiles.forEach((t, i) => {
    const r = row + Math.floor(i / 2)
    const c = (i % 2) * 2 + 1
    const label = s.getCell(r, c)
    const value = s.getCell(r, c + 1)
    label.value = t.label
    label.font = { bold: true, color: { argb: MUTED } }
    value.value = t.note ? `${t.value} ${t.note}` : t.value
    value.font = { bold: true, size: 12, color: { argb: DEEP } }
    for (const cell of [label, value]) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 4 < 2 ? STRIPE : 'FFFFFFFF' } }
      cell.border = { bottom: { style: 'thin', color: { argb: TRACK } } }
    }
  })
  row += Math.ceil(report.tiles.length / 2) + 1
  s.mergeCells(row, 1, row + 2, 4)
  const sum = s.getCell(row, 1)
  sum.value = report.summary
  sum.alignment = { wrapText: true, vertical: 'top' }
  sum.font = { size: 11, color: { argb: DARK } }
  sum.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TRACK } }
  s.getRow(row).height = 22

  /* ---------------- detail sheets ---------------- */
  const sheet = (name: string, cols: { header: string; width: number; wrap?: boolean }[], rows: (string | number | null)[][]) => {
    const ws: Sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = cols.map((c) => ({ header: c.header, width: c.width }))
    const head = ws.getRow(1)
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    head.height = 20
    head.alignment = { vertical: 'middle' }
    rows.forEach((r, i) => {
      const added = ws.addRow(r)
      added.alignment = { vertical: 'top' }
      cols.forEach((c, ci) => {
        if (c.wrap) added.getCell(ci + 1).alignment = { wrapText: true, vertical: 'top' }
      })
      if (i % 2 === 1) added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } }
    })
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
    return ws
  }

  sheet(
    'Days',
    [
      { header: 'Date', width: 12 },
      { header: 'Day', width: 12 },
      { header: 'Clock in', width: 10 },
      { header: 'Clock-in status', width: 30 },
      { header: 'Clock out', width: 16 },
      { header: 'Stores visited', width: 14 },
      { header: 'Visits', width: 9 },
      { header: 'Minutes in stores', width: 17 },
      { header: 'Time in stores', width: 15 },
      { header: 'Report filed', width: 12 },
      { header: 'Summary', width: 80, wrap: true },
    ],
    report.days.map((d) => [
      d.date,
      d.shortLabel.split(' ')[0],
      d.inText,
      d.clockIn?.statusText ?? '',
      d.outText,
      d.stores,
      d.visits.length,
      d.minutesInStores,
      d.visits.length ? minutesText(d.minutesInStores) : '',
      d.report ? 'Yes' : d.active ? 'No' : '',
      d.summary,
    ]),
  )

  sheet(
    'Store visits',
    [
      { header: 'Date', width: 12 },
      { header: '#', width: 5 },
      { header: 'Store', width: 32 },
      { header: 'Address', width: 40, wrap: true },
      { header: 'Checked in', width: 11 },
      { header: 'Checked out', width: 16 },
      { header: 'Minutes in store', width: 16 },
      { header: 'Arrived', width: 24 },
      { header: 'Minutes since the last store', width: 26 },
    ],
    report.days.flatMap((d) =>
      d.visits.map((v, i) => [d.date, i + 1, v.store, v.address ?? '', v.inTime, v.outTime, v.minutes, v.arrival, v.gapBefore]),
    ),
  )

  sheet(
    'Stores',
    [
      { header: 'Store', width: 34 },
      { header: 'Address', width: 42, wrap: true },
      { header: 'Visits', width: 9 },
      { header: 'Minutes in store', width: 16 },
      { header: 'Total time', width: 14 },
      { header: 'Last visit', width: 20 },
    ],
    report.stores.map((st) => [st.store, st.address ?? '', st.visits, st.minutes, st.minutesText, st.lastVisit]),
  )

  sheet(
    'Daily reports',
    [
      { header: 'Date', width: 12 },
      { header: 'Filed at', width: 9 },
      ...['How the day went', 'Sales', 'Stock status', 'Competitor activity', 'Issues for the office'].map((h) => ({ header: h, width: 40, wrap: true })),
    ],
    report.days.filter((d) => d.report).map((d) => [d.date, d.report!.filedAt, ...d.report!.fields.map((f) => (f.empty ? '' : f.text))]),
  )

  const stock = report.days.flatMap((d) => [
    ...d.counts.map((c) => [d.date, 'Stock count', c.store, c.product, c.inStore, c.sold]),
    ...d.sales.map((x) => [d.date, 'X Metrics sale', x.store, x.product, '', String(x.units)]),
  ])
  if (stock.length) {
    sheet(
      'Stock and sales',
      [
        { header: 'Date', width: 12 },
        { header: 'Kind', width: 16 },
        { header: 'Store', width: 32 },
        { header: 'Product', width: 40 },
        { header: 'In store', width: 10 },
        { header: 'Sold or units', width: 13 },
      ],
      stock,
    )
  }

  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)
}

