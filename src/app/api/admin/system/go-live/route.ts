import { z } from 'zod'
import { apiError, dbErrorMessage, requireApiSession } from '@/lib/auth'
import { confirmMatches, LIVE_WORDS } from '@/lib/system-reset'
import { serviceClientWithContext } from '@/lib/system-reset-server'

const schema = z.object({ confirm: z.string().max(40) })

/**
 * Turns test mode off for good (0066). The database refuses ever turning it
 * back on, and writes the audit row (system.go_live).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || !confirmMatches(parsed.data.confirm, LIVE_WORDS)) {
      return Response.json({ error: `Type ${LIVE_WORDS} to confirm.` }, { status: 400 })
    }
    const admin = await serviceClientWithContext()
    const { data, error } = await admin.rpc('system_go_live', { p_actor: session.userId })
    if (error) {
      return Response.json({ error: dbErrorMessage(error, 'Test mode could not be turned off. Try again.') }, { status: 400 })
    }
    return Response.json({ ok: true, ...(data as object) })
  } catch (error) {
    return apiError(error)
  }
}
