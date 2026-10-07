import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { buildStaffLoginDoc, staffLogins } from '@/lib/staff-logins'

/**
 * The staff login sheet as Word (migration 041): built from the live staff
 * list on every download, so new people are always in it. Admins only: it
 * holds temporary passwords.
 */
export async function GET(request: Request) {
  try {
    await requireApiSession(['admin'])
    const staff = await staffLogins(createAdminSupabase())
    const site = new URL(request.url).origin
    const file = await buildStaffLoginDoc(staff, site)

    await audit(await createServerSupabase(), 'staff_logins.download', 'profiles', null, {
      people: staff.length,
    })

    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Xtend-staff-login-details-${date}.docx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
