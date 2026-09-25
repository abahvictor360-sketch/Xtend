import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'

const schema = z.object({
  id: z.string().uuid(),
  token: z.string().uuid(),
  stage: z.enum(['delivered', 'opened']),
})

/**
 * The phone answering a check (public/sw.js). No login needed: the phone
 * may be signed out for the day, and the token in the push is the proof
 * that the answer came from the phone that received it.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 })
  const { id, token, stage } = parsed.data
  const admin = createAdminSupabase()
  const { data } = await admin
    .from('phone_checks')
    .select('delivered_at, opened_at')
    .eq('id', id)
    .eq('token', token)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle<{ delivered_at: string | null; opened_at: string | null }>()
  if (!data) return Response.json({ ok: false }, { status: 404 })

  const now = new Date().toISOString()
  const update: Record<string, string> = {}
  if (!data.delivered_at) update.delivered_at = now
  if (stage === 'opened' && !data.opened_at) update.opened_at = now
  if (Object.keys(update).length) await admin.from('phone_checks').update(update).eq('id', id)
  return Response.json({ ok: true })
}
