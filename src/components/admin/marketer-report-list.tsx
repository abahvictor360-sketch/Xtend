import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { minutesText, reportQuery, type ReportKind } from '@/lib/marketer-report'
import { cn } from '@/lib/utils'

/** A row of the Marketer reports page (loadMarketerRows). */
export interface MarketerListRow {
  id: string
  name: string
  role: string
  team: string | null
  visits: number
  stores: number
  minutes: number
  reports: number
  active: boolean
}

const FORMATS = [
  { format: 'pdf', label: 'PDF', icon: FileText, primary: true },
  { format: 'docx', label: 'Word', icon: FileText, primary: false },
  { format: 'xlsx', label: 'Excel', icon: FileSpreadsheet, primary: false },
] as const

/** Each person with their figures for the period and the three downloads. */
export function MarketerReportList({ rows: shown, kind, periodKey: key }: { rows: MarketerListRow[]; kind: ReportKind; periodKey: string }) {
  return (
    <>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No marketers to show.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 py-3 xl:flex-row xl:items-center">
              <div className="min-w-0 flex-1 xl:min-w-[11rem]">
                <p className="truncate text-sm font-semibold">
                  {r.name}
                  {!r.active && <span className="ml-2 text-xs font-normal text-muted-foreground">(switched off)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.role}
                  {r.team ? ` · ${r.team}’s team` : ''}
                </p>
              </div>
              <dl className="grid grid-cols-4 gap-2 text-xs xl:w-[21rem] xl:shrink-0">
                <Stat label="Visits" value={String(r.visits)} />
                <Stat label="Stores" value={String(r.stores)} />
                <Stat label="Time" value={r.visits ? minutesText(r.minutes) : '—'} />
                <Stat label="Reports" value={String(r.reports)} />
              </dl>
              <div className="flex shrink-0 flex-wrap gap-2">
                {FORMATS.map((f) => (
                  <a
                    key={f.format}
                    href={`/api/admin/export/marketer-report/${f.format}?${reportQuery(r.id, kind, key)}`}
                    download
                    aria-label={`Download ${f.label} report for ${r.name}`}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all',
                      f.primary
                        ? 'bg-brand text-primary-foreground shadow-lift hover:bg-brand-deep'
                        : 'border border-input bg-card hover:bg-tint hover:text-tint-foreground',
                    )}
                  >
                    {f.primary ? <Download className="h-3.5 w-3.5" /> : <f.icon className="h-3.5 w-3.5" />}
                    {f.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-tint/60 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="whitespace-nowrap font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
