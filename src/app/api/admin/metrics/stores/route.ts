import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'

const schema = z.object({ outlet_id: z.string().uuid(), active: z.boolean() })

/** Adds a store to X Metrics, or takes it out (its history stays). */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (body, db) => {
    const { error } = await db.rpc('xm_set_store', { p_outlet: body.outlet_id, p_active: body.active })
    return { error, audit: [body.active ? 'xm.store.enrol' : 'xm.store.remove', 'outlets', body.outlet_id] }
  })
}
