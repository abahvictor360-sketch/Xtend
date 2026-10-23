/**
 * Checks the daily report documents (src/lib/report-files.ts, migration
 * 0064): which files are taken, the five-file and 10 MB limits, the words
 * staff and the office see, and how the marketer report lists them; and
 * the offline outbox (0065): one path per picked document, no second
 * upload on a retry, removals that wait for signal, and what staff are
 * told when one arrives after midnight.
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
import {
  REMOVAL_FAILED_NOTICE,
  REMOVAL_LOCKED_NOTICE,
  REMOVAL_NOTICES_KEY,
  abandonedRemovalReason,
  addRemovalNotice,
  isAlreadyExists,
  needsUpload,
  newClientId,
  queuedFilePath,
  removalNotice,
  removalOutcome,
  savedFileView,
  takeRemovalNotices,
  uploadQueuedFiles,
  type NoticeStore,
  type QueuedReportFile,
} from '@/lib/report-file-queue'

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

// ---------------------------------------------------------------------
// The offline outbox (0065): uploads that never repeat, removals that wait.
// ---------------------------------------------------------------------
async function outboxChecks() {
  const cid = newClientId()
  check(/^[\w-]+$/.test(cid) && cid !== newClientId(), 'each picked document gets its own path-safe id', cid)
  const pdf = { client_id: 'c-1', mime: 'application/pdf' }
  check(queuedFilePath(uid, pdf) === `${uid}/report-c-1.pdf` && queuedFilePath(uid, pdf) === queuedFilePath(uid, { ...pdf }),
    'a document always has the same path in the person’s own folder (as add_report_file wants)', queuedFilePath(uid, pdf))
  let threw = false
  try {
    queuedFilePath(uid, { mime: 'application/pdf' })
  } catch {
    threw = true
  }
  check(threw, 'no path without the document’s id')
  check(needsUpload(uid, pdf), 'a document not sent yet is uploaded')
  check(!needsUpload(uid, { ...pdf, uploaded_path: `${uid}/report-c-1.pdf` }), 'a document already sent is not uploaded again')
  check(needsUpload(uid, { ...pdf, uploaded_path: `other/report-c-1.pdf` }), 'one sent under another account on this phone goes up again under this one')

  check(isAlreadyExists({ message: 'The resource already exists', statusCode: '409' }), 'storage’s "already exists" is recognised')
  check(isAlreadyExists({ message: 'x', status: 409 }) && isAlreadyExists({ message: 'Duplicate', statusCode: 'Duplicate' }),
    'by status or by code')
  check(!isAlreadyExists({ message: 'new row violates row-level security policy', statusCode: '403' }) && !isAlreadyExists(null),
    'other storage errors are not taken for success')

  // A report sent three times: fails part-way, then the post fails, then it goes.
  const blob = new Blob(['x'])
  const job = {
    files: [
      { blob, name: 'One.pdf', mime: 'application/pdf', client_id: 'a1' },
      { blob, name: 'Two.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', client_id: 'a2' },
      // queued before 0065: no id yet
      { blob, name: 'Old.csv', mime: 'text/csv' } as QueuedReportFile,
    ] as QueuedReportFile[],
  }
  const stored = new Set<string>()
  const uploads: string[] = []
  let saves = 0
  let failNext: string | null = 'Two.xlsx'
  const upload = async (path: string, file: QueuedReportFile) => {
    uploads.push(path)
    if (failNext === file.name) {
      failNext = null
      return { message: 'Failed to fetch' }
    }
    if (stored.has(path)) return { message: 'The resource already exists', statusCode: '409' }
    stored.add(path)
    return null
  }
  const save = () => {
    saves += 1
  }
  let firstFailed = false
  try {
    await uploadQueuedFiles(uid, job.files, upload, save)
  } catch {
    firstFailed = true
  }
  check(firstFailed && uploads.length === 2 && saves === 1 && job.files[0].uploaded_path === `${uid}/report-a1.pdf`
    && !job.files[1].uploaded_path,
    'a failure part-way stops there, with what went saved on the phone', { uploads, saves })
  const second = await uploadQueuedFiles(uid, job.files, upload, save)
  check(uploads.length === 4 && !uploads.slice(2).includes(`${uid}/report-a1.pdf`),
    'the retry skips the document already uploaded', uploads)
  check(!!job.files[2].client_id && second[2].path === `${uid}/report-${job.files[2].client_id}.csv`,
    'a document queued before 0065 gets its id on the first try and keeps it', second[2])
  check(second.map((f) => f.name).join() === 'One.pdf,Two.xlsx,Old.csv' && second.every((f) => f.path.startsWith(`${uid}/`)),
    'every document is listed for the report, in order')
  // The report post then fails; the third try uploads nothing at all.
  const before = uploads.length
  const third = await uploadQueuedFiles(uid, job.files, upload, save)
  check(uploads.length === before && JSON.stringify(third) === JSON.stringify(second),
    'once all are up, a retry uploads nothing and sends the same paths', uploads.length - before)
  // The phone lost what it had saved after an upload: storage says it is there.
  const lost: QueuedReportFile[] = [{ blob, name: 'One.pdf', mime: 'application/pdf', client_id: 'a1' }]
  const again = await uploadQueuedFiles(uid, lost, upload, save)
  check(again[0].path === `${uid}/report-a1.pdf` && lost[0].uploaded_path === again[0].path,
    '"already there" from storage counts as uploaded, not as a failure')
  let refused = ''
  try {
    await uploadQueuedFiles(uid, [{ blob, name: 'Big.pdf', mime: 'application/pdf', client_id: 'b' }],
      async () => ({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }), save)
  } catch (e) {
    refused = e instanceof Error ? e.message : ''
  }
  check(refused.includes('maximum allowed size'), 'any other storage refusal stops the send', refused)
}

function removalChecks() {
  check(removalOutcome(200, { }) === 'removed', 'a removal that goes through is done')
  check(removalOutcome(404, { code: 'gone', error: 'That document is not on your report' }) === 'gone',
    'one already gone (an earlier try got through) is done too')
  check(removalOutcome(409, { code: 'locked' }) === 'locked', 'one after midnight is refused as locked')
  check(removalOutcome(400, { error: 'Documents can only be removed on the day the report was filed' }) === 'locked',
    'the same, from a server without 0065 yet')
  check(removalOutcome(400, { error: 'That document is not on your report' }) === 'gone', 'and gone, from one without 0065')
  for (const s of [0, 401, 408, 429, 500, 502, 503]) {
    check(removalOutcome(s, { error: 'x' }) === 'retry', `no answer worth keeping (${s}) is tried again`)
  }
  check(removalOutcome(403, { error: 'Only marketers' }) === 'refused', 'any other refusal is final')

  check(REMOVAL_LOCKED_NOTICE === 'This document could not be removed because the report closed at midnight.',
    'the words staff see when it arrived too late')
  check(removalNotice('Price list.pdf', 'locked') === `“Price list.pdf”: ${REMOVAL_LOCKED_NOTICE}`, 'with the document’s name')
  check(!/locat|monitor|track|alert|integrity/i.test(REMOVAL_LOCKED_NOTICE + REMOVAL_FAILED_NOTICE),
    'nothing about how staff are monitored')
  const now = Date.parse('2026-10-24T09:00:00Z')
  check(abandonedRemovalReason('2026-10-23T08:00:00Z', now) === 'locked', 'a removal given up after a day is told as locked')
  check(abandonedRemovalReason('2026-10-24T07:00:00Z', now) === 'failed', 'one given up sooner is told it did not happen')

  // Notices wait for the report page, once each.
  const mem = new Map<string, string>()
  const store: NoticeStore = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  }
  addRemovalNotice(store, removalNotice('A.pdf', 'locked'))
  addRemovalNotice(store, removalNotice('A.pdf', 'locked'))
  addRemovalNotice(store, removalNotice('B.pdf', 'failed'))
  const taken = takeRemovalNotices(store)
  check(taken.length === 2 && taken[0].includes('A.pdf') && taken[1].includes('B.pdf'), 'each notice once, in order', taken)
  check(takeRemovalNotices(store).length === 0, 'and gone once shown')
  for (let i = 0; i < 15; i++) addRemovalNotice(store, `n${i}`)
  check(takeRemovalNotices(store).length === 10, 'no more than ten are kept')
  const broken: NoticeStore = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  addRemovalNotice(broken, 'x')
  check(takeRemovalNotices(broken).length === 0 && takeRemovalNotices(null).length === 0,
    'a phone without storage never breaks the report')
  mem.set(REMOVAL_NOTICES_KEY, '{not json')
  check(takeRemovalNotices(store).length === 0, 'damaged notices are ignored')

  // On the page: waiting removals read "Removing…" and free their place.
  const view = savedFileView([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['b'])
  check(view.files[1].removing && !view.files[0].removing && view.counted === 2,
    'a document waiting to be removed reads "Removing…" and no longer counts towards the five', view)
}

async function main() {
  await outboxChecks()
  removalChecks()
  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL REPORT FILE CHECKS PASSED')
}

void main()
