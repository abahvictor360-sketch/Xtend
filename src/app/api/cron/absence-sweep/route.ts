import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyWatchers } from '@/lib/notify'

export const maxDuration = 60

interface NoShow {
  user_id: string
  full_name: string
  phone: string | null
  outlet_name: string | null
  shift_start: string
  minutes_late: number
}

/**
 * Absence sweep. Anyone whose shift started more than the grace period ago
 * and who has not clocked in is reported to their admin and supervisor,
 * once per day per person.
 *
 * Scheduled daily at 08:30 UTC (09:30 Lagos), which is past the 30-minute
 * grace for both an 08:00 and a 09:00 shift. Vercel's Hobby plan allows one
 * run per day per cron; on Pro, change the schedule in vercel.json to
 * "0 6-16 * * 1-6" and each outlet is then judged close to its own start.
 *
 * The endpoint is idempotent — no_show_already_reported() keeps a second
 * run from notifying the same person twice — so running it more often is
 * safe whenever the plan allows.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization')
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const graceMinutes = Number(new URL(request.url).searchParams.get('grace') ?? 30)
  const supabase = createAdminSupabase()

  const { data, error } = await supabase.rpc('staff_no_show', {
    p_grace_minutes: Number.isFinite(graceMinutes) ? graceMinutes : 30,
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const absent = (data ?? []) as NoShow[]
  let reported = 0

  for (const person of absent) {
    const { data: already } = await supabase.rpc('no_show_already_reported', {
      p_user: person.user_id,
    })
    if (already === true) continue

    await notifyWatchers({
      subjectId: person.user_id,
      title: `${person.full_name} has not clocked in`,
      body:
        `${person.minutes_late} min after the ${person.shift_start.slice(0, 5)} start at ` +
        `${person.outlet_name ?? 'their outlet'}.` +
        (person.phone ? ` Call ${person.phone}.` : ''),
      url: '/admin',
      detail: { kind: 'no_show', minutes_late: person.minutes_late },
    })
    reported += 1
  }

  return Response.json({
    checked_at: new Date().toISOString(),
    grace_minutes: graceMinutes,
    absent: absent.length,
    reported,
    already_reported: absent.length - reported,
  })
}
