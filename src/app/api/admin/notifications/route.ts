import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { pushConfigured, sendPush, type PushTarget } from '@/lib/push'

export const maxDuration = 60

const schema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(400),
  // A page in Xtend only. A link to another site would let a notification
  // that reads as Xtend's open somebody else's page.
  url: z
    .string()
    .max(300)
    .regex(/^\/(?![/\\])[^\s\\]*$/, 'A notification can only open a page in Xtend')
    .nullable()
    .optional(),
  audience: z.enum(['everyone', 'role', 'outlet', 'users']),
  role: z.enum(['merchandiser', 'marketer', 'supervisor', 'admin']).nullable().optional(),
  outlet_id: z.string().uuid().nullable().optional(),
  user_ids: z.array(z.string().uuid()).max(500).optional(),
  /** Resolve and count the audience without sending anything. */
  preview: z.boolean().default(false),
})

interface TargetRow {
  user_id: string
  full_name: string
  role: string
  outlet_name: string | null
  devices: number
}

export async function POST(request: Request) {
  try {
    // Supervisors may send too, but resolve_notification_targets narrows
    // them to their own outlet, so reach is decided in Postgres.
    const session = await requireApiSession(['admin', 'supervisor'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid notification' },
        { status: 400 },
      )
    }
    const input = parsed.data

    if (input.audience === 'role' && !input.role) {
      return Response.json({ error: 'Pick a role to send to.' }, { status: 400 })
    }
    if (input.audience === 'outlet' && !input.outlet_id) {
      return Response.json({ error: 'Pick an outlet to send to.' }, { status: 400 })
    }
    if (input.audience === 'users' && !input.user_ids?.length) {
      return Response.json({ error: 'Pick at least one person.' }, { status: 400 })
    }

    const detail: Record<string, unknown> = {}
    if (input.audience === 'role') detail.role = input.role
    if (input.audience === 'outlet') detail.outlet_id = input.outlet_id
    if (input.audience === 'users') detail.user_ids = input.user_ids

    const supabase = await createServerSupabase()
    const { data: targetData, error: targetError } = await supabase.rpc(
      'resolve_notification_targets',
      { p_audience: input.audience, p_detail: detail },
    )
    if (targetError) return Response.json({ error: dbErrorMessage(targetError) }, { status: 400 })

    const targets = (targetData ?? []) as TargetRow[]

    if (input.preview) {
      return Response.json({
        preview: true,
        recipients: targets.length,
        with_devices: targets.filter((t) => t.devices > 0).length,
        people: targets.map((t) => ({
          user_id: t.user_id,
          full_name: t.full_name,
          role: t.role,
          outlet_name: t.outlet_name,
          devices: t.devices,
        })),
      })
    }

    if (targets.length === 0) {
      return Response.json({ error: 'That audience matches nobody.' }, { status: 400 })
    }
    if (!pushConfigured()) {
      return Response.json(
        { error: 'Push is not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' },
        { status: 503 },
      )
    }

    // The service role is needed to read other people's device rows and to
    // write the delivery log; the audience above was already narrowed to
    // what this sender is allowed to reach.
    const admin = createAdminSupabase()
    const userIds = targets.map((t) => t.user_id)

    const { data: subs, error: subsError } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
      .eq('is_active', true)
    if (subsError) return Response.json({ error: dbErrorMessage(subsError) }, { status: 400 })

    const { data: notification, error: insertError } = await admin
      .from('notifications')
      .insert({
        sender_id: session.userId,
        title: input.title,
        body: input.body,
        url: input.url || null,
        audience: input.audience,
        audience_detail: detail,
        recipients: targets.length,
      })
      .select('id')
      .single<{ id: string }>()
    if (insertError) return Response.json({ error: dbErrorMessage(insertError) }, { status: 400 })

    const devices = (subs ?? []) as PushTarget[]
    const results = await Promise.all(
      devices.map((device) =>
        sendPush(device, {
          title: input.title,
          body: input.body,
          url: input.url || '/field',
          notificationId: notification.id,
        }),
      ),
    )

    // Retire subscriptions the push service says are gone.
    const dead = results.filter((r) => r.gone).map((r) => r.subscriptionId)
    if (dead.length) {
      await admin.from('push_subscriptions').update({ is_active: false }).in('id', dead)
    }

    // One delivery row per person: sent if any of their devices took it,
    // no_device if they have none registered, failed otherwise.
    const byUser = new Map<string, { ok: number; failed: number; error?: string }>()
    for (const result of results) {
      const entry = byUser.get(result.userId) ?? { ok: 0, failed: 0 }
      if (result.ok) entry.ok += 1
      else {
        entry.failed += 1
        entry.error = result.error
      }
      byUser.set(result.userId, entry)
    }

    const deliveries = targets.map((target) => {
      const entry = byUser.get(target.user_id)
      if (!entry) {
        return {
          notification_id: notification.id,
          user_id: target.user_id,
          status: 'no_device' as const,
          detail: 'No device has notifications turned on',
        }
      }
      return {
        notification_id: notification.id,
        user_id: target.user_id,
        status: entry.ok > 0 ? ('sent' as const) : ('failed' as const),
        detail: entry.ok > 0 ? null : (entry.error ?? 'Delivery failed'),
      }
    })

    await admin.from('notification_deliveries').insert(deliveries)

    const delivered = deliveries.filter((d) => d.status === 'sent').length
    const failed = deliveries.filter((d) => d.status === 'failed').length

    await admin
      .from('notifications')
      .update({ delivered, failed })
      .eq('id', notification.id)

    // write_audit() is admin-only by design, and supervisors send too, so
    // the row goes in directly with the sender as the actor. Every send is
    // audited regardless of who made it.
    await admin.from('audit_log').insert({
      actor_id: session.userId,
      action: 'notification.send',
      target_table: 'notifications',
      target_id: notification.id,
      meta: {
        audience: input.audience,
        detail,
        recipients: targets.length,
        delivered,
        failed,
        title: input.title,
      },
    })

    return Response.json({
      notification_id: notification.id,
      recipients: targets.length,
      delivered,
      failed,
      no_device: deliveries.filter((d) => d.status === 'no_device').length,
    })
  } catch (error) {
    return apiError(error)
  }
}
