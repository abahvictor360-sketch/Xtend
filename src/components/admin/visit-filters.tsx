import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { visitQueryString, type VisitFilter } from '@/lib/visit-review'
import { addDays } from '@/lib/utils'

const pill = 'rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint'

/**
 * Filters live in the URL (a plain GET form), so the downloaded file is
 * exactly the rounds on screen — no second set of options to keep in step.
 */
export function VisitFilters({
  filter,
  staff,
  outlets,
  teams,
  today,
}: {
  filter: VisitFilter & { from: string; to: string }
  staff: { id: string; full_name: string }[]
  outlets: { id: string; name: string }[]
  /** Supervisors, for an admin to pick a team. Null for a supervisor, who only has their own. */
  teams: { id: string; full_name: string }[] | null
  today: string
}) {
  const query = visitQueryString(filter)
  const range = (from: string, to: string) => `?${visitQueryString({ ...filter, from, to })}`
  const presets = [
    { label: 'Today', href: range(today, today) },
    { label: 'Yesterday', href: range(addDays(today, -1), addDays(today, -1)) },
    { label: 'Last 7 days', href: range(addDays(today, -6), today) },
    { label: 'Last 30 days', href: range(addDays(today, -29), today) },
    { label: 'This month', href: range(`${today.slice(0, 8)}01`, today) },
  ]
  const coverage = filter.view === 'coverage'

  return (
    <form method="get" className="space-y-3">
      {filter.view !== 'visits' && <input type="hidden" name="view" value={filter.view} />}
      {filter.gap && <input type="hidden" name="gap" value={filter.gap} />}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filter.from} max={today} className="h-10 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filter.to} max={today} className="h-10 w-40" />
        </div>
        <div className="w-full space-y-1.5 sm:w-52">
          <Label htmlFor="user_id">Who</Label>
          <Select id="user_id" name="user_id" defaultValue={filter.user_id ?? 'all'} className="h-10 text-sm">
            <option value="all">Everyone</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full space-y-1.5 sm:w-52">
          <Label htmlFor="outlet_id">Store</Label>
          <Select id="outlet_id" name="outlet_id" defaultValue={filter.outlet_id ?? 'all'} className="h-10 text-sm">
            <option value="all">All stores</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </Select>
        </div>
        {teams && teams.length > 0 && (
          <div className="w-full space-y-1.5 sm:w-48">
            <Label htmlFor="team">Team</Label>
            <Select id="team" name="team" defaultValue={filter.team ?? 'all'} className="h-10 text-sm">
              <option value="all">Every team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}’s team
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="w-full space-y-1.5 sm:w-44">
          <Label htmlFor="status">Arrival</Label>
          <Select id="status" name="status" defaultValue={filter.status ?? 'all'} className="h-10 text-sm">
            <option value="all">Any</option>
            <option value="on_site">At the store</option>
            <option value="off_site">Away from the store</option>
            <option value="flagged">Location too rough</option>
            <option value="none">A shop not on Xtend</option>
          </Select>
        </div>
        <div className="w-full space-y-1.5 sm:w-40">
          <Label htmlFor="short">How long</Label>
          <Select id="short" name="short" defaultValue={filter.short ? String(filter.short) : 'all'} className="h-10 text-sm">
            <option value="all">Any length</option>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                Under {m} min
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
          Show
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {!coverage && (
          <>
            <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
            {presets.map((p) => (
              <Link key={p.label} href={p.href} className={pill}>
                {p.label}
              </Link>
            ))}
          </>
        )}
        {(filter.user_id || filter.outlet_id || filter.team || filter.status || filter.short) && (
          <Link
            href={`?${visitQueryString({ from: filter.from, to: filter.to, view: filter.view, gap: filter.gap })}`}
            className="px-2 py-1 font-semibold text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-muted-foreground">
            {coverage ? 'Download the store list:' : 'Download:'}
          </span>
          {(['xlsx', 'pdf', 'docx', 'csv'] as const).map((f) => (
            <a key={f} href={`/api/admin/export/visits/${f}?${query}`} className={pill}>
              {{ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' }[f]}
            </a>
          ))}
        </span>
      </div>
    </form>
  )
}
