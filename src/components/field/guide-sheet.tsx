'use client'

import Link from 'next/link'
import { BookOpen, LifeBuoy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { askAlwaysLocation, nativePlatform, openBatterySettings } from '@/lib/native'
import { guideFor, STAFF_GUIDE_HREF, type GuideProblem } from '@/lib/field-guide'

/**
 * The pop-up that tells staff why something did not work and what to do
 * next (lib/field-guide.ts). Opens from the clock-in, store check-in and
 * check-out when a phone setting, the location or the server's answer is
 * in the way, and always points to the staff guide.
 */
export function GuideSheet({
  problem,
  task,
  onClose,
  onRetry,
  onPickStore,
}: {
  problem: GuideProblem | null
  /** What they were trying to do: "clock in", "check in at the store". */
  task?: string
  onClose: () => void
  onRetry?: () => void
  /** Opens the store picker (a marketer starting their day). */
  onPickStore?: () => void
}) {
  if (!problem) return null
  const guide = guideFor(problem, nativePlatform(), task)

  async function act() {
    if (guide.action === 'battery_settings') await openBatterySettings()
    else if (guide.action === 'always_location') await askAlwaysLocation()
    else if (guide.action === 'show_settings') {
      onClose()
      window.setTimeout(() => document.getElementById('clock')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      return
    } else if (guide.action === 'message_office') {
      onClose()
      window.location.href = '/field/messages'
      return
    } else if (guide.action === 'pick_store') {
      onClose()
      onPickStore?.()
      return
    } else if (guide.action === 'close') {
      onClose()
      return
    }
    onClose()
    onRetry?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-sheet-title"
    >
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="icon-tile">
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="guide-sheet-title" className="font-bold">
              {guide.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{guide.why}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-xl p-1 text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <ol className="space-y-2">
          {guide.steps.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-2xl bg-tint p-3 text-sm text-tint-foreground">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" onClick={() => void act()}>
            {guide.actionLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <Link
          href={STAFF_GUIDE_HREF}
          className="flex items-center justify-center gap-2 text-sm font-semibold text-brand"
          onClick={onClose}
        >
          <BookOpen className="h-4 w-4" /> Not sure? Read the staff guide
        </Link>
      </div>
    </div>
  )
}
