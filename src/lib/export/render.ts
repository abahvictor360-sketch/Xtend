import 'server-only'
import { ApiError } from '@/lib/auth'
import { csvCell } from '@/lib/export/formats'
import { XPEL_LOGO_PNG, XPEL_LOGO_RATIO } from '@/lib/export/brand-logo'

export interface ExportRow {
  values: string[]
  /** Rendered as a hyperlink in the link column when present. */
  link?: string | null
  /** The links of the sheet's other link columns (linkColumns), in order. */
  links?: (string | null)[]
}

/**
 * Everything a generated file needs, independent of the format. Attendance
 * and store visits are different tables with different columns; the Excel,
 * Word and PDF writers below should not have to know which is which.
 */
export interface Sheet {
  title: string
  subtitle: string
  /**
   * Optional prose above the table: a written summary of what it shows. A
   * line starting "## " is a heading; "• " a point in a list.
   */
  notes?: string
  /** The Xpel Beauty logo at the top (PDF, Word, Excel). */
  logo?: boolean
  /** Wrap long cells over several lines in the PDF instead of cutting them. */
  wrap?: boolean
  sheetName: string
  columns: readonly string[]
  rows: ExportRow[]
  /** Column widths, in Excel characters and in PDF points. */
  widths: { xlsx: number[]; pdf: number[] }
  /** Column index whose cells become hyperlinks, if any. */
  linkColumn?: number
  /** More link columns, filled from each row's `links`. */
  linkColumns?: number[]
  /** The words of those links, and of a row without one. */
  linkText?: string
  noLinkText?: string
  /** Column index printed in red whenever it is not "on_site". */
  statusColumn?: number
  /** File name without the extension. */
  fileBase: string
}

const BRAND = 'FFC1572A'
const LINK = 'FFC2410C'

/** Whether column i holds links, and the link of a row there. */
function linkAt(sheet: Sheet, row: ExportRow | null, i: number): { isLink: boolean; url: string | null } {
  if (i === sheet.linkColumn) return { isLink: true, url: row?.link ?? null }
  const k = sheet.linkColumns?.indexOf(i) ?? -1
  if (k >= 0) return { isLink: true, url: row?.links?.[k] ?? null }
  return { isLink: false, url: null }
}

/** A notes line: a heading ("## "), or plain text. */
const heading = (line: string) => (line.startsWith('## ') ? line.slice(3) : null)

export async function renderExport(format: string, sheet: Sheet) {
  switch (format) {
    case 'xlsx':
      return await xlsx(sheet)
    case 'docx':
      return await docx(sheet)
    case 'pdf':
      return await pdf(sheet)
    case 'csv':
      return csv(sheet)
    default:
      throw new ApiError('Unsupported export format', 400)
  }
}

export function exportFileName(base: string, ext: string) {
  return `${base}-${new Date().toISOString().slice(0, 10)}.${ext}`
}

