import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { ApiError } from '@/lib/auth'

/*
 * Reading supplies from a file: a CSV or Excel sheet, or a PDF or Word
 * invoice. A sheet with recognisable column headings is read directly;
 * an invoice (or a sheet whose headings mean nothing to us) is read by
 * Claude, which returns the lines as structured data. Either way the
 * admin checks every line before anything is logged.
 */

export type ImportKind = 'csv' | 'xlsx' | 'pdf' | 'docx'

export interface ReadLine {
  description: string
  sku: string | null
  quantity: number | null
  cartons: number | null
  units_per_carton: number | null
  batch: string | null
  expiry_date: string | null
  store: string | null
  supplied_on: string | null
}

export interface ReadFile {
  kind: ImportKind
  read_by: 'table' | 'claude'
  supplier: string | null
  invoice_no: string | null
  invoice_date: string | null
  deliver_to: string | null
  lines: ReadLine[]
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export function importKind(fileName: string, type: string): ImportKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv' || type === 'text/csv') return 'csv'
  if (ext === 'xlsx' || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf'
  if (ext === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  return null
}

/* ------------------------------------------------------------------ */
/* Plain values                                                        */
/* ------------------------------------------------------------------ */

const clean = (v: unknown) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A whole number from "1,200", "24 pcs", "12.0"; null if there is none. */
export function wholeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  const m = clean(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = Math.round(Number(m[0]))
  return n >= 0 && n <= 10_000_000 ? n : null
}

/** YYYY-MM-DD from "2027-03-01", "01/03/2027" (day first), "Mar 2027", an Excel date. */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = clean(v)
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/) // 03/2027: the end of that month
  if (m) return valid(+m[2], +m[1], 0, true)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function valid(y: number, mo: number, d: number, monthEnd = false): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null
  const day = monthEnd ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : d
  const date = new Date(Date.UTC(y, mo - 1, day))
  if (date.getUTCMonth() !== mo - 1) return null
  return date.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* Sheets with headings                                                */
/* ------------------------------------------------------------------ */

type Field = 'product' | 'sku' | 'store' | 'quantity' | 'cartons' | 'per_carton' | 'batch' | 'expiry' | 'date'

const HEADINGS: [Field, RegExp][] = [
  ['per_carton', /^(units?|pcs|pieces|qty)?\s*(per|\/)\s*(carton|ctn|case|box|pack)|^pack\s*size$|^upc$|^case\s*size$/],
  ['cartons', /^(no\.?\s*of\s*)?(cartons?|ctns?|cases?|boxes|box|packs?)(\s*(qty|quantity|supplied))?$/],
  ['quantity', /^(qty|quantity|units?|pcs|pieces)(\s*(supplied|delivered|units?))?$/],
  ['sku', /^(sku|code|item\s*code|product\s*code|barcode|ref)$/],
  ['product', /^(product|item|description|product\s*name|item\s*name|item\s*description|name|particulars)$/],
  ['store', /^(store|outlet|shop|location|branch|customer|deliver(ed)?\s*to|ship\s*to|destination)$/],
  ['batch', /^(batch|lot|batch\s*no\.?|batch\s*number|lot\s*no\.?)$/],
  ['expiry', /^(expiry|exp|expiry\s*date|exp\.?\s*date|best\s*before|bbd|use\s*by)$/],
  ['date', /^(date|date\s*supplied|supplied\s*(on)?|delivery\s*date|delivered\s*(on)?|invoice\s*date)$/],
]

function fieldOf(heading: string): Field | null {
  const h = heading.toLowerCase().replace(/[^a-z0-9/ .]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [field, re] of HEADINGS) if (re.test(h)) return field
  return null
}

/**
 * Reads a grid with a heading row we recognise: the first of the top ten
 * rows naming a product and a quantity (or cartons). Null otherwise.
 */
export function fromGrid(grid: unknown[][]): ReadLine[] | null {
  for (let h = 0; h < Math.min(10, grid.length); h++) {
    const map = new Map<Field, number>()
    grid[h].forEach((cell, i) => {
      const f = fieldOf(clean(cell))
      if (f && !map.has(f)) map.set(f, i)
    })
    if (!(map.has('product') || map.has('sku')) || !(map.has('quantity') || map.has('cartons'))) continue
    const get = (row: unknown[], f: Field) => (map.has(f) ? row[map.get(f)!] : null)
    const lines: ReadLine[] = []
    for (const row of grid.slice(h + 1)) {
      const description = clean(get(row, 'product'))
      const sku = clean(get(row, 'sku')) || null
      const quantity = wholeNumber(get(row, 'quantity'))
      const cartons = wholeNumber(get(row, 'cartons'))
      if (!description && !sku) continue
      if (!quantity && !cartons) continue // a heading, a note
      // Totals and charges are not products.
      if (!sku && /^(sub\s*-?\s*)?total|grand\s*total|^vat\b|^discount|^delivery|^transport|^freight/i.test(description)) continue
      lines.push({
        description: description || sku || '',
        sku,
        quantity: quantity || null,
        cartons: cartons || null,
        units_per_carton: wholeNumber(get(row, 'per_carton')) || null,
        batch: clean(get(row, 'batch')) || null,
        expiry_date: isoDate(get(row, 'expiry')),
        store: clean(get(row, 'store')) || null,
        supplied_on: isoDate(get(row, 'date')),
      })
    }
    return lines.length ? lines : null
  }
  return null
}

function csvGrid(text: string): unknown[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true })
  return parsed.data
}

