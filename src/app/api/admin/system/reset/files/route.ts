import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createServerSupabase } from '@/lib/supabase/server'
import { removeQueuedFiles, serviceClientWithContext } from '@/lib/system-reset-server'

export const maxDuration = 60

/**
 * Finishes removing the stored files a reset queued (0066), when there
 * were too many to remove in one go. Only files a reset queued are ever
 * touched, so this is safe after going live too.
 */
export async function POST() {
  try {
    await requireApiSession(['admin'])
    const admin = await serviceClientWithContext()
    const files = await removeQueuedFiles(admin, Date.now() + 45_000)
    if (files.removed > 0) {
      await audit(await createServerSupabase(), 'system.reset.files', 'system_settings', null, {
        removed: files.removed,
        left: files.left,
      })
    }
    return Response.json({ ok: true, files })
  } catch (error) {
    return apiError(error)
  }
}
