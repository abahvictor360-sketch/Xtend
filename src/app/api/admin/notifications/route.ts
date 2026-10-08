import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { pushConfigured } from '@/lib/push'
import { thingName, writtenText } from '@/lib/fields'
import { audit } from '@/lib/audit'
import { deliverNotification } from '@/lib/notification-send'
import { scheduleProblem } from '@/lib/notification-log'

export const maxDuration = 60

const schema = z.object({
  title: thingName(80, 'title'),
  // An admin's own words: links allowed, junk not.
  body: writtenText(400, 2, 'the message', true),
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
  /** Send later instead of now (an ISO instant). */
  send_at: z.string().datetime({ offset: true }).nullable().optional(),
  /** This send repeats an earlier one to the people it did not reach. */
  resend_of: z.string().uuid().nullable().optional(),
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
    if (input.resend_of && !input.preview) detail.resend_of = input.resend_of

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

    // Later: the database fixes the audience now, with this sender's reach,
    // and the five-minute job sends it when it is due.
    if (input.send_at) {
      const when = new Date(input.send_at)
      const problem = scheduleProblem(when, new Date())
      if (problem) return Response.json({ error: problem }, { status: 400 })
      const { data: scheduledId, error } = await supabase.rpc('schedule_notification', {
        p_title: input.title,
        p_body: input.body,
        p_url: input.url || null,
        p_audience: input.audience,
        p_detail: detail,
        p_send_at: when.toISOString(),
      })
      if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
      await audit(supabase, 'notification.schedule', 'scheduled_notifications', scheduledId as string, {
        audience: input.audience,
        detail,
        recipients: targets.length,
        title: input.title,
        send_at: when.toISOString(),
      })
      return Response.json({ scheduled_id: scheduledId, recipients: targets.length, send_at: when.toISOString() })
    }

    if (!pushConfigured()) {
      return Response.json(
        { error: 'Push is not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' },
        { status: 503 },
      )
    }

    const result = await deliverNotification(
      {
        senderId: session.userId,
        title: input.title,
        body: input.body,
        url: input.url || null,
        audience: input.audience,
        detail,
      },
      targets.map((t) => t.user_id),
    )
    return Response.json(result)
  } catch (error) {
    return apiError(error)
  }
}
