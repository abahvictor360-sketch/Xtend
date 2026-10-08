'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2, Trash2, Upload } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { XmProduct } from '@/lib/metrics/shared'

type Option = { id: string; name: string }

interface Line {
  line: number
  description: string
  sku: string | null
  product_id: string | null
  product_match: 'sku' | 'name' | 'close' | null
  outlet_id: string | null
  store_text: string | null
  unit: 'units' | 'cartons'
  amount: number | null
  units_per_carton: number | null
  stated_units: number | null
  batch: string
  expiry_date: string
  supplied_on: string
}

interface Read {
  import_id: string
  file_name: string
  read_by: 'table' | 'claude'
  supplier: string | null
  invoice_no: string | null
  invoice_date: string | null
  deliver_to: string | null
  lines: Line[]
}

/** A line as edited in the table. Numbers stay text until sent. */
interface Row {
  key: number
  keep: boolean
  description: string
  sku: string | null
  product_match: Line['product_match']
  stated_units: number | null
  outlet_id: string
  product_id: string
  unit: 'units' | 'cartons'
  amount: string
  per: string
  batch: string
  expiry_date: string
  supplied_on: string
}

const whole = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0
const plural = (unit: string) => (/s$/i.test(unit) ? unit : `${unit}s`)

/**
 * Logs supplies from a file: upload a CSV, Excel sheet, or a PDF or Word
 * invoice; check each line read from it (store, product, units or cartons,
 * batch, expiry, date); then log the lines kept, all together.
 */
