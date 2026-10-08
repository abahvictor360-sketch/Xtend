import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  role: z.enum(['merchandiser', 'marketer'], { errorMap: () => ({ message: 'Choose a role' }) }),
  counts_stock: z.boolean(),
})

/** Whether built-in merchandisers or marketers take store counts (migration 046). Admins only. */
export async function PATCH(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid change' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase
      .from('role_store_counts')
      .update({ counts_stock: parsed.data.counts_stock, updated_at: new Date().toISOString() })
      .eq('role', parsed.data.role)
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'role_store_counts.update', 'role_store_counts', null, parsed.data)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