async function xlsxGrid(buf: ArrayBuffer): Promise<unknown[][]> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buf)
  // The first sheet with anything on it.
  const sheet = book.worksheets.find((w) => w.actualRowCount > 0)
  if (!sheet) return []
  const grid: unknown[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value
      values[col - 1] =
        v && typeof v === 'object' && !(v instanceof Date)
          ? 'result' in v
            ? (v as { result: unknown }).result
            : 'text' in v
              ? (v as { text: unknown }).text
              : 'richText' in v
                ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
                : String(v)
          : v
    })
    grid.push(values)
  })
  return grid
}

/** The text of a Word file: paragraphs on lines, table cells split by tabs. */
export async function docxText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new ApiError('That Word file could not be read', 400)
  return xml
    .replace(/<w:tab\/>/g, '\t')
    // A cell's last paragraph ends the cell, not the line.
    .replace(/<\/w:p>(\s*)<\/w:tc>/g, '</w:tc>')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:p>|<\/w:tr>|<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\t+\n/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Invoices, read by Claude                                            */
/* ------------------------------------------------------------------ */

export function invoiceReadingConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// Optional fields as anyOf a value or null: the documented structured-output form.
const nullable = (type: 'string' | 'integer') => ({ anyOf: [{ type }, { type: 'null' }] })

const SCHEMA = {
  type: 'object',
  properties: {
    supplier: nullable('string'),
    invoice_number: nullable('string'),
    invoice_date: nullable('string'),
    deliver_to: nullable('string'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          sku: nullable('string'),
          quantity_units: nullable('integer'),
          cartons: nullable('integer'),
          units_per_carton: nullable('integer'),
          batch: nullable('string'),
          expiry_date: nullable('string'),
          store: nullable('string'),
        },
        required: ['description', 'sku', 'quantity_units', 'cartons', 'units_per_carton', 'batch', 'expiry_date', 'store'],
        additionalProperties: false,
      },
    },
  },
  required: ['supplier', 'invoice_number', 'invoice_date', 'deliver_to', 'lines'],
  additionalProperties: false,
}

const INSTRUCTIONS = `You read supply documents (invoices, delivery notes, waybills, stock transfer sheets) for a Nigerian beauty and personal-care brand, and list the products delivered.

For each product line give:
- description: the product as written.
- sku: the product or item code if one is printed, else null.
- quantity_units: the number of individual units (pieces, bottles, tubs, bars) if the document states it, else null.
- cartons: the number of cartons, cases, boxes or packs if the document states it, else null. "CTN", "CS", "CTNS" mean cartons.
- units_per_carton: units in one carton if stated (e.g. "24 x 100ml", "12pcs/ctn", pack size), else null.
- batch: batch or lot number if printed, else null.
- expiry_date: expiry or best-before date as YYYY-MM-DD if printed (a month and year means the last day of that month), else null.
- store: the store or branch the line is delivered to, when lines go to different stores, else null.

Also give the supplier's name, the invoice or delivery note number, the document date as YYYY-MM-DD, and deliver_to: the store or address the whole document is delivered to. Use null for anything not shown.

Leave out totals, subtotals, VAT, discounts, transport and other charges: only products. Copy numbers exactly; never guess a quantity. Dates written as 01/03/2027 are day first.`

interface ClaudeRead {
  supplier: string | null
  invoice_number: string | null
  invoice_date: string | null
  deliver_to: string | null
  lines: {
    description: string
    sku: string | null
    quantity_units: number | null
    cartons: number | null
    units_per_carton: number | null
    batch: string | null
    expiry_date: string | null
    store: string | null
  }[]
}

