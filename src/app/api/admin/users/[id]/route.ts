import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { generateTempPassword } from '@/lib/credentials'
import { emailAddress, personName, phoneNumber } from '@/lib/fields'

const patchSchema = z.object({
  full_name: personName.optional(),
  /** Admin only: also their login, so it changes the sign-in address. */
  email: emailAddress.optional(),
  // Left out: unchanged. Empty or null: removed. Otherwise a mobile number.
  phone: z.union([z.literal(''), z.null(), phoneNumber]).optional().transform((v) => (v === '' ? null : v)),
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
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid change' },
        { status: 400 },
      )
    }
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
        input.email !== undefined ||
        input.outlet_id !== undefined ||
        input.supervisor_id !== undefined ||
        input.push_exempt !== undefined
      ) {
        return Response.json(
          { error: "Only an admin can change somebody's email, role, store, supervisor or notification rule." },
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

    // A new email is a new login: free, and changed on the account too.
    let previousEmail: string | null = null
    if (input.email !== undefined) {
      const { data: current } = await admin
        .from('profiles')
        .select('email')
        .eq('id', id)
        .maybeSingle<{ email: string | null }>()
      if (current?.email?.toLowerCase() !== input.email) {
        const { data: taken } = await admin
          .from('profiles')
          .select('id')
          .ilike('email', input.email)
          .neq('id', id)
          .limit(1)
        if (taken?.length) {
          return Response.json({ error: 'Somebody already uses that email.' }, { status: 409 })
        }
        const { error } = await admin.auth.admin.updateUserById(id, {
          email: input.email,
          email_confirm: true,
        })
        if (error) return Response.json({ error: error.message }, { status: 400 })
        previousEmail = current?.email ?? null
        changes.email = input.email
      }
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
      if (error) {
        // Put the login back as it was, so account and profile still agree.
        if (previousEmail) {
          await admin.auth.admin.updateUserById(id, { email: previousEmail, email_confirm: true })
        }
        const duplicate = error.code === '23505'
        return Response.json(
          { error: duplicate ? 'Somebody already uses that phone number.' : dbErrorMessage(error) },
          { status: duplicate ? 409 : 400 },
        )
      }
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
