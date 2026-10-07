import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/lib/auth'
import type { Sheet } from '@/lib/export/render'
import { fmtScore, monthLabel, windowLabel, type XmGrade } from '@/lib/metrics/shared'

export const XM_EXPORTS = ['grades', 'stock', 'discrepancies', 'supplies'] as const
export type XmExportKind = (typeof XM_EXPORTS)[number]

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Grades for a month: kept ones if the month is finalised, else live. */
async function gradesSheet(db: SupabaseClient, month: string): Promise<Sheet> {
  const { data: kept } = await db
    .from('xm_monthly_grades')
    .select('grade, review_note, profiles:user_id(full_name)')
    .eq('month', month)
  let grades: (XmGrade & { review_note?: string | null })[]
  let status: string
  if (kept && kept.length) {
    grades = kept.map((k) => ({
      ...(k.grade as XmGrade),
      full_name: one(k.profiles as { full_name: string } | { full_name: string }[] | null)?.full_name,
      review_note: k.review_note as string | null,
    }))
    status = 'Finalised'
  } else {
    const { data, error } = await db.rpc('xm_month_grades', { p_month: month })
    if (error) throw new ApiError('Could not work out the grades', 400)
    grades = (data ?? []) as XmGrade[]
    status = 'Live (not yet finalised)'
  }
  grades.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const w = grades[0]?.weights
  return {
    title: `X Metrics grades: ${monthLabel(month)}`,
    subtitle: `${status}. ${grades.length} staff.`,
    notes: w
      ? `Weights: sales vs target ${w.sales}, stock accuracy ${w.accuracy}, reporting consistency ${w.consistency}, expiry handling ${w.expiry}. A factor with nothing to judge it on is left out and the rest scaled to 100.`
      : undefined,
    sheetName: 'Grades',
    columns: ['Staff', 'Score', 'Band', 'Sales', 'Sold / target', 'Accuracy', 'Consistency', 'Expiry', 'Review'],
    rows: grades.map((g) => ({
      values: [
        g.full_name ?? '',
        fmtScore(g.score),
        g.band ?? 'Not graded',
        fmtScore(g.sales.score),
        g.sales.target ? `${g.sales.target_kind === 'store' ? (g.sales.store_units_sold ?? 0) : g.sales.units_sold} / ${g.sales.target}` : 'No target',
        fmtScore(g.accuracy.score),
        fmtScore(g.consistency.score),
        fmtScore(g.expiry.score),
        g.review_note ?? '',
      ],
    })),
    widths: { xlsx: [26, 8, 10, 8, 14, 10, 12, 8, 36], pdf: [120, 40, 55, 40, 70, 50, 60, 40, 160] },
    wrap: true,
    fileBase: `xmetrics-grades-${month.slice(0, 7)}`,
  }
}

/** What is in each store now, batch by batch, from the latest counts. */
async function stockSheet(db: SupabaseClient, outlet: string | null): Promise<Sheet> {
  let q = db
    .from('xm_stock_on_hand')
    .select('outlet_id, product_id, count_date, batch, expiry_date, on_shelf, in_backroom, units')
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .limit(5000)
  if (outlet) q = q.eq('outlet_id', outlet)
  const { data, error } = await q
  if (error) throw new ApiError('Could not read the stock', 400)
  const rows = data ?? []
  const [{ data: outlets }, { data: products }] = await Promise.all([
    db.from('outlets').select('id, name').in('id', [...new Set(rows.map((r) => r.outlet_id))]),
    db.from('products').select('id, name, sku, unit').in('id', [...new Set(rows.map((r) => r.product_id))]),
  ])
  const oName = new Map((outlets ?? []).map((o) => [o.id, o.name as string]))
  const pInfo = new Map((products ?? []).map((p) => [p.id, p as { name: string; sku: string | null; unit: string }]))
  const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10)
  const daysLeft = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000)
  rows.sort((a, b) => (oName.get(a.outlet_id) ?? '').localeCompare(oName.get(b.outlet_id) ?? ''))
  return {
    title: 'X Metrics stock on hand',
    subtitle: `From the latest count of each product in each store. ${rows.length} batches.`,
    sheetName: 'Stock',
    columns: ['Store', 'Product', 'SKU', 'Batch', 'Expiry', 'Time left', 'Shelf', 'Backroom', 'Total', 'Counted'],
    rows: rows.map((r) => {
      const p = pInfo.get(r.product_id)
      const left = r.expiry_date ? daysLeft(r.expiry_date) : null
      return {
        values: [
          oName.get(r.outlet_id) ?? '',
          p?.name ?? '',
          p?.sku ?? '',
          r.batch || '—',
          r.expiry_date ?? 'Not recorded',
          left === null ? '' : left < 0 ? 'Expired' : `${left} days`,
          String(r.on_shelf),
          String(r.in_backroom),
          `${r.units} ${p?.unit ?? ''}`.trim(),
          r.count_date,
        ],
      }
    }),
    widths: { xlsx: [24, 24, 12, 10, 12, 10, 8, 9, 12, 12], pdf: [110, 110, 55, 50, 60, 50, 40, 45, 55, 60] },
    fileBase: 'xmetrics-stock',
  }
}

type Rec = { count_date: string; outlet_id: string; user_id: string }

