import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, ApiError } from '@/lib/auth'
import { audit } from '@/lib/audit'
import {
  EXPORT_COLUMNS,
  exportFileName,
  fetchAttendance,
  parseFilter,
  toExportRows,
} from '@/lib/export/data'

export const maxDuration = 60

/** Exports are generated server-side, for whatever filter is applied. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const url = new URL(request.url)
    const filter = parseFilter(url)

    const supabase = await createServerSupabase()
    const rows = await fetchAttendance(supabase, filter)
    const exportRows = await toExportRows(supabase, rows)

    await audit(supabase, `export.${format}`, 'attendance', null, {
      ...filter,
      row_count: rows.length,
    })

    switch (format) {
      case 'xlsx':
        return await xlsx(exportRows)
      case 'docx':
        return await docx(exportRows)
      case 'pdf':
        return await pdf(exportRows)
      case 'csv':
        return csv(exportRows)
      default:
        throw new ApiError('Unsupported export format', 400)
    }
  } catch (error) {
    return apiError(error)
  }
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

function csv(rows: Awaited<ReturnType<typeof toExportRows>>) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const body = [
    EXPORT_COLUMNS.map(escape).join(','),
    ...rows.map((r) => r.values.map(escape).join(',')),
  ].join('\r\n')
  return download(`﻿${body}`, 'text/csv; charset=utf-8', exportFileName('csv'))
}

async function xlsx(rows: Awaited<ReturnType<typeof toExportRows>>) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Xtend'
  wb.created = new Date()
  const ws = wb.addWorksheet('Attendance', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.addRow([...EXPORT_COLUMNS])
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF111827' },
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  for (const row of rows) {
    const added = ws.addRow(row.values)
    if (row.selfieUrl) {
      const cell = added.getCell(EXPORT_COLUMNS.length)
      cell.value = { text: 'Open selfie', hyperlink: row.selfieUrl }
      cell.font = { color: { argb: 'FF1D4ED8' }, underline: true }
    }
    const status = String(row.values[8])
    if (status !== 'on_site') {
      added.getCell(9).font = { color: { argb: 'FFB91C1C' }, bold: true }
    }
  }

  ws.columns.forEach((column, i) => {
    column.width = [24, 12, 10, 18, 22, 42, 18, 12, 12, 16][i] ?? 18
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } }

  const buffer = await wb.xlsx.writeBuffer()
  return download(
    buffer as ArrayBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    exportFileName('xlsx'),
  )
}

async function docx(rows: Awaited<ReturnType<typeof toExportRows>>) {
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
    children: EXPORT_COLUMNS.map(
      (label) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16 })] })],
        }),
    ),
  })

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.values.map((value, index) => {
          const isLink = index === EXPORT_COLUMNS.length - 1 && row.selfieUrl
          return new TableCell({
            children: [
              new Paragraph({
                children: isLink
                  ? [
                      new ExternalHyperlink({
                        link: row.selfieUrl!,
                        children: [new TextRun({ text: 'Open selfie', style: 'Hyperlink', size: 16 })],
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
          new Paragraph({ text: 'Xtend attendance export', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${rows.length} record(s). Times are Africa/Lagos. Selfie links expire one hour after generation.`,
                italics: true,
                size: 16,
              }),
            ],
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
    exportFileName('docx'),
  )
}

async function pdf(rows: Awaited<ReturnType<typeof toExportRows>>) {
  const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  // A4 landscape. Ten columns is a wide table on any other paper.
  const pageWidth = 842
  const pageHeight = 595
  const margin = 24
  const widths = [98, 58, 48, 66, 96, 190, 60, 48, 54, 58]
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

  const drawRow = (page: Page, y: number, values: readonly string[], isHeader: boolean, link: string | null) => {
    let x = margin
    values.forEach((value, i) => {
      const width = widths[i]
      const isLinkCell = !isHeader && i === values.length - 1

      if (isLinkCell) {
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
      const text = value.length > max ? `${value.slice(0, max - 1)}\u2026` : value
      page.drawText(text, {
        x: x + 2,
        y,
        size,
        font: isHeader ? bold : font,
        color: !isHeader && i === 8 && value !== 'on_site' ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.12),
      })
      x += width
    })
  }

  const startPage = () => {
    const page = doc.addPage([pageWidth, pageHeight])
    page.drawText('Xtend attendance export', {
      x: margin,
      y: pageHeight - margin - 4,
      size: 12,
      font: bold,
    })
    page.drawText('Times are Africa/Lagos. Selfie links expire one hour after generation.', {
      x: margin,
      y: pageHeight - margin - 17,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.45),
    })
    const headerY = pageHeight - margin - 32
    drawRow(page, headerY, EXPORT_COLUMNS, true, null)
    return { page, y: headerY - lineHeight }
  }

  let { page, y } = startPage()

  for (const row of rows) {
    if (y < margin + lineHeight) {
      ;({ page, y } = startPage())
    }
    drawRow(page, y, row.values, false, row.selfieUrl)
    y -= lineHeight
  }

  const bytes = await doc.save()
  return download(bytes as unknown as ArrayBuffer, 'application/pdf', exportFileName('pdf'))
}
