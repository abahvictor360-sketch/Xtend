import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Whether a scheduled job's request carries `Authorization: Bearer
 * $CRON_SECRET`. Refuses everything when the secret is not set. Compared in
 * constant time, hashed first so the lengths always match.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = request.headers.get('authorization') ?? ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(`Bearer ${secret}`))
}
