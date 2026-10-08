/**
 * Checks how supplies are read from files (src/lib/metrics/supply-import.ts):
 * dates and numbers, finding the heading row, a real CSV and Excel file,
 * the text of a Word file, and matching lines to products and stores.
 * PDF and Word invoices are read by Claude and are not called here.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-supply-import.ts
 */
import ExcelJS from 'exceljs'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import { bestMatch, docxText, fromGrid, isoDate, readSupplyFile, wholeNumber } from '@/lib/metrics/supply-import'

let failed = 0
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}`)
  if (!ok) failed++
}

check(isoDate('01/03/2027') === '2027-03-01', 'a slashed date is read day first')
check(isoDate('2027-3-1') === '2027-03-01', 'an ISO date is kept')
check(isoDate('03/2027') === '2027-03-31', 'a month and year is the end of that month')
check(isoDate('31/02/2027') === null, 'a date that does not exist is dropped')
check(isoDate(new Date(Date.UTC(2027, 0, 15))) === '2027-01-15', 'an Excel date is read')
check(wholeNumber('1,200 pcs') === 1200 && wholeNumber('12.0') === 12 && wholeNumber('n/a') === null, 'numbers are read from text')

const grid = [
  ['XPEL DISTRIBUTORS', '', '', ''],
  ['Invoice 0042', '', '', ''],
  ['Item Code', 'Description', 'CTNS', 'Pcs/Ctn', 'Batch No', 'Exp. Date'],
  ['ARG-100', 'Argan Oil 100ml', '10', '24', 'A12', '03/2028'],
  ['BSP-1', 'Black Soap Bar', '3', '', '', ''],
  ['', 'TOTAL', '13', '', '', ''],
]
const lines = fromGrid(grid)!
check(lines?.length === 2, 'the heading row is found below a letterhead, and the total row is left out')
check(lines[0].sku === 'ARG-100' && lines[0].cartons === 10 && lines[0].units_per_carton === 24, 'cartons and units per carton are read')
check(lines[0].expiry_date === '2028-03-31' && lines[0].batch === 'A12', 'batch and expiry are read')
check(fromGrid([['Colour', 'Size'], ['Red', 'L']]) === null, 'a sheet with no product or quantity column is not guessed at')

const products = [
  { id: 'p1', name: 'Argan Oil 100ml', sku: 'ARG-100' },
  { id: 'p2', name: 'Xpel Black Soap', sku: null },
  { id: 'p3', name: 'Hair Food 250g', sku: 'HF-250' },
]
check(bestMatch(products, 'whatever', 'arg-100')?.how === 'sku', 'a product is matched by its SKU first')
check(bestMatch(products, 'Black Soap Bar')?.item.id === 'p2', 'a close name is matched')
check(bestMatch(products, 'Shea Butter') === null, 'an unknown product is left for the admin to choose')
check(bestMatch([{ id: 's1', name: 'Justrite Superstore Bariga' }], 'JUSTRITE BARIGA')?.item.id === 's1', 'a store is matched by its name')

async function main() {
  const csv = new File(['Product,Qty,Store,Expiry\nArgan Oil 100ml,240,Ikeja City Mall,2027-12-31\nHair Food 250g,"1,000",Wuse Kiosk,\n'], 'supply.csv', { type: 'text/csv' })
  const c = await readSupplyFile(csv)
  check(c.read_by === 'table' && c.lines.length === 2 && c.lines[1].quantity === 1000 && c.lines[0].store === 'Ikeja City Mall', 'a CSV with headings is read directly')

  const book = new ExcelJS.Workbook()
  const ws = book.addWorksheet('Delivery')
  ws.addRow(['Description', 'Cartons', 'Units per carton', 'Batch', 'Expiry'])
  ws.addRow(['Argan Oil 100ml', 5, 24, 'B7', new Date(Date.UTC(2028, 5, 30))])
  const buf = await book.xlsx.writeBuffer()
  const x = await readSupplyFile(new File([buf], 'delivery.xlsx'))
  check(x.read_by === 'table' && x.lines[0].cartons === 5 && x.lines[0].units_per_carton === 24 && x.lines[0].expiry_date === '2028-06-30', 'an Excel sheet is read directly, dates included')

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph('Waybill W-77 to Ikeja City Mall'),
        new Table({ rows: [
          new TableRow({ children: ['Item', 'Ctns'].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
          new TableRow({ children: ['Argan Oil 100ml', '4'].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
        ] }),
      ],
    }],
  })
  const text = await docxText(await (await Packer.toBlob(doc)).arrayBuffer())
  check(text.includes('Waybill W-77') && /Argan Oil 100ml\t4/.test(text), 'a Word file gives its text, table cells split by tabs')

  let refused = ''
  try { await readSupplyFile(new File(['x'], 'photo.jpg')) } catch (e) { refused = (e as Error).message }
  check(/CSV, Excel/.test(refused), 'other file types are refused')

  if (failed) {
    console.log(`\n${failed} FAILED`)
    process.exit(1)
  }
  console.log('\nALL SUPPLY IMPORT CHECKS OK')
}
void main()
