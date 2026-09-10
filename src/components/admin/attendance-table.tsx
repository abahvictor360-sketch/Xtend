'use client'

import { Fragment, useCallback, useState } from 'react'
import { ChevronDown, LogIn, LogOut, Map as MapIcon, Table as TableIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AttendanceMap } from '@/components/admin/attendance-map'
import { formatLagos, metres } from '@/lib/utils'
import type { AttendanceDetail } from '@/lib/types'

export function AttendanceTable({ rows }: { rows: AttendanceDetail[] }) {
  const [view, setView] = useState<'table' | 'map'>('table')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selfies, setSelfies] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)

  /** Buckets are private; a selfie is fetched as a signed URL only on demand. */
  const expand = useCallback(
    async (row: AttendanceDetail) => {
      if (expanded === row.id) {
        setExpanded(null)
        return
      }
      setExpanded(row.id)
      if (selfies[row.id]) return

      setLoading(row.id)
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'selfies', paths: [row.selfie_path], expires_in: 300 }),
        })
        const { urls } = (await res.json()) as { urls: Record<string, string> }
        const url = urls?.[row.selfie_path]
        if (url) setSelfies((current) => ({ ...current, [row.id]: url }))
      } finally {
        setLoading(null)
      }
    },
    [expanded, selfies],
  )

  if (!rows.length) {
    return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      Nothing matches this filter.
    </p>
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button size="sm" variant={view === 'table' ? 'default' : 'outline'} onClick={() => setView('table')}>
          <TableIcon className="h-4 w-4" /> Table
        </Button>
        <Button size="sm" variant={view === 'map' ? 'default' : 'outline'} onClick={() => setView('map')}>
          <MapIcon className="h-4 w-4" /> Map
        </Button>
      </div>

      {view === 'map' ? (
        <AttendanceMap rows={rows} />
      ) : (
        <>
        {/* Phone: a card per event, tapping opens the same detail. */}
        <div className="space-y-3 md:hidden">
          {rows.map((row) => (
            <div key={row.id} className="surface p-3">
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left"
                onClick={() => void expand(row)}
              >
                <span className="icon-tile">
                  {row.type === 'opening' ? (
                    <LogIn className="h-5 w-5" />
                  ) : (
                    <LogOut className="h-5 w-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">{row.staff_name}</span>
                    <Badge variant={row.status === 'on_site' ? 'success' : 'destructive'}>
                      {row.status === 'on_site'
                        ? 'On site'
                        : row.status === 'off_site'
                          ? 'Off site'
                          : 'Flagged'}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {row.attendance_date} · {row.type === 'opening' ? 'In' : 'Out'}{' '}
                    {formatLagos(row.created_at, false)}
                    {row.is_late && <span className="ml-1 text-warning">late</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.outlet_name ?? 'No outlet'} · {metres(row.distance_m)} · ±
                    {Math.round(row.accuracy_m)} m
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.location_label}
                  </span>
                </span>
                <ChevronDown
                  className={`mt-1 h-4 w-4 shrink-0 transition-transform ${
                    expanded === row.id ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {expanded === row.id && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {loading === row.id ? (
                    <Skeleton className="h-40 w-32" />
                  ) : selfies[row.id] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={selfies[row.id]}
                      alt={`Selfie for ${row.staff_name}`}
                      className="w-32 rounded-2xl border border-border"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">Selfie unavailable.</p>
                  )}
                  <dl className="grid gap-x-4 gap-y-1 text-sm">
                    <Detail label="Location" value={row.location_label} />
                    <Detail
                      label="Coordinates"
                      value={`${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}`}
                    />
                    <Detail
                      label="Geofence radius"
                      value={row.outlet_radius_m ? `${row.outlet_radius_m} m` : '—'}
                    />
                    <Detail label="Captured on device at" value={formatLagos(row.client_captured_at)} />
                    <Detail label="Recorded by server at" value={formatLagos(row.created_at)} />
                    <Detail
                      label="Device"
                      value={String((row.device_info as { ua?: string })?.ua ?? 'not reported')}
                    />
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden rounded-lg border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow className="cursor-pointer" onClick={() => void expand(row)}>
                    <TableCell className="font-medium">{row.staff_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.attendance_date}</TableCell>
                    <TableCell>{row.type === 'opening' ? 'In' : 'Out'}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatLagos(row.created_at, false)}
                      {row.is_late && <span className="ml-1 text-xs text-warning">late</span>}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">{row.outlet_name ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{metres(row.distance_m)}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'on_site' ? 'success' : 'destructive'}>
                        {row.status === 'on_site' ? 'On site' : row.status === 'off_site' ? 'Off site' : 'Flagged'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${expanded === row.id ? 'rotate-180' : ''}`}
                      />
                    </TableCell>
                  </TableRow>

                  {expanded === row.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8}>
                        <div className="grid gap-4 py-2 md:grid-cols-[200px_1fr]">
                          <div>
                            {loading === row.id ? (
                              <Skeleton className="h-[200px] w-[160px]" />
                            ) : selfies[row.id] ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={selfies[row.id]}
                                alt={`Selfie for ${row.staff_name}`}
                                className="w-40 rounded-md border border-border"
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Selfie unavailable. Full images are purged after 90 days; the
                                thumbnail is the permanent record.
                              </p>
                            )}
                          </div>

                          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                            <Detail label="Location" value={row.location_label} />
                            <Detail
                              label="Premises"
                              value={row.place_name ?? 'Not identified'}
                            />
                            <Detail label="Captured address" value={row.address ?? '—'} />
                            <Detail
                              label="Coordinates"
                              value={`${row.lat.toFixed(6)}, ${row.lng.toFixed(6)}`}
                            />
                            <Detail label="Distance from outlet" value={metres(row.distance_m)} />
                            <Detail
                              label="Geofence radius"
                              value={row.outlet_radius_m ? `${row.outlet_radius_m} m` : '—'}
                            />
                            <Detail label="GPS accuracy" value={`±${Math.round(row.accuracy_m)} m`} />
                            <Detail
                              label="Captured on device at"
                              value={formatLagos(row.client_captured_at)}
                            />
                            <Detail label="Recorded by server at" value={formatLagos(row.created_at)} />
                            <Detail
                              label="Device"
                              value={String(
                                (row.device_info as { ua?: string })?.ua ?? 'not reported',
                              )}
                            />
                          </dl>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
