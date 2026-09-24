'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface ManagedProduct {
  id: string
  name: string
  sku: string | null
  is_active: boolean
}

/** "Name" or "Name, SKU" per line. */
function parseLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/[,\t]/)
      return { name: name.trim(), sku: rest.join(',').trim() || null }
    })
    .filter((item) => item.name)
}

/**
 * The list merchandisers count against. Taking a product off the list hides
 * it from the count screen; counts already made keep their product.
 */
export function ProductManager({ products }: { products: ManagedProduct[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const items = parseLines(text)

  async function add() {
    if (!items.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        added?: number
        skipped?: number
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? 'The products could not be added.')
      setText('')
      setNotice(
        `Added ${json.added ?? 0}.` +
          (json.skipped ? ` ${json.skipped} already on the list were skipped.` : ''),
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The products could not be added.')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(product: ManagedProduct) {
    setError(null)
    setNotice(null)
    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !product.is_active }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      setError(json.error ?? 'That change could not be saved.')
      return
    }
    router.refresh()
  }

  const active = products.filter((p) => p.is_active).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Products ({active} on the list{products.length > active ? `, ${products.length - active} retired` : ''})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-products">Add products, one per line</Label>
          <Textarea
            id="new-products"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Xpel Body Lotion 400ml, XBL-400\nXpel Shower Gel 250ml'}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Add a comma and a code after the name if you use product codes. You can paste a whole
            column from a spreadsheet.
          </p>
        </div>
        <Button type="button" onClick={add} disabled={busy || !items.length}>
          <Plus className="h-4 w-4" />
          {busy ? 'Adding…' : `Add ${items.length || ''} product${items.length === 1 ? '' : 's'}`}
        </Button>

        {error && <Alert variant="destructive">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        {products.length > 0 && (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className={cn('min-w-0', !p.is_active && 'text-muted-foreground line-through')}>
                  {p.name}
                  {p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {!p.is_active && <Badge variant="outline">Retired</Badge>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => toggle(p)}>
                    {p.is_active ? 'Retire' : 'Restore'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
