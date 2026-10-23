/**
 * Checks the daily report documents (src/lib/report-files.ts, migration
 * 0064): which files are taken, the five-file and 10 MB limits, the words
 * staff and the office see, and how the marketer report lists them.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-report-files.ts
 */
import {
  MAX_REPORT_FILES,
  MAX_REPORT_FILE_BYTES,
  REPORT_FILE_ACCEPT,
  REPORT_FILE_TYPES,
  checkReportFiles,
  countSheetStatus,
  downloadName,
  fileSizeLabel,
  reportFileExt,
  reportFileLabel,
  reportFileLine,
  reportFilePath,
  reportFileType,
} from '@/lib/report-files'
import { buildDay, reportFieldsWithDocuments } from '@/lib/marketer-report'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

// The same list the database takes (report_file_mime_ok in 0064).
const SQL_LIST = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]
check(
  JSON.stringify(Object.keys(REPORT_FILE_TYPES).sort()) === JSON.stringify([...SQL_LIST].sort()),
  'the app accepts exactly the types the database accepts',
  Object.keys(REPORT_FILE_TYPES),
)
check(MAX_REPORT_FILES === 5 && MAX_REPORT_FILE_BYTES === 10 * 1024 * 1024, 'five files, 10 MB each')

// Types: by what the phone says, then by the ending.
check(reportFileType({ name: 'a.pdf', type: 'application/pdf' }) === 'application/pdf', 'a PDF is a PDF')
check(reportFileType({ name: 'Plan.DOCX', type: '' }) === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'a Word file with no type is known by its ending, whatever the case')
check(reportFileType({ name: 'old.doc', type: undefined }) === 'application/msword', 'an old Word file')
check(reportFileType({ name: 'prices.xls', type: 'application/vnd.ms-excel' }) === 'application/vnd.ms-excel', 'an old Excel file')
check(reportFileType({ name: 'sheet.xlsx', type: '' }) === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'an Excel file with no type')
check(reportFileType({ name: 'sales.csv', type: 'application/vnd.ms-excel' }) === 'text/csv',
  'a CSV Windows calls Excel is stored as CSV')
check(reportFileType({ name: 'sales.csv', type: 'text/csv' }) === 'text/csv', 'a CSV')
check(reportFileType({ name: 'shelf.jpg', type: 'image/jpg' }) === 'image/jpeg', 'image/jpg is read as JPEG')
check(reportFileType({ name: 'IMG_1.HEIC', type: '' }) === 'image/heic', 'an iPhone picture')
check(reportFileType({ name: 'tool.exe', type: 'application/x-msdownload' }) === null, 'a program is refused')
check(reportFileType({ name: 'notes.txt', type: 'text/plain' }) === null, 'a plain text file is refused')
check(reportFileType({ name: 'archive.zip', type: '' }) === null, 'a zip is refused')
check(reportFileType({ name: 'noending', type: '' }) === null, 'a file with no type and no ending is refused')
check(reportFileType({ name: 'fake.pdf', type: 'application/zip' }) === 'application/pdf',
  'a known ending decides when the phone gives a type not on the list (storage and the database check again)')

for (const end of ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.png']) {
  check(REPORT_FILE_ACCEPT.split(',').includes(end), `the file picker offers ${end}`)
}

