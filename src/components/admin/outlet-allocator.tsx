'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Search, Store } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
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
  /** Their supervisor, which is their team; null when on nobody's team. */
  supervisor_id: string | null
}

/** A supervisor's team, by the supervisor's name. */
export interface AllocationTeam {
  id: string
  name: string
}

const NO_TEAM = 'no-team'

type Category = 'all' | Allocation['role']
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'merchandiser', label: 'Merchandisers' },
  { value: 'marketer', label: 'Marketers' },
]

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
  teams = [],
}: {
  allocations: Allocation[]
  outlets: AllocatableOutlet[]
  /** Every supervisor's team, for an admin; empty for a supervisor. */
  teams?: AllocationTeam[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [team, setTeam] = useState<string>('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const inCategory = useMemo(
    () => (category === 'all' ? allocations : allocations.filter((a) => a.role === category)),
    [allocations, category],
  )
  const roleCounts = useMemo(() => {
    const counts = new Map<Category, number>([['all', allocations.length]])
    for (const a of allocations) counts.set(a.role, (counts.get(a.role) ?? 0) + 1)
    return counts
  }, [allocations])
  const teamCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of inCategory) {
      const key = a.supervisor_id ?? NO_TEAM
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [inCategory])

  // Grouped by team, then by name, so a team's people sit together.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return inCategory
      .filter((a) => {
        if (team === NO_TEAM && a.supervisor_id) return false
        if (team !== 'all' && team !== NO_TEAM && a.supervisor_id !== team) return false
        return (
          !needle ||
          a.staff_name.toLowerCase().includes(needle) ||
          a.outlet_names.some((name) => name.toLowerCase().includes(needle))
        )
      })
      .sort((x, y) => {
        const tx = x.supervisor_id ? (teamName.get(x.supervisor_id) ?? '') : '~'
        const ty = y.supervisor_id ? (teamName.get(y.supervisor_id) ?? '') : '~'
        return tx.localeCompare(ty) || x.staff_name.localeCompare(y.staff_name)
      })
  }, [inCategory, team, search, teamName])

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

      <div
        role="tablist"
        aria-label="Role"
        className="flex w-full rounded-2xl bg-muted p-1 sm:inline-flex sm:w-auto"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={category === c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors sm:flex-none sm:px-4 sm:text-sm',
              category === c.value
                ? 'bg-card text-foreground shadow-soft'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {c.label} ({roleCounts.get(c.value) ?? 0})
          </button>
        ))}
      </div>

      {teams.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Team">
          <Chip active={team === 'all'} onClick={() => setTeam('all')}>
            Every team ({inCategory.length})
          </Chip>
          {teams.map((t) => (
            <Chip key={t.id} active={team === t.id} onClick={() => setTeam(t.id)}>
              {t.name}&rsquo;s team ({teamCounts.get(t.id) ?? 0})
            </Chip>
          ))}
          <Chip active={team === NO_TEAM} onClick={() => setTeam(NO_TEAM)}>
            No supervisor ({teamCounts.get(NO_TEAM) ?? 0})
          </Chip>
        </div>
      )}

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
          {allocations.length === 0 ? 'Nobody to allocate stores to.' : 'Nobody matches.'}
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
                    {teams.length > 0 &&
                      ` · ${
                        person.supervisor_id
                          ? `${teamName.get(person.supervisor_id) ?? 'A supervisor'}'s team`
                          : 'No supervisor'
                      }`}
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
