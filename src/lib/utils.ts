import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Africa/Lagos is the timezone of record for every human-facing timestamp. */
export const TZ = 'Africa/Lagos'

export function formatLagos(value: string | Date | null | undefined, withDate = true) {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: TZ,
    ...(withDate ? { year: 'numeric', month: 'short', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

export function lagosDateString(d = new Date()) {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

export function metres(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return `${Math.round(value)} m`
  return `${(value / 1000).toFixed(1)} km`
}

/**
 * Calendar helpers for the day strip. Dates are handled as plain
 * YYYY-MM-DD strings anchored at UTC noon, so no timezone shift can push a
 * day across a boundary while we are only doing arithmetic on the label.
 */
function atNoonUtc(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12))
}

export function addDays(dateStr: string, days: number) {
  const d = atNoonUtc(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function dayOfMonth(dateStr: string) {
  return String(atNoonUtc(dateStr).getUTCDate()).padStart(2, '0')
}

export function weekdayShort(dateStr: string) {
  return new Intl.DateTimeFormat('en-NG', { weekday: 'short', timeZone: 'UTC' }).format(
    atNoonUtc(dateStr),
  )
}

export function monthLabel(dateStr: string) {
  return new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(atNoonUtc(dateStr))
    .replace(' ', ', ')
}

export function longDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(atNoonUtc(dateStr))
}
