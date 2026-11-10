import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { buildStaffLoginDoc, staffLogins } from '@/lib/staff-logins'
import { requireRecentAuth } from '@/lib/reconfirm'

/**
 * The staff login sheet as Word (migration 041): built from the live staff
 * list on every download, so new people are always in it. Admins only: it
 * holds temporary passwords.
 */
export async function GET(request: Request) {
  try {
    // It holds temporary passwords: the password again first (0080).
    await requireRecentAuth(await requireApiSession(['admin']))
    const url = new URL(request.url)
    // The button asks first, so the "confirm it is you" box can open; the
    // download itself is a plain link the browser or the app saves.
    if (url.searchParams.get('check') === '1') return new Response(null, { status: 204 })
    const staff = await staffLogins(createAdminSupabase())
    // The address staff are told to open: the one the admin is using, as the
    // proxy saw it (behind Dokploy request.url is the container's own).
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    const site = `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`
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
