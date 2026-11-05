/**
 * The download formats renderExport() writes. Routes check the format
 * against this list before anything else (and before the audit row), so
 * a mistyped or made-up address is a plain 400 and leaves no junk in the
 * audit log.
 */
export const EXPORT_FORMATS = ['xlsx', 'docx', 'pdf', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value)
}

/**
 * One CSV cell. Quoted, with quotes doubled; and a value that a spreadsheet
 * would run as a formula (starting with = + - @, a tab or a carriage return)
 * gets a leading apostrophe, so a name like "=HYPERLINK(...)" typed into
 * Xtend is shown as text, never run, when the file is opened in Excel.
 * A plain negative number such as -3 or -2.5 stays a number: it cannot run.
 */
export function csvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value) && !/^-\d+(\.\d+)?$/.test(value)
  const safe = formula ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
