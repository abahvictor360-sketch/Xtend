import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { PlaceManager, type KnownPlace, type WaitingStore } from '@/components/admin/place-manager'

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

  // Stores with no location yet: a learned place can be confirmed as one (034).
  const { data: waiting } = await supabase
    .from('outlets')
    .select('id, name, address')
    .is('lat', null)
    .eq('is_active', true)
    .order('name')

  // The shop-front photos staff took when naming a place (migration 025).
  const places = (data ?? []) as KnownPlace[]
  const paths = places.map((p) => p.photo_path).filter((p): p is string => Boolean(p))
  const photoUrls: Record<string, string> = {}
  if (paths.length) {
    try {
      const { data: signed } = await createAdminSupabase()
        .storage.from('reports')
        .createSignedUrls(paths.slice(0, 500), 3600)
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) photoUrls[item.path] = item.signedUrl
      }
    } catch {
      // Without the service key the list still shows, just without photos.
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Places</h1>
        <p className="text-sm text-muted-foreground">
          Places Xtend has learned. The first time somebody clocks in or checks in somewhere, its
          GPS position and name are saved here, from Google, OpenStreetMap, or the name the person
          typed when no map knew it. Next time anyone stands there, Xtend names it from this list,
          with no map lookup. Check the names staff typed against the photo they took of the place,
          correct any that are wrong, or turn a place into one of your stores. Stores added without a
          location get it here: when someone allocated to one clocks in away from their other
          stores, the spot is listed with the stores it could be, and you confirm which. Staff are not told
          that Xtend learns places: to them, naming a place is only recording where they are.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">
          Places could not be loaded. Has migration 024 been run in Supabase?
        </p>
      ) : (
        <PlaceManager
          places={places}
          photoUrls={photoUrls}
          waitingStores={(waiting ?? []) as WaitingStore[]}
        />
      )}
    </div>
  )
}
