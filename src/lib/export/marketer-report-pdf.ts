/**
 * The marketer's day or month report as a branded A4 PDF (pdf-lib). A
 * layout of its own, not the generic table renderer: a header with the
 * Xpel logo, the person, summary tiles, then tables and the daily report,
 * with page numbers and a footer on every page.
 */
import { minutesText, reportFieldsWithDocuments, type MarketerReport, type DayDetail } from '@/lib/marketer-report'
import { XPEL_LOGO_PNG, XPEL_LOGO_RATIO } from '@/lib/export/brand-logo'

type RGB = { r: number; g: number; b: number }
const hex = (h: string): RGB => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
})

const C = {
  brand: hex('#d1511a'),
  deep: hex('#9b3517'),
  light: hex('#e8833a'),
  dark: hex('#52281a'),
  peach: hex('#f2b48a'),
  track: hex('#f6e4d8'),
  stripe: hex('#fcf3ed'),
  wash: hex('#fdf8f4'),
  text: hex('#2b211c'),
  muted: hex('#7c6c63'),
  white: hex('#ffffff'),
}

/** The standard PDF fonts only encode WinAnsi; anything else is spelled out or dropped. */
export function pdfSafe(text: string) {
  return text
    .replace(/₦/g, 'NGN ')
    .replace(/[→]/g, '->')
    .replace(/[^\s\x20-\x7E -ÿ–—‘’“”•…€]/g, '')
    .replace(/[ \t]+/g, ' ')
}

export interface Cell {
  text: string
  /** A second, smaller grey line (an address). */
  sub?: string | null
  color?: RGB
  bold?: boolean
}
type CellInput = string | Cell
interface Column {
  label: string
  /** Share of the table width. */
  w: number
  align?: 'left' | 'right'
}

