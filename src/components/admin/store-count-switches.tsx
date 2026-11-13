'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { BASE_LABEL, type BuiltInCounts, type CountingRole, type StaffRole } from '@/lib/staff-roles'

const PLURAL: Record<CountingRole, string> = { merchandiser: 'Merchandisers', marketer: 'Marketers' }

/** What the admin is told after switching a role on or off. */
export function countNotice(who: string, on: boolean) {
  return on
    ? `${who} now take stock counts: the Count tab and the count sheet are back in their app.`
    : `${who} no longer take stock counts: the Count tab, the count-due banner and the count sheet are gone from their app, and nobody can ask them to count.`
}

interface CountRow {
  key: string
  name: string
  note: string
  on: boolean
  url: string
  body: Record<string, unknown>
  who: string
}

/**
 * Which roles take the month-end stock count and the counts a supervisor
 * asks for (migration 046): Merchandisers, Marketers and every added role
 * that works like one. Off, their app has no count form, banner or sheet,
 * and the database refuses their counts. Admins only; shown on Roles and on
 * Store counts.
 */
export function StoreCountSwitches({ builtInCounts, roles }: { builtInCounts: BuiltInCounts; roles: StaffRole[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows: CountRow[] = [
    ...(['merchandiser', 'marketer'] as CountingRole[]).map((role) => ({
      key: role,
      name: PLURAL[role],
      note: 'Built-in role',
      on: builtInCounts[role] ?? true,
      url: '/api/admin/role-store-counts',
      body: { role },
      who: PLURAL[role],
    })),
    ...roles
      .filter((r) => r.base_role !== 'supervisor' && r.is_active)
      .map((r) => ({
        key: r.id,
        name: r.name,
        note: `Works like a ${BASE_LABEL[r.base_role].toLowerCase()}`,
        on: r.counts_stock,
        url: `/api/admin/staff-roles/${r.id}`,
        body: {},
        who: `People with the ${r.name} role`,
      })),
  ]

  async function save(row: CountRow, on: boolean) {
    setBusy(row.key)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(row.url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row.body, counts_stock: on }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That did not save.')
      setNotice(countNotice(row.who, on))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div>
          <p className="font-semibold">Who takes stock counts</p>
          <p className="text-xs text-muted-foreground">
            Switch a role off and its people no longer see the Count tab, the count-due banner or the count
            sheet, and cannot be asked to count. Switch it back on at any time.
          </p>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}
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
                onClick={() => void save(row, !row.on)}
                className={
                  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' +
                  (row.on ? 'bg-primary' : 'bg-muted-foreground/30')
                }
              >
                <span
                  className={
                    'inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ' +
                    (row.on ? 'translate-x-[1.35rem]' : 'translate-x-0.5')
                  }
                />
              </button>
              <span className="w-7 text-xs font-semibold text-muted-foreground">
                {busy === row.key ? '…' : row.on ? 'On' : 'Off'}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
