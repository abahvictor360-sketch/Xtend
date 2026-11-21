'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Home, Loader2, Search, UserMinus, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chip } from '@/components/ui/chip'

/** One field person as Store allocation sees them (staff_allocation). */
export interface StoreStaffPerson {
  user_id: string
  staff_name: string
  role: 'merchandiser' | 'marketer'
  is_active: boolean
  home_outlet_id: string | null
  home_outlet_name: string | null
  outlet_ids: string[]
  outlet_names: string[]
}

type Who = 'all' | StoreStaffPerson['role']
const WHO: { value: Who; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'merchandiser', label: 'Merchandisers' },
  { value: 'marketer', label: 'Marketers' },
]
const MAX_SHOWN = 30

const roleName = (r: StoreStaffPerson['role']) => (r === 'marketer' ? 'Marketer' : 'Merchandiser')

/**
 * The "Allocate" panel under a store on Outlets: who works here, and a
 * search to add marketers or merchandisers to this store (or take them
 * off). It changes only this store for that person (set_store_staff, 0097);
 * their home store is set on their account and shown, not changed, here.
 */
export function StoreStaff({
  outlet,
  staff,
  onClose,
}: {
  outlet: { id: string; name: string; is_active: boolean }
  staff: StoreStaffPerson[]
  onClose: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [who, setWho] = useState<Who>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Changes made here, shown at once while the page refreshes.
  const [local, setLocal] = useState<Record<string, boolean>>({})

  const allocatedHere = (p: StoreStaffPerson) => local[p.user_id] ?? p.outlet_ids.includes(outlet.id)
  const homeHere = (p: StoreStaffPerson) => p.home_outlet_id === outlet.id

  const here = staff
    .filter((p) => homeHere(p) || allocatedHere(p))
    .sort((a, b) => Number(homeHere(b)) - Number(homeHere(a)) || a.staff_name.localeCompare(b.staff_name))

  const q = query.trim().toLowerCase()
  const results = staff
      .filter((p) => p.is_active && !homeHere(p) && !allocatedHere(p))
      .filter((p) => who === 'all' || p.role === who)
      .filter(
        (p) =>
          !q ||
          p.staff_name.toLowerCase().includes(q) ||
          (p.home_outlet_name ?? '').toLowerCase().includes(q) ||
          p.outlet_names.some((n) => n.toLowerCase().includes(q)),
      )
    .sort((a, b) => a.staff_name.localeCompare(b.staff_name))

  async function change(person: StoreStaffPerson, on: boolean) {
    setBusy(person.user_id)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/admin/outlets/${outlet.id}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: person.user_id, on }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'That could not be saved. Try again.')
        return
      }
      setLocal((l) => ({ ...l, [person.user_id]: on }))
      setNote(on ? `${person.staff_name} now works at ${outlet.name}.` : `${person.staff_name} is off ${outlet.name}.`)
      router.refresh()
    } catch {
      setError('Could not reach Xtend. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-brand/30 bg-tint/40 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Allocate staff to {outlet.name}</p>
          <p className="text-xs text-muted-foreground">
            Adding a store keeps the person&rsquo;s other stores. A marketer can then check in here.
          </p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {note && <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-foreground">{note}</p>}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          Working here ({here.length})
        </p>
        {here.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody yet. Search below to add someone.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {here.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.staff_name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {roleName(p.role)}
                    {!p.is_active && ' · inactive'}
                  </span>
                </span>
                {homeHere(p) ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="Their home store is changed on their account (Staff)">
                    <Home className="h-3.5 w-3.5" /> Home store
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy !== null}
                    onClick={() => void change(p, false)}
                  >
                    {busy === p.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {outlet.is_active ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search marketers or merchandisers"
              className="bg-card pl-9"
              aria-label="Search staff to allocate"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WHO.map((w) => (
              <Chip key={w.value} active={who === w.value} onClick={() => setWho(w.value)}>
                {w.label}
              </Chip>
            ))}
          </div>
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {query.trim() ? 'Nobody matches that name.' : 'Everyone is already here.'}
            </p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border bg-card">
              {results.slice(0, MAX_SHOWN).map((p) => (
                <li key={p.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.staff_name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {roleName(p.role)}
                      {p.home_outlet_name ? ` · home: ${p.home_outlet_name}` : ''}
                      {p.outlet_names.length ? ` · also ${p.outlet_names.length} store${p.outlet_names.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void change(p, true)}>
                    {busy === p.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Allocate
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {results.length > MAX_SHOWN && (
            <p className="text-[11px] text-muted-foreground">
              Showing {MAX_SHOWN} of {results.length}. Type a name to find someone.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Reactivate this store to allocate staff to it.</p>
      )}
    </div>
  )
}
