import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface CountSheetInput {
  storeName: string
  staffName: string
  /** Lagos business date, YYYY-MM-DD. */
  date: string
  /** "Month-end count" or "Requested count", shown in the heading. */
  occasion: string
  /** Products from the person's last count at this store, pre-filled. */
  products: string[]
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 40
const ROW_H = 22
const COLS = [
  { key: 'product', label: 'Product', width: 315 },
  { key: 'in_store', label: 'Left in store', width: 100 },
  { key: 'sold', label: 'Sold since last count', width: 100 },
] as const

/**
 * A store's count sheet: a PDF with boxes that can be typed into on a phone
 * or computer, and that prints as a clean form to fill in by pen. The
 * products from the last count are filled in, with spare rows below.
 */
export async function renderCountSheet(input: CountSheetInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(`Store count sheet: ${input.storeName}, ${input.date}`)
  doc.setAuthor('Xtend, Xpel Beauty')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const form = doc.getForm()
  const ink = rgb(0.1, 0.1, 0.12)
  const muted = rgb(0.42, 0.42, 0.47)
  const line = rgb(0.75, 0.75, 0.78)
  const brand = rgb(0.82, 0.33, 0.11)

  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null
  try {
    logo = await doc.embedPng(await readFile(path.join(process.cwd(), 'public/brand/xpel-logo.png')))
  } catch {
    // Without the logo file the sheet is still complete.
  }

  const rowCount = Math.max(24, input.products.length + 6)
  const tableWidth = COLS.reduce((sum, c) => sum + c.width, 0)
  let row = 0
  let pageNo = 0

  while (row < rowCount) {
    pageNo += 1
    const page = doc.addPage([A4.width, A4.height])
    let y = A4.height - MARGIN

    if (logo) {
      const h = 26
      const w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: MARGIN, y: y - h, width: w, height: h })
    }
    page.drawText('Store count sheet', {
      x: A4.width - MARGIN - bold.widthOfTextAtSize('Store count sheet', 16),
      y: y - 18, size: 16, font: bold, color: ink,
    })
    y -= 40
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 2, color: brand })
    y -= 22

    // Who, where and when: filled in, still editable.
    const details: [string, string][] = [
      ['Store', input.storeName],
      ['Counted by', input.staffName],
      ['Date', input.date],
      ['Count', input.occasion],
    ]
    for (let i = 0; i < details.length; i += 2) {
      for (let j = 0; j < 2; j++) {
        const [label, value] = details[i + j]
        const x = MARGIN + j * (tableWidth / 2)
        page.drawText(label, { x, y, size: 8, font: bold, color: muted })
        const field = form.createTextField(`p${pageNo}_${label.toLowerCase().replace(/\s+/g, '_')}`)
        field.setText(value)
        field.addToPage(page, {
          x, y: y - 20, width: tableWidth / 2 - 12, height: 16, font,
          borderWidth: 0, textColor: ink,
        })
        field.setFontSize(10)
        page.drawLine({ start: { x, y: y - 21 }, end: { x: x + tableWidth / 2 - 12, y: y - 21 }, thickness: 0.6, color: line })
      }
      y -= 34
    }
    y -= 6

    // The table header.
    let x = MARGIN
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: tableWidth, height: ROW_H, color: rgb(0.96, 0.93, 0.91) })
    for (const col of COLS) {
      page.drawText(col.label, { x: x + 6, y: y - 15, size: 9, font: bold, color: ink })
      x += col.width
    }
    y -= ROW_H

    const bottom = MARGIN + 70
    while (row < rowCount && y - ROW_H >= bottom) {
      x = MARGIN
      for (const col of COLS) {
        page.drawRectangle({ x, y: y - ROW_H, width: col.width, height: ROW_H, borderColor: line, borderWidth: 0.6 })
        const field = form.createTextField(`row${row + 1}_${col.key}`)
        if (col.key === 'product' && input.products[row]) field.setText(input.products[row])
        field.addToPage(page, {
          x: x + 3, y: y - ROW_H + 3, width: col.width - 6, height: ROW_H - 6, font,
          borderWidth: 0, textColor: ink,
        })
        field.setFontSize(10)
        if (col.key !== 'product') field.setMaxLength(7)
        x += col.width
      }
      y -= ROW_H
      row += 1
    }

    // Signature and how to send it, on every page.
    page.drawText('Signature', { x: MARGIN, y: MARGIN + 46, size: 8, font: bold, color: muted })
    page.drawLine({ start: { x: MARGIN + 50, y: MARGIN + 45 }, end: { x: MARGIN + 260, y: MARGIN + 45 }, thickness: 0.6, color: line })
    page.drawText(
      'Count what is physically in the store. When it is filled in, open Xtend > Store count > Upload filled sheet.',
      { x: MARGIN, y: MARGIN + 20, size: 8, font, color: muted },
    )
    page.drawText(`Page ${pageNo}`, {
      x: A4.width - MARGIN - font.widthOfTextAtSize(`Page ${pageNo}`, 8), y: MARGIN + 20, size: 8, font, color: muted,
    })
  }

  form.updateFieldAppearances(font)
  return doc.save()
}