export function download(body: BodyInit, type: string, filename: string) {
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csv(sheet: Sheet) {
  const body = [
    sheet.columns.map(csvCell).join(','),
    ...sheet.rows.map((r) => r.values.map(csvCell).join(',')),
  ].join('\r\n')
  // The BOM is what makes Excel on Windows read this as UTF-8.
  return download(`﻿${body}`, 'text/csv; charset=utf-8', exportFileName(sheet.fileBase, 'csv'))
}

async function xlsx(sheet: Sheet) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Xtend'
  wb.created = new Date()
  if (sheet.notes) {
    const summary = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
    summary.getColumn(1).width = 110
    if (sheet.logo) {
      const logo = wb.addImage({ buffer: Buffer.from(XPEL_LOGO_PNG) as unknown as ArrayBuffer, extension: 'png' })
      summary.addImage(logo, { tl: { col: 0.05, row: 0.15 }, ext: { width: Math.round(52 * XPEL_LOGO_RATIO), height: 52 } })
      summary.addRow([])
      summary.getRow(1).height = 46
    }
    summary.addRow([sheet.title]).font = { bold: true, size: 14, color: { argb: BRAND } }
    summary.addRow([sheet.subtitle]).font = { italic: true, color: { argb: 'FF6B6B72' } }
    summary.addRow([])
    for (const line of sheet.notes.split('\n')) {
      const h = heading(line)
      const added = summary.addRow([h ?? line])
      added.alignment = { wrapText: true, vertical: 'top' }
      if (h) added.font = { bold: true, size: 12, color: { argb: BRAND } }
    }
  }
  const ws = wb.addWorksheet(sheet.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.addRow([...sheet.columns])
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  for (const row of sheet.rows) {
    const added = ws.addRow(row.values)
    row.values.forEach((_, i) => {
      const { isLink, url } = linkAt(sheet, row, i)
      if (!isLink || !url) return
      const cell = added.getCell(i + 1)
      cell.value = { text: sheet.linkText ?? 'Open selfie', hyperlink: url }
      cell.font = { color: { argb: LINK }, underline: true }
    })
    if (sheet.statusColumn !== undefined && row.values[sheet.statusColumn] !== 'on_site') {
      added.getCell(sheet.statusColumn + 1).font = { color: { argb: 'FFB91C1C' }, bold: true }
    }
  }

  ws.columns.forEach((column, i) => {
    column.width = sheet.widths.xlsx[i] ?? 18
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }

  const buffer = await wb.xlsx.writeBuffer()
  return download(
    buffer as ArrayBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    exportFileName(sheet.fileBase, 'xlsx'),
  )
}

async function docx(sheet: Sheet) {
  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    ExternalHyperlink,
    HeadingLevel,
    WidthType,
    ImageRun,
  } = await import('docx')

  const headerRow = new TableRow({
    tableHeader: true,
    children: sheet.columns.map(
      (label) =>
        new TableCell({
          children: [
            new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16 })] }),
          ],
        }),
    ),
  })

  const bodyRows = sheet.rows.map(
    (row) =>
      new TableRow({
        children: row.values.map((value, index) => {
          const { isLink, url } = linkAt(sheet, row, index)
          return new TableCell({
            children: [
              new Paragraph({
                children: isLink && url
                  ? [
                      new ExternalHyperlink({
                        link: url,
                        children: [
                          new TextRun({ text: sheet.linkText ?? 'Open selfie', style: 'Hyperlink', size: 16 }),
                        ],
                      }),
                    ]
                  : [new TextRun({ text: value, size: 16 })],
              }),
            ],
          })
        }),
      }),
  )

  const doc = new Document({
    sections: [
      {
        children: [
          ...(sheet.logo
            ? [
                new Paragraph({
                  spacing: { after: 160 },
                  children: [new ImageRun({ type: 'png', data: XPEL_LOGO_PNG, transformation: { width: Math.round(48 * XPEL_LOGO_RATIO), height: 48 } })],
                }),
              ]
            : []),
          new Paragraph({ text: sheet.title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun({ text: sheet.subtitle, italics: true, size: 16 })],
          }),
          ...(sheet.notes ?? '')
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
              const h = heading(line)
              return h
                ? new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: h, bold: true, size: 24, color: 'C1572A' })] })
                : new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: line, size: 20 })] })
            }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...bodyRows],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return download(
    new Uint8Array(buffer),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    exportFileName(sheet.fileBase, 'docx'),
  )
}

