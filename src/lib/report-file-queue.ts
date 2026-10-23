/**
 * How report documents behave in the phone's offline outbox (0065): each
 * picked document keeps one name from the moment it is picked, so a retry
 * finds the copy it already uploaded; removing a saved document can wait
 * on the phone until there is signal; and what the person is told when a
 * waiting removal arrives after the report closed at midnight.
 *
 * Pure on purpose (no Supabase, no browser APIs), so
 * scripts/check-report-files.ts can test it.
 */
import { reportFilePath } from '@/lib/report-files'

/** A document waiting in a queued report. */
export interface QueuedReportFile {
  blob: Blob
  name: string
  mime: string
  /** Given when the file is picked (0065). Missing on jobs queued before it. */
  client_id?: string
  /** Where it was uploaded, once it has been. */
  uploaded_path?: string
}

/**
 * The one place a picked document is stored: the person's own folder and
 * the id it was given when picked, so every retry names the same file.
 */
export function queuedFilePath(userId: string, file: Pick<QueuedReportFile, 'client_id' | 'mime'>) {
  if (!file.client_id) throw new Error('A document needs its id before it is uploaded')
  return reportFilePath(userId, file.client_id, file.mime)
}

/**
 * Whether this document still has to be uploaded for this person. One
 * uploaded under somebody else's folder (another account signed in on the
 * same phone) goes up again under theirs.
 */
export function needsUpload(userId: string, file: Pick<QueuedReportFile, 'client_id' | 'mime' | 'uploaded_path'>) {
  if (!file.uploaded_path || !file.client_id) return true
  return file.uploaded_path !== queuedFilePath(userId, file)
}

/**
 * Storage's answer when the file is already there: the first try got
 * through, so this one has nothing left to do.
 */
export function isAlreadyExists(
  error: { message?: string; status?: number; statusCode?: string | number; error?: string } | null | undefined,
) {
  if (!error) return false
  if (error.status === 409 || String(error.statusCode ?? '') === '409') return true
  if (String(error.statusCode ?? '').toLowerCase() === 'duplicate' || (error.error ?? '').toLowerCase() === 'duplicate') return true
  return /already exists|duplicate/i.test(error.message ?? '')
}

type UploadError = Parameters<typeof isAlreadyExists>[0]

/**
 * Uploads the documents of a queued report that are not up yet, each to
 * its one path, and says where every one of them is. `upload` puts one
 * file in storage (never overwriting) and returns storage's error, if any;
 * "already there" counts as done. `saveProgress` runs after each upload, so
 * a retry after a failure part-way skips what already went. The files are
 * updated in place (their id, and where they went).
 */
export async function uploadQueuedFiles<F extends QueuedReportFile>(
  userId: string,
  files: F[],
  upload: (path: string, file: F) => Promise<UploadError>,
  saveProgress: () => Promise<unknown> | void,
): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string }[] = []
  for (const file of files) {
    if (!file.client_id) file.client_id = newClientId()
    const path = queuedFilePath(userId, file)
    if (needsUpload(userId, file)) {
      const error = await upload(path, file)
      if (error && !isAlreadyExists(error)) throw new Error(error.message ?? 'The document did not upload')
      file.uploaded_path = path
      await saveProgress()
    }
    out.push({ path, name: file.name })
  }
  return out
}

/** A saved document to take off today's report, kept until it is sent. */
export interface RemovalJobFields {
  file_id: string
  name: string
}

/**
 * What became of a removal the server answered:
 * - removed: taken off;
 * - gone: it was not there any more (an earlier try got through);
 * - locked: the report closed at midnight, so it stays on;
 * - retry: no answer worth keeping (no signal, signed out, server trouble);
 * - refused: any other refusal, which trying again will not change.
 */
export type RemovalOutcome = 'removed' | 'gone' | 'locked' | 'retry' | 'refused'

export function removalOutcome(status: number, body: { code?: string; error?: string } | null | undefined): RemovalOutcome {
  if (status >= 200 && status < 300) return 'removed'
  const code = body?.code ?? ''
  const message = body?.error ?? ''
  if (code === 'locked' || status === 409 || /only be removed on the day/i.test(message)) return 'locked'
  if (code === 'gone' || status === 404 || /not on your report/i.test(message)) return 'gone'
  if (status === 0 || status === 401 || status === 408 || status === 423 || status === 429 || status >= 500) return 'retry'
  return 'refused'
}

export const REMOVAL_LOCKED_NOTICE = 'This document could not be removed because the report closed at midnight.'
export const REMOVAL_FAILED_NOTICE = 'This document could not be removed. Open today’s report and remove it again if you still want it gone.'

/** What the person is told about a removal that did not happen. */
export function removalNotice(name: string, why: 'locked' | 'failed') {
  return `“${name}”: ${why === 'locked' ? REMOVAL_LOCKED_NOTICE : REMOVAL_FAILED_NOTICE}`
}

/**
 * Why a waiting removal is being given up without an answer: one queued
 * more than a day ago is past midnight whatever else happened.
 */
export function abandonedRemovalReason(queuedAt: string, now = Date.now()): 'locked' | 'failed' {
  return now - new Date(queuedAt).getTime() > 24 * 60 * 60 * 1000 ? 'locked' : 'failed'
}

/** Where notices wait until the report page is next opened. */
export interface NoticeStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const REMOVAL_NOTICES_KEY = 'xtend.report-file-notices'

function read(store: NoticeStore): string[] {
  try {
    const parsed = JSON.parse(store.getItem(REMOVAL_NOTICES_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** Keeps a notice (no duplicates, the latest ten). Never throws. */
export function addRemovalNotice(store: NoticeStore | null | undefined, notice: string) {
  if (!store) return
  try {
    const all = read(store).filter((n) => n !== notice)
    all.push(notice)
    store.setItem(REMOVAL_NOTICES_KEY, JSON.stringify(all.slice(-10)))
  } catch {
    // No storage on this phone: the person is not told, nothing breaks.
  }
}

/** The notices waiting, once: reading them clears them. Never throws. */
export function takeRemovalNotices(store: NoticeStore | null | undefined): string[] {
  if (!store) return []
  try {
    const all = read(store)
    if (all.length) store.removeItem(REMOVAL_NOTICES_KEY)
    return all
  } catch {
    return []
  }
}

/**
 * Today's saved documents as the report shows them: those waiting to be
 * removed read "Removing…" and no longer count towards the five, because
 * the outbox sends the removal before anything saved after it.
 */
export function savedFileView<T extends { id: string }>(saved: T[], removing: Iterable<string>) {
  const ids = new Set(removing)
  const files = saved.map((f) => ({ ...f, removing: ids.has(f.id) }))
  return { files, counted: files.filter((f) => !f.removing).length }
}

/**
 * The id a document gets when it is picked, kept with it until it is on
 * the report. Safe in a storage path.
 */
export function newClientId() {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`
}
