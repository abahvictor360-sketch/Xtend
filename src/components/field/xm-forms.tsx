'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ChevronDown, Clock, MapPin, Plus, Search, Send, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { CameraCapture } from '@/components/field/camera-capture'
import { OutboxBanner } from '@/components/field/outbox-banner'
import { GeoBlocked, requireFix, type Fix } from '@/lib/geo'
import { processReportPhoto } from '@/lib/image'
import { PermanentJobError, submitOrQueue } from '@/lib/offline/sync'
import { cn, longDate } from '@/lib/utils'
import type { XmGrade, XmProduct, XmSettings } from '@/lib/metrics/shared'
import type { XmPolicy } from '@/components/metrics/policy'
import { XmMyScore } from '@/components/field/xm-score'

export interface XmBatch {
  outlet_id: string
  product_id: string
  batch: string
  expiry_date: string | null
}

export interface XmRecent {
  id: string
  kind: 'count' | 'sales'
  store: string
  date: string
  at: string
  voided: boolean
}

type Store = { id: string; name: string }
type Row = { key: number; product_id: string; batch: string; expiry: string; shelf: string; back: string }

let nextKey = 1
const whole = (v: string) => /^\d{1,7}$/.test(v.trim())
const filled = (r: Row) => r.shelf.trim() !== '' || r.back.trim() !== ''

function rowsFor(storeId: string, batches: XmBatch[]): Row[] {
  return batches
    .filter((b) => b.outlet_id === storeId)
    .map((b) => ({
      key: nextKey++,
      product_id: b.product_id,
      batch: b.batch,
      expiry: b.expiry_date ?? '',
      shelf: '',
      back: '',
    }))
}

