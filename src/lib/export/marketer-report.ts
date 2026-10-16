import type { MarketerReport } from '@/lib/marketer-report'
import { marketerReportPdf } from '@/lib/export/marketer-report-pdf'
import { marketerReportDocx } from '@/lib/export/marketer-report-docx'
import { marketerReportXlsx } from '@/lib/export/marketer-report-xlsx'

export const MARKETER_REPORT_FORMATS = ['pdf', 'docx', 'xlsx'] as const
export type MarketerReportFormat = (typeof MARKETER_REPORT_FORMATS)[number]
export const isMarketerReportFormat = (v: string): v is MarketerReportFormat =>
  (MARKETER_REPORT_FORMATS as readonly string[]).includes(v)

const TYPES: Record<MarketerReportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** The marketer's report as a file to download: PDF, Word or Excel. */
export async function renderMarketerReport(format: MarketerReportFormat, report: MarketerReport) {
  const bytes =
    format === 'pdf'
      ? await marketerReportPdf(report)
      : format === 'docx'
        ? await marketerReportDocx(report)
        : await marketerReportXlsx(report)
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': TYPES[format],
      'Content-Disposition': `attachment; filename="${report.fileBase}.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
}
