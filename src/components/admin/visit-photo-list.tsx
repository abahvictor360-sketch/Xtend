import { formatLagos, metres } from '@/lib/utils'
import { duration } from '@/lib/movement'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * One person's store visits on one day, as the office checks them: where
 * and when they checked in and out, how far from the store, and both
 * photos (check-in, and check-out from 0091). Shared by the Attendance
 * table and a person's day page.
 */
export interface DayVisit {
  id: string
  store: string
  status: string
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
  departed_status: string | null
  arrived_distance_m: number | null
  departed_distance_m: number | null
  arrived_label: string | null
  departed_label: string | null
  arrived_lat: number | null
  arrived_lng: number | null
  departed_lat: number | null
  departed_lng: number | null
  outlet_radius_m: number | null
  /** The thumbnail when there is one, else the full photo. */
  in_photo: string | null
  out_photo: string | null
}

/** Store visit rows (store_visit_detail) for the office's day views. */
export function toDayVisit(v: {
  id: string
  status: string
  arrived_at: string
  departed_at: string | null
  minutes: number
  arrived_status: string | null
  departed_status: string | null
  arrived_distance_m: number | null
  departed_distance_m: number | null
  arrived_label: string | null
  departed_label?: string | null
  arrived_lat?: number | null
  arrived_lng?: number | null
  departed_lat?: number | null
  departed_lng?: number | null
  outlet_radius_m?: number | null
  store_label: string | null
  outlet_name: string | null
  selfie_path: string | null
  thumb_path?: string | null
  departed_selfie_path?: string | null
  departed_thumb_path?: string | null
}): DayVisit {
  return {
    id: v.id,
    store: v.store_label ?? v.outlet_name ?? 'A place',
    status: v.status,
    arrived_at: v.arrived_at,
    departed_at: v.departed_at,
    minutes: v.minutes,
    arrived_status: v.arrived_status,
    departed_status: v.departed_status,
    arrived_distance_m: v.arrived_distance_m,
    departed_distance_m: v.departed_distance_m,
    arrived_label: v.arrived_label,
    departed_label: v.departed_label ?? null,
    arrived_lat: v.arrived_lat ?? null,
    arrived_lng: v.arrived_lng ?? null,
    departed_lat: v.departed_lat ?? null,
    departed_lng: v.departed_lng ?? null,
    outlet_radius_m: v.outlet_radius_m ?? null,
    in_photo: v.thumb_path ?? v.selfie_path ?? null,
    out_photo: v.departed_thumb_path ?? v.departed_selfie_path ?? null,
  }
}

const WHERE: Record<string, string> = { on_site: 'At the store', off_site: 'Away from the store', flagged: 'Location too rough' }

function placeBadge(status: string | null) {
  if (!status) return null
  return (
    <Badge variant={status === 'on_site' ? 'success' : 'destructive'}>{WHERE[status] ?? status}</Badge>
  )
}

/**
 * `photos` maps a stored path to a short-lived link (null: could not be
 * fetched or deleted); a path missing from it is still loading.
 */
export function VisitPhotoList({
  visits,
  photos,
  name,
}: {
  visits: DayVisit[]
  photos: Record<string, string | null>
  name: string
}) {
  if (!visits.length) {
    return <p className="text-sm text-muted-foreground">No store check-ins on this day.</p>
  }
  return (
    <ol className="space-y-3">
      {visits.map((v, i) => (
        <li key={v.id} className="rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold">
              {i + 1}. {v.store}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatLagos(v.arrived_at, false)}
              {v.departed_at ? ` – ${formatLagos(v.departed_at, false)} · ${duration(v.minutes)}` : ` · still there, ${duration(v.minutes)}`}
            </span>
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Side
              title="Check-in"
              at={v.arrived_at}
              where={v.arrived_label}
              distance={v.arrived_distance_m}
              radius={v.outlet_radius_m}
              status={v.arrived_status}
              lat={v.arrived_lat}
              lng={v.arrived_lng}
              path={v.in_photo}
              photos={photos}
              alt={`${name} checking in at ${v.store}`}
            />
            {v.departed_at ? (
              <Side
                title="Check-out"
                at={v.departed_at}
                where={v.departed_label}
                distance={v.departed_distance_m}
                radius={v.outlet_radius_m}
                status={v.departed_status}
                lat={v.departed_lat}
                lng={v.departed_lng}
                path={v.out_photo}
                photos={photos}
                alt={`${name} checking out of ${v.store}`}
                noPhoto="No check-out photo (checked out before photos were taken, or by the office)."
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Not checked out yet.
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function Side({
  title,
  at,
  where,
  distance,
  radius,
  status,
  lat,
  lng,
  path,
  photos,
  alt,
  noPhoto = 'No photo',
}: {
  title: string
  at: string
  where: string | null
  distance: number | null
  radius: number | null
  status: string | null
  lat: number | null
  lng: number | null
  path: string | null
  photos: Record<string, string | null>
  alt: string
  noPhoto?: string
}) {
  const photo = path ? photos[path] : null
  const loading = Boolean(path) && !(path! in photos)
  return (
    <div className="flex gap-3 rounded-lg border border-border p-2.5">
      <div className="w-20 shrink-0">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : photo ? (
          <a href={photo} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={alt} className="w-full rounded-lg border border-border" />
          </a>
        ) : (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {path ? 'Photo deleted. Visit photos are kept for 14 days.' : noPhoto}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {title} at {formatLagos(at, false)} {placeBadge(status)}
        </p>
        {where && <p className="break-words text-muted-foreground">{where}</p>}
        <p>
          {distance != null
            ? `${metres(distance)} from the store${radius ? ` (allowed ${radius} m)` : ''}`
            : 'No store of theirs to measure from'}
        </p>
        {lat != null && lng != null && (
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand hover:underline"
          >
            Open in Google Maps
          </a>
        )}
      </div>
    </div>
  )
}
