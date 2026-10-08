'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { problemWith } from '@/lib/field-check'
import { BASE_LABEL, roleName, type BuiltInCounts, type CountingRole, type StaffRole } from '@/lib/staff-roles'

const WORKS_LIKE: { value: StaffRole['base_role']; label: string; hint: string }[] = [
  { value: 'merchandiser', label: 'Merchandiser', hint: 'Clocks in and out with a selfie at one store or office.' },
  { value: 'marketer', label: 'Marketer', hint: 'Clocks in, checks in at each store visited, files a daily report.' },
  { value: 'supervisor', label: 'Supervisor', hint: 'Uses the dashboard for their own team.' },
]

export function RoleManager({
  roles,
  counts,
  builtInCounts,
}: {
  roles: StaffRole[]
  counts: Record<string, number>
  builtInCounts: BuiltInCounts
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [base, setBase] = useState<StaffRole['base_role']>('merchandiser')
  const [countsStock, setCountsStock] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  async function send(url: string, method: string, body: unknown, done: string, key: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That did not save.')
      setNotice(done)
      router.refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const problem = problemWith(roleName, name)
    if (problem) return setError(problem)
    const body = { name, base_role: base, counts_stock: base !== 'supervisor' && countsStock }
    if (await send('/api/admin/staff-roles', 'POST', body, `Added "${name.trim()}".`, 'new')) {
      setName('')
      setCountsStock(true)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                value={name}
                maxLength={40}
                autoCapitalize="words"
                placeholder="e.g. Account Receivable"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-base">Works like</Label>
              <Select id="role-base" value={base} onChange={(e) => setBase(e.target.value as StaffRole['base_role'])}>
                {WORKS_LIKE.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={busy !== null || !name.trim()}>
              <Plus className="h-4 w-4" />
              Add role
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">{WORKS_LIKE.find((w) => w.value === base)?.hint}</p>
          {base !== 'supervisor' && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={countsStock}
                onChange={(e) => setCountsStock(e.target.checked)}
              />
              Takes stock counts
            </label>
          )}
        </CardContent>
      </Card>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <StoreCountSettings
        rows={[
          ...(['merchandiser', 'marketer'] as CountingRole[]).map((role) => ({
            key: role,
            name: BASE_LABEL[role],
            note: 'Built-in role',
            on: builtInCounts[role] ?? true,
            save: (on: boolean) =>
              send('/api/admin/role-store-counts', 'PATCH', { role, counts_stock: on }, countNotice(BASE_LABEL[role], on), role),
          })),
          ...roles
            .filter((r) => r.base_role !== 'supervisor' && r.is_active)
            .map((r) => ({
              key: r.id,
              name: r.name,
              note: `Works like a ${BASE_LABEL[r.base_role].toLowerCase()}`,
              on: r.counts_stock,
              save: (on: boolean) =>
                send(`/api/admin/staff-roles/${r.id}`, 'PATCH', { counts_stock: on }, countNotice(r.name, on), r.id),
            })),
        ]}
        busy={busy}
      />

      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles added yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                {editing?.id === r.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const problem = problemWith(roleName, editing.name)
                      if (problem) return setError(problem)
                      if (await send(`/api/admin/staff-roles/${r.id}`, 'PATCH', { name: editing.name }, 'Renamed.', r.id)) {
                        setEditing(null)
                      }
                    }}
                  >
                    <Input
                      className="h-9"
                      value={editing.name}
                      maxLength={40}
                      autoFocus
                      onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                    />
                    <Button size="sm" type="submit" disabled={busy !== null}>
                      Save
                    </Button>
                    <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <p className="flex items-center gap-2 font-semibold">
                      {r.name}
                      {!r.is_active && <Badge variant="outline">Retired</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Works like a {BASE_LABEL[r.base_role].toLowerCase()} · {counts[r.id] ?? 0}{' '}
                      {(counts[r.id] ?? 0) === 1 ? 'person' : 'people'}
                    </p>
                  </>
                )}
              </div>
              {editing?.id !== r.id && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, name: r.name })}>
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      void send(
                        `/api/admin/staff-roles/${r.id}`,
                        'PATCH',
                        { is_active: !r.is_active },
                        r.is_active ? `"${r.name}" retired: it can no longer be given.` : `"${r.name}" is back in use.`,
                        r.id,
                      )
                    }
                  >
                    {r.is_active ? 'Retire' : 'Bring back'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function countNotice(name: string, on: boolean) {
  return on
    ? `${name} now take stock counts.`
    : `${name} no longer take stock counts: the count form is gone from their app.`
}

interface CountRow {
  key: string
  name: string
  note: string
  on: boolean
  save: (on: boolean) => Promise<boolean>
}

/** Which roles take the month-end stock count and counts a supervisor asks for. */
function StoreCountSettings({ rows, busy }: { rows: CountRow[]; busy: string | null }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div>
          <p className="font-semibold">Stock counts</p>
          <p className="text-xs text-muted-foreground">
            Choose which roles take the month-end stock count and counts a supervisor asks for.
            Roles that are off do not see the count form, and cannot be asked to count.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.note}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={row.on}
                aria-label={`${row.name} take stock counts`}
                disabled={busy !== null}
                onClick={() => void row.save(!row.on)}
                className={
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' +
                  (row.on ? 'bg-primary' : 'bg-muted')
                }
              >
                <span
                  className={
                    'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' +
                    (row.on ? 'translate-x-5' : 'translate-x-0.5')
                  }
                />
              </button>
              <span className="w-8 text-xs font-semibold text-muted-foreground">{row.on ? 'Yes' : 'No'}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
