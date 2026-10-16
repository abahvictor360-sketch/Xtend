/**
 * The marketer's day or month report as a Word document: the same content
 * and order as the PDF, in the brand colours, A4 portrait, with the logo,
 * a running header, and page numbers in the footer.
 */
import { minutesText as mins, type DayDetail, type MarketerReport } from '@/lib/marketer-report'
import { XPEL_LOGO_PNG, XPEL_LOGO_RATIO } from '@/lib/export/brand-logo'

const BRAND = 'D1511A'
const DEEP = '9B3517'
const DARK = '52281A'
const PEACH = 'F2B48A'
const TRACK = 'F6E4D8'
const STRIPE = 'FCF3ED'
const WASH = 'FDF8F4'
const MUTED = '7C6C63'

export async function marketerReportDocx(report: MarketerReport): Promise<Uint8Array> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TabStopType,
    TextRun,
    VerticalAlign,
    WidthType,
  } = await import('docx')

  // A4 in twentieths of a point, 18 mm margins.
  const PAGE_W = 11906
  const MARGIN = 1020
  const CW = PAGE_W - MARGIN * 2

  type Child = InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  const body: Child[] = []

  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const line = (color = PEACH, size = 4) => ({ style: BorderStyle.SINGLE, size, color })
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }

  const run = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean; allCaps?: boolean } = {}) =>
    new TextRun({ text, bold: o.bold, color: o.color, size: o.size ?? 18, italics: o.italics, allCaps: o.allCaps })
  const para = (
    children: InstanceType<typeof TextRun>[],
    o: { after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
  ) => new Paragraph({ children, alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0 } })

  const heading = (title: string, note?: string) =>
    body.push(
      new Paragraph({
        spacing: { before: 280, after: 120 },
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: PEACH, space: 3 } },
        tabStops: [{ type: TabStopType.RIGHT, position: CW }],
        children: [run(title, { bold: true, color: BRAND, size: 25 }), ...(note ? [run(`\t${note}`, { color: MUTED, size: 16 })] : [])],
      }),
    )

  const note = (text: string) => body.push(para([run(text, { italics: true, color: MUTED, size: 18 })], { after: 120 }))

  interface Col {
    label: string
    w: number
    right?: boolean
  }
  type CellIn = string | { text: string; sub?: string | null; bold?: boolean; color?: string }

  const table = (cols: Col[], rows: CellIn[][], opts: { size?: number; total?: CellIn[]; mute?: (i: number) => boolean } = {}) => {
    const size = opts.size ?? 17
    const sum = cols.reduce((s, c) => s + c.w, 0)
    const widths = cols.map((c) => Math.round((c.w / sum) * CW))
    const cell = (value: CellIn, i: number, fill: string | null, header: boolean, muted: boolean, total: boolean) => {
      const v = typeof value === 'string' ? { text: value } : value
      const children = [
        new Paragraph({
          alignment: cols[i].right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            run(v.text, {
              bold: header || total || v.bold,
              color: header ? 'FFFFFF' : (v.color ?? (muted ? MUTED : total ? DARK : '2B211C')),
              size: header ? size - 1 : size,
            }),
          ],
        }),
        ...(v.sub ? [new Paragraph({ children: [run(v.sub, { color: MUTED, size: size - 3 })] })] : []),
      ]
      return new TableCell({
        children,
        width: { size: widths[i], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
      })
    }
    body.push(
      new Table({
        width: { size: CW, type: WidthType.DXA },
        columnWidths: widths,
        borders: { top: none, left: none, right: none, insideVertical: none, bottom: line(PEACH, 8), insideHorizontal: line('F6E4D8', 2) },
        rows: [
          new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c.label, i, BRAND, true, false, false)) }),
          ...rows.map(
            (r, ri) =>
              new TableRow({
                cantSplit: true,
                children: r.map((v, i) => cell(v, i, ri % 2 === 1 ? STRIPE : null, false, Boolean(opts.mute?.(ri)), false)),
              }),
          ),
          ...(opts.total ? [new TableRow({ children: opts.total.map((v, i) => cell(v, i, TRACK, false, false, true)) })] : []),
        ],
      }),
    )
    body.push(para([], { after: 100 }))
  }

  const fields = (list: { label: string; text: string; empty: boolean }[], size = 18) => {
    const w = [2300, CW - 2300]
    body.push(
      new Table({
        width: { size: CW, type: WidthType.DXA },
        columnWidths: w,
        borders: { ...noBorders, insideHorizontal: line('FFFFFF', 4) },
        rows: list.map(
          (f, i) =>
            new TableRow({
              cantSplit: false,
              children: [
                new TableCell({
                  width: { size: w[0], type: WidthType.DXA },
                  margins: { top: 70, bottom: 70, left: 100, right: 100 },
                  shading: i % 2 === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: STRIPE } : undefined,
                  children: [para([run(f.label, { bold: true, color: DEEP, size })])],
                }),
                new TableCell({
                  width: { size: w[1], type: WidthType.DXA },
                  margins: { top: 70, bottom: 70, left: 100, right: 100 },
                  shading: i % 2 === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: STRIPE } : undefined,
                  children: f.text.split(/\r?\n/).map((t) => para([run(t, { size, italics: f.empty, color: f.empty ? MUTED : undefined })])),
                }),
              ],
            }),
        ),
      }),
    )
    body.push(para([], { after: 100 }))
  }

  const arrivalColour = (a: string) => (a === 'Away from the store' || a === 'Location unclear' ? DEEP : a === 'At the store' ? undefined : MUTED)

  const visitsTable = (d: DayDetail, compact: boolean) =>
    table(
      [
        ...(compact ? [] : [{ label: '#', w: 0.35 }]),
        { label: 'Store', w: 3.3 },
        { label: compact ? 'In' : 'Checked in', w: compact ? 0.8 : 1 },
        { label: compact ? 'Out' : 'Checked out', w: 1.3 },
        { label: compact ? 'Time' : 'Time in store', w: 1.2, right: true },
        { label: 'Arrived', w: 1.5 },
        { label: 'Time before', w: 1.6 },
      ],
      d.visits.map((v, i) => [
        ...(compact ? [] : [String(i + 1)]),
        { text: v.store, sub: compact ? null : v.address, bold: true },
        v.inTime,
        { text: v.outTime, color: v.open ? DEEP : undefined },
        v.minutesText,
        { text: v.arrival, color: arrivalColour(v.arrival) },
        i === 0 ? 'First store' : v.gapBefore === null ? '—' : v.gapText.replace(' after the last store', ''),
      ]),
      {
        size: compact ? 16 : 17,
        total: compact
          ? undefined
          : ['', `${d.visits.length} ${d.visits.length === 1 ? 'visit' : 'visits'}, ${d.stores} ${d.stores === 1 ? 'store' : 'stores'}`, '', '', mins(d.minutesInStores), '', ''],
      },
    )

  const extras = (d: DayDetail, compact: boolean) => {
    if (d.counts.length) {
      if (compact) body.push(para([run('Stock counts', { bold: true, color: DEEP, size: 17 })], { before: 60, after: 60 }))
      else heading('Stock counts')
      table(
        [
          { label: 'Store', w: 2.4 },
          { label: 'Product', w: 3.4 },
          { label: 'In store', w: 1, right: true },
          { label: 'Sold', w: 1, right: true },
        ],
        d.counts.map((c) => [c.store, c.product, c.inStore, c.sold]),
        { size: compact ? 16 : 17 },
      )
    }
    if (d.sales.length) {
      const units = d.sales.reduce((s, x) => s + x.units, 0)
      if (compact) body.push(para([run('X Metrics sales', { bold: true, color: DEEP, size: 17 })], { before: 60, after: 60 }))
      else heading('X Metrics sales', `${units} ${units === 1 ? 'unit' : 'units'}`)
      table(
        [
          { label: 'Store', w: 2.6 },
          { label: 'Product', w: 3.8 },
          { label: 'Units', w: 1, right: true },
        ],
        d.sales.map((s) => [s.store, s.product, String(s.units)]),
        { size: compact ? 16 : 17, total: compact ? undefined : ['Total', '', String(units)] },
      )
    }
  }

  /* ---------------- the top ---------------- */

  const logoH = 62
  body.push(
    new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: [CW / 2, CW / 2],
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: CW / 2, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  children: [
                    new ImageRun({ type: 'png', data: XPEL_LOGO_PNG, transformation: { width: Math.round(logoH * XPEL_LOGO_RATIO), height: logoH } }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: CW / 2, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                para([run('MARKETER REPORT', { bold: true, color: BRAND, size: 17 })], { align: AlignmentType.RIGHT }),
                para([run(report.periodLabel, { bold: true, color: DARK, size: 34 })], { align: AlignmentType.RIGHT }),
                para([run(`${report.kindLabel}  ·  Lagos time`, { color: MUTED, size: 17 })], { align: AlignmentType.RIGHT }),
              ],
            }),
          ],
        }),
      ],
    }),
  )
  body.push(para([], { after: 160 }))

  // The person.
  body.push(
    new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: [CW - 2600, 2600],
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: CW - 2600, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
              borders: { top: line(TRACK, 6), bottom: line(TRACK, 6), left: line(BRAND, 24), right: none },
              margins: { top: 120, bottom: 120, left: 220, right: 120 },
              children: [
                para([run(report.person.name, { bold: true, color: DARK, size: 32 })], { after: 40 }),
                para([
                  run(
                    [
                      report.person.role,
                      report.person.supervisor ? `Supervisor: ${report.person.supervisor}` : 'No supervisor',
                      report.person.homeStore ? `Home store: ${report.person.homeStore}` : null,
                    ]
                      .filter(Boolean)
                      .join('   ·   '),
                    { color: MUTED, size: 17 },
                  ),
                ]),
              ],
            }),
            new TableCell({
              width: { size: 2600, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
              borders: { top: line(TRACK, 6), bottom: line(TRACK, 6), right: line(TRACK, 6), left: none },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 120, bottom: 120, left: 120, right: 220 },
              children: [
                para([run('GENERATED', { bold: true, color: MUTED, size: 14 })], { align: AlignmentType.RIGHT }),
                para([run(report.generatedLabel, { bold: true, color: DARK, size: 18 })], { align: AlignmentType.RIGHT }),
              ],
            }),
          ],
        }),
      ],
    }),
  )
  body.push(para([], { after: 160 }))

  // Tiles, four to a row.
  const tileW = Math.floor(CW / 4)
  const tileRows: InstanceType<typeof TableRow>[] = []
  for (let i = 0; i < report.tiles.length; i += 4) {
    tileRows.push(
      new TableRow({
        cantSplit: true,
        children: report.tiles.slice(i, i + 4).map(
          (t) =>
            new TableCell({
              width: { size: tileW, type: WidthType.DXA },
              margins: { top: 110, bottom: 110, left: 150, right: 100 },
              children: [
                para([run(t.label.toUpperCase(), { bold: true, color: MUTED, size: 13 })], { after: 40 }),
                para([run(t.value, { bold: true, color: DEEP, size: 30 })]),
                ...(t.note ? [para([run(t.note, { color: MUTED, size: 14 })])] : []),
              ],
            }),
        ),
      }),
    )
  }
  body.push(
    new Table({
      width: { size: CW, type: WidthType.DXA },
      columnWidths: [tileW, tileW, tileW, tileW],
      borders: { top: line(), bottom: line(), left: line(), right: line(), insideHorizontal: line(), insideVertical: line() },
      rows: tileRows,
    }),
  )
  body.push(para([], { after: 160 }))

  // The summary sentence.
  body.push(
    new Paragraph({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: TRACK },
      border: { left: { style: BorderStyle.SINGLE, size: 30, color: BRAND, space: 10 } },
      spacing: { before: 0, after: 120 },
      indent: { left: 200, right: 120 },
      children: [run(report.summary, { color: DARK, size: 19 })],
    }),
  )

  /* ---------------- the body ---------------- */

  if (report.kind === 'day') {
    const d = report.days[0]
    heading('Clock in and out')
    table(
      [
        { label: '', w: 1.1 },
        { label: 'Time', w: 0.8 },
        { label: 'Status', w: 2.2 },
        { label: 'Where', w: 3.9 },
      ],
      [
        d.clockIn
          ? [{ text: 'Clock in', bold: true }, d.clockIn.time, { text: d.clockIn.statusText, color: d.late ? DEEP : undefined }, d.clockIn.place ?? '—']
          : [{ text: 'Clock in', bold: true }, '—', { text: 'Did not clock in', color: DEEP }, '—'],
        d.clockOut
          ? [{ text: 'Clock out', bold: true }, d.clockOut.time, d.clockOut.statusText, d.clockOut.place ?? '—']
          : [{ text: 'Clock out', bold: true }, '—', { text: d.clockIn ? d.outText : 'Did not clock out', color: d.missingOut ? DEEP : undefined }, '—'],
      ],
    )
    heading('Store visits', d.visits.length ? `${mins(d.minutesInStores)} in stores` : undefined)
    if (d.visits.length) visitsTable(d, false)
    else note('No store visits recorded on this day.')
    heading('Daily report', d.report ? `Filed at ${d.report.filedAt}` : undefined)
    if (d.report) fields(d.report.fields)
    else note('No daily report was filed for this day.')
    extras(d, false)
  } else {
    heading('Day by day', `${report.days.length} ${report.days.length === 1 ? 'day' : 'days'}`)
    table(
      [
        { label: 'Date', w: 1.35 },
        { label: 'Clock in', w: 1.05 },
        { label: 'Clock out', w: 1.35 },
        { label: 'Stores', w: 0.75, right: true },
        { label: 'Visits', w: 0.75, right: true },
        { label: 'Time in stores', w: 1.4, right: true },
        { label: 'Report', w: 0.8 },
      ],
      report.days.map((d) => [
        { text: d.shortLabel, bold: d.active },
        { text: d.inText + (d.late ? ' late' : ''), color: d.late ? DEEP : undefined },
        { text: d.outText, color: d.missingOut ? DEEP : undefined },
        d.active ? String(d.stores) : '—',
        d.active ? String(d.visits.length) : '—',
        d.visits.length ? mins(d.minutesInStores) : '—',
        d.report ? 'Yes' : d.active ? { text: 'No', color: DEEP } : '—',
      ]),
      {
        size: 16,
        mute: (i) => !report.days[i].active,
        total: [
          'Month',
          `${report.totals.clockIns} in`,
          report.totals.missingClockOuts ? `${report.totals.missingClockOuts} missing` : '',
          String(report.totals.storesVisited),
          String(report.totals.visits),
          mins(report.totals.minutesInStores),
          `${report.totals.reportsFiled} filed`,
        ],
      },
    )
    heading('Stores visited', `${report.stores.length} ${report.stores.length === 1 ? 'store' : 'stores'}`)
    if (report.stores.length)
      table(
        [
          { label: 'Store', w: 4 },
          { label: 'Visits', w: 0.8, right: true },
          { label: 'Total time', w: 1.3, right: true },
          { label: 'Last visit', w: 1.6 },
        ],
        report.stores.map((s) => [{ text: s.store, sub: s.address, bold: true }, String(s.visits), s.minutesText, s.lastVisit]),
      )
    else note('No store visits recorded this month.')

    heading('Each day in detail')
    if (!report.activeDays.length) note('Nothing was recorded this month.')
    for (const d of report.activeDays) {
      body.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 200, after: 60 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: TRACK },
          tabStops: [{ type: TabStopType.RIGHT, position: CW - 120 }],
          indent: { left: 100, right: 100 },
          children: [
            run(d.dateLabel, { bold: true, color: DARK, size: 19 }),
            run(
              `\t${[d.clockIn ? `In ${d.inText}` : 'No clock-in', d.clockOut ? `Out ${d.outText}` : d.outText, `${d.stores} ${d.stores === 1 ? 'store' : 'stores'}`, d.visits.length ? mins(d.minutesInStores) : null, d.report ? 'Report filed' : 'No report']
                .filter(Boolean)
                .join('  ·  ')}`,
              { color: DEEP, size: 15 },
            ),
          ],
        }),
      )
      body.push(new Paragraph({ keepNext: true, spacing: { after: 80 }, children: [run(d.summary, { color: MUTED, size: 16 })] }))
      if (d.visits.length) visitsTable(d, true)
      if (d.report) fields(d.report.fields, 16)
      extras(d, true)
    }
  }

  const doc = new Document({
    creator: 'Xtend',
    title: `${report.person.name} — ${report.kindLabel}, ${report.periodLabel}`,
    styles: { default: { document: { run: { font: 'Arial', size: 18 } } } },
    sections: [
      {
        properties: {
          page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 900, bottom: 900, left: MARGIN, right: MARGIN, header: 400, footer: 400 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: PEACH, space: 4 } },
                children: [run(`${report.person.name}  ·  ${report.kindLabel}, ${report.periodLabel}`, { color: MUTED, size: 15 })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: PEACH, space: 4 } },
                tabStops: [{ type: TabStopType.RIGHT, position: CW }],
                children: [
                  run(`Xtend  ·  Xpel Beauty  ·  ${report.person.name}, ${report.kindLabel.toLowerCase()} for ${report.periodLabel}`, { color: MUTED, size: 14 }),
                  new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], bold: true, color: BRAND, size: 14 }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  })
  return new Uint8Array(await Packer.toBuffer(doc))
}

