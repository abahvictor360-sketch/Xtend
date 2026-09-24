'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Send, X } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** A product already counted today at a store: its figures are shown for correcting. */
export interface CountLine {
  outlet_id: string
  product: string
  in_store: number
  sold: number
}

type Row = { key: number; product: string; in_store: string; sold: string }

const whole = (value: string) => /^\d{1,7}$/.test(value.trim())
const productKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

let nextKey = 1
const blank = (product = ''): Row => ({ key: nextKey++, product, in_store: '', sold: '' })

/**
 * Today's figures for a store if there are any; otherwise the products counted
 * there last time, with the numbers left empty, so names are not retyped.
 */
function rowsFor(outletId: string, today: CountLine[], previous: Record<string, string[]>) {
  const done = today.filter((l) => l.outlet_id === outletId)
  if (done.length) {
    return [
      ...done.map((l) => ({ ...blank(l.product), in_store: String(l.in_store), sold: String(l.sold) })),
      blank(),
    ]
  }
  const names = previous[outletId] ?? []
  return names.length ? [...names.map((n) => blank(n)), blank()] : [blank(), blank(), blank()]
}

/**
 * The merchandiser counts what is physically in the store: for each product,
 * its name, how many are left, and how many were sold since the last count.
 */
export function StoreCountForm({
  stores,
  today,
  previous,
  suggestions,
}: {
  stores: { id: string; name: string }[]
  today: CountLine[]
  /** Product names from the person's last count at each store, by store id. */
  previous: Record<string, string[]>
  suggestions: string[]
}) {
  const router = useRouter()
  const listId = useId()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>(() => rowsFor(stores[0]?.id ?? '', today, previous))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (stores.length === 0) {
    return (
      <Alert variant="info">
        You have no store allocated yet, so there is nothing to count. Ask your supervisor or the
        office to allocate your store.
      </Alert>
    )
  }

  // A row counts once it has a name and at least one number.
  const filled = rows.filter(
    (r) => r.product.trim() && (r.in_store.trim() !== '' || r.sold.trim() !== ''),
  )
  const missingName = rows.some((r) => !r.product.trim() && (r.in_store.trim() || r.sold.trim()))
  const keys = filled.map((r) => productKey(r.product))
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i)
  const badNumber = filled.some(
    (r) => (r.in_store.trim() && !whole(r.in_store)) || (r.sold.trim() && !whole(r.sold)),
  )
  const problem = missingName
    ? 'Give every product you counted a name.'
    : duplicate
      ? `"${filled.find((r) => productKey(r.product) === duplicate)?.product.trim()}" is in the list twice.`
      : badNumber
        ? 'Numbers must be whole numbers.'
        : null

  function update(key: number, field: keyof Omit<Row, 'key'>, value: string) {
    setNotice(null)
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, [field]: value } : r))
      // Always keep one empty row at the bottom to type the next product into.
      const last = next[next.length - 1]
      return last.product || last.in_store || last.sold ? [...next, blank()] : next
    })
  }

  function remove(key: number) {
    setRows((current) => {
      const next = current.filter((r) => r.key !== key)
      return next.length ? next : [blank()]
    })
  }

  function changeStore(id: string) {
    setStoreId(id)
    setRows(rowsFor(id, today, previous))
    setNotice(null)
    setError(null)
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!filled.length || problem) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/store-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: storeId,
          lines: filled.map((r) => ({
            product_name: r.product.trim().replace(/\s+/g, ' '),
            in_store: Number(r.in_store.trim() || 0),
            sold: Number(r.sold.trim() || 0),
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { saved?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'The count could not be saved.')
      setNotice(
        `Saved ${filled.length} product${filled.length === 1 ? '' : 's'}. You can correct it until midnight.`,
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

      <p className="text-sm text-muted-foreground">
        Count the products on the shelf and in the store room. For each one, write how many are
        left and how many were sold since the last count. A new empty line appears as you type.
      </p>

      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <ul className="space-y-2">
        {rows.map((row, i) => {
          const empty = !row.product && !row.in_store && !row.sold
          return (
            <li
              key={row.key}
              className={cn(
                'space-y-2 rounded-2xl border bg-card p-2',
                empty ? 'border-dashed border-border' : 'border-border',
              )}
            >
              <div className="flex items-center gap-2">
                <Input
                  list={listId}
                  value={row.product}
                  onChange={(e) => update(row.key, 'product', e.target.value)}
                  placeholder={i === 0 ? 'Product, e.g. Xpel Body Lotion 400ml' : 'Product name'}
                  aria-label={`Product ${i + 1}`}
                  maxLength={120}
                  autoCapitalize="words"
                  className="h-11 px-3 text-sm"
                />
                {!empty && (
                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    aria-label={`Remove product ${i + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-tint"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['in_store', 'sold'] as const).map((field) => (
                  <label key={field} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="w-8 shrink-0 text-right">{field === 'in_store' ? 'Left' : 'Sold'}</span>
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={row[field]}
                      onChange={(e) => update(row.key, field, e.target.value.replace(/[^\d]/g, ''))}
                      aria-label={`Product ${i + 1}: ${field === 'in_store' ? 'left in store' : 'sold'}`}
                      className="h-11 px-2 text-center text-base text-foreground"
                      placeholder="–"
                    />
                  </label>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      {problem && filled.length > 0 && <Alert variant="warning">{problem}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="sticky bottom-24 z-10">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || !filled.length || !!problem}
        >
          <Send className="h-4 w-4" />
          {busy
            ? 'Saving…'
            : filled.length
              ? `Submit count (${filled.length} product${filled.length === 1 ? '' : 's'})`
              : 'Enter a product and its numbers'}
        </Button>
      </div>
    </form>
  )
}
