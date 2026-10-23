/**
 * Report photos in the phone's offline outbox (0067), the same way report
 * documents work (0065, report-file-queue.ts): each photo keeps one id from
 * the moment it is taken or picked, so a retry finds the copy it already
 * uploaded instead of sending it again under a new name.
 *
 * Pure on purpose (no Supabase, no browser APIs), so
 * scripts/check-report-photos.ts can test it.
 */
import { isAlreadyExists, newClientId } from '@/lib/report-file-queue'

/** The bucket report photos share with count, store and place photos. */
export const REPORT_PHOTO_BUCKET = 'reports'

/** A photo waiting in a queued report. */
export interface QueuedReportPhoto {
  blob: Blob
  /** Given when the photo is taken or picked (0067). */
  client_id?: string
  /** Where it was uploaded, once it has been. */
  uploaded_path?: string
}

/** Jobs queued before 0067 hold bare pictures; both shapes are read. */
export type QueuedPhotoEntry = Blob | QueuedReportPhoto

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

/**
 * The one place a report photo is stored: the person's own folder (the
 * storage rule) and the id it was given, so every retry names the same
 * file. The database's clean-up (report_photo_orphans) knows this name.
 */
export function reportPhotoPath(userId: string, clientId: string) {
  if (!SAFE_ID.test(clientId)) throw new Error('A photo needs its id before it is uploaded')
  return `${userId}/report-photo-${clientId}.jpg`
}

/**
 * Names the clean-up may delete when on no report: this version's and the
 * plain <user id>/<uuid>.jpg earlier versions used. The same test as the
 * database's report_photo_orphans_before().
 */
export function isReportPhotoName(name: string) {
  return /^[0-9a-f-]{36}\/(report-photo-[A-Za-z0-9-]{1,64}|[0-9a-f-]{36})\.jpg$/.test(name)
}

function isEntry(entry: QueuedPhotoEntry): entry is QueuedReportPhoto {
  return typeof entry === 'object' && entry !== null && 'blob' in entry && !(entry instanceof Blob)
}

/**
 * The photos of a queued report as entries with an id. A bare picture
 * from a job queued before 0067 is wrapped and given its id now, on its
 * first try; entries already wrapped are returned as they are (the same
 * objects), so progress saved on them stays with the job.
 */
export function queuedPhotos(photos: QueuedPhotoEntry[] | undefined): QueuedReportPhoto[] {
  return (photos ?? []).map((entry) => {
    const photo: QueuedReportPhoto = isEntry(entry) ? entry : { blob: entry }
    if (!photo.client_id || !SAFE_ID.test(photo.client_id)) photo.client_id = newClientId()
    return photo
  })
}

/**
 * Whether this photo still has to be uploaded for this person. One
 * uploaded under somebody else's folder (another account signed in on the
 * same phone) goes up again under theirs.
 */
export function photoNeedsUpload(userId: string, photo: QueuedReportPhoto) {
  if (!photo.uploaded_path || !photo.client_id) return true
  return photo.uploaded_path !== reportPhotoPath(userId, photo.client_id)
}

type UploadError = Parameters<typeof isAlreadyExists>[0]

/**
 * Uploads the photos of a queued report that are not up yet, each to its
 * one path, and returns every photo's path in order. `upload` puts one
 * photo in storage (never overwriting) and returns storage's error, if
 * any; "already there" counts as done. `saveProgress` runs after each
 * upload, so a retry after a failure part-way skips what already went.
 */
export async function uploadQueuedPhotos(
  userId: string,
  photos: QueuedReportPhoto[],
  upload: (path: string, photo: QueuedReportPhoto) => Promise<UploadError>,
  saveProgress: () => Promise<unknown> | void,
): Promise<string[]> {
  const out: string[] = []
  for (const photo of photos) {
    if (!photo.client_id) photo.client_id = newClientId()
    const path = reportPhotoPath(userId, photo.client_id)
    if (photoNeedsUpload(userId, photo)) {
      const error = await upload(path, photo)
      if (error && !isAlreadyExists(error)) throw new Error(error.message ?? 'The photo did not upload')
      photo.uploaded_path = path
      await saveProgress()
    }
    out.push(path)
  }
  return out
}
