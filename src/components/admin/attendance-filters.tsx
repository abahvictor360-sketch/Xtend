import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { STATUS_FILTERS, type Preset } from '@/lib/attendance-report'
import type { Choices, ReportFilter } from '@/lib/attendance-server'

const FORMATS = { xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' } as const
const CHIP = 'rounded-full border border-border bg-card px-3 py-1 font-semibold hover:border-brand hover:bg-tint'

export interface Download {
  label: string
  /** The export route, without the format. */
  base: string
  query: string
}

/**
 * The filters as a plain GET form, so the address bar holds the whole view
 * and every download is exactly what is on screen. Attendance shows the
 * person and status pickers; Analytics shows "group by" instead.
 */
export function AttendanceFilters({
  mode,
  filter,
  choices,
  presets,
  presetHref,
  downloads,
  today,
}: {
  mode: 'attendance' | 'analytics'
  filter: ReportFilter
  choices: Choices
  presets: Preset[]
  presetHref: (p: Preset) => string
  downloads: Download[]
  today: string
}) {
  const active = choices.people.filter((p) => p.active)
  const inactive = choices.people.filter((p) => !p.active)
  const isPreset = (p: Preset) => p.from === filter.from && p.to === filter.to
  const narrowed = filter.user_id || filter.outlet_id || filter.team || filter.role || filter.status

  return (
    <form method="get" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filter.from} max={today} className="h-10 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filter.to} max={today} className="h-10 w-40" />
        </div>
        {mode === 'attendance' && (
          <div className="w-full space-y-1.5 sm:w-52">
            <Label htmlFor="user_id">Who</Label>
            <Select id="user_id" name="user_id" defaultValue={filter.user_id ?? 'all'} className="h-10 text-sm">
              <option value="all">Everyone</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {inactive.length > 0 && (
                <optgroup label="Switched off">
                  {inactive.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
        )}
        <div className="w-full space-y-1.5 sm:w-52">
          <Label htmlFor="outlet_id">Store</Label>
          <Select id="outlet_id" name="outlet_id" defaultValue={filter.outlet_id ?? 'all'} className="h-10 text-sm">
            <option value="all">All stores</option>
            {choices.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        {choices.teams.length > 1 && (
          <div className="w-full space-y-1.5 sm:w-48">
            <Label htmlFor="team">Team</Label>
            <Select id="team" name="team" defaultValue={filter.team ?? 'all'} className="h-10 text-sm">
              <option value="all">All teams</option>
              {choices.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="none">Reports to nobody</option>
            </Select>
          </div>
        )}
        {choices.roles.length > 1 && (
          <div className="w-full space-y-1.5 sm:w-44">
            <Label htmlFor="role">Role</Label>
            <Select id="role" name="role" defaultValue={filter.role ?? 'all'} className="h-10 text-sm">
              <option value="all">All roles</option>
              {choices.roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {mode === 'attendance' ? (
          <div className="w-full space-y-1.5 sm:w-44">
            <Label htmlFor="status">Show days</Label>
            <Select id="status" name="status" defaultValue={filter.status ?? 'all'} className="h-10 text-sm">
              <option value="all">All days</option>
              {Object.entries(STATUS_FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="w-full space-y-1.5 sm:w-40">
            <Label htmlFor="by">Compare by</Label>
            <Select id="by" name="by" defaultValue={filter.by} className="h-10 text-sm">
              <option value="person">Person</option>
              <option value="store">Store</option>
              <option value="team">Team</option>
            </Select>
          </div>
        )}
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="sundays"
            value="1"
            defaultChecked={filter.sundays}
            className="h-4 w-4 accent-[hsl(var(--brand))]"
          />
          Sundays are working days
        </label>
        <button type="submit" className={buttonVariants({ size: 'sm', className: 'h-10' })}>
          Show
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 font-semibold text-muted-foreground">Quick:</span>
        {presets.map((p) => (
          <Link
            key={p.key}
            href={presetHref(p)}
            className={isPreset(p) ? 'rounded-full border border-brand bg-brand px-3 py-1 font-semibold text-primary-foreground' : CHIP}
          >
            {p.label}
          </Link>
        ))}
        {narrowed && (
          <Link
            href={`?from=${filter.from}&to=${filter.to}`}
            className="px-2 py-1 font-semibold text-muted-foreground hover:text-foreground"
          >
            Clear filters
          </Link>
        )}
      </div>

      {downloads.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {downloads.map((d) => (
            <span key={d.label} className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-muted-foreground">{d.label}:</span>
              {(Object.keys(FORMATS) as (keyof typeof FORMATS)[]).map((f) => (
                <a key={f} href={`${d.base}/${f}${d.query ? `?${d.query}` : ''}`} className={CHIP}>
                  {FORMATS[f]}
                </a>
              ))}
              <span className="mx-1 hidden text-border sm:inline">|</span>
            </span>
          ))}
        </div>
      )}
    </form>
  )
}
