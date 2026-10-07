'use client'

import { useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ChevronDown, MapPin, Package, Plus, Search, Send, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CameraCapture } from '@/components/field/camera-capture'
import { GeoBlocked, requireFix, type Fix } from '@/lib/geo'
import { processReportPhoto } from '@/lib/image'
import { supabase } from '@/lib/supabase/client'
import { checkPhoto } from '@/lib/offline/sync'
import { thingName } from '@/lib/fields'
import { problemWith } from '@/lib/field-check'

/** The rule the server applies to a typed product name. */
const PRODUCT_NAME = thingName(120, 'product name', 1)

/** A product on the Xpel stock count sheet, in the sheet's order. */
export interface SheetProduct {
  name: string
  barcode: string | null
}

/** A product already counted today at a store: its figures are shown for correcting. */
export interface CountLine {
  outlet_id: string
  product: string
  back_store: number | null
  shop_floor: number | null
  in_store: number
  sold: number
  expiry_date: string | null
}

/** What was typed for one product. Empty strings are "not counted". */
type Figures = { back: string; shop: string; sold: string; expiry: string }
type Extra = Figures & { key: number; product: string }

const EMPTY: Figures = { back: '', shop: '', sold: '', expiry: '' }
const whole = (value: string) => /^\d{1,7}$/.test(value.trim())
const productKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
const counted = (f: Figures) => f.back.trim() !== '' || f.shop.trim() !== ''
const touched = (f: Figures) => Boolean(f.back || f.shop || f.sold || f.expiry)
const total = (f: Figures) => Number(f.back || 0) + Number(f.shop || 0)

let nextKey = 1
const blankExtra = (product = ''): Extra => ({ key: nextKey++, product, ...EMPTY })

function figuresOf(line: CountLine): Figures {
  // A line sent by an older phone has only the total: it was on the shelf.
  const split = line.back_store !== null || line.shop_floor !== null
  return {
    back: split && line.back_store !== null ? String(line.back_store) : '',
    shop: split ? (line.shop_floor !== null ? String(line.shop_floor) : '') : String(line.in_store),
    sold: line.sold ? String(line.sold) : '',
    expiry: line.expiry_date ?? '',
  }
}

/** Today's figures for a store, split into sheet products and the rest. */
function startFor(outletId: string, today: CountLine[], onSheet: Set<string>) {
  const sheet: Record<string, Figures> = {}
  const extras: Extra[] = []
  for (const line of today.filter((l) => l.outlet_id === outletId)) {
    const key = productKey(line.product)
    if (onSheet.has(key)) sheet[key] = figuresOf(line)
    else extras.push({ ...blankExtra(line.product), ...figuresOf(line) })
  }
  return { sheet, extras }
}

/**
 * The Xpel stock count sheet on the phone: every product on the sheet, with
 * its barcode, counted in the back store and on the shop floor, plus the
 * expiry date of the stock and how many sold since the last count. Only
 * the products given a number are sent.
 */
