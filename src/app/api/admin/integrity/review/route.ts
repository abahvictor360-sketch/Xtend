import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { note } from '@/lib/fields'

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pick at least one flag').max(200, 'Review at most 200 flags at a time'),
  note: note(500),
})

/**
 * Marks several flags as looked at, with one note. Who may is decided by
 * review_integrity_flags() (054): a supervisor only their own team's. Flags
 * someone already reviewed keep that review.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Pick the flags to review' }, { status: 400 })
    }

    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('review_integrity_flags', {
      p_ids: parsed.data.ids,
      p_note: parsed.data.note || null,
    })
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return Response.json(
        { error: missing ? 'Reviewing several at once needs update 054 run in Supabase.' : dbErrorMessage(error) },
        { status: 400 },
      )
    }
    const reviewed = (data as number | null) ?? 0
    await audit(supabase, 'integrity.review_many', 'integrity_flags', null, {
      asked: parsed.data.ids.length,
      reviewed,
      note: parsed.data.note || null,
    })
    return Response.json({ ok: true, reviewed, asked: parsed.data.ids.length })
  } catch (error) {
    return apiError(error)
  }
}