/** Every reconciliation in a month, gaps first. */
async function discrepancySheet(db: SupabaseClient, month: string, outlet: string | null): Promise<Sheet> {
  let q = db
    .from('xm_reconciliations')
    .select(
      'previous_units, supplied_units, sold_units, expected_units, actual_units, variance_units, variance_pct, tolerance_pct, flagged, product_id, xm_counts!inner(count_date, outlet_id, user_id)',
    )
    .gte('xm_counts.count_date', month)
    .lte('xm_counts.count_date', monthEnd(month))
    .order('variance_pct', { ascending: false })
    .limit(5000)
  if (outlet) q = q.eq('xm_counts.outlet_id', outlet)
  const { data, error } = await q
  if (error) throw new ApiError('Could not read the reconciliations', 400)
  const rows = (data ?? []).map((r) => ({ ...r, c: one(r.xm_counts as unknown as Rec | Rec[]) as Rec }))
  const [{ data: outlets }, { data: products }, { data: people }] = await Promise.all([
    db.from('outlets').select('id, name').in('id', [...new Set(rows.map((r) => r.c.outlet_id))]),
    db.from('products').select('id, name').in('id', [...new Set(rows.map((r) => r.product_id))]),
    db.from('profiles').select('id, full_name').in('id', [...new Set(rows.map((r) => r.c.user_id))]),
  ])
  const name = (list: { id: string; name?: string; full_name?: string }[] | null) =>
    new Map((list ?? []).map((x) => [x.id, (x.name ?? x.full_name) as string]))
  const o = name(outlets), p = name(products), u = name(people)
  return {
    title: `X Metrics stock reconciliation: ${monthLabel(month)}`,
    subtitle: `${rows.length} product counts checked, ${rows.filter((r) => r.flagged).length} outside tolerance.`,
    notes: 'Expected = previous count + supplied since − sold since. A gap above the tolerance is flagged for review.',
    sheetName: 'Reconciliation',
    columns: ['Date', 'Store', 'Counted by', 'Product', 'Previous', 'Supplied', 'Sold', 'Expected', 'Counted', 'Gap', 'Gap %', 'Flagged'],
    rows: rows.map((r) => ({
      values: [
        r.c.count_date,
        o.get(r.c.outlet_id) ?? '',
        u.get(r.c.user_id) ?? '',
        p.get(r.product_id) ?? '',
        String(r.previous_units),
        String(r.supplied_units),
        String(r.sold_units),
        String(r.expected_units),
        String(r.actual_units),
        String(r.variance_units),
        `${r.variance_pct}%`,
        r.flagged ? `Yes (over ${r.tolerance_pct}%)` : 'No',
      ],
    })),
    widths: { xlsx: [11, 22, 20, 22, 9, 9, 8, 9, 9, 8, 8, 14], pdf: [52, 90, 80, 90, 40, 40, 35, 42, 42, 35, 40, 60] },
    fileBase: `xmetrics-reconciliation-${month.slice(0, 7)}`,
  }
}

async function suppliesSheet(db: SupabaseClient, month: string, outlet: string | null): Promise<Sheet> {
  let q = db
    .from('xm_supplies')
    .select('supplied_on, outlet_id, product_id, quantity, batch, expiry_date, note, logged_by, created_at, voided_at, void_reason')
    .gte('supplied_on', month)
    .lte('supplied_on', monthEnd(month))
    .order('supplied_on')
    .limit(5000)
  if (outlet) q = q.eq('outlet_id', outlet)
  const { data, error } = await q
  if (error) throw new ApiError('Could not read the supplies', 400)
  const rows = data ?? []
  const [{ data: outlets }, { data: products }, { data: people }] = await Promise.all([
    db.from('outlets').select('id, name').in('id', [...new Set(rows.map((r) => r.outlet_id))]),
    db.from('products').select('id, name').in('id', [...new Set(rows.map((r) => r.product_id))]),
    db.from('profiles').select('id, full_name').in('id', [...new Set(rows.map((r) => r.logged_by))]),
  ])
  const name = (list: { id: string; name?: string; full_name?: string }[] | null) =>
    new Map((list ?? []).map((x) => [x.id, (x.name ?? x.full_name) as string]))
  const o = name(outlets), p = name(products), u = name(people)
  return {
    title: `X Metrics supplies: ${monthLabel(month)}`,
    subtitle: `${rows.filter((r) => !r.voided_at).length} deliveries${rows.some((r) => r.voided_at) ? `, ${rows.filter((r) => r.voided_at).length} voided` : ''}.`,
    sheetName: 'Supplies',
    columns: ['Supplied', 'Store', 'Product', 'Quantity', 'Batch', 'Expiry', 'Logged by', 'Note', 'Status'],
    rows: rows.map((r) => ({
      values: [
        r.supplied_on,
        o.get(r.outlet_id) ?? '',
        p.get(r.product_id) ?? '',
        String(r.quantity),
        r.batch || '—',
        r.expiry_date ?? '',
        u.get(r.logged_by) ?? '',
        r.note ?? '',
        r.voided_at ? `Voided: ${r.void_reason}` : 'Live',
      ],
    })),
    widths: { xlsx: [11, 22, 22, 9, 10, 11, 20, 28, 20], pdf: [52, 95, 95, 45, 50, 55, 85, 110, 80] },
    wrap: true,
    fileBase: `xmetrics-supplies-${month.slice(0, 7)}`,
  }
}

export async function xmSheet(
  db: SupabaseClient,
  kind: XmExportKind,
  month: string,
  outlet: string | null,
): Promise<Sheet> {
  switch (kind) {
    case 'grades':
      return gradesSheet(db, month)
    case 'stock':
      return stockSheet(db, outlet)
    case 'discrepancies':
      return discrepancySheet(db, month, outlet)
    case 'supplies':
      return suppliesSheet(db, month, outlet)
  }
}
