import { z } from 'zod'
import { optional, zEmail, zPersonName, zPhone } from '@/lib/validation'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { deliverCredentials, generateTempPassword } from '@/lib/credentials'
import { rememberTempPassword } from '@/lib/staff-logins'

const createUserSchema = z.object({
  full_name: zPersonName,
  email: zEmail,
  phone: optional(zPhone),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).default('merchandiser'),
  outlet_id: z.string().uuid().nullable().optional(),
  supervisor_id: z.string().uuid().nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = createUserSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid user' },
        { status: 400 },
      )
    }
    const input = parsed.data

    // A supervisor staffs their own team: field roles only, reporting to
    // them. Role is the one field that grants power, so it stays with
    // admins.
    const isSupervisor = session.profile.role === 'supervisor'
    if (isSupervisor && input.role !== 'merchandiser' && input.role !== 'marketer') {
      return Response.json(
        { error: 'Supervisors can create merchandisers and marketers only.' },
        { status: 403 },
      )
    }
    // And into one of their own stores: editing a store is admin-only, so
    // creating somebody must not be a way round that.
    if (isSupervisor && input.outlet_id) {
      const supabase = await createServerSupabase()
      const { data: mine } = await supabase.rpc('outlets_for_user', { target: session.userId })
      const own = ((mine ?? []) as { outlet_id: string }[]).some((o) => o.outlet_id === input.outlet_id)
      if (!own) {
        return Response.json(
          { error: 'Supervisors can add staff to their own stores only.' },
          { status: 403 },
        )
      }
    }
    const supervisor_id = isSupervisor ? session.userId : (input.supervisor_id ?? null)
    const outlet_id = isSupervisor
      ? (input.outlet_id ?? session.profile.outlet_id ?? null)
      : (input.outlet_id ?? null)

    // Merchandisers and marketers sign in with their phone, so they need one.
    if ((input.role === 'merchandiser' || input.role === 'marketer') && !input.phone) {
      return Response.json(
        { error: 'Enter their phone number: merchandisers and marketers sign in with it.' },
        { status: 400 },
      )
    }

    const email = input.email.toLowerCase().trim()
    const temp_password = generateTempPassword()

    const admin = createAdminSupabase()
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    })

    if (authError || !created.user) {
      const message = authError?.message ?? 'Could not create the account'
      const status = message.toLowerCase().includes('already') ? 409 : 400
      return Response.json({ error: message }, { status })
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      full_name: input.full_name,
      email,
      phone: input.phone || null,
      role: input.role,
      outlet_id: outlet_id || null,
      supervisor_id,
      must_change_password: true,
    })

    if (profileError) {
      // Never leave an auth user without a profile.
      await admin.auth.admin.deleteUser(created.user.id)
      const duplicate = profileError.code === '23505'
      return Response.json(
        {
          error: duplicate
            ? 'Somebody already has that email or phone number.'
            : dbErrorMessage(profileError),
        },
        { status: duplicate ? 409 : 400 },
      )
    }

    // Kept for the staff login sheet until they choose their own (039).
    await rememberTempPassword(admin, created.user.id, temp_password)

    const delivery = await deliverCredentials({
      full_name: input.full_name,
      email,
      phone: input.phone ?? null,
      temp_password,
    })

    // Supervisors may create staff but may not call write_audit, so their
    // row is written with the service role rather than skipped.
    const meta = { email, role: input.role, delivery, created_by_role: session.profile.role }
    if (isSupervisor) {
      await admin.from('audit_log').insert({
        actor_id: session.userId,
        action: 'user.create',
        target_table: 'profiles',
        target_id: created.user.id,
        meta,
      })
    } else {
      const supabase = await createServerSupabase()
      await audit(supabase, 'user.create', 'profiles', created.user.id, meta)
    }

    return Response.json(
      { user_id: created.user.id, temp_password, delivery },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
