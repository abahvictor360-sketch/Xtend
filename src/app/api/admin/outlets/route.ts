import { z } from 'zod'
import { optional, zAddress, zPlaceName } from '@/lib/validation'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  name: zPlaceName,
  address: optional(zAddress),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geofence_radius_m: z.number().int().min(25).max(2000).default(150),
  shift_start: z.string().regex(/^\d{2}:\d{2}$/),
  shift_end: z.string().regex(/^\d{2}:\d{2}$/),
})

export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid outlet' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('outlets')
      .insert(parsed.data)
      .select('id')
      .single<{ id: string }>()

    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    await audit(supabase, 'outlet.create', 'outlets', data.id, parsed.data)
    return Response.json({ outlet_id: data.id }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
