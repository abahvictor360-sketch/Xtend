'use client'

import { MapPin, Navigation, Phone, RefreshCw, Route } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLagos, metres } from '@/lib/utils'

export interface LiveLocation {
  user_id: string
  full_name: string
  phone: string | null
  outlet_name: string | null
  outlet_lat: number | null
  outlet_lng: number | null
  outlet_radius_m: number | null
  clocked_in_at: string
  clock_in_label: string | null
  clock_in_status: string | null
  last_ping_at: string | null
  minutes_since_ping: number | null
  last_lat: number | null
  last_lng: number | null
  last_place_name: string | null
  distance_from_outlet_m: number | null
  inside_geofence: boolean | null
  /** Signed link to their profile photo (037), when they have one. */
  avatar_url?: string | null
}

/**
 * Where everyone on shift is, right now. The clock-in line is where they
 * started; the heartbeat line is where they were last seen and how long
 * ago, so a stale figure reads as stale rather than as current.
 */
export function LiveLocations({ rows }: { rows: LiveLocation[] }) {
  const router = useRouter()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Navigation className="h-4 w-4" />
          Where everyone is ({rows.length} on shift)
        </CardTitle>
        <div className="flex items-center gap-1">
          <Link href="/admin/tracking" className="text-xs font-semibold text-brand hover:underline">
            Live map
          </Link>
          <Button
            size="iconSm"
            variant="ghost"
            aria-label="Refresh"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is on shift right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const stale = (row.minutes_since_ping ?? 999) > 15
              const mapLink =
                row.last_lat !== null && row.last_lng !== null
                  ? `https://www.google.com/maps/search/?api=1&query=${row.last_lat},${row.last_lng}`
                  : null

              return (
                <li
                  key={row.user_id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {row.full_name}
                      {row.inside_geofence === true && <Badge variant="success">In store</Badge>}
                      {row.inside_geofence === false && (
                        <Badge variant="destructive">Not in store</Badge>
                      )}
                      {row.inside_geofence === null && <Badge variant="outline">No outlet</Badge>}
                    </p>

                    <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="min-w-0">
                        {row.last_place_name ??
                          row.clock_in_label ??
                          (row.last_lat !== null
                            ? `${row.last_lat.toFixed(5)}, ${row.last_lng?.toFixed(5)}`
                            : 'Location unknown')}
                        {row.distance_from_outlet_m !== null && (
                          <>
                            {' · '}
                            <span
                              className={
                                row.inside_geofence
                                  ? 'text-success'
                                  : 'font-semibold text-destructive'
                              }
                            >
                              {metres(row.distance_from_outlet_m)} from{' '}
                              {row.outlet_name ?? 'outlet'}
                            </span>
                          </>
                        )}
                      </span>
                    </p>

                    <p className="text-[11px] text-muted-foreground">
                      Clocked in {formatLagos(row.clocked_in_at, false)}
                      {' · '}
                      {row.last_ping_at ? (
                        <span className={stale ? 'text-warning' : undefined}>
                          last seen {formatLagos(row.last_ping_at, false)}
                          {row.minutes_since_ping !== null &&
                            ` (${row.minutes_since_ping} min ago)`}
                        </span>
                      ) : (
                        <span className="text-warning">no location check since clock-in</span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {row.phone && (
                      <a
                        href={`tel:${row.phone}`}
                        aria-label={`Call ${row.full_name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-brand"
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                    <Link
                      href={`/admin/tracking?person=${row.user_id}`}
                      aria-label={`Follow ${row.full_name}'s route today`}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-brand"
                    >
                      <Route className="h-4 w-4" />
                    </Link>
                    {mapLink && (
                      <a
                        href={mapLink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${row.full_name}'s location on a map`}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-brand"
                      >
                        <MapPin className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