function matches(p: XmProduct, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${p.name} ${p.sku ?? ''} ${p.category ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * X Metrics on the phone: the stock count, by batch with expiry dates, and
 * the day's sales. Each is taken with a photo from the in-app camera and
 * kept on the phone if there is no signal, then sent when there is.
 */
export function XmFieldForms({
  initialTab,
  stores,
  products,
  batches,
  businessDate,
  salesPhotoRequired,
  recent,
  grade,
  settings,
  policy,
  policyRead,
}: {
  initialTab: 'count' | 'sales' | 'score'
  stores: Store[]
  products: XmProduct[]
  batches: XmBatch[]
  businessDate: string
  salesPhotoRequired: boolean
  recent: XmRecent[]
  grade: XmGrade | null
  settings: XmSettings | null
  policy: XmPolicy | null
  policyRead: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState(initialTab)

  return (
    <div className="space-y-4">
      <OutboxBanner onFlushed={() => router.refresh()} />
      <div className="flex gap-2">
        <Chip active={tab === 'count'} onClick={() => setTab('count')}>
          Stock count
        </Chip>
        <Chip active={tab === 'sales'} onClick={() => setTab('sales')}>
          Daily sales
        </Chip>
        <Chip active={tab === 'score'} onClick={() => setTab('score')}>
          My score{policy && !policyRead ? ' •' : ''}
        </Chip>
      </div>

      {policy && !policyRead && tab !== 'score' && (
        <Alert variant="info">
          The scoring policy has been updated.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setTab('score')}>
            Read it
          </button>
        </Alert>
      )}

      {tab === 'score' ? (
        <XmMyScore grade={grade} settings={settings} policy={policy} read={policyRead} />
      ) : products.length === 0 ? (
        <Alert variant="info">There are no products in X Metrics yet. The office adds them.</Alert>
      ) : tab === 'count' ? (
        <CountForm stores={stores} products={products} batches={batches} />
      ) : (
        <SalesForm
          stores={stores}
          products={products}
          businessDate={businessDate}
          photoRequired={salesPhotoRequired}
        />
      )}

      {recent.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-semibold">Sent this week</p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
            {recent.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className={cn(r.voided && 'text-muted-foreground line-through')}>
                  {r.kind === 'count' ? 'Stock count' : 'Sales'} · {r.store}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.voided ? 'Voided' : longDate(r.date)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function StorePicker({ id, stores, value, onChange }: { id: string; stores: Store[]; value: string; onChange: (v: string) => void }) {
  if (stores.length === 1) return <p className="text-sm font-semibold">{stores[0].name}</p>
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Store</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </div>
  )
}

function useSubmitState() {
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  return { busy, setBusy, step, setStep, error, setError, notice, setNotice }
}

function Status({ s }: { s: ReturnType<typeof useSubmitState> }) {
  return (
    <>
      {s.error && <Alert variant="destructive">{s.error}</Alert>}
      {s.notice && <Alert variant="success">{s.notice}</Alert>}
      {s.step && <p className="text-center text-xs text-muted-foreground">{s.step}…</p>}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Stock count                                                         */
/* ------------------------------------------------------------------ */

function CountForm({ stores, products, batches }: { stores: Store[]; products: XmProduct[]; batches: XmBatch[] }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0].id)
  const [rows, setRows] = useState<Row[]>(() => rowsFor(stores[0].id, batches))
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyCounted, setOnlyCounted] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const s = useSubmitState()

  const byProduct = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) map.set(r.product_id, [...(map.get(r.product_id) ?? []), r])
    return map
  }, [rows])
  const counted = rows.filter(filled)
  const countedProducts = new Set(counted.map((r) => r.product_id))
  const shown = products.filter(
    (p) => matches(p, query) && (!onlyCounted || countedProducts.has(p.id)),
  )
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? 'a product'

  const seen = new Set<string>()
  let problem: string | null = null
  for (const r of counted) {
    const key = `${r.product_id}|${r.batch.trim().toLowerCase()}`
    if ((r.shelf.trim() && !whole(r.shelf)) || (r.back.trim() && !whole(r.back))) {
      problem = `Numbers for ${name(r.product_id)} must be whole numbers.`
    } else if (seen.has(key)) {
      problem = `${name(r.product_id)} has the same batch twice.`
    } else if (r.batch.length > 60) {
      problem = `The batch for ${name(r.product_id)} is too long.`
    }
    if (problem) break
    seen.add(key)
  }

  function changeStore(id: string) {
    setStoreId(id)
    setRows(rowsFor(id, batches))
    setOpen(null)
    s.setNotice(null)
    s.setError(null)
  }

  function update(key: number, field: keyof Row, value: string) {
    s.setNotice(null)
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  }

  function addBatch(productId: string) {
    setRows((current) => [...current, { key: nextKey++, product_id: productId, batch: '', expiry: '', shelf: '', back: '' }])
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((r) => r.key !== key))
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!counted.length || problem) return
    s.setBusy(true)
    s.setError(null)
    s.setNotice(null)
    s.setStep('Checking you are in the store')
    try {
      setFix(await requireFix())
      setCapturedAt(new Date().toISOString())
      s.setStep(null)
      setCamera(true)
    } catch (e) {
      s.setStep(null)
      s.setBusy(false)
      s.setError(e instanceof GeoBlocked ? e.message : 'Your location could not be read. Turn on location and try again.')
    }
  }

  async function send(photo: Blob) {
    setCamera(false)
    if (!fix || !capturedAt) return
    try {
      s.setStep('Sending the count')
      const store = stores.find((x) => x.id === storeId)!
      const result = await submitOrQueue({
        kind: 'xm_count',
        outlet_id: storeId,
        outlet_name: store.name,
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy_m,
        photo: await processReportPhoto(photo),
        client_captured_at: capturedAt,
        lines: counted.map((r) => ({
          product_id: r.product_id,
          batch: r.batch.trim(),
          expiry_date: r.expiry || null,
          on_shelf: Number(r.shelf.trim() || 0),
          in_backroom: Number(r.back.trim() || 0),
        })),
      })
      s.setNotice(
        result.queued && 'waitingForPlace' in result && result.waitingForPlace
          ? `The count for ${store.name} is saved on this phone. It is sent as soon as you add the place above.`
          : result.queued
          ? `No signal: the count for ${store.name} is saved on this phone and will be sent when you are back online (within 3 days).`
          : `Count for ${store.name} sent: ${counted.length} line${counted.length === 1 ? '' : 's'}.`,
      )
      setRows(rowsFor(storeId, batches))
      router.refresh()
    } catch (e) {
      s.setError(
        e instanceof PermanentJobError || e instanceof Error ? e.message : 'The count could not be sent. Try again.',
      )
    } finally {
      s.setStep(null)
      s.setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <StorePicker id="xm-count-store" stores={stores} value={storeId} onChange={changeStore} />
      <p className="text-sm text-muted-foreground">
        For each product, count what is on the shelf and in the backroom, batch by batch, with the
        expiry date printed on it. Leave out products you do not have.
      </p>
      <p className="flex items-start gap-2 rounded-xl bg-tint/60 p-2.5 text-xs text-tint-foreground">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Send it from the store. Xtend checks your location and asks for a shelf photo{' '}
          <Camera className="inline h-3 w-3" />. No signal? It is kept on the phone and sent later.
        </span>
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or SKU"
          aria-label="Search products"
          className="h-11 pl-10 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Chip active={!onlyCounted} onClick={() => setOnlyCounted(false)}>
          All {products.length}
        </Chip>
        <Chip active={onlyCounted} onClick={() => setOnlyCounted(true)}>
          Counted {countedProducts.size}
        </Chip>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {shown.map((p) => {
          const its = byProduct.get(p.id) ?? []
          const units = its.filter(filled).reduce((n, r) => n + Number(r.shelf || 0) + Number(r.back || 0), 0)
          const isOpen = open === p.id
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(isOpen ? null : p.id)
                  if (!isOpen && its.length === 0) addBatch(p.id)
                }}
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                aria-expanded={isOpen}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.sku, p.category, p.unit].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {countedProducts.has(p.id) && (
                  <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-tint-foreground">
                    {units}
                  </span>
                )}
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="space-y-2 px-3 pb-3">
                  {its.map((r, i) => (
                    <div key={r.key} className="space-y-2 rounded-xl border border-border p-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={r.batch}
                          onChange={(e) => update(r.key, 'batch', e.target.value)}
                          placeholder="Batch no."
                          aria-label={`${p.name} batch ${i + 1}`}
                          maxLength={60}
                          className="h-10 px-3 text-sm"
                        />
                        <Input
                          type="date"
                          value={r.expiry}
                          onChange={(e) => update(r.key, 'expiry', e.target.value)}
                          aria-label={`${p.name} batch ${i + 1} expiry date`}
                          className="h-10 px-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(r.key)}
                          aria-label={`Remove ${p.name} batch ${i + 1}`}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-tint"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 text-xs text-muted-foreground">
                          On shelf
                          <Input
                            inputMode="numeric"
                            value={r.shelf}
                            onChange={(e) => update(r.key, 'shelf', e.target.value)}
                            placeholder="0"
                            className="h-10 px-3 text-sm"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-muted-foreground">
                          In backroom
                          <Input
                            inputMode="numeric"
                            value={r.back}
                            onChange={(e) => update(r.key, 'back', e.target.value)}
                            placeholder="0"
                            className="h-10 px-3 text-sm"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addBatch(p.id)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand"
                  >
                    <Plus className="h-3.5 w-3.5" /> Another batch
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="p-4 text-center text-sm text-muted-foreground">
            {onlyCounted ? 'Nothing counted yet.' : 'No product matches that.'}
          </li>
        )}
      </ul>

      {problem && <Alert variant="warning">{problem}</Alert>}
      <Status s={s} />
      <Button type="submit" className="w-full" disabled={s.busy || !counted.length || !!problem}>
        <Send className="h-4 w-4" />
        {counted.length ? `Send count (${countedProducts.size} product${countedProducts.size === 1 ? '' : 's'})` : 'Count a product to send'}
      </Button>

      <CameraCapture
        open={camera}
        facing="environment"
        title="Photo of the shelf"
        subtitle={stores.find((x) => x.id === storeId)?.name}
        onCapture={send}
        onClose={() => {
          setCamera(false)
          s.setBusy(false)
        }}
      />
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Daily sales                                                         */
/* ------------------------------------------------------------------ */

function SalesForm({
  stores,
  products,
  businessDate,
  photoRequired,
}: {
  stores: Store[]
  products: XmProduct[]
  businessDate: string
  photoRequired: boolean
}) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0].id)
  const [date, setDate] = useState(businessDate)
  const [units, setUnits] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [camera, setCamera] = useState(false)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const s = useSubmitState()

  const days = [0, 1, 2, 3].map((n) => new Date(Date.parse(businessDate) - n * 86_400_000).toISOString().slice(0, 10))
  const entered = Object.entries(units).filter(([, v]) => v.trim() !== '')
  const bad = entered.find(([, v]) => !whole(v))
  const shown = products.filter((p) => matches(p, query))

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!entered.length || bad) return
    s.setError(null)
    s.setNotice(null)
    s.setBusy(true)
    setCapturedAt(new Date().toISOString())
    if (photoRequired) setCamera(true)
    else void send(null)
  }

  async function send(photo: Blob | null) {
    setCamera(false)
    try {
      s.setStep('Sending the sales')
      const store = stores.find((x) => x.id === storeId)!
      const result = await submitOrQueue({
        kind: 'xm_sales',
        outlet_id: storeId,
        outlet_name: store.name,
        sale_date: date,
        photo: photo ? await processReportPhoto(photo) : null,
        client_captured_at: capturedAt ?? new Date().toISOString(),
        lines: entered.map(([product_id, v]) => ({ product_id, units: Number(v.trim()) })),
      })
      s.setNotice(
        result.queued && 'waitingForPlace' in result && result.waitingForPlace
          ? `The sales for ${longDate(date)} are saved on this phone. They are sent as soon as you add the place above.`
          : result.queued
          ? `No signal: the sales for ${longDate(date)} are saved on this phone and will be sent when you are back online.`
          : `Sales for ${longDate(date)} sent. Sending this day again replaces them.`,
      )
      setUnits({})
      router.refresh()
    } catch (e) {
      s.setError(e instanceof Error ? e.message : 'The sales could not be sent. Try again.')
    } finally {
      s.setStep(null)
      s.setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <StorePicker id="xm-sales-store" stores={stores} value={storeId} onChange={setStoreId} />
      <div className="space-y-1.5">
        <Label htmlFor="xm-sales-date">Day</Label>
        <Select id="xm-sales-date" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((d, i) => (
            <option key={d} value={d}>
              {i === 0 ? 'Today' : i === 1 ? 'Yesterday' : longDate(d)}
            </option>
          ))}
        </Select>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-tint/60 p-2.5 text-xs text-tint-foreground">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Units sold that day, per product. Send it by the end of the day.
          {photoRequired && ' You will be asked for a photo of the shelf.'}
        </span>
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or SKU"
          aria-label="Search products"
          className="h-11 pl-10 text-sm"
        />
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2">
            <label htmlFor={`xm-sold-${p.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.sku ?? p.unit}</span>
            </label>
            <Input
              id={`xm-sold-${p.id}`}
              inputMode="numeric"
              value={units[p.id] ?? ''}
              onChange={(e) => {
                s.setNotice(null)
                setUnits((u) => ({ ...u, [p.id]: e.target.value }))
              }}
              placeholder="0"
              className={cn('h-10 w-20 px-3 text-right text-sm', units[p.id] && !whole(units[p.id]) && 'border-destructive')}
            />
          </li>
        ))}
        {shown.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No product matches that.</li>}
      </ul>

      {bad && <Alert variant="warning">Units sold must be whole numbers.</Alert>}
      <Status s={s} />
      <Button type="submit" className="w-full" disabled={s.busy || !entered.length || !!bad}>
        <Send className="h-4 w-4" />
        {entered.length ? `Send sales (${entered.length} product${entered.length === 1 ? '' : 's'})` : 'Enter units sold to send'}
      </Button>

      <CameraCapture
        open={camera}
        facing="environment"
        title="Photo of the shelf"
        subtitle={stores.find((x) => x.id === storeId)?.name}
        onCapture={send}
        onClose={() => {
          setCamera(false)
          s.setBusy(false)
        }}
      />
    </form>
  )
}
