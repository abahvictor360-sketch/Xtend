import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { pushConfigured, sendPush, type PushTarget } from '@/lib/push'

export interface WatcherAlert {
  /** The member of staff the alert is about. */
  subjectId: string
  title: string
  body: string
  url?: string
  /** Recorded on the notification so sweeps can avoid repeating themselves. */
  detail?: Record<string, unknown>
}

/**
 * Tells the office about something without being asked: pushes to every
 * admin and to the supervisor of the subject's own outlet, then records the
 * message so it shows in the notification log and survives a closed laptop.
 *
 * Deliberately never throws. An alert failing to send must not roll back the
 * clock-in that caused it — the attendance record is the thing that matters,
 * and the alert row in location_alerts is written by the database either way.
 */
export async function notifyWatchers(alert: WatcherAlert): Promise<{
  watchers: number
  delivered: number
}> {
  try {
    const admin = createAdminSupabase()

    const { data: watcherRows, error: watcherError } = await admin.rpc('alert_watchers', {
      p_user: alert.subjectId,
    })
    if (watcherError) {
      console.error('alert_watchers failed', watcherError.message)
      return { watchers: 0, delivered: 0 }
    }

    const watchers = (watcherRows ?? []) as { user_id: string }[]
    if (watchers.length === 0) return { watchers: 0, delivered: 0 }

    const { data: notification } = await admin
      .from('notifications')
      .insert({
        sender_id: null,
        title: alert.title.slice(0, 80),
        body: alert.body.slice(0, 400),
        url: alert.url ?? '/admin/alerts',
        audience: 'users',
        audience_detail: {
          ...(alert.detail ?? {}),
          system: true,
          subject_id: alert.subjectId,
          user_ids: watchers.map((w) => w.user_id),
        },
        recipients: watchers.length,
      })
      .select('id')
      .single<{ id: string }>()

    let delivered = 0
    const deliveries: {
      notification_id: string
      user_id: string
      status: 'sent' | 'failed' | 'no_device'
      detail: string | null
    }[] = []

    if (pushConfigured() && notification) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in(
          'user_id',
          watchers.map((w) => w.user_id),
        )
        .eq('is_active', true)

      const devices = (subs ?? []) as PushTarget[]
      const results = await Promise.all(
        devices.map((device) =>
          sendPush(device, {
            title: alert.title,
            body: alert.body,
            url: alert.url ?? '/admin/alerts',
            notificationId: notification.id,
          }),
        ),
      )

      const dead = results.filter((r) => r.gone).map((r) => r.subscriptionId)
      if (dead.length) {
        await admin.from('push_subscriptions').update({ is_active: false }).in('id', dead)
      }

      const reached = new Set(results.filter((r) => r.ok).map((r) => r.userId))
      const attempted = new Set(results.map((r) => r.userId))

      for (const watcher of watchers) {
        const status = reached.has(watcher.user_id)
          ? 'sent'
          : attempted.has(watcher.user_id)
            ? 'failed'
            : 'no_device'
        if (status === 'sent') delivered += 1
        deliveries.push({
          notification_id: notification.id,
          user_id: watcher.user_id,
          status,
          detail: status === 'sent' ? null : 'Not delivered to any device',
        })
      }
    } else if (notification) {
      // No push configured: the message is still logged, and the dashboard
      // alert feed still shows it live.
      for (const watcher of watchers) {
        deliveries.push({
          notification_id: notification.id,
          user_id: watcher.user_id,
          status: 'no_device',
          detail: 'Push is not configured on this deployment',
        })
      }
    }

    if (notification && deliveries.length) {
      await admin.from('notification_deliveries').insert(deliveries)
      await admin
        .from('notifications')
        .update({ delivered, failed: deliveries.filter((d) => d.status === 'failed').length })
        .eq('id', notification.id)
    }

    return { watchers: watchers.length, delivered }
  } catch (error) {
    console.error('notifyWatchers failed', error)
    return { watchers: 0, delivered: 0 }
  }
}
