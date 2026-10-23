/**
 * Documents attached to the daily report (migration 0064): which files
 * are taken, how big, and the words people see about them.
 *
 * Pure on purpose (no Supabase, no browser APIs), so
 * scripts/check-report-files.ts can test it. The database applies the same
 * limits (report_file_mime_ok, add_report_file, report_file_limit); these
 * are the friendly first check on the phone.
 */

export const REPORT_FILE_BUCKET = 'report-files'
export const MAX_REPORT_FILES = 5
export const MAX_REPORT_FILE_BYTES = 10 * 1024 * 1024

interface FileType {
  /** What staff see, e.g. "PDF". */
  label: string
  /** File ending kept on the stored file. */
  ext: string
  /** Endings that mean this type when the phone gives no type. */
  endings: string[]
}

/** Every type the database accepts, by the type storage records. */
export const REPORT_FILE_TYPES: Record<string, FileType> = {
  'application/pdf': { label: 'PDF', ext: 'pdf', endings: ['pdf'] },
  'application/msword': { label: 'Word', ext: 'doc', endings: ['doc'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'Word',
    ext: 'docx',
    endings: ['docx'],
  },
  'application/vnd.ms-excel': { label: 'Excel', ext: 'xls', endings: ['xls'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    label: 'Excel',
    ext: 'xlsx',
    endings: ['xlsx'],
  },
  'text/csv': { label: 'CSV', ext: 'csv', endings: ['csv'] },
  'image/jpeg': { label: 'Picture', ext: 'jpg', endings: ['jpg', 'jpeg'] },
  'image/png': { label: 'Picture', ext: 'png', endings: ['png'] },
  'image/webp': { label: 'Picture', ext: 'webp', endings: ['webp'] },
  'image/heic': { label: 'Picture', ext: 'heic', endings: ['heic'] },
  'image/heif': { label: 'Picture', ext: 'heif', endings: ['heif'] },
}

/** For the file picker's accept="…". */
export const REPORT_FILE_ACCEPT = [
  ...Object.keys(REPORT_FILE_TYPES),
  ...Object.values(REPORT_FILE_TYPES).flatMap((t) => t.endings.map((e) => `.${e}`)),
].join(',')

/** Types phones and Windows give that mean one on the list. */
const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'application/csv': 'text/csv',
  'text/comma-separated-values': 'text/csv',
  'application/x-pdf': 'application/pdf',
}

function ending(name: string) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/**
 * The type a picked file is stored as, or null when it is not one that is
 * taken. The file's own ending decides when the phone gives no type, or a
 * vague one (Windows calls a CSV "application/vnd.ms-excel").
 */
export function reportFileType(file: { name: string; type?: string | null }): string | null {
  const given = ALIASES[(file.type ?? '').toLowerCase()] ?? (file.type ?? '').toLowerCase()
  const end = ending(file.name)
  const byEnding = Object.entries(REPORT_FILE_TYPES).find(([, t]) => t.endings.includes(end))?.[0] ?? null
  if (given === 'application/vnd.ms-excel' && end === 'csv') return 'text/csv'
  if (given && REPORT_FILE_TYPES[given]) return given
  return byEnding
}

/** "PDF", "Word", "Excel", "CSV", "Picture" or "File". */
export function reportFileLabel(mime: string | null | undefined) {
  return (mime && REPORT_FILE_TYPES[mime.toLowerCase()]?.label) || 'File'
}

/** The ending the stored copy gets. */
export function reportFileExt(mime: string) {
  return REPORT_FILE_TYPES[mime]?.ext ?? 'bin'
}

/** "850 KB", "2.4 MB". */
export function fileSizeLabel(bytes: number | null | undefined) {
  const b = Math.max(0, Math.round(Number(bytes) || 0))
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  const mb = b / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** "Price survey.pdf (PDF, 1.2 MB)". */
export function reportFileLine(f: { name: string; mime?: string | null; size_bytes?: number | null }) {
  return `${f.name} (${reportFileLabel(f.mime)}, ${fileSizeLabel(f.size_bytes)})`
}

export interface PickedFile {
  name: string
  type?: string | null
  size: number
}

/**
 * Which of the picked files can be added, and why the rest cannot.
 * `already` is how many are on the report or waiting to be sent.
 */
export function checkReportFiles<T extends PickedFile>(already: number, picked: T[]) {
  const ok: { file: T; mime: string }[] = []
  const problems: string[] = []
  let room = Math.max(0, MAX_REPORT_FILES - already)
  for (const file of picked) {
    const mime = reportFileType(file)
    if (!mime) {
      problems.push(`${file.name}: attach a PDF, Word, Excel or CSV file, or a picture.`)
    } else if (file.size <= 0) {
      problems.push(`${file.name}: the file is empty.`)
    } else if (file.size > MAX_REPORT_FILE_BYTES) {
      problems.push(`${file.name}: each document must be 10 MB or smaller.`)
    } else if (room <= 0) {
      problems.push(`${file.name}: a report can have up to ${MAX_REPORT_FILES} documents.`)
    } else {
      ok.push({ file, mime })
      room -= 1
    }
  }
  return { ok, problems }
}

/** The path a document is stored at: always under the person's own folder. */
export function reportFilePath(userId: string, id: string, mime: string) {
  return `${userId}/report-${id}.${reportFileExt(mime)}`
}

/** A name safe for a download's Content-Disposition. */
export function downloadName(name: string) {
  return name.replace(/[^\w .()-]+/g, '_').slice(0, 150) || 'document'
}

/**
 * What a sent stock count sheet is for, as the You page lists it (0064):
 * a count a supervisor asked for, the month-end count, or one sent when no
 * count was due, which the office still receives.
 */
export function countSheetStatus(s: { request_id?: string | null; count_was_due?: boolean | null }) {
  if (s.request_id) return 'For the count your supervisor asked for'
  if (s.count_was_due !== false) return 'For the month-end count'
  return 'Received by the office'
}
