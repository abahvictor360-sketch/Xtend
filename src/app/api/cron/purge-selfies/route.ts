import { createAdminSupabase } from '@/lib/supabase/admin'

export const maxDuration = 60

/**
 * Nightly retention. After 90 days the full-size selfie is deleted and the
 * 200x200 thumbnail becomes the permanent audit record. Roughly 900MB a
 * month at 100 staff, so this is not optional.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const { data, error } = await supabase.rpc('purge_old_selfies')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ purged: data ?? 0, ran_at: new Date().toISOString() })
}
