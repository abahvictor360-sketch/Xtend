'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { xmCall } from '@/components/admin/xm/widgets'
import type { XmProduct, XmSettings } from '@/lib/metrics/shared'

type Option = { id: string; name: string }

function useSubmit(onDone?: () => void) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  async function run(url: string, method: 'POST' | 'PATCH' | 'PUT', body: unknown, success: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await xmCall(url, method, body)
      setNotice(success)
      onDone?.()
      router.refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, notice, run }
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <Alert variant="destructive">{error}</Alert>
  if (notice) return <Alert variant="success">{notice}</Alert>
  return null
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function SupplyForm({ stores, products, today }: { stores: Option[]; products: XmProduct[]; today: string }) {
  const blank = {
    outlet_id: '',
    product_id: '',
    unit: 'units' as 'units' | 'cartons',
    quantity: '',
    per_carton: '',
    batch: '',
    expiry_date: '',
    supplied_on: today,
    note: '',
  }
  const [f, setF] = useState(blank)
  const s = useSubmit()
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }))
  const product = products.find((p) => p.id === f.product_id)
  // A product that knows its carton size fills it in; it can be changed.
  const per = f.per_carton || (product?.units_per_carton ? String(product.units_per_carton) : '')
  const totalUnits = f.unit === 'cartons' && /^\d+$/.test(f.quantity) && /^\d+$/.test(per) ? Number(f.quantity) * Number(per) : null

  if (!stores.length || !products.length) {
    return <Alert variant="info">Add products and stores to X Metrics first (Products & stores).</Alert>
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await s.run(
          '/api/admin/metrics/supplies',
          'POST',
          {
            outlet_id: f.outlet_id,
            product_id: f.product_id,
            quantity: f.unit === 'units' ? Number(f.quantity) : null,
            cartons: f.unit === 'cartons' ? Number(f.quantity) : null,
            units_per_carton: f.unit === 'cartons' && per ? Number(per) : null,
            batch: f.batch,
            expiry_date: f.expiry_date || null,
            supplied_on: f.supplied_on,
            note: f.note,
          },
          'Supply logged.',
        )
        if (ok) setF({ ...blank, outlet_id: f.outlet_id, supplied_on: f.supplied_on, unit: f.unit })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="sup-store" label="Store">
          <Select id="sup-store" value={f.outlet_id} onChange={set('outlet_id')} required>
            <option value="">Choose…</option>
            {stores.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        </Field>
        <Field id="sup-product" label="Product">
          <Select id="sup-product" value={f.product_id} onChange={set('product_id')} required>
            <option value="">Choose…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field id="sup-qty" label={f.unit === 'cartons' ? 'Cartons supplied' : 'Units supplied'}>
          <div className="flex gap-2">
            <Input id="sup-qty" inputMode="numeric" value={f.quantity} onChange={set('quantity')} required placeholder="0" className="min-w-0" />
            <Select aria-label="Units or cartons" value={f.unit} onChange={set('unit')} className="w-32 shrink-0">
              <option value="units">Units</option>
              <option value="cartons">Cartons</option>
            </Select>
          </div>
        </Field>
        {f.unit === 'cartons' && (
          <Field id="sup-per" label={`Units in one carton${product ? ` of ${product.name}` : ''}`}>
            <Input
              id="sup-per"
              inputMode="numeric"
              value={per}
              onChange={set('per_carton')}
              required
              placeholder="e.g. 24"
            />
            <p className="text-xs text-muted-foreground">
              {totalUnits !== null
                ? `${f.quantity} cartons × ${per} = ${totalUnits.toLocaleString('en-GB')} ${/s$/i.test(product?.unit ?? 'units') ? product?.unit ?? 'units' : `${product?.unit}s`}`
                : product && !product.units_per_carton
                  ? 'Saved on the product for next time.'
                  : 'Cartons are turned into units for stock checks.'}
            </p>
          </Field>
        )}
        <Field id="sup-date" label="Date supplied">
          <Input id="sup-date" type="date" max={today} value={f.supplied_on} onChange={set('supplied_on')} required />
        </Field>
        <Field id="sup-batch" label="Batch">
          <Input id="sup-batch" value={f.batch} onChange={set('batch')} maxLength={60} placeholder="Batch no." />
        </Field>
        <Field id="sup-expiry" label="Expiry date">
          <Input id="sup-expiry" type="date" value={f.expiry_date} onChange={set('expiry_date')} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="sup-note" label="Note (optional)">
            <Input id="sup-note" value={f.note} onChange={set('note')} maxLength={300} placeholder="Waybill number, driver…" />
          </Field>
        </div>
      </div>
      <Feedback error={s.error} notice={s.notice} />
      <Button type="submit" disabled={s.busy}>
        {s.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Log supply
      </Button>
    </form>
  )
}

/* ------------------------------------------------------------------ */

export function TargetForm({ month, people, stores }: { month: string; people: Option[]; stores: Option[] }) {
  const [kind, setKind] = useState<'person' | 'store'>('person')
  const [who, setWho] = useState('')
  const [units, setUnits] = useState('')
  const s = useSubmit()
  const list = kind === 'person' ? people : stores
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await s.run(
          '/api/admin/metrics/targets',
          'POST',
          {
            month,
            user_id: kind === 'person' ? who : null,
            outlet_id: kind === 'store' ? who : null,
            target_units: Number(units),
          },
          'Target set. Any earlier target for the same month is kept in the history.',
        )
        if (ok) {
          setWho('')
          setUnits('')
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id="tg-kind" label="Target for">
          <Select
            id="tg-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'person' | 'store')
              setWho('')
            }}
          >
            <option value="person">A person</option>
            <option value="store">A store</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="tg-who" label={kind === 'person' ? 'Merchandiser or marketer' : 'Store'}>
            <Select id="tg-who" value={who} onChange={(e) => setWho(e.target.value)} required>
              <option value="">Choose…</option>
              {list.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="tg-units" label="Units to sell">
          <Input id="tg-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} required placeholder="0" />
        </Field>
      </div>
      <Feedback error={s.error} notice={s.notice} />
      <Button type="submit" disabled={s.busy || !who || !/^\d+$/.test(units)}>
        {s.busy && <Loader2 className="h-4 w-4 animate-spin" />} Set target
      </Button>
    </form>
  )
}

