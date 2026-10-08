import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { roleName } from '@/lib/staff-roles'

const schema = z.object({
  name: roleName,
  base_role: z.enum(['merchandiser', 'marketer', 'supervisor'], {
    errorMap: () => ({ message: 'Choose what the role works like' }),
  }),
  counts_stock: z.boolean().default(true),
})

/** Adds a role (migration 042). Admins only; the table's policy agrees. */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid role' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('staff_roles')
      .insert(parsed.data)
      .select('id')
      .single<{ id: string }>()
    if (error) {
      const taken = error.code === '23505'
      return Response.json(
        { error: taken ? 'There is already a role with that name.' : dbErrorMessage(error) },
        { status: taken ? 409 : 400 },
      )
    }
    await audit(supabase, 'staff_role.create', 'staff_roles', data.id, parsed.data)
    return Response.json({ id: data.id }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
