import 'server-only'
import { ApiError } from '@/lib/auth'

export interface ExportRow {
  values: string[]
  /** Rendered as a hyperlink in the link column when present. */
  link?: string | null
}

/**
 * Everything a generated file needs, independent of the format. Attendance
 * and store visits are different tables with different columns; the Excel,
 * Word and PDF writers below should not have to know which is which.
 */
export interface Sheet {
  title: string
  subtitle: string
  sheetName: string
  columns: readonly string[]
  rows: ExportRow[]
  /** Column widths, in Excel characters and in PDF points. */
  widths: { xlsx: number[]; pdf: number[] }
  /** Column index whose cells become hyperlinks, if any. */
  linkColumn?: number
  /** Column index printed in red whenever it is not "on_site". */
  statusColumn?: number
  /** File name without the extension. */
  fileBase: string
}

const BRAND = 'FFC1572A'
const LINK = 'FFC2410C'

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

function download(body: BodyInit, type: string, filename: string) {
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csv(sheet: Sheet) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const body = [
    sheet.columns.map(escape).join(','),
    ...sheet.rows.map((r) => r.values.map(escape).join(',')),
  ].join('\r\n')
  // The BOM is what makes Excel on Windows read this as UTF-8.
  return download(`﻿${body}`, 'text/csv; charset=utf-8', exportFileName(sheet.fileBase, 'csv'))
}

async function xlsx(sheet: Sheet) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Xtend'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheet.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.addRow([...sheet.columns])
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  for (const row of sheet.rows) {
    const added = ws.addRow(row.values)
    if (sheet.linkColumn !== undefined && row.link) {
      const cell = added.getCell(sheet.linkColumn + 1)
      cell.value = { text: 'Open selfie', hyperlink: row.link }
      cell.font = { color: { argb: LINK }, underline: true }
    }
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
          const isLink = index === sheet.linkColumn && row.link
          return new TableCell({
            children: [
              new Paragraph({
                children: isLink
                  ? [
                      new ExternalHyperlink({
                        link: row.link!,
                        children: [
                          new TextRun({ text: 'Open selfie', style: 'Hyperlink', size: 16 }),
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
          new Paragraph({ text: sheet.title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun({ text: sheet.subtitle, italics: true, size: 16 })],
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

  const drawRow = (
    page: Page,
    y: number,
    values: readonly string[],
    isHeader: boolean,
    link: string | null,
  ) => {
    let x = margin
    values.forEach((value, i) => {
      const width = widths[i] ?? 60
      if (!isHeader && i === sheet.linkColumn) {
        if (link) {
          page.drawText('Open selfie', { x: x + 2, y, size, font, color: rgb(0.11, 0.31, 0.85) })
          addLink(page, x + 2, y, width - 4, link)
        } else {
          page.drawText('expired', { x: x + 2, y, size, font, color: rgb(0.45, 0.45, 0.5) })
        }
        x += width
        return
      }

      const max = Math.max(1, Math.floor((width - 4) / (size * 0.5)))
      const text = value.length > max ? `${value.slice(0, max - 1)}…` : value
      const flagged = !isHeader && i === sheet.statusColumn && value !== 'on_site'
      page.drawText(text, {
        x: x + 2,
        y,
        size,
        font: isHeader ? bold : font,
        color: flagged ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.12),
      })
      x += width
    })
  }

  const startPage = () => {
    const page = doc.addPage([pageWidth, pageHeight])
    page.drawText(sheet.title, { x: margin, y: pageHeight - margin - 4, size: 12, font: bold })
    page.drawText(sheet.subtitle, {
      x: margin,
      y: pageHeight - margin - 17,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.45),
    })
    const headerY = pageHeight - margin - 32
    drawRow(page, headerY, sheet.columns, true, null)
    return { page, y: headerY - lineHeight }
  }

  let { page, y } = startPage()

  for (const row of sheet.rows) {
    if (y < margin + lineHeight) {
      ;({ page, y } = startPage())
    }
    drawRow(page, y, row.values, false, row.link ?? null)
    y -= lineHeight
  }

  const bytes = await doc.save()
  return download(
    bytes as unknown as ArrayBuffer,
    'application/pdf',
    exportFileName(sheet.fileBase, 'pdf'),
  )
}
