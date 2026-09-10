'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Download } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

const FORMATS = [
  ['pdf', 'PDF'],
  ['docx', 'Word'],
  ['xlsx', 'Excel'],
  ['csv', 'CSV'],
] as const

/**
 * Filters live in the URL, so the downloaded file is exactly the rounds on
 * screen — no second set of options to keep in step.
 */
export function VisitFilters({
  staff,
  outlets,
}: {
  staff: { id: string; full_name: string }[]
  outlets: { id: string; name: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`)
  }

  const query = params.toString()

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6">
      <Field label="From">
        <Input
          type="date"
          value={params.get('from') ?? ''}
          onChange={(e) => set('from', e.target.value)}
        />
      </Field>
      <Field label="To">
        <Input
          type="date"
          value={params.get('to') ?? ''}
          onChange={(e) => set('to', e.target.value)}
        />
      </Field>
      <Field label="Staff">
        <Select
          value={params.get('user_id') ?? 'all'}
          onChange={(e) => set('user_id', e.target.value)}
        >
          <option value="all">Everyone</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Store">
        <Select
          value={params.get('outlet_id') ?? 'all'}
          onChange={(e) => set('outlet_id', e.target.value)}
        >
          <option value="all">All stores</option>
          {outlets.map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Arrival">
        <Select value={params.get('status') ?? 'all'} onChange={(e) => set('status', e.target.value)}>
          <option value="all">Any</option>
          <option value="on_site">On site</option>
          <option value="off_site">Off site</option>
          <option value="flagged">Flagged</option>
        </Select>
      </Field>

      <Field label="Download report">
        <div className="flex flex-wrap gap-1">
          {FORMATS.map(([format, label]) => (
            <a
              key={format}
              href={`/api/admin/export/visits/${format}?${query}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Download className="h-3.5 w-3.5" />
              {label}
            </a>
          ))}
        </div>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