export function StoreCountForm({
  stores,
  products,
  today,
  suggestions,
}: {
  stores: { id: string; name: string }[]
  products: SheetProduct[]
  today: CountLine[]
  suggestions: string[]
}) {
  const router = useRouter()
  const listId = useId()
  const onSheet = useMemo(() => new Set(products.map((p) => productKey(p.name))), [products])
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [start] = useState(() => startFor(stores[0]?.id ?? '', today, onSheet))
  const [sheet, setSheet] = useState<Record<string, Figures>>(start.sheet)
  const [extras, setExtras] = useState<Extra[]>(() => [...start.extras, blankExtra()])
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyCounted, setOnlyCounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [fix, setFix] = useState<Fix | null>(null)
  const [camera, setCamera] = useState(false)

  const sheetLines = products
    .map((p) => ({ name: p.name, figures: sheet[productKey(p.name)] ?? EMPTY }))
    .filter((l) => touched(l.figures))
  const extraLines = extras.filter((e) => e.product.trim() || touched(e))
  const countedCount =
    sheetLines.filter((l) => counted(l.figures)).length +
    extraLines.filter((e) => e.product.trim() && counted(e)).length

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return products.filter((p) => {
      if (onlyCounted && !touched(sheet[productKey(p.name)] ?? EMPTY)) return false
      if (!words.length) return true
      const hay = `${p.name} ${p.barcode ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [products, query, onlyCounted, sheet])

  if (stores.length === 0) {
    return (
      <Alert variant="info">
        You have no store allocated yet, so there is nothing to count. Ask your supervisor or the
        office to allocate your store.
      </Alert>
    )
  }

  const all = [
    ...sheetLines.map((l) => ({ name: l.name, f: l.figures })),
    ...extraLines.map((e) => ({ name: e.product.trim(), f: e as Figures })),
  ]
  const badNumber = all.find(
    ({ f }) =>
      (f.back.trim() && !whole(f.back)) || (f.shop.trim() && !whole(f.shop)) || (f.sold.trim() && !whole(f.sold)),
  )
  const noCount = all.find(({ f }) => !counted(f))
  const missingName = extraLines.some((e) => !e.product.trim())
  const extraKeys = extraLines.map((e) => productKey(e.product)).filter(Boolean)
  const duplicate = extraLines.find(
    (e, i) =>
      e.product.trim() &&
      (onSheet.has(productKey(e.product)) || extraKeys.indexOf(productKey(e.product)) !== i),
  )
  const badName = extraLines.find((e) => e.product.trim() && problemWith(PRODUCT_NAME, e.product))
  const problem = missingName
    ? 'Give every product you added a name.'
    : badName
      ? `"${badName.product.trim()}": ${problemWith(PRODUCT_NAME, badName.product)}`
      : duplicate
      ? onSheet.has(productKey(duplicate.product))
        ? `"${duplicate.product.trim()}" is on the sheet: count it there.`
        : `"${duplicate.product.trim()}" is in the list twice.`
      : badNumber
        ? 'Numbers must be whole numbers.'
        : noCount
          ? `Enter the back store or shop floor number for "${noCount.name || 'the product you added'}".`
          : null

  function setFigures(name: string, field: keyof Figures, value: string) {
    setNotice(null)
    setSheet((current) => ({
      ...current,
      [productKey(name)]: { ...(current[productKey(name)] ?? EMPTY), [field]: value },
    }))
  }

  function clearFigures(name: string) {
    setSheet((current) => {
      const next = { ...current }
      delete next[productKey(name)]
      return next
    })
  }

  function updateExtra(key: number, field: keyof Omit<Extra, 'key'>, value: string) {
    setNotice(null)
    setExtras((current) => {
      const next = current.map((e) => (e.key === key ? { ...e, [field]: value } : e))
      const last = next[next.length - 1]
      return last.product || touched(last) ? [...next, blankExtra()] : next
    })
  }

  function removeExtra(key: number) {
    setExtras((current) => {
      const next = current.filter((e) => e.key !== key)
      return next.length ? next : [blankExtra()]
    })
  }

  function changeStore(id: string) {
    const fresh = startFor(id, today, onSheet)
    setStoreId(id)
    setSheet(fresh.sheet)
    setExtras([...fresh.extras, blankExtra()])
    setOpen(null)
    setNotice(null)
    setError(null)
  }

  /**
   * A count is proof of what is on the shelf, so it is taken in the store:
   * first a live location, then a photo of the shelf with the in-app camera,
   * then the numbers. The server refuses it from anywhere else.
   */
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!countedCount || problem) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setStep('Checking you are in the store')
    try {
      setFix(await requireFix())
      setStep(null)
      setCamera(true)
    } catch (e) {
      setStep(null)
      setBusy(false)
      setError(
        e instanceof GeoBlocked
          ? e.message
          : 'Your location could not be read. Turn on location and try again.',
      )
    }
  }

  async function send(photo: Blob) {
    setCamera(false)
    if (!fix) return
    try {
      setStep('Uploading the shelf photo')
      const client = supabase()
      const {
        data: { user },
      } = await client.auth.getUser()
      if (!user) throw new Error('You are signed out. Sign in and try again.')
      const photo_path = `${user.id}/count-${crypto.randomUUID()}.jpg`
      const upload = await client.storage
        .from('reports')
        .upload(photo_path, await processReportPhoto(photo), { contentType: 'image/jpeg' })
      if (upload.error) throw new Error(upload.error.message)

      // A picture of a screen, or of no shelf at all, is refused here.
      setStep('Checking the photo')
      await checkPhoto('reports', photo_path)

      setStep('Saving the count')
      const number = (v: string) => (v.trim() === '' ? null : Number(v.trim()))
      const res = await fetch('/api/store-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: storeId,
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy_m,
          photo_path,
          lines: all.map(({ name, f }) => ({
            product_name: name.replace(/\s+/g, ' '),
            back_store: number(f.back),
            shop_floor: number(f.shop),
            sold: Number(f.sold.trim() || 0),
            expiry_date: f.expiry || null,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { saved?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The count could not be saved.')
      setNotice(
        `Saved ${all.length} product${all.length === 1 ? '' : 's'}. You can correct it until midnight.`,
      )
      router.refresh()
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'No connection. Your numbers are still on the screen; try again when you have signal.',
      )
    } finally {
      setStep(null)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {stores.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="count-store">Store</Label>
          <Select id="count-store" value={storeId} onChange={(e) => changeStore(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Package className="h-4 w-4 text-brand" />
          {stores[0].name}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        This is the Xpel stock count sheet. Tap each product you have, and enter how many are in
        the back store and on the shop floor. Add the expiry date of the stock, and how many sold
        since the last count. Leave out products you do not have.
      </p>
      <p className="flex items-start gap-2 rounded-xl bg-tint/60 p-2.5 text-xs text-tint-foreground">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Submit while you are in the store. Xtend checks your location and asks for a photo of
          the shelf <Camera className="inline h-3 w-3" /> before saving.
        </span>
      </p>

      {products.length > 0 && (
        <section className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or barcode"
              aria-label="Search the count sheet"
              className="h-11 pl-10 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Chip active={!onlyCounted} onClick={() => setOnlyCounted(false)}>
              All {products.length}
            </Chip>
            <Chip active={onlyCounted} onClick={() => setOnlyCounted(true)}>
              Counted {sheetLines.length}
            </Chip>
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {shown.map((p) => (
              <SheetRow
                key={p.name}
                product={p}
                figures={sheet[productKey(p.name)] ?? EMPTY}
                open={open === p.name}
                onToggle={() => setOpen((o) => (o === p.name ? null : p.name))}
                onChange={setFigures}
                onClear={clearFigures}
              />
            ))}
            {shown.length === 0 && (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {onlyCounted ? 'Nothing counted yet.' : 'No product on the sheet matches that.'}
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-sm font-semibold">
          {products.length ? 'Products not on the sheet' : 'Products'}
        </p>
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <ul className="space-y-2">
          {extras.map((row, i) => {
            const empty = !row.product && !touched(row)
            return (
              <li
                key={row.key}
                className={cn(
                  'space-y-2 rounded-2xl border bg-card p-2',
                  empty ? 'border-dashed border-border' : 'border-border',
                )}
              >
                <div className="flex items-center gap-2">
                  {empty && <Plus className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <Input
                    list={listId}
                    value={row.product}
                    onChange={(e) => updateExtra(row.key, 'product', e.target.value)}
                    placeholder="Product name"
                    aria-label={`Other product ${i + 1}`}
                    maxLength={120}
                    autoCapitalize="words"
                    className="h-11 px-3 text-sm"
                  />
                  {!empty && (
                    <button
                      type="button"
                      onClick={() => removeExtra(row.key)}
                      aria-label={`Remove other product ${i + 1}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-tint"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {!empty && (
                  <FigureFields
                    label={row.product || `Other product ${i + 1}`}
                    figures={row}
                    onChange={(field, value) => updateExtra(row.key, field, value)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {problem && all.length > 0 && <Alert variant="warning">{problem}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="sticky bottom-24 z-10">
        <Button type="submit" size="lg" className="w-full" disabled={busy || !countedCount || !!problem}>
          <Send className="h-4 w-4" />
          {busy
            ? (step ?? 'Take the shelf photo…')
            : countedCount
              ? `Submit count (${countedCount} product${countedCount === 1 ? '' : 's'})`
              : 'Count at least one product'}
        </Button>
      </div>

      <CameraCapture
        open={camera}
        facing="environment"
        title="Photo of the shelf"
        subtitle="Show the products you counted"
        onCapture={(photo) => void send(photo)}
        onClose={() => {
          setCamera(false)
          setBusy(false)
          setError('The count was not sent: it needs a photo of the shelf.')
        }}
      />
    </form>
  )
}

/** One product on the sheet: its name and barcode, and the figures once opened. */
function SheetRow({
  product,
  figures,
  open,
  onToggle,
  onChange,
  onClear,
}: {
  product: SheetProduct
  figures: Figures
  open: boolean
  onToggle: () => void
  onChange: (name: string, field: keyof Figures, value: string) => void
  onClear: (name: string) => void
}) {
  const done = counted(figures)
  return (
    <li className={cn(open && 'bg-tint/30')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug">{product.name}</span>
          {product.barcode && (
            <span className="block font-mono text-[11px] text-muted-foreground">{product.barcode}</span>
          )}
        </span>
        {done ? (
          <span className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-bold tabular-nums text-primary-foreground">
            {total(figures)}
          </span>
        ) : touched(figures) ? (
          <span className="shrink-0 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-tint-foreground">
            No count
          </span>
        ) : null}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <FigureFields
            label={product.name}
            figures={figures}
            onChange={(field, value) => onChange(product.name, field, value)}
          />
          {touched(figures) && (
            <button
              type="button"
              onClick={() => onClear(product.name)}
              className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear this product
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** Back store, shop floor and their total; sold; expiry date. */
function FigureFields({
  label,
  figures,
  onChange,
}: {
  label: string
  figures: Figures
  onChange: (field: keyof Figures, value: string) => void
}) {
  const numberField = (field: 'back' | 'shop' | 'sold', title: string) => (
    <label className="space-y-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className="block">{title}</span>
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        value={figures[field]}
        onChange={(e) => onChange(field, e.target.value.replace(/[^\d]/g, ''))}
        aria-label={`${label}: ${title.toLowerCase()}`}
        className="h-11 px-2 text-center text-base text-foreground"
        placeholder="–"
      />
    </label>
  )
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {numberField('back', 'Back store')}
        {numberField('shop', 'Shop floor')}
        <div className="space-y-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="block">Total</span>
          <span className="flex h-11 items-center justify-center rounded-2xl bg-muted text-base font-bold tabular-nums text-foreground">
            {counted(figures) ? total(figures) : '–'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numberField('sold', 'Sold')}
        <label className="space-y-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="block">Expiry date</span>
          <Input
            type="date"
            value={figures.expiry}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => onChange('expiry', e.target.value)}
            aria-label={`${label}: expiry date`}
            className="h-11 px-2 text-sm text-foreground"
          />
        </label>
      </div>
    </div>
  )
}
