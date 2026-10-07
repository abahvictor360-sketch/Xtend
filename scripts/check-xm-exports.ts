/**
 * Renders each X Metrics report (grades, stock, reconciliation, supplies)
 * in every format from made-up rows, through a stand-in for the database,
 * and checks each file starts like the file it claims to be.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-xm-exports.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderExport } from '@/lib/export/render'
import { XM_EXPORTS, xmSheet } from '@/lib/metrics/export'

const grade = (i: number) => ({
  month: '2026-09-01',
  user_id: `u${i}`,
  full_name: ['Ada Okafor', 'Bala Yusuf', 'Grace Nnadi'][i % 3],
  score: [37.5, 62.5, 88][i % 3],
  band: ['Poor', 'Average', 'Strong'][i % 3],
  weights: { sales: 40, accuracy: 30, consistency: 20, expiry: 10 },
  bands: { poor_below: 40, strong_from: 70 },
  sales: { score: 50, units_sold: 100, target: 200, target_kind: 'person', store_units_sold: null },
  accuracy: { score: 0, reconciliations: 1, within_tolerance: 0, tolerance_pct: 5 },
  consistency: { score: null, days_present: 0, sales_on_time: 0, counts_in_time: 0 },
  expiry: { score: 100, lines_counted: 3, expiry_recorded: 3, expired_on_shelf: 0 },
})

const TABLES: Record<string, unknown[]> = {
  xm_monthly_grades: [],
  xm_stock_on_hand: Array.from({ length: 40 }, (_, i) => ({
    outlet_id: `o${i % 3}`, product_id: `p${i % 5}`, count_date: '2026-10-05', batch: `B${i}`,
    expiry_date: i % 4 ? '2027-01-15' : null, on_shelf: 20 + i, in_backroom: 5, units: 25 + i,
  })),
  outlets: [0, 1, 2].map((i) => ({ id: `o${i}`, name: ['Ikeja City Mall', 'Wuse Kiosk', 'Port Harcourt Mall'][i] })),
  products: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `Product ${i}`, sku: `SKU-${i}`, unit: 'bottle' })),
  xm_reconciliation_detail: Array.from({ length: 30 }, (_, i) => ({
    count_date: '2026-09-12', outlet_name: 'Ikeja City Mall', staff_name: 'Ada Okafor', product_name: 'Body Oil',
    previous_units: 200, supplied_units: 300, sold_units: 100, expected_units: 400, actual_units: 300 + i,
    variance_units: -100 + i, variance_pct: 25, tolerance_pct: 5, flagged: i % 2 === 0,
  })),
  xm_supply_detail: Array.from({ length: 20 }, (_, i) => ({
    supplied_on: '2026-09-10', outlet_name: 'Wuse Kiosk', product_name: 'Hair Gel', quantity: 300, batch: 'G7',
    expiry_date: '2027-03-01', note: i % 3 ? null : 'Waybill 4471', logged_by_name: 'Ngozi Eze',
    voided_at: i === 4 ? '2026-09-11T10:00:00Z' : null, void_reason: i === 4 ? 'Logged twice' : null,
  })),
}

function fakeDb(): SupabaseClient {
  const builder = (rows: unknown[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
          return () => builder(rows)
        },
      },
    )
  return {
    from: (table: string) => builder(TABLES[table] ?? []),
    rpc: async () => ({ data: [0, 1, 2, 3, 4].map(grade), error: null }),
  } as unknown as SupabaseClient
}

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  pdf: (b) => new TextDecoder().decode(b.slice(0, 5)) === '%PDF-',
  csv: (b) => b.length > 10,
}

async function main() {
  let failed = 0
  for (const kind of XM_EXPORTS) {
    const sheet = await xmSheet(fakeDb(), kind, '2026-09-01', null)
    if (!sheet.rows.length) {
      console.log(`FAIL: ${kind}: no rows`)
      failed++
    }
    if (sheet.rows.some((r) => r.values.length !== sheet.columns.length)) {
      console.log(`FAIL: ${kind}: a row does not match the columns`)
      failed++
    }
    for (const format of Object.keys(SIGNATURES)) {
      const res = await renderExport(format, sheet)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const ok = res.ok && SIGNATURES[format](bytes)
      console.log(`${ok ? 'ok  ' : 'FAIL'}: ${kind}.${format} (${bytes.length} bytes)`)
      if (!ok) failed++
    }
  }
  if (failed) {
    console.log(`\n${failed} FAILED`)
    process.exit(1)
  }
  console.log('\nALL X METRICS EXPORTS OK')
}

void main()
