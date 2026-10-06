/**
 * Renders a store count sheet from made-up data and checks it is a PDF with
 * fillable fields, the products filled in and a second page when the list
 * is long. Needs no database.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-count-sheet.ts [out.pdf]
 */
import { writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { renderCountSheet } from '@/lib/count-sheet'

function ok(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`ok: ${label}`)
}

async function main() {
  const products = ['Xpel Hair Food 250ml', 'Xpel Shampoo 400ml', 'Xpel Body Lotion 500ml']
  const bytes = await renderCountSheet({
    storeName: 'Justrite Ogba', staffName: 'Maria Etim Udo', date: '2026-10-06',
    occasion: 'Month-end count', products,
  })
  ok(Buffer.from(bytes.slice(0, 5)).toString() === '%PDF-', 'it is a PDF')
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  ok(doc.getPageCount() === 1, 'a short list fits on one page')
  ok(form.getTextField('p1_store').getText() === 'Justrite Ogba', 'the store is filled in')
  ok(form.getTextField('row2_product').getText() === 'Xpel Shampoo 400ml', 'last count\'s products are filled in')
  ok(form.getTextField('row4_product').getText() === undefined, 'spare rows are left blank')
  ok(form.getTextField('row1_in_store').getText() === undefined, 'the numbers are left to fill in')

  const many = Array.from({ length: 40 }, (_, i) => `Product ${i + 1}`)
  const long = await PDFDocument.load(await renderCountSheet({
    storeName: 'Market Square GRA', staffName: 'Anya Christiana Aru', date: '2026-10-06',
    occasion: 'Requested count', products: many,
  }))
  ok(long.getPageCount() >= 2, 'a long list carries on to another page')
  ok(long.getForm().getTextField('row40_product').getText() === 'Product 40', 'every product is listed')

  if (process.argv[2]) await writeFile(process.argv[2], bytes)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