/* ------------------------------------------------------------------ */

type ProductDraft = { name: string; sku: string; category: string; unit: string; per_carton: string }
const toDraft = (p?: XmProduct): ProductDraft => ({
  name: p?.name ?? '',
  sku: p?.sku ?? '',
  category: p?.category ?? '',
  unit: p?.unit ?? 'unit',
  per_carton: p?.units_per_carton ? String(p.units_per_carton) : '',
})
/** What the products route takes: the carton size as a number, or none. */
const productBody = (d: ProductDraft) => ({
  name: d.name,
  sku: d.sku,
  category: d.category,
  unit: d.unit,
  units_per_carton: /^\d+$/.test(d.per_carton.trim()) ? Number(d.per_carton.trim()) : null,
})

function ProductFields({ d, set, prefix }: { d: ProductDraft; set: (d: ProductDraft) => void; prefix: string }) {
  const on = (k: keyof ProductDraft) => (e: React.ChangeEvent<HTMLInputElement>) => set({ ...d, [k]: e.target.value })
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      <Input aria-label="Product name" id={`${prefix}-name`} value={d.name} onChange={on('name')} placeholder="Name" maxLength={120} required />
      <Input aria-label="SKU" value={d.sku} onChange={on('sku')} placeholder="SKU" maxLength={40} />
      <Input aria-label="Category" value={d.category} onChange={on('category')} placeholder="Category" maxLength={60} />
      <Input aria-label="Unit" value={d.unit} onChange={on('unit')} placeholder="Unit (bottle, tub…)" maxLength={30} required />
      <Input
        aria-label="Units per carton"
        inputMode="numeric"
        value={d.per_carton}
        onChange={on('per_carton')}
        placeholder="Units per carton"
        maxLength={6}
      />
    </div>
  )
}