async function pdf(sheet: Sheet) {
  const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = sheet.logo ? await doc.embedPng(XPEL_LOGO_PNG) : null

  // A4 landscape. A table this wide does not fit any other paper.
  const pageWidth = 842
  const pageHeight = 595
  const margin = 24
  const widths = sheet.widths.pdf
  const size = 7
  const lineHeight = 11

  type Page = ReturnType<typeof doc.addPage>

  /** pdf-lib has no link helper, so the annotation is built by hand. */
  const addLink = (page: Page, x: number, y: number, width: number, url: string) => {
    const annotation = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y - 2, x + width, y + size + 2],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    })
    const existing = page.node.lookup(PDFName.of('Annots'))
    if (existing) {
      // @ts-expect-error pdf-lib types the array loosely here.
      existing.push(doc.context.register(annotation))
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotation)]))
    }
  }

  /**
   * The standard PDF fonts only encode WinAnsi; anything else (a naira sign,
   * an emoji in a report) would throw, so it is spelled out or dropped.
   */
  const safe = (text: string) =>
    text
      .replace(/\u20A6/g, 'NGN ')
      .replace(/[^\s\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '')
      .replace(/\s+/g, ' ')

  type Font = typeof font

  /** Greedy word wrap, breaking words that are wider than the line on their own. */
  const wrap = (text: string, width: number, f: Font, sz: number) => {
    const lines: string[] = []
    let line = ''
    for (const word of safe(text).split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (f.widthOfTextAtSize(next, sz) <= width) {
        line = next
        continue
      }
      if (line) lines.push(line)
      line = word
      while (f.widthOfTextAtSize(line, sz) > width && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && f.widthOfTextAtSize(line.slice(0, cut), sz) > width) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }

  const MAX_CELL_LINES = 8

  /** The lines each cell of a row prints as. */
  const cellLines = (values: readonly string[], isHeader: boolean) =>
    values.map((value, i) => {
      const width = widths[i] ?? 60
      if (!sheet.wrap || isHeader || linkAt(sheet, null, i).isLink) {
        const max = Math.max(1, Math.floor((width - 4) / (size * 0.5)))
        const text = safe(value)
        return [text.length > max ? `${text.slice(0, max - 1)}…` : text]
      }
      const lines = wrap(value, width - 4, font, size)
      if (lines.length <= MAX_CELL_LINES) return lines
      const kept = lines.slice(0, MAX_CELL_LINES)
      kept[MAX_CELL_LINES - 1] = `${kept[MAX_CELL_LINES - 1].slice(0, -1)}…`
      return kept
    })

  const drawRow = (
    page: Page,
    y: number,
    values: readonly string[],
    isHeader: boolean,
    link: string | null,
    cells = cellLines(values, isHeader),
    links: (string | null)[] | undefined = undefined,
  ) => {
    let x = margin
    values.forEach((value, i) => {
      const width = widths[i] ?? 60
      if (!isHeader && linkAt(sheet, null, i).isLink) {
        const url = i === sheet.linkColumn ? link : (links?.[sheet.linkColumns!.indexOf(i)] ?? null)
        if (url) {
          page.drawText(sheet.linkText ?? 'Open selfie', { x: x + 2, y, size, font, color: rgb(0.11, 0.31, 0.85) })
          addLink(page, x + 2, y, width - 4, url)
        } else {
          page.drawText(sheet.noLinkText ?? 'expired', { x: x + 2, y, size, font, color: rgb(0.45, 0.45, 0.5) })
        }
        x += width
        return
      }

      const flagged = !isHeader && i === sheet.statusColumn && value !== 'on_site'
      cells[i].forEach((text, line) => {
        page.drawText(text, {
          x: x + 2,
          y: y - line * lineHeight,
          size,
          font: isHeader ? bold : font,
          color: flagged ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.12),
        })
      })
      x += width
    })
  }

  const startPage = (first: boolean): { page: Page; y: number } => {
    let page = doc.addPage([pageWidth, pageHeight])
    if (logo) {
      const h = first ? 34 : 22
      page.drawImage(logo, { x: pageWidth - margin - h * XPEL_LOGO_RATIO, y: pageHeight - margin - h + 6, width: h * XPEL_LOGO_RATIO, height: h })
    }
    page.drawText(safe(sheet.title), {
      x: margin,
      y: pageHeight - margin - 4,
      size: 12,
      font: bold,
    })
    page.drawText(safe(sheet.subtitle), {
      x: margin,
      y: pageHeight - margin - 17,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.45),
    })
    let headerY = pageHeight - margin - 32

    // The written summary goes on the first page only, above the table.
    if (first && sheet.notes) {
      const noteSize = 9
      const noteLine = 12
      let noteY = headerY - 2
      for (const paragraph of sheet.notes.split('\n')) {
        if (!paragraph.trim()) {
          noteY -= noteLine / 2
          continue
        }
        // A long write-up carries on over the page.
        if (noteY < margin + 40) {
          page = doc.addPage([pageWidth, pageHeight])
          page.drawText(safe(sheet.title), { x: margin, y: pageHeight - margin - 4, size: 12, font: bold })
          noteY = pageHeight - margin - 30
        }
        const h = heading(paragraph)
        if (h) {
          noteY -= 3
          page.drawText(safe(h), { x: margin, y: noteY, size: 10.5, font: bold, color: rgb(0.76, 0.34, 0.16) })
          noteY -= noteLine + 2
          continue
        }
        for (const line of wrap(paragraph, pageWidth - margin * 2, font, noteSize)) {
          if (noteY < margin + 12) {
            page = doc.addPage([pageWidth, pageHeight])
            page.drawText(safe(sheet.title), { x: margin, y: pageHeight - margin - 4, size: 12, font: bold })
            noteY = pageHeight - margin - 30
          }
          page.drawText(line, { x: margin, y: noteY, size: noteSize, font })
          noteY -= noteLine
        }
      }
      headerY = noteY - 10
      // No room left for the table on this page: it starts on the next.
      if (headerY < margin + 60) {
        page = doc.addPage([pageWidth, pageHeight])
        page.drawText(safe(sheet.title), { x: margin, y: pageHeight - margin - 4, size: 12, font: bold })
        headerY = pageHeight - margin - 32
      }
    }

    drawRow(page, headerY, sheet.columns, true, null)
    return { page, y: headerY - lineHeight - (sheet.wrap ? 3 : 0) }
  }

  let { page, y } = startPage(true)

  for (const row of sheet.rows) {
    const cells = cellLines(row.values, false)
    const height = Math.max(...cells.map((c) => c.length)) * lineHeight
    if (y - height + lineHeight < margin + lineHeight) {
      ;({ page, y } = startPage(false))
    }
    drawRow(page, y, row.values, false, row.link ?? null, cells, row.links)
    y -= height + (sheet.wrap ? 3 : 0)
  }

  const bytes = await doc.save()
  return download(
    bytes as unknown as ArrayBuffer,
    'application/pdf',
    exportFileName(sheet.fileBase, 'pdf'),
  )
}
