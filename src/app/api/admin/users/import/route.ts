import { z } from 'zod'
import { optional, zEmail, zPersonName, zPhone } from '@/lib/validation'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { deliverCredentials, generateTempPassword } from '@/lib/credentials'
import { rememberTempPassword } from '@/lib/staff-logins'

const rowSchema = z.object({
  full_name: zPersonName,
  email: zEmail,
  phone: optional(zPhone),
  outlet_name: z.string().max(160).nullable().optional(),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).default('merchandiser'),
})

const bodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string().nullable())).min(1).max(500),
  commit: z.boolean().default(false),
})

export interface ImportRowResult {
  line: number
  full_name: string
  email: string
  phone: string | null
  role: string
  outlet_name: string | null
  outlet_id: string | null
  error: string | null
  created?: boolean
  temp_password?: string
}

/**
 * Validate the whole file first, then commit. Nobody hand-creates 80
 * accounts, and nobody wants half a file imported either.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid import payload' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data: outlets } = await admin.from('outlets').select('id, name')
    const outletByName = new Map(
      (outlets ?? []).map((o: { id: string; name: string }) => [o.name.trim().toLowerCase(), o.id]),
    )

    const { data: existing } = await admin.from('profiles').select('email, phone')
    const takenEmails = new Set(
      (existing ?? []).map((p: { email: string | null }) => p.email?.toLowerCase()).filter(Boolean),
    )
    const takenPhones = new Set(
      (existing ?? []).map((p: { phone: string | null }) => p.phone).filter(Boolean),
    )

    const seenEmails = new Set<string>()
    const results: ImportRowResult[] = []

    parsed.data.rows.forEach((raw, index) => {
      const normalised = {
        full_name: (raw.full_name ?? raw.name ?? '').trim(),
        email: (raw.email ?? '').trim().toLowerCase(),
        phone: (raw.phone ?? '').trim() || null,
        outlet_name: (raw.outlet_name ?? raw.outlet ?? '').trim() || null,
        role: (raw.role ?? 'merchandiser').trim().toLowerCase(),
      }

      const check = rowSchema.safeParse(normalised)
      const base: ImportRowResult = {
        line: index + 2, // +1 for zero-index, +1 for the header row
        full_name: normalised.full_name,
        email: normalised.email,
        phone: normalised.phone,
        role: normalised.role,
        outlet_name: normalised.outlet_name,
        outlet_id: null,
        error: null,
      }

      if (!check.success) {
        base.error = check.error.issues[0]?.message ?? 'Invalid row'
        results.push(base)
        return
      }
      // Tidied: single spaces, one phone format, so duplicates are caught.
      normalised.full_name = check.data.full_name
      normalised.phone = check.data.phone ?? null
      base.full_name = normalised.full_name
      base.phone = normalised.phone

      if (seenEmails.has(normalised.email)) base.error = 'Duplicate email inside this file'
      else if (takenEmails.has(normalised.email)) base.error = 'An account with this email exists'
      else if (normalised.phone && takenPhones.has(normalised.phone))
        base.error = 'An account with this phone exists'

      if (normalised.outlet_name) {
        const outletId = outletByName.get(normalised.outlet_name.toLowerCase())
        if (!outletId) base.error = base.error ?? `No outlet named "${normalised.outlet_name}"`
        else base.outlet_id = outletId
      }

      seenEmails.add(normalised.email)
      results.push(base)
    })

    const invalid = results.filter((r) => r.error).length

    if (!parsed.data.commit) {
      return Response.json({ preview: true, valid: results.length - invalid, invalid, rows: results })
    }

    if (invalid > 0) {
      return Response.json(
        { error: `Fix ${invalid} row(s) before importing.`, rows: results },
        { status: 400 },
      )
    }

    for (const row of results) {
      const temp_password = generateTempPassword()
      const { data: created, error: authError } = await admin.auth.admin.createUser({
        email: row.email,
        password: temp_password,
        email_confirm: true,
        user_metadata: { full_name: row.full_name },
      })

      if (authError || !created.user) {
        row.error = authError?.message ?? 'Could not create the account'
        continue
      }

      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        outlet_id: row.outlet_id,
        must_change_password: true,
      })

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        row.error = profileError.message
        continue
      }

      await rememberTempPassword(admin, created.user.id, temp_password)
      await deliverCredentials({
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        temp_password,
      })
      row.created = true
      row.temp_password = temp_password
    }

    const created = results.filter((r) => r.created).length
    const supabase = await createServerSupabase()
    await audit(supabase, 'user.bulk_import', 'profiles', null, {
      attempted: results.length,
      created,
    })

    return Response.json({ committed: true, created, failed: results.length - created, rows: results })
  } catch (error) {
    return apiError(error)
  }
}
