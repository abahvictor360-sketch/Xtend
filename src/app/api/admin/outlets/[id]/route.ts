import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { address, thingName } from '@/lib/fields'

const schema = z.object({
  name: thingName(160, 'store name').optional(),
  address,
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geofence_radius_m: z.number().int().min(25).max(2000).optional(),
  shift_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  shift_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  is_active: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid change' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { error } = await supabase.from('outlets').update(parsed.data).eq('id', id)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    await audit(supabase, 'outlet.update', 'outlets', id, parsed.data)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
