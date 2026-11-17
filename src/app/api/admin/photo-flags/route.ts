import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { note } from '@/lib/fields'
import { PHOTO_FLAG_REASONS } from '@/lib/photo-flags'

const path = z.string().min(3).max(300)
const flagSchema = z.object({
  path,
  reason: z.enum(PHOTO_FLAG_REASONS, { error: 'Choose why the photo is not right' }),
  note: note(300),
})

function missing(error: { code?: string }) {
  return error.code === 'PGRST202' || error.code === '42883'
}

/**
 * Flags a clock-in, clock-out or store visit photo as not right (0092).
 * flag_photo() decides who may: an admin, or the person's own supervisor.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = flagSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Choose why the photo is not right' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('flag_photo', {
      p_path: parsed.data.path,
      p_reason: parsed.data.reason,
      p_note: parsed.data.note || null,
    })
    if (error) {
      return Response.json(
        { error: missing(error) ? 'Flagging photos needs update 0092 run in Supabase.' : dbErrorMessage(error) },
        { status: 400 },
      )
    }
    await audit(supabase, 'photo.flag', 'integrity_flags', (data as string | null) ?? null, {
      path: parsed.data.path,
      reason: parsed.data.reason,
      note: parsed.data.note || null,
    })
    return Response.json({ ok: true, id: data })
  } catch (error) {
    return apiError(error)
  }
}

/** Takes the office's flag off a photo again. */
export async function DELETE(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = z.object({ path }).safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Which photo?' }, { status: 400 })
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('unflag_photo', { p_path: parsed.data.path })
    if (error) {
      return Response.json(
        { error: missing(error) ? 'Flagging photos needs update 0092 run in Supabase.' : dbErrorMessage(error) },
        { status: 400 },
      )
    }
    if (data) await audit(supabase, 'photo.unflag', 'integrity_flags', null, { path: parsed.data.path })
    return Response.json({ ok: true, removed: Boolean(data) })
  } catch (error) {
    return apiError(error)
  }
}
