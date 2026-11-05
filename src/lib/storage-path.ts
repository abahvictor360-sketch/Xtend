/**
 * Whether a storage path a phone sent is a file in the caller's own folder.
 *
 * `path.startsWith(uid + '/')` is not enough: storage does not tidy
 * `<uid>/../<someone-else>/x.jpg`, so a server-side (service role) read of
 * that path would fetch another person's photo. Only plain names are
 * accepted: `<uid>/<name>` or `<uid>/<folder>/<name>`, each part letters,
 * digits, dot, dash or underscore, never `.` or `..`, never empty.
 */
export const MAX_STORAGE_PATH = 300

const SEGMENT = /^[A-Za-z0-9._-]+$/

export function isOwnStoragePath(path: unknown, userId: string): path is string {
  if (typeof path !== 'string' || !userId) return false
  if (path.length === 0 || path.length > MAX_STORAGE_PATH) return false
  const parts = path.split('/')
  if (parts.length < 2 || parts[0] !== userId) return false
  return parts.slice(1).every((p) => SEGMENT.test(p) && p !== '.' && p !== '..')
}
