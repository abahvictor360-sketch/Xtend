'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { xmCall } from '@/components/admin/xm/widgets'
import { XM_FEATURE_INFO, xmOn, type XmFeatures } from '@/lib/metrics/features'
import { cn } from '@/lib/utils'

/**
 * The X Metrics switches (0063): the whole module and four parts. Each
 * switch saves at once; nothing is deleted when a part is turned off.
 */
export function FeaturesForm({ features }: { features: XmFeatures }) {
  const router = useRouter()
  const [f, setF] = useState(features)
  const [busy, setBusy] = useState<keyof XmFeatures | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function flip(key: keyof XmFeatures) {
    const next = { ...f, [key]: !f[key] }
    const label = XM_FEATURE_INFO.find((i) => i.key === key)?.label ?? 'X Metrics'
    if (
      key === 'enabled' &&
      !next.enabled &&
      !window.confirm('Switch X Metrics off? It disappears from the menu and the staff app. All its records are kept.')
    ) {
      return
    }
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await xmCall('/api/admin/metrics/features', 'PUT', next)
      setF(next)
      setNotice(
        next[key]
          ? `${label} is on again. It carries on from where it stopped.`
          : `${label} is off. Everything it recorded is kept, and comes back when you turn it on.`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {XM_FEATURE_INFO.map((info) => {
          const isMaster = info.key === 'enabled'
          const own = f[info.key]
          const blocked = !isMaster && !f.enabled
          return (
            <li key={info.key} className={cn('flex items-start gap-3 py-3', !isMaster && 'sm:pl-4')}>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-semibold', isMaster && 'text-base')} id={`xmf-${info.key}`}>
                  {info.label}
                  {blocked && own && <span className="ml-2 text-xs font-normal text-muted-foreground">(off while X Metrics is off)</span>}
                </p>
                <p className="text-xs text-muted-foreground">{info.line}</p>
                {info.key === 'supplies' && own && f.enabled && !xmOn(f, 'reconcile') && (
                  <p className="mt-1 text-xs text-muted-foreground">Checking counts against supplies also needs Sales on.</p>
                )}
                {info.key === 'sales' && own && f.enabled && !xmOn(f, 'reconcile') && (
                  <p className="mt-1 text-xs text-muted-foreground">Checking counts against supplies also needs Supplies on.</p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={own}
                aria-labelledby={`xmf-${info.key}`}
                disabled={busy !== null}
                onClick={() => flip(info.key)}
                className={cn(
                  'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60',
                  own ? (blocked ? 'bg-[#f2b48a]' : 'bg-brand') : 'bg-[#e6d9cf]',
                )}
              >
                <span className="sr-only">{own ? 'On' : 'Off'}</span>
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform',
                    own ? 'translate-x-6' : 'translate-x-1',
                  )}
                >
                  {busy === info.key && <Loader2 className="h-3 w-3 animate-spin text-brand" />}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Turning a part off hides it and stops its work. Nothing it recorded is deleted: turn it back on and it carries on.
      </p>
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
    </div>
  )
}
