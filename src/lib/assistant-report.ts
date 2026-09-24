import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportRow, Sheet } from '@/lib/export/render'
import type { ReportSpec } from '@/lib/assistant-report-spec'
import {
  attendanceOnDay,
  attendanceSummary,
  fieldReports,
  staffHistory,
  storeCounts,
  storeVisits,
  type Clock,
} from '@/lib/assistant-data'
import { longDate } from '@/lib/utils'

/** Printable width of an A4 landscape page in the PDF writer, in points. */
const PDF_WIDTH = 794

interface Built {
  columns: string[]
  /** Relative column widths. */
  weights: number[]
  rows: string[][]
  period: string
}

const yesNo = (v: boolean | undefined) => (v ? 'Yes' : 'No')
const time = (c: Clock | null) => c?.time ?? '—'
const status = (c: Clock | null) => c?.status ?? '—'

function period(from: string, to: string) {
  return from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`
}

async function build(supabase: SupabaseClient, spec: ReportSpec): Promise<Built> {
  switch (spec.kind) {
    case 'daily_attendance': {
      const day = await attendanceOnDay(supabase, spec.from)
      const groups: [string, typeof day.not_clocked_in][] = [
        ['Clocked in and out', day.clocked_in_and_out],
        ['On shift, not clocked out', day.still_on_shift_not_clocked_out],
        ['Not clocked in', day.not_clocked_in],
      ]
      return {
        period: period(day.date, day.date),
        columns: ['Staff', 'Role', 'Store', 'Status', 'Clock in', 'Late', 'In status', 'Clock-in location', 'Clock out'],
        weights: [4, 2, 3.5, 3.5, 1.6, 1.2, 1.8, 6, 1.6],
        rows: groups.flatMap(([label, people]) =>
          people.map((p) => [
            p.name,
            p.role,
            p.store ?? '—',
            label,
            time(p.clock_in),
            p.clock_in ? yesNo(p.clock_in.late) : '—',
            status(p.clock_in),
            p.clock_in?.location ?? '—',
            time(p.clock_out),
          ]),
        ),
      }
    }
    case 'attendance_summary': {
      const s = await attendanceSummary(supabase, spec.from, spec.to)
      return {
        period: period(s.from, s.to),
        columns: ['Staff', 'Role', 'Store', 'Days clocked in', 'Days clocked out', 'In but not out', 'Late days', 'Off-site clock-ins'],
        weights: [4, 2, 4, 2, 2, 2, 1.6, 2.2],
        rows: s.people.map((p) => [
          p.name,
          p.role,
          p.store ?? '—',
          String(p.days_clocked_in),
          String(p.days_clocked_out),
          String(p.days_clocked_in_but_not_out),
          String(p.late_days),
          String(p.off_site_clock_ins),
        ]),
      }
    }
    case 'staff_history': {
      const h = await staffHistory(supabase, spec.name, spec.from, spec.to)
      return {
        period: period(h.from, h.to),
        columns: ['Date', 'Staff', 'Clock in', 'Late', 'In status', 'Clock-in location', 'Clock out', 'Out status'],
        weights: [2, 4, 1.6, 1.2, 1.8, 7, 1.6, 1.8],
        rows: h.matches.flatMap((m) =>
          m.history.map((d) => [
            d.date,
            m.name,
            time(d.clock_in),
            d.clock_in ? yesNo(d.clock_in.late) : '—',
            status(d.clock_in),
            d.clock_in?.location ?? '—',
            time(d.clock_out),
            status(d.clock_out),
          ]),
        ),
      }
    }
    case 'field_reports': {
      const r = await fieldReports(supabase, spec.from, spec.to, 2000)
      return {
        period: period(r.from, r.to),
        columns: ['Date', 'Staff', 'Store', 'Sales', 'Stock', 'Competitors', 'Issues', 'Notes'],
        weights: [1.8, 3, 3, 4, 4, 4, 4, 4],
        rows: r.reports.map((x) => [
          x.date,
          x.name ?? '—',
          x.store ?? '—',
          x.sales || '—',
          x.stock || '—',
          x.competitors || '—',
          x.issues || '—',
          x.notes || '—',
        ]),
      }
    }
    case 'store_visits': {
      const v = await storeVisits(supabase, spec.from, spec.to)
      return {
        period: period(v.from, v.to),
        columns: ['Date', 'Staff', 'Store', 'Arrived', 'Left', 'Minutes', 'Arrival status', 'Visit'],
        weights: [2, 4, 6, 1.6, 2, 1.6, 2.2, 1.6],
        rows: v.visits.map((x) => [
          x.date,
          x.name,
          x.store,
          x.arrived,
          x.left,
          x.minutes === null ? '—' : String(x.minutes),
          x.arrived_status ?? '—',
          x.visit_status,
        ]),
      }
    }
    case 'store_counts': {
      const c = await storeCounts(supabase, spec.from, spec.to)
      return {
        period: period(c.from, c.to),
        columns: ['Date', 'Staff', 'Store', 'Product', 'Left in store', 'Sold since last count'],
        weights: [2, 4, 5, 6, 2, 2.4],
        rows: c.counts.map((x) => [
          x.date,
          x.name,
          x.store,
          x.product,
          String(x.in_store),
          String(x.sold),
        ]),
      }
    }
  }
}

/** Builds the report rows, for the assistant to count or for a download. */
export async function buildReportSheet(supabase: SupabaseClient, spec: ReportSpec): Promise<Sheet> {
  const built = await build(supabase, spec)
  const total = built.weights.reduce((a, b) => a + b, 0)
  const rows: ExportRow[] = built.rows.map((values) => ({ values }))

  return {
    title: spec.title,
    subtitle: `${built.period} · ${rows.length} row(s) · times are Africa/Lagos · generated by Ask Xtend`,
    notes: spec.summary || undefined,
    sheetName: 'Report',
    columns: built.columns,
    rows,
    widths: {
      xlsx: built.weights.map((w) => Math.round(w * 6)),
      pdf: built.weights.map((w) => Math.floor((w / total) * PDF_WIDTH)),
    },
    wrap: true,
    fileBase: `xtend-${spec.kind.replace(/_/g, '-')}`,
  }
}
