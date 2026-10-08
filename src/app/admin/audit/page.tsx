import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  ACTION_GROUPS,
  actionGroup,
  actionLabel,
  auditQueryString,
  deviceLabel,
  fetchAudit,
  locationText,
  mapLink,
  metaText,
  parseAuditFilter,
  type AuditEntry,
} from '@/lib/audit-log'
import { addDays, formatLagos, lagosDateString } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Audit log — Xtend' }

const ROLE = { admin: 'Admin', supervisor: 'Supervisor' } as Record<string, string>
const KIND = { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' } as Record<string, string>

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession(['admin'])
  const filter = parseAuditFilter(await searchParams)
  const supabase = await createServerSupabase()

  const [{ data: people }, audit] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('role', ['admin', 'supervisor']).order('full_name'),
    fetchAudit(supabase, filter, 400).catch((e: Error) => ({ error: e.message })),
  ])
  const failed = 'error' in audit ? audit.error : null
  const rows = 'rows' in audit ? audit.rows : []
  const flags = 'flags' in audit ? audit.flags : new Map()

  const devices = new Set(rows.map((r) => deviceLabel(r.device)).filter(Boolean))
  const vpn = rows.filter((r) => r.vpn).length
  const newOnes = rows.filter((r) => flags.get(r.id)?.newDevice || flags.get(r.id)?.newPlace).length
  const located = rows.filter((r) => r.lat != null).length
  const query = auditQueryString(filter)
  const today = lagosDateString()
  const groups = [...new Set(Object.values(ACTION_GROUPS)), 'Other']

  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
  ].map((p) => ({ ...p, href: `?${auditQueryString({ ...filter, from: p.from, to: p.to })}` }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every change an admin or supervisor makes, newest first: who, what, where they were and on what device.
          Location comes from the browser when it was allowed, otherwise roughly from the IP address. Rows are written
          by the server and the database, never by the browser.
        </p>
      </div>

      <form method="get" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="person">Who</Label>
            <Select id="person" name="person" defaultValue={filter.person ?? 'all'} className="h-10 text-sm">
              <option value="all">Everyone</option>
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-48">
            <Label htmlFor="group">What</Label>
            <Select id="group" name="group" defaultValue={filter.group ?? 'all'} className="h-10 text-sm">
              <option value="all">All actions</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={filter.from ?? ''} max={today} className="h-10 w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={filter.to ?? ''} max={today} className="h-10 w-40" />
          </div>
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="q">Search</Label>
            <Input id="q" name="q" defaultValue={filter.q ?? ''} placeholder="Name, store, IP, device…" className="h-10" />
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="flagged" value="1" defaultChecked={filter.flagged} className="h-4 w-4 accent-[hsl(var(--brand))]" />
            Only VPN, new device or new location
          </label>
          <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
            Show
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
          {presets.map((p) => (
            <Link key={p.label} href={p.href} className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint">
              {p.label}
            </Link>
          ))}
          {query && (
            <Link href="/admin/audit" className="px-2 py-1 font-semibold text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-muted-foreground">Download:</span>
            {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
              <a
                key={f}
                href={`/api/admin/export/audit/${f}${query ? `?${query}` : ''}`}
                className="rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint"
              >
                {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
              </a>
            ))}
          </span>
        </div>
      </form>

      {failed && <p className="text-sm text-destructive">Could not load the audit log: {failed}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Actions" value={rows.length} note={'truncated' in audit && audit.truncated ? 'newest shown' : undefined} />
        <Stat label="With a location" value={located} note={rows.length ? `${Math.round((located / rows.length) * 100)}%` : undefined} />
        <Stat label="Devices used" value={devices.size} />
        <Stat label="VPN or new device / place" value={vpn + newOnes} tone={vpn + newOnes > 0 ? 'warn' : undefined} />
      </div>

      {rows.length === 0 && !failed ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing matches.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Entry key={row.id} row={row} flag={flags.get(row.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'warn' }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-4">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}

function Entry({ row, flag }: { row: AuditEntry; flag?: { newDevice: boolean; newPlace: boolean } }) {
  const map = mapLink(row)
  const device = deviceLabel(row.device)
  const detail = metaText(row.meta)
  return (
    <details className="group rounded-lg border border-border bg-card open:border-brand/40">
      <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-4 gap-y-1.5 p-3 text-sm [&::-webkit-details-marker]:hidden">
        <div className="w-full sm:w-36">
          <p className="tabular-nums">{formatLagos(row.created_at)}</p>
          <p className="text-xs text-muted-foreground">{actionGroup(row.action)}</p>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold">{actionLabel(row.action)}</p>
          <p className="text-xs text-muted-foreground">
            {row.actor_name ?? 'System'}
            {row.actor_role && ROLE[row.actor_role] ? ` · ${ROLE[row.actor_role]}` : ''}
            {detail ? ` · ${detail.length > 90 ? `${detail.slice(0, 90)}…` : detail}` : ''}
          </p>
        </div>
        <div className="min-w-0 basis-56 sm:max-w-xs">
          <p className="truncate">
            {map ? (
              <a href={map} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
                {locationText(row)}
              </a>
            ) : (
              <span className="text-muted-foreground">{locationText(row)}</span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {device ?? 'Unknown device'}
            {row.device?.type ? ` · ${KIND[row.device.type]}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 sm:w-44 sm:justify-end">
          {row.vpn && <Badge variant="destructive">VPN</Badge>}
          {flag?.newDevice && <Badge variant="warning">New device</Badge>}
          {flag?.newPlace && <Badge variant="warning">New location</Badge>}
          {row.location_source === 'browser' && <Badge variant="outline">GPS</Badge>}
          {row.location_source === 'ip' && <Badge variant="outline">IP location</Badge>}
        </div>
      </summary>
      <div className="grid gap-x-6 gap-y-1 border-t border-border px-3 py-3 text-xs sm:grid-cols-2">
        <Fact k="Action" v={row.action} mono />
        <Fact k="Target" v={row.target_table ? `${row.target_table}${row.target_id ? ` · ${row.target_id}` : ''}` : null} mono />
        <Fact k="IP address" v={row.ip ? `${row.ip}${row.country ? ` (${row.country})` : ''}` : null} mono />
        <Fact k="VPN or datacentre" v={row.vpn == null ? null : row.vpn ? 'Yes' : 'No'} />
        <Fact
          k="Location"
          v={
            row.lat != null && row.lng != null
              ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)} · ${
                  row.location_source === 'ip' ? 'from the IP, to about 25 km' : `from the browser, ±${Math.round(row.accuracy_m ?? 0)} m`
                }`
              : null
          }
        />
        <Fact k="Store or place" v={row.place} />
        <Fact k="Device" v={device ? `${device}${row.device?.type ? ` · ${KIND[row.device.type]}` : ''}` : null} />
        <Fact k="App or web" v={row.device ? (row.device.app ? 'Xtend app' : 'Web browser') : null} />
        <div className="sm:col-span-2">
          <Fact k="Browser string" v={row.user_agent} mono />
        </div>
        {detail && (
          <div className="sm:col-span-2">
            <p className="font-semibold text-muted-foreground">Detail</p>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">
              {JSON.stringify(row.meta, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  )
}

function Fact({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <p className="min-w-0 break-words">
      <span className="font-semibold text-muted-foreground">{k}: </span>
      <span className={mono ? 'font-mono text-[11px]' : ''}>{v ?? '—'}</span>
    </p>
  )
}
