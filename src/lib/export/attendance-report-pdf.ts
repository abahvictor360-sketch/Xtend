/**
 * The attendance report as a designed A4 PDF (pdf-lib): the Xpel logo and
 * the period, eight figure tiles, a ring of how the day went, a bar chart
 * (clock-in times for one day, turnout per day for several), attendance by
 * store, the written account, cards of who needs attention, then the day
 * by day table, with page numbers on every page. Excel, Word and CSV keep
 * the plain table layout (lib/export/render.ts).
 */
import { XPEL_LOGO_PNG, XPEL_LOGO_RATIO } from '@/lib/export/brand-logo'
import { pdfSafe } from '@/lib/export/marketer-report-pdf'
import { TONE_HEX, type ReportModel } from '@/lib/attendance-report-model'
import { MAX_NAMES } from '@/lib/attendance-writeup'

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
  line: hex('#efe2d8'),
  text: hex('#2b211c'),
  muted: hex('#7c6c63'),
  white: hex('#ffffff'),
}
const tone = (t: keyof typeof TONE_HEX) => hex(TONE_HEX[t])

export async function attendanceReportPdf(m: ReportModel, generatedLabel: string): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(`Attendance report — ${m.periodLabel}`)
  doc.setAuthor('Xtend')
  doc.setCreator('Xtend · Xpel Beauty')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await doc.embedPng(XPEL_LOGO_PNG)
  type Font = typeof font
  type Page = ReturnType<typeof doc.addPage>

  const W = 595.28
  const H = 841.89
  const M = 36
  const CW = W - 2 * M
  const BOTTOM = 52
  const col = (c: RGB) => rgb(c.r, c.g, c.b)

  /* ---------------- drawing helpers ---------------- */

  const text = (p: Page, s: string, x: number, y: number, size: number, f: Font = font, c: RGB = C.text) =>
    p.drawText(pdfSafe(s), { x, y, size, font: f, color: col(c) })
  const width = (s: string, size: number, f: Font = font) => f.widthOfTextAtSize(pdfSafe(s), size)
  const textRight = (p: Page, s: string, right: number, y: number, size: number, f: Font = font, c: RGB = C.text) =>
    text(p, s, right - width(s, size, f), y, size, f, c)
  const textCenter = (p: Page, s: string, cx: number, y: number, size: number, f: Font = font, c: RGB = C.text) =>
    text(p, s, cx - width(s, size, f) / 2, y, size, f, c)
  const fit = (s: string, w: number, f: Font, size: number) => {
    let t = pdfSafe(s)
    if (f.widthOfTextAtSize(t, size) <= w) return t
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > w) t = t.slice(0, -1)
    return `${t}…`
  }
  const wrap = (raw: string, w: number, f: Font, size: number) => {
    const out: string[] = []
    let line = ''
    for (const word of pdfSafe(raw).split(' ')) {
      if (!word) continue
      const next = line ? `${line} ${word}` : word
      if (f.widthOfTextAtSize(next, size) <= w) {
        line = next
        continue
      }
      if (line) out.push(line)
      line = f.widthOfTextAtSize(word, size) > w ? fit(word, w, f, size) : word
    }
    if (line) out.push(line)
    return out.length ? out : ['']
  }
  const roundRect = (p: Page, x: number, y: number, w: number, h: number, r: number, fill: RGB, border?: RGB) => {
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
    p.drawSvgPath(path, { x, y: y + h, color: col(fill), ...(border ? { borderColor: col(border), borderWidth: 0.75 } : {}) })
  }
  const link = (p: Page, x: number, y: number, w: number, h: number, url: string) => {
    const annotation = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    })
    const ref = doc.context.register(annotation)
    const existing = p.node.lookup(PDFName.of('Annots'))
    // @ts-expect-error pdf-lib types the array loosely here.
    if (existing) existing.push(ref)
    else p.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
  }

  /** One slice of a ring, from angle a0 to a1 (radians, clockwise from the top). */
  const ringSlice = (p: Page, cx: number, cy: number, R: number, r: number, a0: number, a1: number, c: RGB) => {
    // drawSvgPath: y grows downwards from the origin, so the origin is the ring's top-left.
    const ox = cx - R
    const oy = cy + R
    const pt = (rad: number, a: number) => `${R + rad * Math.sin(a)} ${R - rad * Math.cos(a)}`
    const large = a1 - a0 > Math.PI ? 1 : 0
    const path = `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`
    p.drawSvgPath(path, { x: ox, y: oy, color: col(c) })
  }

  /* ---------------- pages ---------------- */

  const pages: Page[] = []
  let page!: Page
  let y = 0

  const newPage = () => {
    page = doc.addPage([W, H])
    pages.push(page)
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: col(C.brand) })
    page.drawRectangle({ x: W * 0.7, y: H - 6, width: W * 0.3, height: 6, color: col(C.light) })
    if (pages.length > 1) {
      const lh = 20
      page.drawImage(logo, { x: M, y: H - 24 - lh, width: lh * XPEL_LOGO_RATIO, height: lh })
      textRight(page, `Attendance report  ·  ${m.periodLabel}`, W - M, H - 38, 8, font, C.muted)
      page.drawLine({ start: { x: M, y: H - 52 }, end: { x: W - M, y: H - 52 }, thickness: 0.6, color: col(C.peach) })
      y = H - 66
    }
  }
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage()
  }
  const heading = (title: string, note?: string) => {
    ensure(90)
    y -= 10
    text(page, title, M, y - 12, 13, bold, C.dark)
    if (note) textRight(page, note, W - M, y - 11, 8, font, C.muted)
    page.drawRectangle({ x: M, y: y - 19, width: 28, height: 2.2, color: col(C.brand) })
    y -= 28
  }

  /* ---------------- 1. header ---------------- */

  newPage()
  const logoH = 50
  page.drawImage(logo, { x: M, y: H - 30 - logoH, width: logoH * XPEL_LOGO_RATIO, height: logoH })
  textRight(page, 'ATTENDANCE REPORT', W - M, H - 38, 8.5, bold, C.brand)
  const period = wrap(m.periodLabel, 330, bold, 16)
  period.forEach((l, i) => textRight(page, l, W - M, H - 58 - i * 19, 16, bold, C.dark))
  let hy = H - 58 - (period.length - 1) * 19 - 15
  for (const l of wrap(m.filterLine, 330, font, 7.5).slice(0, 2)) {
    textRight(page, l, W - M, hy, 7.5, font, C.muted)
    hy -= 10
  }
  textRight(page, `Lagos time · made ${generatedLabel}`, W - M, hy, 7.5, font, C.muted)
  y = Math.min(H - 96, hy - 14)

  /* ---------------- 2. figures ---------------- */

  {
    const gap = 8
    const tileW = (CW - gap * 3) / 4
    const tileH = 62
    m.kpis.forEach((k, i) => {
      const x = M + (i % 4) * (tileW + gap)
      const top = y - Math.floor(i / 4) * (tileH + gap)
      const c = tone(k.tone)
      roundRect(page, x, top - tileH, tileW, tileH, 8, C.white, C.line)
      page.drawRectangle({ x, y: top - tileH + 10, width: 3, height: tileH - 20, color: col(c) })
      text(page, fit(k.label.toUpperCase(), tileW - 22, bold, 6.6), x + 12, top - 15, 6.6, bold, C.muted)
      text(page, fit(k.value, tileW - 22, bold, 19), x + 12, top - 37, 19, bold, c)
      text(page, fit(k.note, tileW - 22, font, 6.8), x + 12, top - 48.5, 6.8, font, C.muted)
      if (k.bar != null) {
        const bw = tileW - 24
        roundRect(page, x + 12, top - 56, bw, 3, 1.5, C.track)
        const v = Math.max(0, Math.min(100, k.bar))
        if (v > 0) roundRect(page, x + 12, top - 56, Math.max(3, (bw * v) / 100), 3, 1.5, c)
      }
    })
    y -= Math.ceil(m.kpis.length / 4) * (tileH + gap) + 6
  }

  /* ---------------- 3. charts ---------------- */

  {
    const gap = 10
    const cardH = 176
    const leftW = 214
    const rightW = CW - leftW - gap
    ensure(cardH + 10)
    const top = y

    // The ring: how the day went.
    roundRect(page, M, top - cardH, leftW, cardH, 10, C.white, C.line)
    text(page, m.single ? 'How the day went' : 'How the days went', M + 14, top - 20, 10.5, bold, C.dark)
    const total = m.mix.reduce((s, x) => s + x.value, 0)
    const R = 48
    const r = 30
    const cx = M + 14 + R
    const cy = top - 36 - R - 6
    if (total > 0) {
      let a = 0
      for (const s of m.mix.filter((x) => x.value > 0)) {
        const span = (s.value / total) * Math.PI * 2
        // A full ring cannot be one arc: draw it in two halves.
        if (span >= Math.PI * 2 - 1e-6) {
          ringSlice(page, cx, cy, R, r, 0, Math.PI, hex(s.color))
          ringSlice(page, cx, cy, R, r, Math.PI, Math.PI * 2, hex(s.color))
        } else ringSlice(page, cx, cy, R, r, a, a + span, hex(s.color))
        a += span
      }
    } else {
      ringSlice(page, cx, cy, R, r, 0, Math.PI, C.track)
      ringSlice(page, cx, cy, R, r, Math.PI, Math.PI * 2, C.track)
    }
    const came = m.mix[0].value + m.mix[1].value + m.mix[2].value
    const expected = came + m.mix[3].value
    textCenter(page, expected ? `${Math.round((came / expected) * 100)}%` : '—', cx, cy + 1, 14, bold, C.dark)
    textCenter(page, 'came in', cx, cy - 10, 6.8, font, C.muted)
    // Legend, beside the ring.
    let ly = top - 46
    for (const s of m.mix) {
      page.drawRectangle({ x: cx + R + 14, y: ly - 1, width: 7, height: 7, color: col(hex(s.color)) })
      text(page, s.label, cx + R + 25, ly, 7.4, font, C.text)
      textRight(page, String(s.value), M + leftW - 12, ly, 7.4, bold, C.dark)
      ly -= 14
    }
    text(page, fit(`${total} ${m.single ? 'people' : 'person-days'} in this report`, leftW - 28, font, 6.8), M + 14, top - cardH + 12, 6.8, font, C.muted)

    // The bars.
    const bx = M + leftW + gap
    roundRect(page, bx, top - cardH, rightW, cardH, 10, C.white, C.line)
    text(page, m.barsTitle, bx + 14, top - 20, 10.5, bold, C.dark)
    textRight(page, m.barsNote, bx + rightW - 12, top - 19, 6.8, font, C.muted)
    const chartTop = top - 42
    const chartBottom = top - cardH + 30
    const chartH = chartTop - chartBottom
    const chartX = bx + 16
    const chartW = rightW - 32
    page.drawLine({ start: { x: chartX, y: chartBottom }, end: { x: chartX + chartW, y: chartBottom }, thickness: 0.6, color: col(C.line) })
    if (!m.bars.length) {
      textCenter(page, 'Nobody clocked in.', chartX + chartW / 2, chartBottom + chartH / 2, 8.5, font, C.muted)
    } else {
      const max = Math.max(1, ...m.bars.map((b) => b.value))
      const scaleMax = m.single ? max : 100
      const slot = chartW / m.bars.length
      const bw = Math.min(26, slot * 0.66)
      // Light guide lines.
      for (const f of [0.5, 1]) {
        const gy = chartBottom + chartH * f
        page.drawLine({ start: { x: chartX, y: gy }, end: { x: chartX + chartW, y: gy }, thickness: 0.4, color: col(C.stripe) })
      }
      m.bars.forEach((b, i) => {
        const h = (b.value / scaleMax) * (chartH - 12)
        const x = chartX + i * slot + (slot - bw) / 2
        if (h > 0) roundRect(page, x, chartBottom, bw, Math.max(2, h), Math.min(3, bw / 3), b.warn ? C.light : C.brand)
        if (b.text) textCenter(page, b.text, x + bw / 2, chartBottom + h + 3, 6.6, bold, C.dark)
        if (m.bars.length <= 16 || i % Math.ceil(m.bars.length / 16) === 0) {
          textCenter(page, fit(b.label, slot + 6, font, 6), x + bw / 2, chartBottom - 10, 6, font, C.muted)
        }
      })
      // Key.
      const ky = top - cardH + 10
      page.drawRectangle({ x: chartX, y: ky, width: 7, height: 7, color: col(C.brand) })
      text(page, m.single ? 'Before the shift starts' : '80% or more came in', chartX + 10, ky + 1, 6.6, font, C.muted)
      const kx = chartX + 10 + width(m.single ? 'Before the shift starts' : '80% or more came in', 6.6) + 14
      page.drawRectangle({ x: kx, y: ky, width: 7, height: 7, color: col(C.light) })
      text(page, m.single ? 'After it starts (late)' : 'Below 80%', kx + 10, ky + 1, 6.6, font, C.muted)
    }
    y -= cardH + 12
  }

  /* ---------------- 4. stores ---------------- */

  if (m.stores.length > 1) {
    const rowH = 16
    const cardH = 34 + m.stores.length * rowH
    ensure(cardH + 10)
    roundRect(page, M, y - cardH, CW, cardH, 10, C.white, C.line)
    text(page, 'By store', M + 14, y - 20, 10.5, bold, C.dark)
    textRight(page, 'Came in of those expected', W - M - 12, y - 19, 6.8, font, C.muted)
    const nameW = 150
    const barX = M + 14 + nameW
    const barW = CW - nameW - 90
    m.stores.forEach((s, i) => {
      const ry = y - 36 - i * rowH
      text(page, fit(s.name, nameW - 8, font, 7.8), M + 14, ry, 7.8, font, C.text)
      roundRect(page, barX, ry - 1, barW, 7, 3.5, C.track)
      const v = s.expected ? s.came / s.expected : 0
      if (v > 0) roundRect(page, barX, ry - 1, Math.max(7, barW * v), 7, 3.5, v >= 0.8 ? C.brand : C.light)
      textRight(page, `${s.came} / ${s.expected}  ·  ${Math.round(v * 100)}%`, W - M - 14, ry, 7.6, bold, C.dark)
    })
    y -= cardH + 12
  }

  /* ---------------- 5. the account ---------------- */

  {
    const lines = m.story.overview.flatMap((p) => wrap(p, CW - 40, font, 9.2))
    const h = 34 + lines.length * 12.6
    ensure(h + 10)
    roundRect(page, M, y - h, CW, h, 10, C.track)
    page.drawRectangle({ x: M, y: y - h + 10, width: 4, height: h - 20, color: col(C.brand) })
    text(page, m.story.heading, M + 20, y - 20, 10.5, bold, C.dark)
    lines.forEach((l, i) => text(page, l, M + 20, y - 36 - i * 12.6, 9.2, font, C.dark))
    y -= h + 6
  }

  /* ---------------- 6. who needs attention ---------------- */

  if (m.story.sections.length) {
    heading('Who needs attention', 'Most important first')
    for (const sec of m.story.sections) {
      const c = tone(sec.tone)
      const items = sec.items.slice(0, MAX_NAMES)
      const nameW = 150
      const laid = items.map((it) => ({ it, lines: wrap(it.detail, CW - nameW - 40, font, 7.8) }))
      const head = 26
      // A short card stays on one page; a long one keeps its title with its first rows.
      const cardH = head + 4 + laid.reduce((t, l) => t + l.lines.length * 10.6 + 6, 0)
      ensure(cardH <= 260 ? cardH + 10 : head + 3 * 17 + 14)
      roundRect(page, M, y - head, CW, head, 8, C.wash, C.line)
      page.drawRectangle({ x: M, y: y - head, width: 4, height: head, color: col(c) })
      text(page, sec.title, M + 16, y - 17, 10, bold, C.dark)
      const chip = String(sec.items.length)
      const chipW = width(chip, 8, bold) + 14
      roundRect(page, M + 22 + width(sec.title, 10, bold), y - 20, chipW, 13, 6.5, c)
      text(page, chip, M + 29 + width(sec.title, 10, bold), y - 16.5, 8, bold, C.white)
      y -= head + 4
      laid.forEach(({ it, lines }, i) => {
        const h = lines.length * 10.6 + 6
        if (y - h < BOTTOM) newPage()
        if (i % 2 === 1) page.drawRectangle({ x: M + 4, y: y - h, width: CW - 4, height: h, color: col(C.stripe) })
        page.drawCircle({ x: M + 14, y: y - 9, size: 2, color: col(c) })
        text(page, fit(it.name, nameW - 30, bold, 8), M + 22, y - 11, 8, bold, C.text)
        if (it.day) text(page, it.day, M + 22 + Math.min(nameW - 30, width(it.name, 8, bold)) + 5, y - 11, 7, font, C.muted)
        lines.forEach((l, li) => text(page, l, M + nameW + 22, y - 11 - li * 10.6, 7.8, font, C.text))
        y -= h
      })
      if (sec.items.length > MAX_NAMES) {
        text(page, `and ${sec.items.length - MAX_NAMES} more: see the table.`, M + 22, y - 10, 7.6, font, C.muted)
        y -= 14
      }
      y -= 10
    }
  }

  if (m.story.worry.length) {
    heading('Worth a look', 'Patterns over these days')
    for (const w of m.story.worry) {
      const lines = wrap(w, CW - 30, font, 8.2)
      ensure(lines.length * 11 + 6)
      page.drawCircle({ x: M + 6, y: y - 8, size: 2, color: col(C.brand) })
      lines.forEach((l, i) => text(page, l, M + 16, y - 10 - i * 11, 8.2, font, C.text))
      y -= lines.length * 11 + 5
    }
    y -= 6
  }

  /* ---------------- 7. the table ---------------- */

  heading(m.single ? 'Everyone, one by one' : 'Day by day', `${m.rows.length} ${m.rows.length === 1 ? 'row' : 'rows'} · clocked in first`)
  {
    const cols = [
      ...(m.single ? [] : [{ key: 'date', label: 'Day', w: 1.05 }]),
      { key: 'name', label: 'Person', w: 2.2 },
      { key: 'how', label: 'How it went', w: 1.6 },
      { key: 'in', label: 'In', w: 0.6 },
      { key: 'out', label: 'Out', w: 0.6 },
      { key: 'hours', label: 'Hours', w: 0.95 },
      { key: 'from', label: 'From store', w: 0.8 },
      { key: 'notes', label: 'Notes', w: 2.6 },
    ]
    const sum = cols.reduce((s, c) => s + c.w, 0)
    const widths = cols.map((c) => (c.w / sum) * CW)
    const size = 7.4
    const pad = 4.5
    const header = () => {
      const h = 18
      roundRect(page, M, y - h, CW, h, 5, C.dark)
      let x = M
      cols.forEach((c, i) => {
        text(page, c.label, x + pad, y - 12, 7, bold, C.white)
        x += widths[i]
      })
      y -= h + 2
    }
    ensure(60)
    header()
    m.rows.forEach((r, i) => {
      // Room on the right of the notes for "Map".
      const notesW = widths[cols.length - 1] - pad * 2 - (r.map ? width('Map', 6.8, bold) + 6 : 0)
      const notes = wrap(r.notes || ' ', notesW, font, 6.8).slice(0, 4)
      const h = Math.max(24, notes.length * 9 + 12)
      if (y - h < BOTTOM) {
        newPage()
        header()
      }
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col(C.stripe) })
      let x = M
      cols.forEach((c, ci) => {
        const w = widths[ci] - pad * 2
        const ty = y - 11
        switch (c.key) {
          case 'date':
            text(page, fit(r.date, w, font, size), x + pad, ty, size, font, C.text)
            break
          case 'name':
            text(page, fit(r.name, w, bold, size + 0.4), x + pad, ty, size + 0.4, bold, C.text)
            text(page, fit(r.sub, w, font, 6.4), x + pad, ty - 9, 6.4, font, C.muted)
            break
          case 'how': {
            if (r.how) {
              const c2 = tone(r.tone)
              const pw = Math.min(w, width(r.how, 6.8, bold) + 12)
              roundRect(page, x + pad, ty - 4, pw, 13, 6.5, c2)
              text(page, fit(r.how, pw - 10, bold, 6.8), x + pad + 6, ty - 0.5, 6.8, bold, C.white)
            }
            break
          }
          case 'notes':
            notes.forEach((l, li) => text(page, l, x + pad, ty - li * 9, 6.8, font, C.muted))
            if (r.map) {
              const mx = x + widths[ci] - pad - width('Map', 6.8, bold)
              text(page, 'Map', mx, ty, 6.8, bold, C.brand)
              link(page, mx - 1, ty - 2, width('Map', 6.8, bold) + 2, 10, r.map)
            }
            break
          default: {
            const v = (r as unknown as Record<string, string>)[c.key]
            text(page, fit(v || (c.key === 'out' && r.in ? '—' : ''), w, font, size), x + pad, ty, size, font, C.text)
          }
        }
        x += widths[ci]
      })
      y -= h
    })
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: col(C.peach) })
  }

  /* ---------------- footers ---------------- */

  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 36 }, end: { x: W - M, y: 36 }, thickness: 0.6, color: col(C.peach) })
    text(p, fit(`Xtend  ·  Xpel Beauty  ·  Attendance report, ${m.periodLabel}`, CW - 80, font, 7.2), M, 24, 7.2, font, C.muted)
    textRight(p, `Page ${i + 1} of ${pages.length}`, W - M, 24, 7.2, bold, C.brand)
  })

  return await doc.save()
}
