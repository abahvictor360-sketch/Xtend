import { z } from 'zod'
import { apiError, dbErrorMessage, requireApiSession } from '@/lib/auth'
import { confirmMatches, RESET_KEYS, RESET_WORD, resetSummary, type ResetResult } from '@/lib/system-reset'
import {
  passwordIsRight,
  removeOrphanSignIns,
  removeQueuedFiles,
  serviceClientWithContext,
} from '@/lib/system-reset-server'

// The database work is one quick transaction; the stored files are removed
// in batches of 1,000 for as long as the function may run, and whatever is
// left is finished from the System page (POST /api/admin/system/reset/files).
export const maxDuration = 60
const FILES_BUDGET_MS = 40_000

const schema = z.object({
  confirm: z.string().max(20),
  password: z.string().min(1, 'Enter your password').max(200),
  categories: z
    .array(z.enum([...(RESET_KEYS as [string, ...string[]]), 'everything']))
    .min(1, 'Choose at least one thing to reset')
    .max(20),
})

/**
 * Clears the test run (0066). Admins only, only while test mode is on,
 * with RESET typed and the admin's own password. The database decides what
 * the choice really clears, clears it in one transaction and writes the one
 * audit row; this route then removes the stored files.
 */
export async function POST(request: Request) {
  const started = Date.now()
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const { confirm, password, categories } = parsed.data
    if (!confirmMatches(confirm, RESET_WORD)) {
      return Response.json({ error: `Type ${RESET_WORD} to confirm.` }, { status: 400 })
    }
    if (!session.email || !(await passwordIsRight(session.email, password))) {
      return Response.json({ error: 'That password is not right.' }, { status: 403 })
    }

    const admin = await serviceClientWithContext()
    const { data, error } = await admin.rpc('reset_test_data', {
      p_actor: session.userId,
      p_categories: categories,
    })
    if (error) {
      return Response.json({ error: dbErrorMessage(error, 'The reset did not run. Nothing was changed.') }, { status: 400 })
    }
    const result = data as ResetResult

    const deadline = started + FILES_BUDGET_MS
    let signInsRemoved = 0
    if (result.auth_fallback) signInsRemoved = await removeOrphanSignIns(admin, deadline)
    const files = await removeQueuedFiles(admin, deadline)

    return Response.json({
      ok: true,
      result,
      files,
      signInsRemoved,
      summary: resetSummary(result, files),
    })
  } catch (error) {
    return apiError(error)
  }
}
