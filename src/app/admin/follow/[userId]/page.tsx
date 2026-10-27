import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { FollowLive } from '@/components/admin/follow-live'
import type { LiveLocation } from '@/components/admin/live-locations'
import { avatarUrls } from '@/lib/avatars'
import { formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Follow live — Xtend' }

/**
 * Follow live (migration 0070): one person who is clocked in, moving on the
 * map. Opened from Movement. live_locations() runs through the caller's
 * rights, so a supervisor only finds their own team here, and only people
 * clocked in and not clocked out today; the database checks both again
 * when following starts.
 */
export default async function FollowPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireSession(['admin', 'supervisor'])
  const { userId } = await params
  const supabase = await createServerSupabase()
  const valid = /^[0-9a-f-]{36}$/i.test(userId)

  const { data: live } = valid ? await supabase.rpc('live_locations') : { data: null }
  const row = ((live ?? []) as LiveLocation[]).find((r) => r.user_id === userId) ?? null

  if (!row) {
    const { data: person } = valid
      ? await supabase.from('profiles').select('id, full_name').eq('id', userId).maybeSingle<{ id: string; full_name: string }>()
      : { data: null }
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Follow live</h1>
        <Alert variant="info">
          {person
            ? `${person.full_name} is not clocked in right now, so they cannot be followed live. You can follow someone only while they are on shift.`
            : 'This person was not found, or is not on your team.'}
        </Alert>
        <div className="flex flex-wrap gap-2">
          {person && (
            <Link href={`/admin/tracking?person=${person.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Their route today
            </Link>
          )}
          <Link href="/admin/tracking" className={buttonVariants({ size: 'sm' })}>
            Everyone on shift
          </Link>
        </div>
      </div>
    )
  }

  const photo = (await avatarUrls(supabase, [row.user_id])).get(row.user_id) ?? null
  const store =
    row.outlet_lat != null && row.outlet_lng != null
      ? { name: row.outlet_name ?? 'Their store', lat: row.outlet_lat, lng: row.outlet_lng, radius_m: row.outlet_radius_m ?? 150 }
      : null
  const initial =
    row.last_lat != null && row.last_lng != null
      ? {
          lat: row.last_lat,
          lng: row.last_lng,
          at: row.last_ping_at ?? row.clocked_in_at,
          accuracy_m: null,
          place: row.last_place_name ?? row.clock_in_label,
        }
      : null

  return (
    <div className="space-y-2">
      <FollowLive person={{ id: row.user_id, name: row.full_name, phone: row.phone, photo }} store={store} initial={initial} />
      <p className="text-xs text-muted-foreground">Clocked in at {formatLagos(row.clocked_in_at, false)}.</p>
    </div>
  )
}