export function SupplyImport({ stores, products, today }: { stores: Option[]; products: XmProduct[]; today: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [read, setRead] = useState<Read | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [allStore, setAllStore] = useState('')

  const productOf = (id: string) => products.find((p) => p.id === id)

  async function upload(file: File) {
    setError(null)
    setNotice(null)
    setRead(null)
    setBusy(/\.(pdf|docx)$/i.test(file.name) ? 'Reading the invoice (this can take a minute)' : 'Reading the file')
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/admin/metrics/supplies/import', { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as Read & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'That file could not be read')
      setRead(data)
      setRows(
        data.lines.map((l) => ({
          key: l.line,
          keep: true,
          description: l.description,
          sku: l.sku,
          product_match: l.product_match,
          stated_units: l.stated_units,
          outlet_id: l.outlet_id ?? '',
          product_id: l.product_id ?? '',
          unit: l.unit,
          amount: l.amount ? String(l.amount) : '',
          per: l.units_per_carton ? String(l.units_per_carton) : '',
          batch: l.batch,
          expiry_date: l.expiry_date,
          supplied_on: l.supplied_on,
        })),
      )
      setAllStore('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read')
    } finally {
      setBusy(null)
    }
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r
        const next = { ...r, ...patch }
        // Choosing a product brings its carton size, if the line has none.
        if (patch.product_id && !next.per) {
          const per = productOf(patch.product_id)?.units_per_carton
          if (per) next.per = String(per)
        }
        return next
      }),
    )
  }

  const kept = rows.filter((r) => r.keep)
  const problem = (r: Row) =>
    !r.outlet_id
      ? 'Choose the store'
      : !r.product_id
        ? 'Choose the product'
        : !whole(r.amount)
          ? `Enter the ${r.unit}`
          : r.unit === 'cartons' && !whole(r.per)
            ? 'Units per carton?'
            : !r.supplied_on || r.supplied_on > today
              ? 'Date?'
              : null
  const firstProblem = kept.map((r) => [r, problem(r)] as const).find(([, p]) => p)
  // Units in the lines that are ready; a carton line without its size counts nothing yet.
  const totalUnits = kept
    .filter((r) => !problem(r))
    .reduce((n, r) => n + Number(r.amount) * (r.unit === 'cartons' ? Number(r.per) : 1), 0)

  async function log() {
    if (!read || !kept.length || firstProblem) return
    setBusy('Logging the supplies')
    setError(null)
    try {
      const res = await fetch(`/api/admin/metrics/supplies/import/${read.import_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: kept.map((r) => ({
            outlet_id: r.outlet_id,
            product_id: r.product_id,
            quantity: r.unit === 'units' ? Number(r.amount) : null,
            cartons: r.unit === 'cartons' ? Number(r.amount) : null,
            units_per_carton: r.unit === 'cartons' ? Number(r.per) : null,
            batch: r.batch,
            expiry_date: r.expiry_date || null,
            supplied_on: r.supplied_on,
            note: [read.supplier, read.invoice_no && `Invoice ${read.invoice_no}`].filter(Boolean).join(', ').slice(0, 300),
          })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; data?: number }
      if (!res.ok) throw new Error(data.error ?? 'The supplies could not be logged')
      setNotice(`${data.data ?? kept.length} supplies logged from ${read.file_name}.`)
      setRead(null)
      setRows([])
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The supplies could not be logged')
    } finally {
      setBusy(null)
    }
  }

  if (!stores.length || !products.length) {
    return <Alert variant="info">Add products and stores to X Metrics first (Products & stores).</Alert>
  }

  return (
    <div className="space-y-4">
      {!read && (
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-6 text-center text-sm transition-colors hover:border-brand hover:bg-tint/40',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-brand" /> : <FileUp className="h-6 w-6 text-brand" />}
          <span className="font-semibold">{busy ?? 'Choose an invoice or supply sheet'}</span>
          <span className="text-xs text-muted-foreground">
            PDF or Word invoice, CSV or Excel (.xlsx) sheet, up to 10 MB. Nothing is logged until you check the lines.
          </span>
          <input
            type="file"
            className="sr-only"
            accept=".csv,.xlsx,.pdf,.docx,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void upload(file)
            }}
          />
        </label>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {read && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-2xl bg-tint/50 p-3 text-sm">
            <div>
              <p className="font-semibold">{read.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {[read.supplier, read.invoice_no && `Invoice ${read.invoice_no}`, read.invoice_date, read.deliver_to && `To ${read.deliver_to}`]
                  .filter(Boolean)
                  .join(' · ') || 'Read from the column headings'}
                {' · '}
                {rows.length} line{rows.length === 1 ? '' : 's'} found{read.read_by === 'claude' ? ', read by Claude: check them' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select aria-label="Store for every line" value={allStore} onChange={(e) => {
                setAllStore(e.target.value)
                if (e.target.value) setRows((rs) => rs.map((r) => ({ ...r, outlet_id: e.target.value })))
              }} className="h-9 w-48 text-xs">
                <option value="">Same store for all…</option>
                {stores.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setRead(null); setRows([]) }}>
                Start again
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[1040px] text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">From the file</th>
                  <th className="p-2 font-medium">Product</th>
                  <th className="p-2 font-medium">Store</th>
                  <th className="p-2 font-medium">Quantity</th>
                  <th className="p-2 font-medium">Per carton</th>
                  <th className="p-2 font-medium">Batch</th>
                  <th className="p-2 font-medium">Expiry</th>
                  <th className="p-2 font-medium">Supplied</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = problem(r)
                  const product = productOf(r.product_id)
                  return (
                    <tr key={r.key} className={cn('border-t border-border align-top', !r.keep && 'opacity-40')}>
                      <td className="w-56 min-w-[14rem] p-2">
                        <span className="block font-medium">{r.description}</span>
                        <span className="text-muted-foreground">
                          {[r.sku, r.stated_units ? `${r.stated_units} units stated` : null].filter(Boolean).join(' · ')}
                        </span>
                        {r.keep && p && <span className="mt-1 block font-semibold text-destructive">{p}</span>}
                      </td>
                      <td className="p-2">
                        <Select value={r.product_id} onChange={(e) => update(r.key, { product_id: e.target.value })} className="h-9 w-44 text-xs" aria-label={`Product for line ${r.key}`}>
                          <option value="">Choose…</option>
                          {products.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}{o.sku ? ` (${o.sku})` : ''}</option>
                          ))}
                        </Select>
                        {r.product_match === 'close' && r.product_id && <Badge variant="warning" className="mt-1">Close match: check</Badge>}
                      </td>
                      <td className="p-2">
                        <Select value={r.outlet_id} onChange={(e) => update(r.key, { outlet_id: e.target.value })} className="h-9 w-40 text-xs" aria-label={`Store for line ${r.key}`}>
                          <option value="">Choose…</option>
                          {stores.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Input value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} inputMode="numeric" className="h-9 w-16 px-2 text-xs" aria-label={`Quantity for line ${r.key}`} />
                          <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value as Row['unit'] })} className="h-9 w-28 text-xs" aria-label={`Units or cartons for line ${r.key}`}>
                            <option value="units">Units</option>
                            <option value="cartons">Cartons</option>
                          </Select>
                        </div>
                        {r.unit === 'cartons' && whole(r.amount) && whole(r.per) && (
                          <span className="mt-1 block text-muted-foreground">
                            = {(Number(r.amount) * Number(r.per)).toLocaleString('en-GB')} {plural(product?.unit ?? 'unit')}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.unit === 'cartons' ? (
                          <Input value={r.per} onChange={(e) => update(r.key, { per: e.target.value })} inputMode="numeric" placeholder="e.g. 24" className="h-9 w-16 px-2 text-xs" aria-label={`Units per carton for line ${r.key}`} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Input value={r.batch} onChange={(e) => update(r.key, { batch: e.target.value })} maxLength={60} className="h-9 w-20 px-2 text-xs" aria-label={`Batch for line ${r.key}`} />
                      </td>
                      <td className="p-2">
                        <Input type="date" value={r.expiry_date} onChange={(e) => update(r.key, { expiry_date: e.target.value })} className="h-9 w-36 px-2 text-xs" aria-label={`Expiry for line ${r.key}`} />
                      </td>
                      <td className="p-2">
                        <Input type="date" max={today} value={r.supplied_on} onChange={(e) => update(r.key, { supplied_on: e.target.value })} className="h-9 w-36 px-2 text-xs" aria-label={`Date supplied for line ${r.key}`} />
                      </td>
                      <td className="p-2">
                        <Button type="button" size="iconSm" variant="ghost" onClick={() => update(r.key, { keep: !r.keep })} aria-label={r.keep ? `Leave out line ${r.key}` : `Keep line ${r.key}`}>
                          {r.keep ? <Trash2 className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void log()} disabled={!!busy || !kept.length || !!firstProblem}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ?? `Log ${kept.length} suppl${kept.length === 1 ? 'y' : 'ies'} (${totalUnits.toLocaleString('en-GB')} units)`}
            </Button>
            {firstProblem && <span className="text-xs text-destructive">Line {firstProblem[0].key}: {firstProblem[1]}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
