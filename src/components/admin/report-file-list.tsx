import { Download, FileText } from 'lucide-react'
import { fileSizeLabel, reportFileLabel } from '@/lib/report-files'
import { shortDate } from '@/lib/marketer-report'

/** A document attached to a daily report, as report_file_detail gives it (0064). */
export interface OfficeReportFile {
  id: string
  user_id: string
  staff_name: string
  report_date: string
  name: string
  mime: string
  size_bytes: number
}

/**
 * The documents staff attached to their daily reports, each with a
 * download link. The link goes through /api/report-files/<id>, which checks
 * the reader may see it, records the download and opens a short-lived link.
 */
export function ReportFileList({ files }: { files: OfficeReportFile[] }) {
  if (!files.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No documents were attached to the daily reports in this period.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border">
      {files.map((f) => (
        <li key={f.id} className="flex items-start gap-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{f.name}</p>
            <p className="break-words text-xs text-muted-foreground">
              {f.staff_name} · {shortDate(f.report_date)} · {reportFileLabel(f.mime)}, {fileSizeLabel(f.size_bytes)}
            </p>
          </div>
          <a
            href={`/api/report-files/${f.id}`}
            aria-label={`Download ${f.name}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-xs font-semibold transition-all hover:bg-tint hover:text-tint-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </li>
      ))}
    </ul>
  )
}
