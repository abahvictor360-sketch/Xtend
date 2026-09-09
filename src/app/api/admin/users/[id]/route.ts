import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { generateTempPassword } from '@/lib/credentials'

const patchSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  phone: z.string().min(7).max(20).nullable().optional(),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).optional(),
  outlet_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  reset_password: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin'])
    const { id } = await ctx.params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid change' }, { status: 400 })
    const input = parsed.data

    if (id === session.userId && input.is_active === false) {
      return Response.json({ error: 'You cannot deactivate your own account.' }, { status: 400 })
    }
    if (id === session.userId && input.role && input.role !== 'admin') {
      return Response.json({ error: 'You cannot remove your own admin role.' }, { status: 400 })
    }

    const admin = createAdminSupabase()
    const changes: Record<string, unknown> = {}
    for (const key of ['full_name', 'phone', 'role', 'outlet_id', 'is_active'] as const) {
      if (input[key] !== undefined) changes[key] = input[key]
    }

    let temp_password: string | undefined
    if (input.reset_password) {
      temp_password = generateTempPassword()
      const { error } = await admin.auth.admin.updateUserById(id, { password: temp_password })
      if (error) return Response.json({ error: error.message }, { status: 400 })
      changes.must_change_password = true
    }

    if (Object.keys(changes).length) {
      const { error } = await admin.from('profiles').update(changes).eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 400 })
    }

    // Deactivation is a soft delete. Attendance rows are never destroyed;
    // the foreign key is on delete restrict to make that structural.
    const supabase = await createServerSupabase()
    await audit(supabase, input.reset_password ? 'user.reset_password' : 'user.update', 'profiles', id, changes)

    return Response.json({ ok: true, temp_password })
  } catch (error) {
    return apiError(error)
  }
}
