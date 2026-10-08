import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { PlaceManager, type KnownPlace, type WaitingStore } from '@/components/admin/place-manager'
import { PlaceDues, type PlaceDueRow } from '@/components/admin/place-dues'

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

  // Places staff must add before going on (045): open today, and recent.
  const { data: dues } = await supabase
    .from('place_naming_due_detail')
    .select('id, staff_name, lat, lng, source_kind, due_date, created_at, named_at, place_name, dismissed_at, dismiss_reason, dismissed_by_name')
    .gte('due_date', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
    .order('created_at', { ascending: false })
    .limit(200)

  // The shop-front photos staff took when naming a place (migration 025).
  const places = (data ?? []) as KnownPlace[]
  const paths = places
    .flatMap((p) => [p.photo_path, p.selfie_path])
    .filter((p): p is string => Boolean(p))
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
          Places Xtend has learned. When someone clocks in or checks in somewhere no store, learned
          place or map can name, they must add it before they go on: standing outside, they type the
          name on the sign, take a photo of the building with the sign and a selfie holding one of our
          products, both live in the app, and the phone&apos;s GPS gives the position. Next time anyone
          stands there, Xtend recognises it. Check the names against the photos, correct any that are
          wrong, or turn a place into one of your stores. Stores added without a location get it here:
          when someone allocated to one clocks in away from their other stores, the spot is listed with
          the stores it could be, and you confirm which.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">
          Places could not be loaded. Has migration 024 been run in Supabase?
        </p>
      ) : (
        <>
        <PlaceDues dues={(dues ?? []) as PlaceDueRow[]} />
        <PlaceManager
          places={places}
          photoUrls={photoUrls}
          waitingStores={(waiting ?? []) as WaitingStore[]}
        />
        </>
      )}
    </div>
  )
}
