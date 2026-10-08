import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { pushConfigured, sendPush, type PushTarget } from '@/lib/push'
import { auditContext } from '@/lib/audit-context'

export interface OutgoingNotification {
  senderId: string | null
  title: string
  body: string
  url: string | null
  audience: 'everyone' | 'role' | 'outlet' | 'users'
  detail: Record<string, unknown>
}

export interface SendResult {
  notification_id: string
  recipients: number
  delivered: number
  failed: number
  no_device: number
}

/**
 * Sends a notification an office member wrote to people already worked out
 * with their reach: the log row, a push to every device, one delivery row
 * per person, and the audit row. Push must be configured (the callers check).
 *
 * The service role is needed to read other people's device rows and to
 * write the delivery log; who is in `userIds` was decided before this, by
 * resolve_notification_targets with the sender's own session.
 *
 * `context` is the audit context: the request's (the default) for a send
 * someone made, or null for one the scheduled job made.
 */
export async function deliverNotification(
  msg: OutgoingNotification,
  userIds: string[],
  options: { context?: 'request' | null; auditMeta?: Record<string, unknown> } = {},
): Promise<SendResult> {
  const admin = createAdminSupabase()
  const ids = [...new Set(userIds)]

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', ids)
    .eq('is_active', true)
  if (subsError) throw new Error(subsError.message)

  const { data: notification, error: insertError } = await admin
    .from('notifications')
    .insert({
      sender_id: msg.senderId,
      title: msg.title,
      body: msg.body,
      url: msg.url || null,
      audience: msg.audience,
      audience_detail: msg.detail,
      recipients: ids.length,
    })
    .select('id')
    .single<{ id: string }>()
  if (insertError || !notification) throw new Error(insertError?.message ?? 'Could not record the notification')

  const devices = (subs ?? []) as PushTarget[]
  const results = await Promise.all(
    devices.map((device) =>
      sendPush(device, {
        title: msg.title,
        body: msg.body,
        url: msg.url || '/field',
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

  const deliveries = ids.map((userId) => {
    const entry = byUser.get(userId)
    if (!entry) {
      return {
        notification_id: notification.id,
        user_id: userId,
        status: 'no_device' as const,
        detail: 'No device has notifications turned on',
      }
    }
    return {
      notification_id: notification.id,
      user_id: userId,
      status: entry.ok > 0 ? ('sent' as const) : ('failed' as const),
      detail: entry.ok > 0 ? null : (entry.error ?? 'Delivery failed'),
    }
  })

  if (deliveries.length) await admin.from('notification_deliveries').insert(deliveries)

  const delivered = deliveries.filter((d) => d.status === 'sent').length
  const failed = deliveries.filter((d) => d.status === 'failed').length
  const noDevice = deliveries.filter((d) => d.status === 'no_device').length

  await admin.from('notifications').update({ delivered, failed }).eq('id', notification.id)

  // The row goes in directly with the sender as the actor. Every send is
  // audited, whoever (or whatever schedule) made it.
  await admin.from('audit_log').insert({
    actor_id: msg.senderId,
    action: 'notification.send',
    target_table: 'notifications',
    target_id: notification.id,
    meta: {
      audience: msg.audience,
      detail: msg.detail,
      recipients: ids.length,
      delivered,
      failed,
      title: msg.title,
      ...(options.auditMeta ?? {}),
      ...(options.context === null ? {} : { _context: await auditContext() }),
    },
  })

  return { notification_id: notification.id, recipients: ids.length, delivered, failed, no_device: noDevice }
}

/**
 * The five-minute job's part: send every scheduled notification that is
 * due. Each is claimed once in the database, so two runs never both send
 * it. With push not configured nothing is claimed, and the page shows the
 * schedule as late.
 */
export async function flushScheduledNotifications(): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured()) return { sent: 0, failed: 0 }
  const admin = createAdminSupabase()
  const { data, error } = await admin.rpc('claim_due_notifications', { p_limit: 20 })
  if (error) {
    // Before migration 053 the function does not exist; nothing to send.
    if (!/claim_due_notifications/.test(error.message)) console.error('claim_due_notifications failed', error.message)
    return { sent: 0, failed: 0 }
  }
  let sent = 0
  let failed = 0
  for (const row of (data ?? []) as ScheduledRow[]) {
    const result = await sendScheduled(row)
    if (result) sent += 1
    else failed += 1
  }
  return { sent, failed }
}

export interface ScheduledRow {
  id: string
  created_by: string | null
  title: string
  body: string
  url: string | null
  audience: OutgoingNotification['audience']
  audience_detail: Record<string, unknown>
  user_ids: string[]
}

/**
 * Sends one scheduled notification that has already been claimed (status
 * 'sending'), and records how it went. Only people still active get it.
 * `userIds` overrides the list fixed at scheduling time (send now re-checks
 * the sender's reach). Never throws: the row is marked failed instead.
 */
export async function sendScheduled(
  row: ScheduledRow,
  options: { userIds?: string[]; context?: 'request' | null } = {},
): Promise<SendResult | null> {
  const admin = createAdminSupabase()
  try {
    let ids = options.userIds ?? row.user_ids
    if (!options.userIds && ids.length) {
      const { data: active } = await admin.from('profiles').select('id').in('id', ids).eq('is_active', true)
      ids = ((active ?? []) as { id: string }[]).map((p) => p.id)
    }
    if (ids.length === 0) {
      await admin
        .from('scheduled_notifications')
        .update({ status: 'failed', error: 'Nobody it was meant for is still active.' })
        .eq('id', row.id)
      return null
    }
    const result = await deliverNotification(
      {
        senderId: row.created_by,
        title: row.title,
        body: row.body,
        url: row.url,
        audience: row.audience,
        detail: { ...row.audience_detail, scheduled_id: row.id },
      },
      ids,
      { context: options.context ?? null, auditMeta: { scheduled_id: row.id } },
    )
    await admin
      .from('scheduled_notifications')
      .update({ status: 'sent', sent_at: new Date().toISOString(), notification_id: result.notification_id })
      .eq('id', row.id)
    return result
  } catch (error) {
    await admin
      .from('scheduled_notifications')
      .update({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Sending failed' })
      .eq('id', row.id)
    return null
  }
}
