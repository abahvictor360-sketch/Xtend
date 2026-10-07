import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The Xpel stock count sheet as an Excel file, laid out like Xpel's own
 * sheet: company name, the month being counted, store name, date and
 * location, then every product on the sheet (migration 038) with its
 * barcode and columns for the back store, the shop floor, their total and
 * the expiry date. Built from the product list each time, so it always
 * matches what the app counts.
 */

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

/** "OCTOBER 2026" for a YYYY-MM-DD date. */
export function countMonth(date: string) {
  const [year, month] = date.split('-').map(Number)
  return `${MONTHS[(month ?? 1) - 1]} ${year}`
}

/** XPEL_OCTOBER_2026_STOCK_COUNT_SHEET.xlsx */
export function countSheetFileName(date: string, store?: string | null) {
  const part = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `XPEL_${part(countMonth(date))}_STOCK_COUNT_SHEET${store ? `_${part(store).slice(0, 40)}` : ''}.xlsx`
}

export async function sheetProducts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('products')
    .select('name, barcode')
    .not('sheet_order', 'is', null)
    .eq('is_active', true)
    .order('sheet_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as { name: string; barcode: string | null }[]
}

export async function buildCountSheet({
  products,
  date,
  store,
  location,
}: {
  products: { name: string; barcode: string | null }[]
  /** The day the sheet is for, YYYY-MM-DD; its month names the sheet. */
  date: string
  store?: string | null
  location?: string | null
}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Xtend'
  wb.created = new Date()
  const month = countMonth(date)
  const ws = wb.addWorksheet(`${month} count`.slice(0, 31), {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 7 }],
  })
  ws.pageSetup.printTitlesRow = '7:7'

  ws.columns = [
    { width: 16 },
    { width: 70 },
    { width: 11 },
    { width: 11 },
    { width: 10 },
    { width: 13 },
  ]

  const thin = { style: 'thin' as const }
  const medium = { style: 'medium' as const }
  const box = (b: { style: 'thin' | 'medium' }) => ({ top: b, left: b, bottom: b, right: b })

  ws.mergeCells('A1:F1')
  ws.getCell('A1').value = 'XPEL PHARMACEUTICAL COMPANY LTD'
  ws.getCell('A1').font = { name: 'Calibri', size: 20, bold: true }
  ws.mergeCells('A2:F2')
  ws.getCell('A2').value = `${month} STOCK COUNT SHEET`
  ws.getCell('A2').font = { name: 'Calibri', size: 16, bold: true }
  for (const cell of ['A1', 'A2']) {
    ws.getCell(cell).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    ws.getCell(cell).border = box(medium)
  }
  ws.getRow(1).height = 30
  ws.getRow(2).height = 24

  const [y, m, d] = date.split('-')
  ws.mergeCells('A4:B4')
  ws.getCell('A4').value = `STORE NAME: ${store ?? ''}`
  ws.mergeCells('C4:F4')
  ws.getCell('C4').value = `DATE: ${store ? `${d}/${m}/${y}` : ''}`
  ws.mergeCells('A5:B5')
  ws.getCell('A5').value = `LOCATION: ${location ?? ''}`
  for (const cell of ['A4', 'C4', 'A5']) {
    ws.getCell(cell).font = { name: 'Calibri', size: 11, bold: true }
    ws.getCell(cell).alignment = { horizontal: 'left', vertical: 'middle' }
    ws.getCell(cell).border = box(medium)
  }

  const header = ws.getRow(7)
  header.values = ['BARCODE', 'PRODUCT', 'BACK STORE', 'SHOP FLOOR', 'TOTAL', 'EXPIRY DATE']
  header.height = 29
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = box(medium)
  })

  products.forEach((p, i) => {
    const r = 8 + i
    const row = ws.getRow(r)
    row.getCell(1).value = p.barcode ?? ''
    row.getCell(1).numFmt = '@'
    row.getCell(1).alignment = { horizontal: 'right' }
    row.getCell(2).value = p.name
    row.getCell(5).value = { formula: `IF(COUNT(C${r}:D${r})=0,"",SUM(C${r}:D${r}))` }
    row.getCell(6).numFmt = 'dd/mm/yyyy'
    for (let c = 1; c <= 6; c++) {
      row.getCell(c).border = box(thin)
      row.getCell(c).font = { name: 'Calibri', size: 11 }
    }
  })

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
