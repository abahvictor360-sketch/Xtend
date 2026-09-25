import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { PlaceManager, type KnownPlace } from '@/components/admin/place-manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Places — Xtend' }

export default async function PlacesPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('known_place_detail')
    .select('*')
    .order('verified', { ascending: true })
    .order('last_seen_at', { ascending: false })
    .limit(1000)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Places</h1>
        <p className="text-sm text-muted-foreground">
          Places Xtend has learned. The first time somebody clocks in or checks in somewhere, its
          GPS position and name are saved here, from Google, OpenStreetMap, or the name the
          person typed when no map knew it. Next time anyone stands there, Xtend names it from
          this list, with no map lookup. Check the names staff typed, correct any that are wrong,
          or turn a place into one of your stores.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">
          Places could not be loaded. Has migration 024 been run in Supabase?
        </p>
      ) : (
        <PlaceManager places={(data ?? []) as KnownPlace[]} />
      )}
    </div>
  )
}
