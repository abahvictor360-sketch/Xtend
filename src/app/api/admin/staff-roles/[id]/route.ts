import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { roleName } from '@/lib/staff-roles'

const schema = z.object({
  name: roleName.optional(),
  /** Retired roles stay on the people who have them, but cannot be given. */
  is_active: z.boolean().optional(),
})

/** Renames, retires or brings back a role. Admins only. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid change' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.from('staff_roles').update(parsed.data).eq('id', id)
    if (error) {
      const taken = error.code === '23505'
      return Response.json(
        { error: taken ? 'There is already a role with that name.' : dbErrorMessage(error) },
        { status: taken ? 409 : 400 },
      )
    }
    await audit(supabase, 'staff_role.update', 'staff_roles', id, parsed.data)
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
