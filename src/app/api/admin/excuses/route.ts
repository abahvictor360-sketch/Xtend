import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { note } from '@/lib/fields'
import { isClaim, type Claim } from '@/lib/excuse'
import { checkExcuse } from '@/lib/excuse-server'

const schema = z.object({
  user_id: z.string().uuid(),
  claim: z.string().refine(isClaim, 'Choose what they said'),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  note: note(500),
})

/**
 * Keeps a check on the record (048). The verdict is worked out again here
 * from the evidence, so what is kept is what the evidence says.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid check' }, { status: 400 })
    }
    const b = parsed.data
    const supabase = await createServerSupabase()
    const checked = await checkExcuse(supabase, b.user_id, b.from, b.to, b.claim as Claim)
    if (checked.error || !checked.result) {
      return Response.json({ error: dbErrorMessage(checked.error as { code?: string; message: string }, 'That check could not be run') }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('record_excuse_check', {
      p_user: b.user_id,
      p_claim: b.claim,
      p_from: b.from,
      p_to: b.to,
      p_verdict: checked.result.verdict,
      p_headline: checked.result.headline,
      p_note: b.note || null,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    return Response.json({ id: data, verdict: checked.result.verdict }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
