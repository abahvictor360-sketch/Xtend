import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { auditContext, parseUserAgent } from '@/lib/audit-context'
import { formatLagos } from '@/lib/utils'
import { OFFICE_ROLES, deviceLine } from '@/lib/zero-trust'
import type { UserRole } from '@/lib/types'

/**
 * An office account (supervisor, admin, HR) signed in from a phone or
 * computer it has never used, while it already has one it uses (0080): the
 * person and every admin are told, and it is audited. The very first device
 * after an account starts using Xtend is not news, so it is not announced.
 * Field staff are never told about this, nor is anyone about field staff's
 * devices. Never holds up or fails the sign-in.
 */
export async function alertNewOfficeDevice(userId: string, headers: Headers) {
  try {
    const admin = createAdminSupabase()
    const { data: person } = await admin
      .from('profiles')
      .select('full_name, role')
      .eq('id', userId)
      .maybeSingle<{ full_name: string; role: UserRole }>()
    if (!person || !OFFICE_ROLES.includes(person.role)) return

    const device = deviceLine(parseUserAgent(headers.get('user-agent')))
    const when = formatLagos(new Date())
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
    const others = ((admins ?? []) as { id: string }[]).map((a) => a.id).filter((id) => id !== userId)

    await notifyUsers([userId], {
      title: 'New sign-in to your account',
      body: `Your Xtend account was opened on a new device: ${device}, ${when}. If this was not you, change your password now and tell an admin.`,
      url: '/change-password',
      detail: { kind: 'new_device' },
    })
    if (others.length) {
      await notifyUsers(others, {
        title: `New sign-in: ${person.full_name}`,
        body: `${person.full_name}'s account was opened on a new device: ${device}, ${when}. If it was not them, reset their password on Staff.`,
        url: '/admin/users',
        detail: { kind: 'new_device', user_id: userId },
      })
    }
    await admin.from('audit_log').insert({
      actor_id: userId,
      action: 'auth.new_device',
      target_table: 'profiles',
      target_id: userId,
      meta: { device, _context: await auditContext() },
    })
  } catch {
    // An alert that could not go out never stops the sign-in.
  }
}
