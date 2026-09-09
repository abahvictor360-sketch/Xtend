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
