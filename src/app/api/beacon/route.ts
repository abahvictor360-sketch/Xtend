import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'

/**
 * A field phone reporting on itself (lib/phone-report.ts). The database
 * checks and cleans every value; see record_beacon() in migration 026.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession([...FIELD_ROLES])
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid report' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('record_beacon', { p: body })
    // Before migration 026 there is nowhere to keep it: say nothing.
    if (error) return Response.json({ id: null }, { status: 202 })
    return Response.json(data as { id: string; server_time: string })
  } catch (error) {
    return apiError(error)
  }
}
