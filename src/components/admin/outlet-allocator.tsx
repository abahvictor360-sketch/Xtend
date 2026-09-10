'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Search, Store } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface Allocation {
  user_id: string
  staff_name: string
  role: 'merchandiser' | 'marketer'
  is_active: boolean
  home_outlet_id: string | null
  home_outlet_name: string | null
  outlet_ids: string[]
  outlet_names: string[]
}

export interface AllocatableOutlet {
  id: string
  name: string
  address: string | null
}

/**
 * One person, many stores. The home store is shown but never editable here:
 * it is set with the rest of the account, and it always counts as allocated
 * so nobody ends up with nowhere to clock in.
 */
export function OutletAllocator({
  allocations,
  outlets,
}: {
  allocations: Allocation[]
  outlets: AllocatableOutlet[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return allocations
    return allocations.filter(
      (a) =>
        a.staff_name.toLowerCase().includes(needle) ||
        a.outlet_names.some((name) => name.toLowerCase().includes(needle)),
    )
  }, [allocations, search])

  function startEditing(person: Allocation) {
    setError(null)
    setSaved(null)
    setEditing(person.user_id)
    setChosen(new Set(person.outlet_ids))
  }

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save(person: Allocation) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: person.user_id, outlet_ids: [...chosen] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Those stores could not be saved.')
        return
      }
      setSaved(
        `${person.staff_name} now covers ${chosen.size || 'no'} allocated store${
          chosen.size === 1 ? '' : 's'
        }.`,
      )
      setEditing(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      {saved && <Alert variant="success">{saved}</Alert>}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search staff or store"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {visible.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nobody to allocate stores to.
        </p>
      )}

      {visible.map((person) => {
        const open = editing === person.user_id
        return (
          <Card key={person.user_id}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {person.staff_name}
                    <Badge variant="outline">{person.role}</Badge>
                    {!person.is_active && <Badge variant="destructive">inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Home store: {person.home_outlet_name ?? 'none set'}
                  </p>
                </div>
                {open ? (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void save(person)}>
                      {busy ? 'Saving' : `Save ${chosen.size} store${chosen.size === 1 ? '' : 's'}`}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => startEditing(person)}>
                    <Store className="h-3.5 w-3.5" />
                    Allocate stores
                  </Button>
                )}
              </div>

              {open ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {outlets.map((outlet) => {
                    const picked = chosen.has(outlet.id)
                    const isHome = outlet.id === person.home_outlet_id
                    return (
                      <button
                        key={outlet.id}
                        type="button"
                        onClick={() => toggle(outlet.id)}
                        aria-pressed={picked}
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                          picked ? 'border-brand bg-tint' : 'border-border hover:bg-tint',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                            picked
                              ? 'border-brand bg-brand text-primary-foreground'
                              : 'border-border',
                          )}
                        >
                          {picked && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{outlet.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {isHome ? 'Home store — always included' : (outlet.address ?? '')}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : person.outlet_names.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {person.outlet_names.map((name) => (
                    <Badge key={name} variant="brand">
                      {name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No extra stores allocated — only the home store.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
