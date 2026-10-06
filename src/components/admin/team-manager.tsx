'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, UserCheck, UserMinus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface TeamMember {
  id: string
  full_name: string
  role: 'merchandiser' | 'marketer'
  store: string | null
  supervisor_id: string | null
}

export interface TeamSupervisor {
  id: string
  full_name: string
  role: string
}

const UNASSIGNED = 'unassigned'

type Category = 'all' | TeamMember['role']
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'merchandiser', label: 'Merchandisers' },
  { value: 'marketer', label: 'Marketers' },
]

export function TeamManager({
  members,
  supervisors,
}: {
  members: TeamMember[]
  supervisors: TeamSupervisor[]
}) {
  const router = useRouter()
  const [category, setCategory] = useState<Category>('all')
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState(supervisors[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const nameOf = useMemo(() => new Map(supervisors.map((s) => [s.id, s.full_name])), [supervisors])
  const inCategory = useMemo(
    () => (category === 'all' ? members : members.filter((m) => m.role === category)),
    [members, category],
  )
  const roleCounts = useMemo(() => {
    const map = new Map<Category, number>([['all', members.length]])
    for (const m of members) map.set(m.role, (map.get(m.role) ?? 0) + 1)
    return map
  }, [members])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of inCategory) {
      const key = m.supervisor_id ?? UNASSIGNED
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [inCategory])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return inCategory.filter((m) => {
      if (filter === UNASSIGNED && m.supervisor_id) return false
      if (filter !== 'all' && filter !== UNASSIGNED && m.supervisor_id !== filter) return false
      if (!needle) return true
      return (
        m.full_name.toLowerCase().includes(needle) || (m.store ?? '').toLowerCase().includes(needle)
      )
    })
  }, [inCategory, filter, search])

  const allVisibleChosen = visible.length > 0 && visible.every((m) => chosen.has(m.id))

  // Switching category drops anyone ticked who is no longer shown, so a
  // move never includes people the admin cannot see.
  function chooseCategory(next: Category) {
    setCategory(next)
    setChosen((current) => {
      if (next === 'all') return current
      const roleOf = new Map(members.map((m) => [m.id, m.role]))
      return new Set([...current].filter((id) => roleOf.get(id) === next))
    })
  }

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setChosen((current) => {
      const next = new Set(current)
      for (const m of visible) {
        if (allVisibleChosen) next.delete(m.id)
        else next.add(m.id)
      }
      return next
    })
  }

  async function apply(supervisorId: string | null) {
    if (!chosen.size) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/teams', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [...chosen], supervisor_id: supervisorId }),
      })
      const json = (await res.json().catch(() => ({}))) as { updated?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That change could not be saved.')
      const n = json.updated ?? chosen.size
      setNotice(
        supervisorId
          ? `${n} ${n === 1 ? 'person now reports' : 'people now report'} to ${nameOf.get(supervisorId)}.`
          : `${n} ${n === 1 ? 'person was' : 'people were'} taken off their supervisor's team.`,
      )
      setChosen(new Set())
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  if (supervisors.length === 0) {
    return (
      <Alert variant="info">
        There are no supervisors yet. Make somebody a supervisor on the Staff page first, then come
        back here to give them a team.
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Category"
        className="flex w-full rounded-2xl bg-muted p-1 sm:inline-flex sm:w-auto"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={category === c.value}
            onClick={() => chooseCategory(c.value)}
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

      <div className="flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          Everyone ({inCategory.length})
        </Chip>
        <Chip active={filter === UNASSIGNED} onClick={() => setFilter(UNASSIGNED)}>
          No supervisor ({counts.get(UNASSIGNED) ?? 0})
        </Chip>
        {supervisors.map((s) => (
          <Chip key={s.id} active={filter === s.id} onClick={() => setFilter(s.id)}>
            {s.full_name} ({counts.get(s.id) ?? 0})
          </Chip>
        ))}
      </div>

      <div className="surface sticky top-[7.5rem] z-10 flex flex-wrap items-center gap-2 p-3 lg:top-4">
        <span className="text-sm font-semibold">{chosen.size} selected</span>
        <Select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-10 w-auto min-w-[12rem] flex-1 sm:flex-none"
          aria-label="Supervisor"
        >
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
              {s.role === 'admin' ? ' (admin)' : ''}
            </option>
          ))}
        </Select>
        <Button size="sm" className="h-10" disabled={busy || !chosen.size || !target} onClick={() => apply(target)}>
          <UserCheck className="h-4 w-4" />
          Assign to supervisor
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={busy || !chosen.size}
          onClick={() => apply(null)}
        >
          <UserMinus className="h-4 w-4" />
          Remove from team
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find by name or store"
          className="h-10 pl-10"
          aria-label="Find by name or store"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <label className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <input
            type="checkbox"
            checked={allVisibleChosen}
            onChange={toggleAllVisible}
            className="h-4 w-4 accent-[hsl(var(--brand))]"
          />
          Select all shown ({visible.length})
        </label>
        <ul className="divide-y divide-border">
          {visible.map((m) => (
            <li key={m.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm',
                  chosen.has(m.id) && 'bg-tint/60',
                )}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 accent-[hsl(var(--brand))]"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.full_name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        m.role === 'merchandiser'
                          ? 'bg-tint text-tint-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {m.role === 'merchandiser' ? 'Merchandiser' : 'Marketer'}
                    </span>
                    {m.store ?? 'no home store'}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    m.supervisor_id ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {m.supervisor_id ? (nameOf.get(m.supervisor_id) ?? 'Unknown') : 'No supervisor'}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nobody here.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
