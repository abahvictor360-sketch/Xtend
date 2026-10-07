import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { note } from '@/lib/fields'

const schema = z.object({ note: note(300) })

/** Marks an expiry alert handled, with what was decided. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return xmAdminAction(request, schema, async (b, db) => {
    const { error } = await db.rpc('xm_acknowledge_expiry', { p_alert: id, p_note: b.note || null })
    return { error, audit: ['xm.expiry.acknowledge', 'xm_expiry_alerts', id] }
  })
}
