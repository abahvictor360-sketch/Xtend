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

interface Draft {
  full_name: string
  email: string
  phone: string
  role: UserRole
  outlet_id: string
}

const EMPTY: Draft = { full_name: '', email: '', phone: '', role: 'merchandiser', outlet_id: '' }

export function StaffManager({ staff, outlets }: { staff: Profile[]; outlets: Outlet[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const [search, setSearch] = useState('')

  const outletName = useMemo(
    () => new Map(outlets.map((outlet) => [outlet.id, outlet.name])),
    [outlets],
  )

  const visible = staff.filter((person) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return [person.full_name, person.email, person.phone].some((value) =>
      value?.toLowerCase().includes(needle),
    )
  })

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setIssued(null)

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
            Shown once. Hand it over now; they must change it at first login. Wire
            CREDENTIALS_WEBHOOK_URL to send it by SMS or email instead.
          </p>
        </Alert>
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
                <Label>Full name</Label>
                <Input
                  required
                  value={draft.full_name}
                  onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  required
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
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
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Outlet</Label>
                <Select
                  value={draft.outlet_id}
                  onChange={(e) => setDraft({ ...draft, outlet_id: e.target.value })}
                >
                  <option value="">No outlet</option>
                  {outlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
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
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((person) => (
              <TableRow key={person.id}>
                <TableCell className="font-medium">{person.full_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {person.email}
                  <br />
                  {person.phone ?? '—'}
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
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
                <div className="min-w-0">
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
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="field-label">Role</Label>
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
                </div>
                <div className="space-y-1">
                  <Label className="field-label">Outlet</Label>
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
