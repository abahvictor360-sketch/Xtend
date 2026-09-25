'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, ExternalLink, Search, Store, Trash2 } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { cn, formatLagos } from '@/lib/utils'

export interface KnownPlace {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  radius_m: number
  source: 'google' | 'osm' | 'staff' | 'admin'
  verified: boolean
  times_seen: number
  created_at: string
  last_seen_at: string
  named_by_name: string | null
}

const SOURCE: Record<KnownPlace['source'], string> = {
  google: 'Named by Google',
  osm: 'Named by OpenStreetMap',
  staff: 'Named by staff',
  admin: 'Added by an admin',
}

export function PlaceManager({ places }: { places: KnownPlace[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<'check' | 'all'>('check')
  const [search, setSearch] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Staff-typed names that nobody has checked yet come first.
  const toCheck = places.filter((p) => !p.verified && p.source === 'staff')
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (filter === 'check' ? toCheck : places).filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        (p.address ?? '').toLowerCase().includes(needle),
    )
  }, [filter, places, search, toCheck])

  async function call(id: string, url: string, method: string, body?: unknown, done?: string) {
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That change could not be saved.')
      if (done) setNotice(done)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  if (places.length === 0) {
    return (
      <Alert variant="info">
        No places learned yet. They appear here as staff clock in and check in at places that
        are not one of your stores.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={filter === 'check'} onClick={() => setFilter('check')}>
          Names to check ({toCheck.length})
        </Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All places ({places.length})
        </Chip>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a place"
            className="h-9 pl-9 text-sm"
            aria-label="Find a place"
          />
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <ul className="space-y-3">
        {visible.map((p) => {
          const draft = names[p.id] ?? p.name
          return (
            <li key={p.id} className="rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {p.name}
                    {p.verified && <BadgeCheck className="h-4 w-4 text-brand" aria-label="Verified" />}
                  </p>
                  {p.address && <p className="text-xs text-muted-foreground">{p.address}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {SOURCE[p.source]}
                    {p.named_by_name ? ` (${p.named_by_name})` : ''} · seen {p.times_seen}{' '}
                    {p.times_seen === 1 ? 'time' : 'times'} · last {formatLagos(p.last_seen_at)} ·{' '}
                    {p.radius_m} m around
                  </p>
                </div>
                <a
                  href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-semibold text-brand"
                >
                  See on map <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))}
                  maxLength={120}
                  className="h-9 min-w-[12rem] flex-1 text-sm"
                  aria-label={`Name for ${p.name}`}
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={busy === p.id || draft.trim().length < 2}
                  onClick={() =>
                    call(
                      p.id,
                      `/api/admin/places/${p.id}`,
                      'PATCH',
                      { name: draft.trim(), verified: true },
                      `"${draft.trim()}" is verified.`,
                    )
                  }
                >
                  <BadgeCheck className="h-4 w-4" />
                  {draft.trim() === p.name ? (p.verified ? 'Verified' : 'Verify') : 'Save and verify'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={busy === p.id}
                  onClick={() => {
                    if (!confirm(`Make "${p.name}" one of your stores? Staff can then be allocated to it.`)) return
                    void call(p.id, `/api/admin/places/${p.id}/store`, 'POST', {}, `"${p.name}" is now a store.`)
                  }}
                >
                  <Store className="h-4 w-4" />
                  Make it a store
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn('h-9 text-destructive')}
                  disabled={busy === p.id}
                  onClick={() => {
                    if (!confirm(`Forget "${p.name}"?`)) return
                    void call(p.id, `/api/admin/places/${p.id}`, 'DELETE', undefined, `"${p.name}" was removed.`)
                  }}
                  aria-label={`Remove ${p.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          )
        })}
        {visible.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            {filter === 'check' ? 'No names waiting to be checked.' : 'No place matches.'}
          </li>
        )}
      </ul>
    </div>
  )
}