async function readWithClaude(content: Anthropic.Beta.BetaContentBlockParam[]): Promise<Omit<ReadFile, 'kind' | 'read_by'>> {
  if (!invoiceReadingConfigured()) {
    throw new ApiError(
      'Reading PDF and Word invoices is not set up on this server (ANTHROPIC_API_KEY). Use a CSV or Excel file with column headings, or log the supply by hand.',
      400,
    )
  }
  const client = new Anthropic({ timeout: 120_000, maxRetries: 1 })
  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: INSTRUCTIONS,
      messages: [{ role: 'user', content }],
    })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      throw new ApiError('The invoice reader is busy. Try again in a minute.', 503)
    }
    if (error instanceof Anthropic.APIError) {
      console.error('invoice reading failed', error.status, error.message)
      throw new ApiError('That file could not be read. Try a clearer copy, or a CSV or Excel file.', 400)
    }
    throw error
  }
  if (response.stop_reason === 'refusal') throw new ApiError('That file could not be read.', 400)
  if (response.stop_reason === 'max_tokens') {
    throw new ApiError('That document has too many lines to read at once. Split it and import each part.', 400)
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  let read: ClaudeRead
  try {
    read = JSON.parse(text) as ClaudeRead
  } catch {
    throw new ApiError('That file could not be read. Try again.', 400)
  }
  return {
    supplier: clean(read.supplier) || null,
    invoice_no: clean(read.invoice_number) || null,
    invoice_date: isoDate(read.invoice_date),
    deliver_to: clean(read.deliver_to) || null,
    lines: (read.lines ?? [])
      .map((l) => ({
        description: clean(l.description),
        sku: clean(l.sku) || null,
        quantity: wholeNumber(l.quantity_units) || null,
        cartons: wholeNumber(l.cartons) || null,
        units_per_carton: wholeNumber(l.units_per_carton) || null,
        batch: clean(l.batch) || null,
        expiry_date: isoDate(l.expiry_date),
        store: clean(l.store) || null,
        supplied_on: null,
      }))
      .filter((l) => l.description && (l.quantity || l.cartons)),
  }
}

/** Reads a file into supply lines, or says why it cannot. */
export async function readSupplyFile(file: File): Promise<ReadFile> {
  const kind = importKind(file.name, file.type)
  if (!kind) throw new ApiError('Import a CSV, Excel (.xlsx), PDF or Word (.docx) file', 400)
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError('That file is over 10 MB', 400)
  const buf = await file.arrayBuffer()

  if (kind === 'csv' || kind === 'xlsx') {
    let grid: unknown[][]
    try {
      grid = kind === 'csv' ? csvGrid(new TextDecoder().decode(buf)) : await xlsxGrid(buf)
    } catch {
      throw new ApiError(`That ${kind === 'csv' ? 'CSV' : 'Excel'} file could not be opened`, 400)
    }
    const lines = fromGrid(grid)
    if (lines) return { kind, read_by: 'table', supplier: null, invoice_no: null, invoice_date: null, deliver_to: null, lines }
    // No headings we know: let Claude read the sheet as text.
    const text = grid
      .slice(0, 400)
      .map((r) => r.map((c) => clean(c instanceof Date ? c.toISOString().slice(0, 10) : c)).join('\t'))
      .join('\n')
    return { kind, read_by: 'claude', ...(await readWithClaude([{ type: 'text', text: `Supply sheet:\n\n${text}` }])) }
  }

  if (kind === 'pdf') {
    const data = Buffer.from(buf).toString('base64')
    return {
      kind,
      read_by: 'claude',
      ...(await readWithClaude([
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
        { type: 'text', text: 'List the products delivered in this document.' },
      ])),
    }
  }

  const text = await docxText(buf)
  if (!text) throw new ApiError('That Word file is empty', 400)
  return { kind, read_by: 'claude', ...(await readWithClaude([{ type: 'text', text: `Supply document:\n\n${text}` }])) }
}

/* ------------------------------------------------------------------ */
/* Matching lines to products and stores                               */
/* ------------------------------------------------------------------ */

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  )

/** How alike two names are, 0 to 1, by the words they share. */
export function likeness(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / Math.min(x.size, y.size) - Math.abs(x.size - y.size) * 0.02
}

export function bestMatch<T extends { id: string; name: string; sku?: string | null }>(
  items: T[],
  name: string | null,
  sku?: string | null,
): { item: T; how: 'sku' | 'name' | 'close' } | null {
  if (sku) {
    const bySku = items.find((i) => i.sku && i.sku.trim().toLowerCase() === sku.trim().toLowerCase())
    if (bySku) return { item: bySku, how: 'sku' }
  }
  if (!name) return null
  const exact = items.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (exact) return { item: exact, how: 'name' }
  let best: T | null = null
  let score = 0
  for (const i of items) {
    const s = likeness(i.name, name)
    if (s > score) {
      best = i
      score = s
    }
  }
  return best && score >= 0.6 ? { item: best, how: 'close' } : null
}
