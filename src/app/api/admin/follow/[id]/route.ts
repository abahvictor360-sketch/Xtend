import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, dbErrorMessage, requireApiSession } from '@/lib/auth'

const id = z.string().uuid()
const schema = z.object({ action: z.enum(['heartbeat', 'extend', 'stop', 'close']) })

/**
 * The follow page's check-in (every ~20 s), "Keep following", Stop, and
 * the page being closed (sent with navigator.sendBeacon, so the body may
 * arrive as plain text). Only the person following may act on a session;
 * the database checks that and audits extend and stop.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const session = id.safeParse((await ctx.params).id)
    let body: unknown = null
    try {
      body = JSON.parse(await request.text())
    } catch {
      body = null
    }
    const parsed = schema.safeParse(body)
    if (!session.success || !parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = await createServerSupabase()
    const a = parsed.data.action
    const { data, error } =
      a === 'heartbeat'
        ? await supabase.rpc('follow_heartbeat', { p_session: session.data })
        : a === 'extend'
          ? await supabase.rpc('follow_extend', { p_session: session.data })
          : await supabase.rpc('follow_stop', { p_session: session.data, p_reason: a === 'close' ? 'closed' : 'stopped' })
    if (error) {
      return Response.json(
        { error: dbErrorMessage(error, 'That did not work. Try again.'), code: error.hint ?? null },
        { status: error.hint === 'follow_not_found' ? 404 : error.hint === 'follow_cap' ? 429 : 400 },
      )
    }
    return Response.json({ session: data })
  } catch (error) {
    return apiError(error)
  }
}
