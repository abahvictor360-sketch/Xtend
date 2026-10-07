import 'server-only'
import type { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

/**
 * The shape of every X Metrics admin action: admins only, the body checked
 * by zod, one Postgres function doing the work (and refusing anyone else),
 * and an audit row.
 */
export async function xmAdminAction<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  run: (
    body: z.output<S>,
    supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ) => Promise<{ data?: unknown; error: { code?: string; message: string } | null; audit: [string, string, string | null, Record<string, unknown>?] }>,
) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const result = await run(parsed.data, supabase)
    if (result.error) {
      const taken = result.error.code === '23505'
      return Response.json(
        { error: taken ? 'That already exists.' : dbErrorMessage(result.error) },
        { status: taken ? 409 : 400 },
      )
    }
    const [action, table, id, meta] = result.audit
    await audit(supabase, action, table, id, { ...(parsed.data as object), ...(meta ?? {}) })
    return Response.json({ ok: true, data: result.data ?? null })
  } catch (error) {
    return apiError(error)
  }
}