export async function marketerReportPdf(report: MarketerReport): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(`${report.person.name} — ${report.kindLabel}, ${report.periodLabel}`)
  doc.setAuthor('Xtend')
  doc.setCreator('Xtend · Xpel Beauty')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const logo = await doc.embedPng(XPEL_LOGO_PNG)
  type Font = typeof font
  type Page = ReturnType<typeof doc.addPage>

  const W = 595.28
  const H = 841.89
  const M = 40
  const CW = W - 2 * M
  const TOP = H - 64 // first line under a continuation page's header
  const BOTTOM = 56 // above the footer
  const col = (c: RGB) => rgb(c.r, c.g, c.b)

  const wrap = (raw: string, width: number, f: Font, size: number) => {
    const out: string[] = []
    for (const para of pdfSafe(raw).split(/\r?\n/)) {
      let line = ''
      for (const word of para.split(' ')) {
        if (!word) continue
        const next = line ? `${line} ${word}` : word
        if (f.widthOfTextAtSize(next, size) <= width) {
          line = next
          continue
        }
        if (line) out.push(line)
        line = word
        while (f.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && f.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--
          out.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      }
      out.push(line)
    }
    return out.length ? out : ['']
  }

  const roundRect = (page: Page, x: number, y: number, w: number, h: number, r: number, fill: RGB, border?: RGB) => {
    // drawSvgPath measures y downwards from the given origin.
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
    page.drawSvgPath(path, {
      x,
      y: y + h,
      color: col(fill),
      ...(border ? { borderColor: col(border), borderWidth: 0.75 } : {}),
    })
  }

  const text = (page: Page, s: string, x: number, y: number, size: number, f: Font = font, c: RGB = C.text) =>
    page.drawText(pdfSafe(s), { x, y, size, font: f, color: col(c) })
  const textRight = (page: Page, s: string, right: number, y: number, size: number, f: Font = font, c: RGB = C.text) =>
    text(page, s, right - f.widthOfTextAtSize(pdfSafe(s), size), y, size, f, c)
  const fit = (s: string, width: number, f: Font, size: number) => {
    let t = pdfSafe(s)
    if (f.widthOfTextAtSize(t, size) <= width) return t
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1)
    return `${t}…`
  }

  /* ---------------- pages ---------------- */

  const pages: Page[] = []
  let page!: Page
  let y = 0

  const newPage = () => {
    page = doc.addPage([W, H])
    pages.push(page)
    // A thin brand line along the top of every page.
    page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: col(C.brand) })
    page.drawRectangle({ x: W * 0.72, y: H - 5, width: W * 0.28, height: 5, color: col(C.light) })
    if (pages.length > 1) {
      const lh = 20
      page.drawImage(logo, { x: M, y: H - 22 - lh, width: lh * XPEL_LOGO_RATIO, height: lh })
      textRight(page, `${report.person.name}  ·  ${report.kindLabel}, ${report.periodLabel}`, W - M, H - 36, 8, font, C.muted)
      page.drawLine({ start: { x: M, y: H - 50 }, end: { x: W - M, y: H - 50 }, thickness: 0.6, color: col(C.peach) })
      y = TOP
    }
  }

  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage()
  }

  /* ---------------- first page header ---------------- */

  newPage()
  const logoH = 46
  page.drawImage(logo, { x: M, y: H - 30 - logoH, width: logoH * XPEL_LOGO_RATIO, height: logoH })
  textRight(page, 'MARKETER REPORT', W - M, H - 38, 8.5, bold, C.brand)
  textRight(page, report.periodLabel, W - M, H - 58, 17, bold, C.dark)
  textRight(page, `${report.kindLabel}  ·  Lagos time`, W - M, H - 72, 8.5, font, C.muted)
  y = H - 96

  // The person.
  const personH = 54
  roundRect(page, M, y - personH, CW, personH, 8, C.wash, C.track)
  page.drawRectangle({ x: M, y: y - personH + 8, width: 3, height: personH - 16, color: col(C.brand) })
  text(page, fit(report.person.name, CW - 170, bold, 16), M + 16, y - 23, 16, bold, C.dark)
  const meta = [
    report.person.role,
    report.person.supervisor ? `Supervisor: ${report.person.supervisor}` : 'No supervisor',
    report.person.homeStore ? `Home store: ${report.person.homeStore}` : null,
  ]
    .filter(Boolean)
    .join('   ·   ')
  text(page, fit(meta, CW - 170, font, 8.5), M + 16, y - 40, 8.5, font, C.muted)
  textRight(page, 'GENERATED', W - M - 14, y - 21, 7, bold, C.muted)
  textRight(page, report.generatedLabel, W - M - 14, y - 34, 9, bold, C.dark)
  y -= personH + 14

  // Summary tiles, four to a row.
  const gap = 8
  const tileW = (CW - gap * 3) / 4
  const tileH = 48
  report.tiles.forEach((t, i) => {
    const row = Math.floor(i / 4)
    const x = M + (i % 4) * (tileW + gap)
    const top = y - row * (tileH + gap)
    roundRect(page, x, top - tileH, tileW, tileH, 7, C.white, C.peach)
    text(page, t.label.toUpperCase(), x + 10, top - 14, 6.6, bold, C.muted)
    text(page, fit(t.value, tileW - 20, bold, 14), x + 10, top - 32, 14, bold, C.deep)
    if (t.note) text(page, fit(t.note, tileW - 20, font, 6.8), x + 10, top - 42.5, 6.8, font, C.muted)
  })
  y -= Math.ceil(report.tiles.length / 4) * (tileH + gap) + 4

  // The summary sentence.
  {
    const lines = wrap(report.summary, CW - 34, font, 9.5)
    const h = lines.length * 13 + 16
    roundRect(page, M, y - h, CW, h, 7, C.track)
    page.drawRectangle({ x: M, y: y - h, width: 4, height: h, color: col(C.brand) })
    lines.forEach((l, i) => text(page, l, M + 18, y - 19 - i * 13, 9.5, font, C.dark))
    y -= h + 2
  }

  /* ---------------- building blocks ---------------- */

  const heading = (title: string, note?: string) => {
    // Never a heading alone at the foot of a page.
    ensure(110)
    y -= 12
    text(page, title, M, y - 12, 12.5, bold, C.brand)
    if (note) textRight(page, note, W - M, y - 11, 8, font, C.muted)
    page.drawLine({ start: { x: M, y: y - 18 }, end: { x: W - M, y: y - 18 }, thickness: 0.8, color: col(C.peach) })
    y -= 26
  }

  const paragraph = (s: string, size = 8.5, c: RGB = C.muted, f: Font = font) => {
    for (const l of wrap(s, CW, f, size)) {
      ensure(size + 4)
      text(page, l, M, y - size, size, f, c)
      y -= size + 3.5
    }
    y -= 3
  }

  const table = (
    columns: Column[],
    rows: CellInput[][],
    opts: { size?: number; total?: CellInput[]; muteRow?: (i: number) => boolean } = {},
  ) => {
    const size = opts.size ?? 8
    const lh = size + 2.6
    const padX = 5
    const padY = 4.5
    const widths = columns.map((c) => (c.w / columns.reduce((s, x) => s + x.w, 0)) * CW)

    const header = () => {
      const h = size + padY * 2 + 1
      page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col(C.brand) })
      let x = M
      columns.forEach((c, i) => {
        const label = fit(c.label, widths[i] - padX * 2, bold, size - 0.5)
        if (c.align === 'right') textRight(page, label, x + widths[i] - padX, y - padY - size + 1, size - 0.5, bold, C.white)
        else text(page, label, x + padX, y - padY - size + 1, size - 0.5, bold, C.white)
        x += widths[i]
      })
      y -= h
    }

    const layout = (cells: CellInput[], isTotal: boolean) =>
      cells.map((raw, i) => {
        const cell: Cell = typeof raw === 'string' ? { text: raw } : raw
        const f = cell.bold || isTotal ? bold : font
        const inner = widths[i] - padX * 2
        const main = columns[i].align === 'right' ? [fit(cell.text, inner, f, size)] : wrap(cell.text, inner, f, size)
        const sub = cell.sub ? wrap(cell.sub, inner, font, size - 1.2) : []
        return { cell, f, main, sub, h: main.length * lh + sub.length * (lh - 1.5) }
      })

    const drawRow = (cells: CellInput[], i: number, isTotal = false) => {
      const laid = layout(cells, isTotal)
      const h = Math.max(...laid.map((l) => l.h)) + padY * 2 - 2.6
      if (y - h < BOTTOM) {
        newPage()
        header()
      }
      if (isTotal) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col(C.track) })
      else if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col(C.stripe) })
      const muted = !isTotal && opts.muteRow?.(i)
      let x = M
      laid.forEach((l, ci) => {
        const colour = l.cell.color ?? (muted ? C.muted : isTotal ? C.dark : C.text)
        let ly = y - padY - size + 1
        for (const line of l.main) {
          if (columns[ci].align === 'right') textRight(page, line, x + widths[ci] - padX, ly, size, l.f, colour)
          else text(page, line, x + padX, ly, size, l.f, colour)
          ly -= lh
        }
        for (const line of l.sub) {
          text(page, line, x + padX, ly + 0.5, size - 1.2, font, C.muted)
          ly -= lh - 1.5
        }
        x += widths[ci]
      })
      y -= h
    }

    ensure(size * 5 + 20)
    header()
    rows.forEach((r, i) => drawRow(r, i))
    if (opts.total) drawRow(opts.total, 0, true)
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: col(C.peach) })
    y -= 6
  }

  /** "Label    text that wraps" in two columns. */
  const fields = (list: { label: string; text: string; empty?: boolean }[], size = 8.5, labelW = 118) => {
    list.forEach((f, i) => {
      const lines = wrap(f.text, CW - labelW - 14, f.empty ? italic : font, size)
      const h = lines.length * (size + 3.4) + 9
      if (y - Math.min(h, 60) < BOTTOM) newPage()
      if (i % 2 === 0) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col(C.stripe) })
      text(page, f.label, M + 6, y - size - 4, size, bold, C.deep)
      let ly = y - size - 4
      for (const l of lines) {
        if (ly < BOTTOM) {
          newPage()
          ly = y - size - 4
        }
        text(page, l, M + labelW, ly, size, f.empty ? italic : font, f.empty ? C.muted : C.text)
        ly -= size + 3.4
      }
      y = Math.min(y - h, ly + size - 1)
    })
    y -= 8
  }

  const arrivalColour = (a: string) => (a === 'At the store' ? C.text : a === 'Away from the store' || a === 'Location unclear' ? C.deep : C.muted)

  const visitsTable = (d: DayDetail, compact: boolean) => {
    table(
      compact
        ? [
            { label: 'Store', w: 3.2 },
            { label: 'In', w: 0.75 },
            { label: 'Out', w: 1.25 },
            { label: 'Time', w: 1.1, align: 'right' },
            { label: 'Arrived', w: 2.1 },
            { label: 'Time before', w: 1.6 },
          ]
        : [
            { label: '#', w: 0.35 },
            { label: 'Store', w: 3.3 },
            { label: 'Checked in', w: 1 },
            { label: 'Checked out', w: 1.3 },
            { label: 'Time in store', w: 1.2, align: 'right' },
            { label: 'Arrived', w: 1.5 },
            { label: 'Time before', w: 1.6 },
          ],
      d.visits.map((v, i) => {
        const cells: CellInput[] = [
          { text: v.store, sub: compact ? null : v.address, bold: true },
          v.inTime,
          { text: v.outTime, color: v.open ? C.deep : undefined },
          v.minutesText,
          { text: v.arrival, color: arrivalColour(v.arrival) },
          i === 0 ? 'First store' : v.gapBefore === null ? '—' : `${v.gapText.replace(' after the last store', '')}`,
        ]
        return compact ? cells : [String(i + 1), ...cells]
      }),
      {
        size: compact ? 7.5 : 8,
        total: compact
          ? undefined
          : ['', `${d.visits.length} ${d.visits.length === 1 ? 'visit' : 'visits'}, ${d.stores} ${d.stores === 1 ? 'store' : 'stores'}`, '', '', minutesText(d.minutesInStores), '', ''],
      },
    )
  }

  const extras = (d: DayDetail, compact: boolean) => {
    if (d.counts.length) {
      if (compact) {
        ensure(30)
        text(page, 'Stock counts', M, y - 9, 8.5, bold, C.deep)
        y -= 14
      } else heading('Stock counts', `${d.counts.length} ${d.counts.length === 1 ? 'line' : 'lines'}`)
      table(
        [
          { label: 'Store', w: 2.4 },
          { label: 'Product', w: 3.4 },
          { label: 'In store', w: 1, align: 'right' },
          { label: 'Sold', w: 1, align: 'right' },
        ],
        d.counts.map((c) => [c.store, c.product, c.inStore, c.sold]),
        { size: compact ? 7.2 : 8 },
      )
    }
    if (d.sales.length) {
      const units = d.sales.reduce((s, x) => s + x.units, 0)
      if (compact) {
        ensure(30)
        text(page, 'X Metrics sales', M, y - 9, 8.5, bold, C.deep)
        y -= 14
      } else heading('X Metrics sales', `${units} ${units === 1 ? 'unit' : 'units'}`)
      table(
        [
          { label: 'Store', w: 2.6 },
          { label: 'Product', w: 3.8 },
          { label: 'Units', w: 1, align: 'right' },
        ],
        d.sales.map((s) => [s.store, s.product, String(s.units)]),
        { size: compact ? 7.2 : 8, total: compact ? undefined : ['Total', '', String(units)] },
      )
    }
  }

  /* ---------------- the day report ---------------- */

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
          ? [{ text: 'Clock in', bold: true }, d.clockIn.time, { text: d.clockIn.statusText, color: d.late ? C.deep : undefined }, d.clockIn.place ?? '—']
          : [{ text: 'Clock in', bold: true }, '—', { text: 'Did not clock in', color: C.deep }, '—'],
        d.clockOut
          ? [{ text: 'Clock out', bold: true }, d.clockOut.time, d.clockOut.statusText, d.clockOut.place ?? '—']
          : [{ text: 'Clock out', bold: true }, '—', { text: d.clockIn ? d.outText : 'Did not clock out', color: d.missingOut ? C.deep : undefined }, '—'],
      ],
    )

    heading('Store visits', d.visits.length ? `${minutesText(d.minutesInStores)} in stores` : undefined)
    if (d.visits.length) visitsTable(d, false)
    else paragraph('No store visits recorded on this day.', 9, C.muted, italic)

    heading('Daily report', d.report ? `Filed at ${d.report.filedAt}` : undefined)
    if (d.report) fields(reportFieldsWithDocuments(d.report))
    else paragraph('No daily report was filed for this day.', 9, C.muted, italic)

    extras(d, false)
  } else {
    /* ---------------- the month report ---------------- */
    heading('Day by day', `${report.days.length} ${report.days.length === 1 ? 'day' : 'days'}`)
    table(
      [
        { label: 'Date', w: 1.35 },
        { label: 'Clock in', w: 1.05 },
        { label: 'Clock out', w: 1.35 },
        { label: 'Stores', w: 0.75, align: 'right' },
        { label: 'Visits', w: 0.75, align: 'right' },
        { label: 'Time in stores', w: 1.4, align: 'right' },
        { label: 'Report', w: 0.8 },
      ],
      report.days.map((d) => [
        { text: d.shortLabel, bold: d.active },
        { text: d.inText + (d.late ? ' late' : ''), color: d.late ? C.deep : undefined },
        { text: d.outText, color: d.missingOut ? C.deep : undefined },
        d.active ? String(d.stores) : '—',
        d.active ? String(d.visits.length) : '—',
        d.visits.length ? minutesText(d.minutesInStores) : '—',
        d.report ? 'Yes' : d.active ? { text: 'No', color: C.deep } : '—',
      ]),
      {
        size: 7.6,
        muteRow: (i) => !report.days[i].active,
        total: [
          'Month',
          `${report.totals.clockIns} in`,
          report.totals.missingClockOuts ? `${report.totals.missingClockOuts} missing` : '',
          String(report.totals.storesVisited),
          String(report.totals.visits),
          minutesText(report.totals.minutesInStores),
          `${report.totals.reportsFiled} filed`,
        ],
      },
    )

    heading('Stores visited', `${report.stores.length} ${report.stores.length === 1 ? 'store' : 'stores'}`)
    if (report.stores.length) {
      table(
        [
          { label: 'Store', w: 4 },
          { label: 'Visits', w: 0.8, align: 'right' },
          { label: 'Total time', w: 1.3, align: 'right' },
          { label: 'Last visit', w: 1.6 },
        ],
        report.stores.map((s) => [{ text: s.store, sub: s.address, bold: true }, String(s.visits), s.minutesText, s.lastVisit]),
      )
    } else paragraph('No store visits recorded this month.', 9, C.muted, italic)

    heading('Each day in detail')
    if (!report.activeDays.length) paragraph('Nothing was recorded this month.', 9, C.muted, italic)
    for (const d of report.activeDays) {
      ensure(110)
      y -= 4
      const barH = 22
      roundRect(page, M, y - barH, CW, barH, 6, C.track)
      text(page, d.dateLabel, M + 10, y - 14.5, 9.5, bold, C.dark)
      const chips = [
        d.clockIn ? `In ${d.inText}` : 'No clock-in',
        d.clockOut ? `Out ${d.outText}` : d.outText,
        `${d.stores} ${d.stores === 1 ? 'store' : 'stores'}`,
        d.visits.length ? minutesText(d.minutesInStores) : null,
        d.report ? 'Report filed' : 'No report',
      ]
        .filter(Boolean)
        .join('   ·   ')
      textRight(page, chips, W - M - 10, y - 14.5, 7.6, font, C.deep)
      y -= barH + 6
      paragraph(d.summary, 8, C.muted)
      if (d.visits.length) visitsTable(d, true)
      if (d.report) fields(reportFieldsWithDocuments(d.report), 7.8, 108)
      extras(d, true)
      y -= 4
    }
  }

  /* ---------------- footers ---------------- */

  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.6, color: col(C.peach) })
    const left = `Xtend  ·  Xpel Beauty  ·  ${report.person.name}, ${report.kindLabel.toLowerCase()} for ${report.periodLabel}`
    text(p, fit(left, CW - 80, font, 7.2), M, 26, 7.2, font, C.muted)
    textRight(p, `Page ${i + 1} of ${pages.length}`, W - M, 26, 7.2, bold, C.brand)
  })

  return await doc.save()
}