// Labels.
check(reportFileLabel('application/pdf') === 'PDF', 'PDF label')
check(reportFileLabel('application/msword') === 'Word' && reportFileLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document') === 'Word', 'Word label')
check(reportFileLabel('application/vnd.ms-excel') === 'Excel', 'Excel label')
check(reportFileLabel('text/csv') === 'CSV', 'CSV label')
check(reportFileLabel('image/png') === 'Picture', 'a picture is "Picture"')
check(reportFileLabel(null) === 'File' && reportFileLabel('application/x-foo') === 'File', 'anything else is "File"')
check(reportFileExt('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') === 'xlsx', 'Excel is stored as .xlsx')
check(reportFileExt('image/jpeg') === 'jpg', 'JPEG is stored as .jpg')

check(fileSizeLabel(0) === '0 B', '0 B')
check(fileSizeLabel(900) === '900 B', '900 B')
check(fileSizeLabel(1024) === '1 KB', '1 KB')
check(fileSizeLabel(850 * 1024) === '850 KB', '850 KB')
check(fileSizeLabel(1.25 * 1024 * 1024) === '1.3 MB', '1.3 MB', fileSizeLabel(1.25 * 1024 * 1024))
check(fileSizeLabel(10 * 1024 * 1024) === '10 MB', '10 MB')
check(fileSizeLabel(null) === '0 B', 'no size reads 0 B')
check(
  reportFileLine({ name: 'Price survey.pdf', mime: 'application/pdf', size_bytes: 1_250_000 }) === 'Price survey.pdf (PDF, 1.2 MB)',
  'a document reads as name (type, size)',
  reportFileLine({ name: 'Price survey.pdf', mime: 'application/pdf', size_bytes: 1_250_000 }),
)

// Limits on what is picked.
function f(name: string, size: number, type = '') {
  return { name, size, type }
}
{
  const { ok, problems } = checkReportFiles(0, [f('a.pdf', 1000), f('b.exe', 10), f('c.pdf', 0), f('d.pdf', MAX_REPORT_FILE_BYTES + 1), f('e.pdf', MAX_REPORT_FILE_BYTES)])
  check(ok.length === 2 && ok[0].file.name === 'a.pdf' && ok[1].file.name === 'e.pdf', 'good files are kept, exactly 10 MB is allowed', ok.map((o) => o.file.name))
  check(problems.length === 3, 'each refused file says why', problems)
  check(problems[0].includes('b.exe') && problems[0].includes('PDF, Word, Excel or CSV'), 'a wrong type is explained', problems[0])
  check(problems[1].includes('empty'), 'an empty file is explained', problems[1])
  check(problems[2].includes('10 MB or smaller'), 'a big file is explained', problems[2])
}
{
  const { ok, problems } = checkReportFiles(3, [f('1.pdf', 5), f('2.pdf', 5), f('3.pdf', 5)])
  check(ok.length === 2 && problems.length === 1 && problems[0].includes('up to 5'), 'no more than five in all, counting those already on the report', problems)
}
check(checkReportFiles(5, [f('x.pdf', 5)]).ok.length === 0, 'none once five are attached')
check(checkReportFiles(7, [f('x.pdf', 5)]).ok.length === 0, 'and never a negative room')

// Paths and names.
const uid = '11111111-2222-3333-4444-555555555555'
check(reportFilePath(uid, 'abc', 'application/pdf') === `${uid}/report-abc.pdf`, 'stored under the person’s own folder')
check(downloadName('Q3 "plan"/final.docx') === 'Q3 _plan_final.docx', 'a download name has no quotes or slashes', downloadName('Q3 "plan"/final.docx'))
check(downloadName('') === 'document', 'an empty name downloads as "document"')

// Count sheets on the You page.
check(countSheetStatus({ request_id: 'r1', count_was_due: true }) === 'For the count your supervisor asked for', 'a sheet for a requested count')
check(countSheetStatus({ request_id: null, count_was_due: true }) === 'For the month-end count', 'a sheet for the month-end count')
check(countSheetStatus({ request_id: null, count_was_due: false }) === 'Received by the office', 'a sheet sent any time')
check(countSheetStatus({ request_id: null }) === 'For the month-end count', 'a sheet from before 0064 reads as a count that was due')

// The marketer report lists them by name.
const day = buildDay('2026-10-16', {
  events: [],
  visits: [],
  reports: [{ report_date: '2026-10-16', created_at: '2026-10-16T16:00:00Z', updated_at: null, body: 'Good day', sales_summary: 'Ten', stock_status: 'Full', competitor_activity: null, issues: null }],
  counts: [],
  sales: [],
  today: '2026-10-17',
  files: [
    { report_date: '2026-10-16', name: 'Price survey.pdf', mime: 'application/pdf', size_bytes: 1_250_000 },
    { report_date: '2026-10-16', name: 'Shelf.jpg', mime: 'image/jpeg', size_bytes: 300_000 },
    { report_date: '2026-10-15', name: 'Other day.pdf', mime: 'application/pdf', size_bytes: 10 },
  ],
})
check(day.report?.documents.length === 2 && day.report.documents[0] === 'Price survey.pdf (PDF, 1.2 MB)',
  'a day’s report carries its own documents only', day.report?.documents)
const printed = day.report ? reportFieldsWithDocuments(day.report) : []
check(printed.length === 6 && printed[5].label === 'Documents attached' && printed[5].text.includes('Shelf.jpg (Picture, 293 KB)'),
  'the PDF and Word reports add a "Documents attached" line', printed[5])
const plain = buildDay('2026-10-15', { events: [], visits: [], counts: [], sales: [], today: '2026-10-17',
  reports: [{ report_date: '2026-10-15', created_at: '2026-10-15T16:00:00Z', updated_at: null, body: 'x', sales_summary: 'y', stock_status: 'z', competitor_activity: null, issues: null }] })
check(plain.report?.documents.length === 0 && reportFieldsWithDocuments(plain.report!).length === 5,
  'a report without documents prints as before')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL REPORT FILE CHECKS PASSED')