export function ProductManager({ products }: { products: XmProduct[] }) {
  const [draft, setDraft] = useState(toDraft())
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState(toDraft())
  const [query, setQuery] = useState('')
  const add = useSubmit()
  const change = useSubmit(() => setEditing(null))
  const shown = products.filter((p) =>
    `${p.name} ${p.sku ?? ''} ${p.category ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await add.run('/api/admin/metrics/products', 'POST', productBody(draft), `${draft.name} added.`)) setDraft(toDraft())
        }}
      >
        <ProductFields d={draft} set={setDraft} prefix="new" />
        <Feedback error={add.error} notice={add.notice} />
        <Button type="submit" size="sm" disabled={add.busy}>
          <Plus className="h-3.5 w-3.5" /> Add product
        </Button>
      </form>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" className="h-9 max-w-xs text-sm" />
      <Feedback error={change.error} notice={null} />
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {shown.map((p) => (
          <li key={p.id} className="space-y-2 p-3 text-sm">
            {editing === p.id ? (
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await change.run(`/api/admin/metrics/products/${p.id}`, 'PATCH', productBody(edit), 'Saved.')
                }}
              >
                <ProductFields d={edit} set={setEdit} prefix={p.id} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={change.busy}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {[p.sku, p.category, p.unit, p.units_per_carton ? `${p.units_per_carton} per carton` : null].filter(Boolean).join(' · ')}
                  </span>
                  {!p.is_active && <Badge variant="outline" className="ml-2">Retired</Badge>}
                </span>
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(p.id)
                      setEdit(toDraft(p))
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={change.busy}
                    onClick={() =>
                      change.run(
                        `/api/admin/metrics/products/${p.id}`,
                        'PATCH',
                        { is_active: !p.is_active },
                        p.is_active ? 'Retired.' : 'Back in use.',
                      )
                    }
                  >
                    {p.is_active ? 'Retire' : 'Bring back'}
                  </Button>
                </span>
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">No products.</li>}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function StoreEnrolment({ outlets }: { outlets: (Option & { enrolled: boolean; hasCount: boolean })[] }) {
  const [query, setQuery] = useState('')
  const s = useSubmit()
  const shown = outlets.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A store joins X Metrics here. Its first stock count after joining is its opening stock, the
        baseline every later count is reconciled against. Taking a store out keeps its history.
      </p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stores" className="h-9 max-w-xs text-sm" />
      <Feedback error={s.error} notice={s.notice} />
      <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-2xl border border-border">
        {shown.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>
              {o.name}
              {o.enrolled && (
                <Badge variant={o.hasCount ? 'success' : 'warning'} className="ml-2">
                  {o.hasCount ? 'In X Metrics' : 'Waiting for opening count'}
                </Badge>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant={o.enrolled ? 'ghost' : 'outline'}
              disabled={s.busy}
              onClick={() =>
                s.run(
                  '/api/admin/metrics/stores',
                  'POST',
                  { outlet_id: o.id, active: !o.enrolled },
                  o.enrolled ? `${o.name} taken out of X Metrics.` : `${o.name} added to X Metrics.`,
                )
              }
            >
              {o.enrolled ? 'Take out' : 'Add'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function SettingsForm({ settings }: { settings: XmSettings }) {
  const [f, setF] = useState({
    ...settings,
    windows: settings.alert_windows_days.join(', '),
  })
  const s = useSubmit()
  const num = (k: keyof XmSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value === '' ? ('' as unknown as number) : Number(e.target.value) }))
  const sum = Number(f.weight_sales) + Number(f.weight_accuracy) + Number(f.weight_consistency) + Number(f.weight_expiry)
  const windows = f.windows
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault()
        await s.run(
          '/api/admin/metrics/settings',
          'PUT',
          {
            tolerance_pct: Number(f.tolerance_pct),
            weight_sales: Number(f.weight_sales),
            weight_accuracy: Number(f.weight_accuracy),
            weight_consistency: Number(f.weight_consistency),
            weight_expiry: Number(f.weight_expiry),
            band_poor_below: Number(f.band_poor_below),
            band_strong_from: Number(f.band_strong_from),
            alert_windows_days: windows,
            velocity_days: Number(f.velocity_days),
            count_interval_days: Number(f.count_interval_days),
            sales_grace_hours: Number(f.sales_grace_hours),
            sales_photo_required: f.sales_photo_required,
          },
          'Settings saved. The earlier version is kept in the history below.',
        )
      }}
    >
      <section className="space-y-3">
        <h2 className="text-sm font-bold">Reconciliation</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-tol" label="Tolerance (%)">
            <Input id="st-tol" type="number" step="0.5" min={0} max={100} value={f.tolerance_pct} onChange={num('tolerance_pct')} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">A count further than this from expected is flagged. More than four times it is a high flag.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">Grade weights (must add up to 100; now {sum})</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field id="st-ws" label="Sales vs target">
            <Input id="st-ws" type="number" min={0} max={100} value={f.weight_sales} onChange={num('weight_sales')} />
          </Field>
          <Field id="st-wa" label="Stock accuracy">
            <Input id="st-wa" type="number" min={0} max={100} value={f.weight_accuracy} onChange={num('weight_accuracy')} />
          </Field>
          <Field id="st-wc" label="Reporting consistency">
            <Input id="st-wc" type="number" min={0} max={100} value={f.weight_consistency} onChange={num('weight_consistency')} />
          </Field>
          <Field id="st-we" label="Expiry handling">
            <Input id="st-we" type="number" min={0} max={100} value={f.weight_expiry} onChange={num('weight_expiry')} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">Bands</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-bp" label="Poor below">
            <Input id="st-bp" type="number" min={1} max={99} value={f.band_poor_below} onChange={num('band_poor_below')} />
          </Field>
          <Field id="st-bs" label="Strong from">
            <Input id="st-bs" type="number" min={2} max={100} value={f.band_strong_from} onChange={num('band_strong_from')} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Poor 0–{Number(f.band_poor_below) - 1}, Average {f.band_poor_below}–{Number(f.band_strong_from) - 1}, Strong {f.band_strong_from}–100.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">Expiry</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-win" label="Alert windows (days before expiry)">
            <Input id="st-win" value={f.windows} onChange={(e) => setF((v) => ({ ...v, windows: e.target.value }))} />
          </Field>
          <Field id="st-vel" label="Rate of sale over (days)">
            <Input id="st-vel" type="number" min={7} max={365} value={f.velocity_days} onChange={num('velocity_days')} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          730, 365, 180, 90, 30 is 2 years, 1 year, 6 months, 3 months and 1 month. A batch that will not sell before it expires at
          the recent rate of sale is marked “consider pulling”.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">Reporting</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="st-ci" label="A count is due every (days)">
            <Input id="st-ci" type="number" min={1} max={31} value={f.count_interval_days} onChange={num('count_interval_days')} />
          </Field>
          <Field id="st-gh" label="Sales on time if sent within (hours after the day)">
            <Input id="st-gh" type="number" min={0} max={72} value={f.sales_grace_hours} onChange={num('sales_grace_hours')} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={f.sales_photo_required}
              onChange={(e) => setF((v) => ({ ...v, sales_photo_required: e.target.checked }))}
            />
            Daily sales need a shelf photo
          </label>
        </div>
      </section>

      <Feedback error={s.error} notice={s.notice} />
      <Button type="submit" disabled={s.busy || sum !== 100 || windows.some((w) => !Number.isInteger(w) || w < 1)}>
        {s.busy && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
      </Button>
    </form>
  )
}
