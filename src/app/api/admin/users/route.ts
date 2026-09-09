import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { deliverCredentials, generateTempPassword } from '@/lib/credentials'

const createUserSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(7).max(20).nullable().optional(),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).default('merchandiser'),
  outlet_id: z.string().uuid().nullable().optional(),
})

export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = createUserSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid user' },
        { status: 400 },
      )
    }
    const input = parsed.data
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
      outlet_id: input.outlet_id || null,
      must_change_password: true,
    })

    if (profileError) {
      // Never leave an auth user without a profile.
      await admin.auth.admin.deleteUser(created.user.id)
      const status = profileError.code === '23505' ? 409 : 400
      return Response.json({ error: profileError.message }, { status })
    }

    const delivery = await deliverCredentials({
      full_name: input.full_name,
      email,
      phone: input.phone ?? null,
      temp_password,
    })

    const supabase = await createServerSupabase()
    await audit(supabase, 'user.create', 'profiles', created.user.id, {
      email,
      role: input.role,
      delivery,
    })

    return Response.json(
      { user_id: created.user.id, temp_password, delivery },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
