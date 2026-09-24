'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Package, Search, Send } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface CountProduct {
  id: string
  name: string
  sku: string | null
}

export interface CountLine {
  outlet_id: string
  product_id: string
  in_store: number
  sold: number
}

type Entry = { in_store: string; sold: string }

function entriesFor(counted: CountLine[], outletId: string) {
  const entries: Record<string, Entry> = {}
  for (const line of counted) {
    if (line.outlet_id !== outletId) continue
    entries[line.product_id] = { in_store: String(line.in_store), sold: String(line.sold) }
  }
  return entries
}

const whole = (value: string) => /^\d{1,7}$/.test(value.trim())

/**
 * One row per product: how many are in the store now, and how many sold
 * since the last count. Only the rows with a number in them are sent; a blank beside a
 * filled-in box counts as zero.
 */
export function StoreCountForm({
  stores,
  products,
  counted,
}: {
  stores: { id: string; name: string }[]
  products: CountProduct[]
  counted: CountLine[]
}) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    entriesFor(counted, stores[0]?.id ?? ''),
  )
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return products
    return products.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle),
    )
  }, [products, search])

  const filled = Object.entries(entries).filter(
    ([, e]) => e.in_store.trim() !== '' || e.sold.trim() !== '',
  )
  const invalid = filled.some(
    ([, e]) =>
      (e.in_store.trim() !== '' && !whole(e.in_store)) || (e.sold.trim() !== '' && !whole(e.sold)),
  )

  if (stores.length === 0) {
    return (
      <Alert variant="info">
        You have no store allocated yet, so there is nothing to count. Ask your supervisor or the
        office to allocate your store.
      </Alert>
    )
  }
  if (products.length === 0) {
    return (
      <Alert variant="info">
        The office has not set up the product list yet. Once they do, the products appear here.
      </Alert>
    )
  }

  function update(productId: string, field: keyof Entry, value: string) {
    setNotice(null)
    setEntries((current) => ({
      ...current,
      [productId]: { ...(current[productId] ?? { in_store: '', sold: '' }), [field]: value },
    }))
  }

  function changeStore(id: string) {
    setStoreId(id)
    setEntries(entriesFor(counted, id))
    setNotice(null)
    setError(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!filled.length || invalid) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/store-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: storeId,
          lines: filled.map(([product_id, e]) => ({
            product_id,
            in_store: Number(e.in_store.trim() || 0),
            sold: Number(e.sold.trim() || 0),
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { saved?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The count could not be saved.')
      setNotice(
        `Saved ${json.saved ?? filled.length} product${filled.length === 1 ? '' : 's'}. You can correct it until midnight.`,
      )
      router.refresh()
    } catch (e) {
      setError(
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'No connection. Your numbers are still on the screen; try again when you have signal.',
      )
    } finally {
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

      {products.length > 8 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a product"
            className="pl-10"
            aria-label="Find a product"
          />
        </div>
      )}

      <div className="grid grid-cols-[1fr_72px_72px] items-end gap-2 px-1 text-xs font-semibold text-muted-foreground">
        <span>Product</span>
        <span className="text-center">In store</span>
        <span className="text-center leading-tight">Sold since last count</span>
      </div>

      <ul className="space-y-2">
        {visible.map((product) => {
          const entry = entries[product.id] ?? { in_store: '', sold: '' }
          const done = entry.in_store.trim() !== '' || entry.sold.trim() !== ''
          return (
            <li
              key={product.id}
              className={cn(
                'grid grid-cols-[1fr_72px_72px] items-center gap-2 rounded-2xl border bg-card p-2 pl-3',
                done ? 'border-brand/40' : 'border-border',
              )}
            >
              <span className="min-w-0 text-sm">
                <span className="flex items-start gap-1.5 font-medium leading-snug">
                  {done && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />}
                  <span className="line-clamp-2 break-words">{product.name}</span>
                </span>
                {product.sku && (
                  <span className="block truncate text-xs text-muted-foreground">{product.sku}</span>
                )}
              </span>
              {(['in_store', 'sold'] as const).map((field) => (
                <Input
                  key={field}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={entry[field]}
                  onChange={(e) => update(product.id, field, e.target.value.replace(/[^\d]/g, ''))}
                  aria-label={`${product.name}: ${field === 'in_store' ? 'in store' : 'sold since last count'}`}
                  className="h-11 px-2 text-center"
                  placeholder="–"
                />
              ))}
            </li>
          )
        })}
        {visible.length === 0 && (
          <li className="py-4 text-center text-sm text-muted-foreground">No product matches.</li>
        )}
      </ul>

      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="sticky bottom-24 z-10">
        <Button type="submit" size="lg" className="w-full" disabled={busy || !filled.length || invalid}>
          <Send className="h-4 w-4" />
          {busy
            ? 'Saving…'
            : filled.length
              ? `Submit count (${filled.length} product${filled.length === 1 ? '' : 's'})`
              : 'Enter a number to submit'}
        </Button>
      </div>
    </form>
  )
}
