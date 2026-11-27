import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, ApiError, dbErrorMessage } from '@/lib/auth'
import { requireRecentAuth } from '@/lib/reconfirm'
import { removeQueuedFiles, serviceClientWithContext } from '@/lib/system-reset-server'
import { logProblem } from '@/lib/log'

export const maxDuration = 60

const kind = z.enum(['outlet', 'staff'])

/**
 * Deleting a store or a person for good, with everything that belongs to
 * them (0098). GET shows what would go; POST does it once the name is
 * typed. The database decides who may and writes the audit row; this
 * route then removes their stored photos and, if the database could not,
 * their sign-in.
 */
export async function GET(request: Request) {
  try {
    await requireApiSession(['admin'])
    const url = new URL(request.url)
    const k = kind.safeParse(url.searchParams.get('kind'))
    const id = z.string().guid().safeParse(url.searchParams.get('id'))
    if (!k.success || !id.success) throw new ApiError('Choose a store or a person', 400)
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('delete_for_good_preview', { p_kind: k.data, p_id: id.data })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new ApiError('Deleting for good needs the latest database update (0098). Deactivate it for now.', 409)
      }
      throw new ApiError(dbErrorMessage(error, 'Could not check what would be deleted.'), 400)
    }
    return Response.json(data)
  } catch (error) {
    return apiError(error)
  }
}

const schema = z.object({ kind, id: z.string().guid(), confirm: z.string().max(300) })

export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ApiError('Choose a store or a person', 400)
    const { kind: k, id, confirm } = parsed.data
    if (k === 'staff' && id === session.userId) throw new ApiError('You cannot delete your own account.', 400)
    // Removing for good is the riskiest thing in Xtend: password again.
    await requireRecentAuth(session)

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('delete_for_good', { p_kind: k, p_id: id, p_confirm: confirm })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new ApiError('Deleting for good needs the latest database update (0098). Deactivate it for now.', 409)
      }
      throw new ApiError(dbErrorMessage(error, 'That could not be deleted. Try again.'), 400)
    }
    const result = data as { name: string; removed: Record<string, number>; files: number; auth_fallback: boolean }

    if (k === 'staff' && result.auth_fallback) {
      const { error: authError } = await createAdminSupabase().auth.admin.deleteUser(id)
      if (authError) logProblem('delete for good: sign-in not removed', authError.message)
    }
    let filesLeft = 0
    if (result.files > 0) {
      const done = await removeQueuedFiles(await serviceClientWithContext(), Date.now() + 20_000)
      filesLeft = done.left
    }
    return Response.json({ ok: true, name: result.name, removed: result.removed, files_left: filesLeft })
  } catch (error) {
    return apiError(error)
  }
}
