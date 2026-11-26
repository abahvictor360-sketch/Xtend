import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { POST as sendNotification } from '@/app/api/admin/notifications/route'

const schema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(120),
  notes: z.string().trim().max(3000),
  audience: z.enum(['everyone', 'field', 'office']),
  required: z.boolean(),
  min_android_build: z.number().int().positive().nullable(),
  min_ios_build: z.number().int().positive().nullable(),
  /** Also send it to their phones as a notification. */
  notify: z.boolean(),
})

const ROLES = {
  everyone: null,
  field: ['merchandiser', 'marketer'],
  office: ['supervisor', 'admin'],
} as const

/** Publishes "What's new" (and, if set, a required update or a lowest app build). */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Check the form' }, { status: 400 })
    }
    const b = parsed.data
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('app_releases')
      .insert({
        title: b.title,
        notes: b.notes,
        audience: b.audience,
        required: b.required,
        min_android_build: b.min_android_build,
        min_ios_build: b.min_ios_build,
        created_by: session.userId,
      })
      .select('id')
      .single()
    if (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205'
      return Response.json({ error: missing ? 'This needs update 057 run in Supabase.' : dbErrorMessage(error) }, { status: 400 })
    }
    await audit(supabase, 'app.release', 'app_releases', data.id, { ...b })

    // The phones hear about it the way any notification reaches them: the
    // same route, the same reach checks and audit row.
    let notified = 0
    if (b.notify) {
      const roles = ROLES[b.audience]
      for (const role of roles ?? [null]) {
        const res = await sendNotification(
          new Request(new URL('/api/admin/notifications', request.url), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              title: `New in Xtend: ${b.title}`.slice(0, 80),
              body: (b.notes || 'Open Xtend to get the latest version.').slice(0, 400),
              url: '/',
              audience: role ? 'role' : 'everyone',
              role,
            }),
          }),
        )
        if (res.ok) notified += Number(((await res.json()) as { recipients?: number }).recipients ?? 0)
      }
    }
    return Response.json({ id: data.id, notified }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

const forceSchema = z.object({
  /** After the third update reminder and the grace time, the old app stops (0113). */
  force_old_app: z.boolean(),
  force_app_after_hours: z.number().int().min(0).max(720),
})

/** Switches "the old app must update after three reminders" on or off, and its grace time. */
export async function PATCH(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = forceSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: 'Give the hours as a number from 0 to 720' }, { status: 400 })
    }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_force_app_update', {
      p_on: parsed.data.force_old_app,
      p_hours: parsed.data.force_app_after_hours,
    })
    if (error) {
      const missing = /set_force_app_update/.test(error.message) && /function|schema cache/i.test(error.message)
      return Response.json({ error: missing ? 'This needs migration 0113 run in Supabase.' : dbErrorMessage(error) }, { status: 400 })
    }
    await audit(supabase, 'app.force_update', 'system_settings', null, { ...parsed.data })
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(error)
  }
}
