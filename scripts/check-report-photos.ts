/**
 * Checks report photos in the offline outbox (src/lib/report-photo-queue.ts,
 * migration 0067): one path per photo from the moment it is taken or
 * picked, no second upload on a retry, "already exists" counted as done,
 * old queued jobs given their ids on the first try, and the names the
 * nightly clean-up may touch.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-report-photos.ts
 */
import {
  REPORT_PHOTO_BUCKET,
  isReportPhotoName,
  photoNeedsUpload,
  queuedPhotos,
  reportPhotoPath,
  uploadQueuedPhotos,
  type QueuedPhotoEntry,
  type QueuedReportPhoto,
} from '@/lib/report-photo-queue'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

const uid = '5b0e8a4e-2f53-4a3c-9a43-1c1d2a9e7f10'
const other = '9a1f3d22-7c44-4b1e-8e0a-55aa0b3c4d21'

function paths() {
  check(REPORT_PHOTO_BUCKET === 'reports', 'report photos stay in the reports bucket')
  check(reportPhotoPath(uid, 'abc-123') === `${uid}/report-photo-abc-123.jpg`,
    'a photo is stored in the person\'s own folder under its id')
  let refused = false
  try {
    reportPhotoPath(uid, '../x')
  } catch {
    refused = true
  }
  check(refused, 'an id that is not safe in a path is refused')
  check(isReportPhotoName(reportPhotoPath(uid, crypto.randomUUID())), 'the clean-up knows this name')
  check(isReportPhotoName(`${uid}/${crypto.randomUUID()}.jpg`), 'and the plain names earlier versions used')
  for (const name of [
    `${uid}/count-${crypto.randomUUID()}.jpg`,
    `${uid}/place-sign-${crypto.randomUUID()}.jpg`,
    `${uid}/xm-count-${crypto.randomUUID()}.jpg`,
    `${uid}/count-sheet-${crypto.randomUUID()}.pdf`,
    `${uid}/count-template-${crypto.randomUUID()}.pdf`,
    `${uid}/report-photo-a/b.jpg`,
    `${uid}/${crypto.randomUUID()}_thumb.jpg`,
  ]) {
    check(!isReportPhotoName(name), `never another photo or file: ${name.slice(37)}`)
  }
}

async function queue() {
  const blob = new Blob(['x'])
  // A job queued before 0067 holds bare pictures; one after holds entries.
  const job: { photos: QueuedPhotoEntry[] } = { photos: [blob, { blob, client_id: 'p2' }, blob] }
  const photos = queuedPhotos(job.photos)
  check(photos.length === 3 && photos.every((p) => !!p.client_id) && photos[1] === job.photos[1],
    'old pictures get an id on their first try; entries are kept as they are')
  check(photos[0].client_id !== photos[2].client_id, 'every photo has its own id')
  job.photos = photos
  check(queuedPhotos(job.photos).map((p) => p.client_id).join() === photos.map((p) => p.client_id).join(),
    'and keep it on the next try')

  const stored = new Set<string>()
  const uploads: string[] = []
  let saves = 0
  let failOn: string | null = 'p2'
  const upload = async (path: string, photo: QueuedReportPhoto) => {
    uploads.push(path)
    if (failOn === photo.client_id) {
      failOn = null
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
    await uploadQueuedPhotos(uid, photos, upload, save)
  } catch {
    firstFailed = true
  }
  check(firstFailed && uploads.length === 2 && saves === 1 && !!photos[0].uploaded_path && !photos[1].uploaded_path,
    'a failure part-way stops there, with what went saved on the phone', { uploads, saves })
  const second = await uploadQueuedPhotos(uid, photos, upload, save)
  check(uploads.length === 4 && !uploads.slice(2).includes(photos[0].uploaded_path!),
    'the retry skips the photo already uploaded', uploads)
  check(second.length === 3 && second.every((p, i) => p === reportPhotoPath(uid, photos[i].client_id!)),
    'every photo is listed for the report, in order, at its one path')
  // The report post then fails (or its answer is lost): nothing is uploaded again.
  const before = uploads.length
  const third = await uploadQueuedPhotos(uid, photos, upload, save)
  check(uploads.length === before && third.join() === second.join(),
    'once all are up, a retry uploads nothing and sends the same paths, so the report gets no new rows')
  check(new Set(third).size === 3, 'and no photo is sent twice in one report')

  // The phone lost what it had saved: storage says the photo is there.
  const lost: QueuedReportPhoto[] = [{ blob, client_id: photos[0].client_id }]
  const again = await uploadQueuedPhotos(uid, lost, upload, save)
  check(again[0] === second[0] && lost[0].uploaded_path === again[0],
    '"already there" from storage counts as uploaded, not as a failure')

  // Another account signed in on the same phone: theirs goes up under theirs.
  check(photoNeedsUpload(other, photos[0]) && !photoNeedsUpload(uid, photos[0]),
    'a photo uploaded for someone else goes up again under the person sending')

  let refused = ''
  try {
    await uploadQueuedPhotos(uid, [{ blob, client_id: 'big' }],
      async () => ({ message: 'new row violates row-level security policy', statusCode: '403' }), save)
  } catch (e) {
    refused = e instanceof Error ? e.message : ''
  }
  check(refused.includes('row-level security'), 'any other storage refusal stops the send', refused)
}

async function main() {
  paths()
  await queue()
  if (failed) {
    console.log(`\n${failed} REPORT PHOTO CHECK(S) FAILED`)
    process.exit(1)
  }
  console.log('\nALL REPORT PHOTO CHECKS PASSED')
}

void main()
