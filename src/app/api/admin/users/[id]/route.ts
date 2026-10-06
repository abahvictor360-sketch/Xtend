import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { generateTempPassword } from '@/lib/credentials'

const patchSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  phone: z.string().min(7).max(20).nullable().optional(),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).optional(),
  outlet_id: z.string().uuid().nullable().optional(),
  supervisor_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  /** Admin only: may clock in without notifications on (migration 027). */
  push_exempt: z.boolean().optional(),
  reset_password: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
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

    // A supervisor edits their own team, and only the details that do not
    // grant anybody anything: name, phone, active, a new password.
    const isSupervisor = session.profile.role === 'supervisor'
    if (isSupervisor) {
      const { data: allowed } = await admin
        .from('profiles')
        .select('id')
        .eq('id', id)
        .eq('supervisor_id', session.userId)
        .maybeSingle<{ id: string }>()
      if (!allowed) {
        return Response.json({ error: 'That person is not on your team.' }, { status: 403 })
      }
      if (
        input.role !== undefined ||
        input.outlet_id !== undefined ||
        input.supervisor_id !== undefined ||
        input.push_exempt !== undefined
      ) {
        return Response.json(
          { error: "Only an admin can change somebody's role, store, supervisor or notification rule." },
          { status: 403 },
        )
      }
    }

    const changes: Record<string, unknown> = {}
    for (const key of [
      'full_name',
      'phone',
      'role',
      'outlet_id',
      'supervisor_id',
      'is_active',
      'push_exempt',
    ] as const) {
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
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    }

    // Deactivation is a soft delete. Attendance rows are never destroyed;
    // the foreign key is on delete restrict to make that structural.
    const action = input.reset_password ? 'user.reset_password' : 'user.update'
    if (isSupervisor) {
      await admin.from('audit_log').insert({
        actor_id: session.userId,
        action,
        target_table: 'profiles',
        target_id: id,
        meta: changes,
      })
    } else {
      const supabase = await createServerSupabase()
      await audit(supabase, action, 'profiles', id, changes)
    }

    return Response.json({ ok: true, temp_password })
  } catch (error) {
    return apiError(error)
  }
}
