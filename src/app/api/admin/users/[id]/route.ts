import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { auditContext } from '@/lib/audit-context'
import { generateTempPassword } from '@/lib/credentials'
import { emailAddress, personName, phoneNumber } from '@/lib/fields'
import { rememberTempPassword } from '@/lib/staff-logins'
import { authAdminError } from '@/lib/auth-admin-errors'
import { requireRecentAuth } from '@/lib/reconfirm'
import { OFFICE_ROLES } from '@/lib/zero-trust'
import type { UserRole } from '@/lib/types'

const patchSchema = z.object({
  full_name: personName.optional(),
  /** Admin only: also their login, so it changes the sign-in address. */
  email: emailAddress.optional(),
  // Left out: unchanged. Empty or null: removed. Otherwise a mobile number.
  phone: z.union([z.literal(''), z.null(), phoneNumber]).optional().transform((v) => (v === '' ? null : v)),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin', 'hr']).optional(),
  /** A role an admin added (042), or null for a built-in one. */
  staff_role_id: z.string().guid().nullable().optional(),
  outlet_id: z.string().guid().nullable().optional(),
  supervisor_id: z.string().guid().nullable().optional(),
  is_active: z.boolean().optional(),
  /** Admin only: may clock in without notifications on (migration 027). */
  push_exempt: z.boolean().optional(),
  /** Admin only: must use the phone app, not a browser (migration 0084). */
  app_only: z.boolean().optional(),
  reset_password: z.boolean().optional(),
  /** Lift a sign-in lock (0077) early. */
  unlock: z.boolean().optional(),
  /** Admin only: remove their authenticator app so they set it up again (0080). */
  reset_mfa: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin', 'supervisor', 'hr'])
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
    if (id === session.userId && ((input.role && input.role !== 'admin') || input.staff_role_id)) {
      return Response.json({ error: 'You cannot remove your own admin role.' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // A supervisor edits their own team, and only the details that do not
    // grant anybody anything: name, phone, active, a new password.
    const isSupervisor = session.profile.role === 'supervisor'
    if (isSupervisor) {
      // Postgres decides first, as the caller (0017): a supervisor reaches
      // field staff on their team only, never a supervisor, HR or admin,
      // whatever reporting line is left over from before a promotion.
      const supabase = await createServerSupabase()
      const { data: canEdit } = await supabase.rpc('can_edit_staff', { target: id })
      if (canEdit !== true) {
        return Response.json({ error: 'That person is not on your team.' }, { status: 403 })
      }
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
        input.staff_role_id !== undefined ||
        input.email !== undefined ||
        input.outlet_id !== undefined ||
        input.supervisor_id !== undefined ||
        input.push_exempt !== undefined ||
        input.app_only !== undefined
      ) {
        return Response.json(
          { error: "Only an admin can change somebody's email, role, store, supervisor, notification rule or app-only setting." },
          { status: 403 },
        )
      }
    }

    // HR (0072) edits merchandisers and marketers anywhere: details, store,
    // supervisor, active, a new password. Never a role, email or an account
    // above field staff.
    const isHr = session.profile.role === 'hr'
    if (isHr) {
      const { data: target } = await admin
        .from('profiles')
        .select('role')
        .eq('id', id)
        .maybeSingle<{ role: string }>()
      if (target?.role !== 'merchandiser' && target?.role !== 'marketer') {
        return Response.json({ error: 'HR can change merchandisers and marketers only.' }, { status: 403 })
      }
      if (
        input.role !== undefined ||
        input.staff_role_id !== undefined ||
        input.email !== undefined ||
        input.push_exempt !== undefined ||
        input.app_only !== undefined
      ) {
        return Response.json(
          { error: "Only an admin can change somebody's email, role, notification rule or app-only setting." },
          { status: 403 },
        )
      }
      if (input.supervisor_id) {
        const { data: sup } = await admin
          .from('profiles')
          .select('role, is_active')
          .eq('id', input.supervisor_id)
          .maybeSingle<{ role: string; is_active: boolean }>()
        if (!sup?.is_active || (sup.role !== 'supervisor' && sup.role !== 'admin')) {
          return Response.json({ error: 'Pick an active supervisor.' }, { status: 400 })
        }
      }
    }

    // Zero trust (0080): a change that hands out power or a way in needs the
    // password confirmed in the last few minutes. That is any role or login
    // change, a reset of two-step sign-in, and a new password or
    // (de)activation for an office account.
    let targetIsOffice = false
    if (input.reset_password || input.is_active !== undefined || input.reset_mfa) {
      const { data: target } = await admin
        .from('profiles')
        .select('role')
        .eq('id', id)
        .maybeSingle<{ role: UserRole }>()
      targetIsOffice = Boolean(target && OFFICE_ROLES.includes(target.role))
    }
    if (
      input.role !== undefined ||
      input.staff_role_id !== undefined ||
      input.email !== undefined ||
      input.reset_mfa ||
      ((input.reset_password || input.is_active !== undefined) && targetIsOffice)
    ) {
      await requireRecentAuth(session)
    }

    // Two-step sign-in reset (0080): an admin removes the person's
    // authenticator app, for a lost or new phone. They set one up again at
    // their next sign-in if their role needs it.
    if (input.reset_mfa) {
      if (session.profile.role !== 'admin') {
        return Response.json({ error: 'Only an admin can reset two-step sign-in.' }, { status: 403 })
      }
      if (!targetIsOffice) {
        return Response.json({ error: 'Only office accounts use two-step sign-in.' }, { status: 400 })
      }
      const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: id })
      if (listError) {
        return Response.json({ error: 'Two-step sign-in could not be reset. Try again.' }, { status: 502 })
      }
      for (const factor of listed?.factors ?? []) {
        const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: id })
        if (error) {
          return Response.json({ error: 'Two-step sign-in could not be reset. Try again.' }, { status: 502 })
        }
      }
      await audit(await createServerSupabase(), 'user.mfa_reset', 'profiles', id, {
        removed: listed?.factors?.length ?? 0,
      })
      return Response.json({ ok: true })
    }

    // A sign-in lock (0077): Postgres checks who may lift it and audits it.
    if (input.unlock) {
      const supabase = await createServerSupabase()
      const { error } = await supabase.rpc('unlock_sign_in', { p_user: id })
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 403 })
      return Response.json({ ok: true })
    }

    const changes: Record<string, unknown> = {}
    for (const key of [
      'full_name',
      'phone',
      'role',
      'staff_role_id',
      'outlet_id',
      'supervisor_id',
      'is_active',
      'push_exempt',
      'app_only',
    ] as const) {
      if (input[key] !== undefined) changes[key] = input[key]
    }

    // An added role must still be in use; the database sets the base role.
    if (input.staff_role_id) {
      const { data: added } = await admin
        .from('staff_roles')
        .select('is_active')
        .eq('id', input.staff_role_id)
        .maybeSingle<{ is_active: boolean }>()
      if (!added?.is_active) {
        return Response.json({ error: 'That role is not available any more.' }, { status: 400 })
      }
      delete changes.role
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
        if (error) {
          const { message, status } = authAdminError(error, 'The email could not be changed. Try again.')
          return Response.json({ error: message }, { status })
        }
        previousEmail = current?.email ?? null
        changes.email = input.email
      }
    }

    let temp_password: string | undefined
    if (input.reset_password) {
      temp_password = generateTempPassword()
      const { error } = await admin.auth.admin.updateUserById(id, { password: temp_password })
      if (error) {
        const { message, status } = authAdminError(error, 'The password could not be reset. Try again.')
        return Response.json({ error: message }, { status })
      }
      changes.must_change_password = true
      await rememberTempPassword(admin, id, temp_password)
      // A new password also lifts a sign-in lock (0077).
      const { data: who } = await admin.from('profiles').select('email').eq('id', id).maybeSingle<{ email: string | null }>()
      if (who?.email) await admin.rpc('sign_in_clear', { p_account: who.email })
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
        meta: { ...changes, _context: await auditContext() },
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

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireApiSession(['admin'])
    const { id } = await ctx.params

    if (id === session.userId) {
      return Response.json({ error: 'You cannot delete your own account.' }, { status: 400 })
    }
    await requireRecentAuth(session)

    const admin = createAdminSupabase()

    // Anyone with history is kept: the attendance (and visit, count, metrics)
    // foreign keys are ON DELETE RESTRICT, so the account cannot be removed
    // without destroying records. Check the main one up front for a clear
    // message; deactivation is the right tool there.
    const { count } = await admin
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id)
    if ((count ?? 0) > 0) {
      return Response.json(
        {
          error:
            'This person has attendance history, so their account cannot be deleted. Deactivate it instead.',
        },
        { status: 409 },
      )
    }

    // Removing the auth account cascades to the profile. If a record elsewhere
    // still holds them back, the delete fails — report it as history too.
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) {
      console.error('deleteUser failed', error)
      return Response.json(
        {
          error:
            'This account has records that cannot be removed, so it cannot be deleted. Deactivate it instead.',
        },
        { status: 409 },
      )
    }

    const supabase = await createServerSupabase()
    await audit(supabase, 'user.delete', 'profiles', id, {})
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
