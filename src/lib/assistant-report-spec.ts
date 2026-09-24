import { z } from 'zod'

/**
 * A report the assistant asked for. It carries no rows: the download route
 * rebuilds them from the database for whoever clicks, so a report can only
 * ever contain what that person is allowed to see, and nothing the model
 * typed can end up in a table.
 */
export const REPORT_KINDS = [
  'daily_attendance',
  'attendance_summary',
  'staff_history',
  'field_reports',
  'store_visits',
] as const

export type ReportKind = (typeof REPORT_KINDS)[number]

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const reportSpecSchema = z.object({
  kind: z.enum(REPORT_KINDS),
  from: date,
  to: date.nullable(),
  name: z.string().trim().max(80).nullable(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000),
})

export type ReportSpec = z.infer<typeof reportSpecSchema>

export const REPORT_FORMATS = [
  { id: 'pdf', label: 'PDF' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'docx', label: 'Word' },
  { id: 'csv', label: 'CSV' },
] as const

export function reportDownloadUrl(spec: ReportSpec, format: string) {
  const params = new URLSearchParams({ kind: spec.kind, from: spec.from, title: spec.title })
  if (spec.to) params.set('to', spec.to)
  if (spec.name) params.set('name', spec.name)
  if (spec.summary) params.set('summary', spec.summary)
  return `/api/admin/ask/report/${format}?${params.toString()}`
}

export function parseReportSpec(url: URL) {
  const get = (k: string) => url.searchParams.get(k)
  return reportSpecSchema.safeParse({
    kind: get('kind'),
    from: get('from'),
    to: get('to'),
    name: get('name'),
    title: get('title'),
    summary: get('summary') ?? '',
  })
}
