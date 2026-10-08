/**
 * X Metrics (migration 043): what the browser and the server both need.
 * The rules themselves (reconciliation, expiry windows, grading) live in
 * Postgres; this only names and shows them.
 */

export interface XmSettings {
  tolerance_pct: number
  weight_sales: number
  weight_accuracy: number
  weight_consistency: number
  weight_expiry: number
  band_poor_below: number
  band_strong_from: number
  alert_windows_days: number[]
  velocity_days: number
  count_interval_days: number
  sales_grace_hours: number
  sales_photo_required: boolean
  updated_at: string
}

export interface XmProduct {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string
  is_active: boolean
  /** Units in one carton, when known (047). */
  units_per_carton?: number | null
}

export interface XmFactor {
  score: number | null
}

export interface XmGrade {
  month: string
  user_id: string
  full_name?: string
  score: number | null
  band: 'Poor' | 'Average' | 'Strong' | null
  weights: { sales: number; accuracy: number; consistency: number; expiry: number }
  bands: { poor_below: number; strong_from: number }
  sales: XmFactor & {
    units_sold: number
    target: number | null
    target_kind: 'person' | 'store' | null
    store_units_sold: number | null
  }
  accuracy: XmFactor & { reconciliations: number; within_tolerance: number; tolerance_pct: number }
  consistency: XmFactor & { days_present: number; sales_on_time: number; counts_in_time: number }
  expiry: XmFactor & { lines_counted: number; expiry_recorded: number; expired_on_shelf: number }
}

/** "2026-10" from a month input, or this month. Always the 1st. */
export function monthStart(value?: string | null): string {
  const m = value && /^(\d{4})-(\d{2})/.exec(value)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}-01`
  const now = new Date(Date.now() + 60 * 60 * 1000) // Lagos is UTC+1
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** How an expiry window reads: 730 is "2 years", 0 is "expired". */
export function windowLabel(days: number): string {
  if (days <= 0) return 'Expired'
  if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`
  if (days % 30 === 0) return days === 30 ? '1 month' : `${days / 30} months`
  return `${days} days`
}

/** The Badge variant for a band. */
export function bandVariant(band: string | null | undefined) {
  if (band === 'Strong') return 'success' as const
  if (band === 'Average') return 'warning' as const
  if (band === 'Poor') return 'destructive' as const
  return 'outline' as const
}

export function fmtScore(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1).replace(/\.0$/, '')}`
}
