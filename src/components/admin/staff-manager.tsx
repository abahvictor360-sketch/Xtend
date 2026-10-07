'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Outlet, Profile, UserRole } from '@/lib/types'
import { cn } from '@/lib/utils'
import { check } from '@/lib/validation'

interface Draft {
  full_name: string
  email: string
  phone: string
  role: UserRole
  outlet_id: string
  supervisor_id: string
}

type Category = 'all' | UserRole
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'merchandiser', label: 'Merchandisers' },
  { value: 'marketer', label: 'Marketers' },
  { value: 'supervisor', label: 'Supervisors' },
  { value: 'admin', label: 'Admins' },
]

const EMPTY: Draft = {
  full_name: '',
  email: '',
  phone: '',
  role: 'merchandiser',
  outlet_id: '',
  supervisor_id: '',
}

export interface SupervisorOption {
  id: string
  full_name: string
  role: string
}

export function StaffManager({
  staff,
  outlets,
  isAdmin = true,
  supervisors = [],
  notified = [],
  initialSearch = '',
  startCreating = false,
  photos = {},
  newStaffOutletIds,
}: {
  staff: Profile[]
  outlets: Outlet[]
  /** The stores a supervisor may add new staff to; every store when unset. */
  newStaffOutletIds?: string[]
  /** Supervisors staff their own team but never hand out roles or stores. */
  isAdmin?: boolean
  /** Who an admin may name as somebody's supervisor. */
  supervisors?: SupervisorOption[]
  /** Who has notifications on, which clocking in needs (migration 027). */
  notified?: string[]
  /** From the dashboard's search box (?q=). */
  initialSearch?: string
  /** From the dashboard's "Add staff" button (?new=1). */
  startCreating?: boolean
  /** Signed links to profile photos (037), by person. */
  photos?: Record<string, string>
}) {
  const hasPush = useMemo(() => new Set(notified), [notified])
  const isField = (role: string) => role === 'merchandiser' || role === 'marketer'
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [creating, setCreating] = useState(startCreating)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const [search, setSearch] = useState(initialSearch)
  const [category, setCategory] = useState<Category>('all')

  const outletName = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet.name])),
    [outlets],
  )

  const supervisorName = useMemo(
    () => new Map(supervisors.map((s) => [s.id, s.full_name])),
    [supervisors],
  )

  const roleCounts = useMemo(() => {
    const counts = new Map<Category, number>([['all', staff.length]])
    for (const p of staff) counts.set(p.role, (counts.get(p.role) ?? 0) + 1)
    return counts
  }, [staff])
  // A category nobody is in is left out, so a supervisor sees only their team's.
  const categories = CATEGORIES.filter((c) => c.value === 'all' || (roleCounts.get(c.value) ?? 0) > 0)

  const visible = staff.filter((person) => {
    if (category !== 'all' && person.role !== category) return false
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return [person.full_name, person.email, person.phone].some((value) =>
      value?.toLowerCase().includes(needle),
    )
  })

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setIssued(null)
    // Say what is wrong before sending; the server checks the same rules.
    const problem =
      check.personName(draft.full_name) ??
      check.email(draft.email) ??
      (draft.phone.trim()
        ? check.phone(draft.phone)
        : isField(draft.role)
          ? 'Enter their phone number: merchandisers and marketers sign in with it.'
          : null)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: draft.full_name,
          email: draft.email,
          phone: draft.phone || null,
          role: draft.role,
          outlet_id: draft.outlet_id || null,
          supervisor_id: draft.supervisor_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not create that account.')
        return
      }

      setIssued({ name: draft.full_name, password: data.temp_password })
      setDraft(EMPTY)
      setCreating(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, changes: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That change did not save.')
        return
      }
      if (data.temp_password) {
        const person = staff.find((p) => p.id === id)
        setIssued({ name: person?.full_name ?? 'This user', password: data.temp_password })
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}

      {issued && (
        <Alert variant="success">
          <p className="font-medium">Temporary password for {issued.name}</p>
          <p className="mt-1 font-mono text-lg tracking-wide">{issued.password}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hand it over now; they must change it at first login. Until they do, admins also
            find it in Login details (Word) on this page.
          </p>
        </Alert>
      )}

      {categories.length > 2 && (
        <div
          role="tablist"
          aria-label="Category"
          className="flex w-full overflow-x-auto rounded-2xl bg-muted p-1 sm:inline-flex sm:w-auto"
        >
          {categories.map((c) => (
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
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button onClick={() => setCreating((c) => !c)} variant={creating ? 'outline' : 'default'}>
          <UserPlus className="h-4 w-4" />
          {creating ? 'Cancel' : 'Add staff'}
        </Button>
      </div>

      {creating && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1">
                <Label htmlFor="new-name">Full name</Label>
                <Input
                  id="new-name"
                  required
                  minLength={3}
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="words"
                  placeholder="First and last name"
                  value={draft.full_name}
                  onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  required
                  maxLength={120}
                  autoComplete="off"
                  autoCapitalize="none"
                  placeholder="name@gmail.com"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-phone">Phone{isField(draft.role) ? '' : ' (optional)'}</Label>
                <Input
                  id="new-phone"
                  type="tel"
                  inputMode="tel"
                  required={isField(draft.role)}
                  maxLength={16}
                  autoComplete="off"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/[^\d+ ]/g, '') })}
                  placeholder="08012345678"
                />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
                >
                  <option value="merchandiser">Merchandiser</option>
                  <option value="marketer">Marketer</option>
                  {isAdmin && <option value="supervisor">Supervisor</option>}
                  {isAdmin && <option value="admin">Admin</option>}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Outlet</Label>
                <Select
                  value={draft.outlet_id}
                  onChange={(e) => setDraft({ ...draft, outlet_id: e.target.value })}
                >
                  <option value="">No outlet</option>
                  {outlets
                    .filter((outlet) => !newStaffOutletIds || newStaffOutletIds.includes(outlet.id))
                    .map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="field-label">Reports to</Label>
                <Select
                  value={draft.supervisor_id}
                  onChange={(e) => setDraft({ ...draft, supervisor_id: e.target.value })}
                  disabled={!isAdmin}
                >
                  <option value="">{isAdmin ? 'Nobody' : 'You'}</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2 lg:col-span-5">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create account'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Desktop: the full table. */}
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Outlet</TableHead>
              <TableHead>Reports to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((person) => (
              <TableRow key={person.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2.5">
                    <PersonPhoto name={person.full_name} url={photos[person.id]} />
                    {person.full_name}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {person.email}
                  <br />
                  {person.phone ?? '—'}
                </TableCell>
                <TableCell>
                  {isAdmin ? (
<Select
                    className="h-9 w-36"
                    value={person.role}
                    onChange={(e) => void patch(person.id, { role: e.target.value })}
                  >
                    <option value="merchandiser">Merchandiser</option>
                    <option value="marketer">Marketer</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{person.role}</span>
                  )}
                </TableCell>
                <TableCell>
                  {isAdmin ? (
<Select
                    className="h-9 w-44"
                    value={person.outlet_id ?? ''}
                    onChange={(e) => void patch(person.id, { outlet_id: e.target.value || null })}
                  >
                    <option value="">No outlet</option>
                    {outlets.map((outlet) => (
                      <option key={outlet.id} value={outlet.id}>
                        {outletName.get(outlet.id)}
                      </option>
                    ))}
                  </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{outletName.get(person.outlet_id ?? '') ?? 'No store'}</span>
                  )}
                </TableCell>
                <TableCell>
                  {isAdmin && supervisors.length > 0 ? (
                    <Select
                      className="h-9 w-40"
                      value={person.supervisor_id ?? ''}
                      onChange={(e) =>
                        void patch(person.id, { supervisor_id: e.target.value || null })
                      }
                    >
                      <option value="">Nobody</option>
                      {supervisors
                        .filter((s) => s.id !== person.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {supervisorName.get(person.supervisor_id ?? '') ?? '—'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {person.is_active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Deactivated</Badge>
                  )}
                  {person.must_change_password && (
                    <Badge variant="warning" className="ml-1">
                      Temp password
                    </Badge>
                  )}
                  {isField(person.role) && (
                    <NotificationBadge
                      on={hasPush.has(person.id)}
                      exempt={Boolean(person.push_exempt)}
                      className="ml-1"
                    />
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void patch(person.id, { reset_password: true })}
                  >
                    Reset password
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void patch(person.id, { is_active: !person.is_active })}
                  >
                    {person.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  {isAdmin && isField(person.role) && (
                    <ExemptButton person={person} busy={busy} patch={patch} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone: one card per person. A seven-column table is unusable here. */}
      <div className="space-y-3 md:hidden">
        {visible.map((person) => (
          <Card key={person.id}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <PersonPhoto name={person.full_name} url={photos[person.id]} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{person.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                  <p className="text-xs text-muted-foreground">{person.phone ?? 'No phone'}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {person.is_active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Deactivated</Badge>
                  )}
                  {person.must_change_password && <Badge variant="warning">Temp password</Badge>}
                  {isField(person.role) && (
                    <NotificationBadge on={hasPush.has(person.id)} exempt={Boolean(person.push_exempt)} />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="field-label">Role</Label>
                  {isAdmin ? (
<Select
                    className="h-10"
                    value={person.role}
                    onChange={(e) => void patch(person.id, { role: e.target.value })}
                  >
                    <option value="merchandiser">Merchandiser</option>
                    <option value="marketer">Marketer</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{person.role}</span>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="field-label">Outlet</Label>
                  {isAdmin ? (
<Select
                    className="h-10"
                    value={person.outlet_id ?? ''}
                    onChange={(e) => void patch(person.id, { outlet_id: e.target.value || null })}
                  >
                    <option value="">No outlet</option>
                    {outlets.map((outlet) => (
                      <option key={outlet.id} value={outlet.id}>
                        {outletName.get(outlet.id)}
                      </option>
                    ))}
                  </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{outletName.get(person.outlet_id ?? '') ?? 'No store'}</span>
                  )}
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="field-label">Reports to</Label>
                  {isAdmin && supervisors.length > 0 ? (
                    <Select
                      className="h-10"
                      value={person.supervisor_id ?? ''}
                      onChange={(e) =>
                        void patch(person.id, { supervisor_id: e.target.value || null })
                      }
                    >
                      <option value="">Nobody</option>
                      {supervisors
                        .filter((s) => s.id !== person.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {supervisorName.get(person.supervisor_id ?? '') ?? '—'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void patch(person.id, { reset_password: true })}
                >
                  Reset password
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void patch(person.id, { is_active: !person.is_active })}
                >
                  {person.is_active ? 'Deactivate' : 'Reactivate'}
                </Button>
                {isAdmin && isField(person.role) && (
                  <ExemptButton person={person} busy={busy} patch={patch} />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function NotificationBadge({ on, exempt, className }: { on: boolean; exempt: boolean; className?: string }) {
  if (on) {
    return (
      <Badge variant="success" className={className}>
        Notifications on
      </Badge>
    )
  }
  return (
    <Badge variant={exempt ? 'outline' : 'warning'} className={className}>
      {exempt ? 'Excused from notifications' : 'Notifications off: cannot clock in'}
    </Badge>
  )
}

function ExemptButton({
  person,
  busy,
  patch,
}: {
  person: Profile
  busy: boolean
  patch: (id: string, body: Record<string, unknown>) => Promise<void>
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() => {
        const excuse = !person.push_exempt
        if (
          excuse &&
          !confirm(
            `Let ${person.full_name} clock in without notifications? Only do this for a phone that cannot receive them: their phone can then not be checked live.`,
          )
        )
          return
        void patch(person.id, { push_exempt: excuse })
      }}
    >
      {person.push_exempt ? 'Require notifications' : 'Excuse from notifications'}
    </Button>
  )
}

/** Their profile photo, or initials until they take one. */
function PersonPhoto({ name, url }: { name: string; url?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-[11px] font-bold text-tint-foreground">
      {name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('')}
    </span>
  )
}
