import type { XmSettings } from '@/lib/metrics/shared'
import { windowLabel } from '@/lib/metrics/shared'
import { xmFeaturesFrom, xmOn } from '@/lib/metrics/features'

export interface XmPolicy {
  id: string
  title: string
  body: string
  change_note: string | null
  published_at: string
}

/**
 * The policy as written: blank lines separate blocks, lines starting with
 * "- " are bullet points, and a short line before bullets is their heading.
 * Plain text in, plain elements out: nothing typed is treated as HTML.
 */
export function PolicyText({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => l.trim()))
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((lines, i) => {
        const bullets = lines.filter((l) => /^[-•*]\s+/.test(l))
        const head = lines[0] && !/^[-•*]\s+/.test(lines[0]) && bullets.length === lines.length - 1 && bullets.length > 0 ? lines[0] : null
        if (bullets.length && (bullets.length === lines.length || head)) {
          return (
            <div key={i}>
              {head && <p className="font-semibold">{head}</p>}
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {bullets.map((b, j) => (
                  <li key={j}>{b.replace(/^[-•*]\s+/, '')}</li>
                ))}
              </ul>
            </div>
          )
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {lines.join('\n')}
          </p>
        )
      })}
    </div>
  )
}

/** The scoring rules as currently set, in numbers. */
export function ScoringSummary({ settings }: { settings: XmSettings }) {
  // Parts switched off (0063) do not count towards the score.
  const f = xmFeaturesFrom(settings as unknown as Record<string, unknown>)
  const on = { sales: xmOn(f, 'sales'), accuracy: xmOn(f, 'reconcile'), expiry: xmOn(f, 'expiry') }
  const rows = (
    [
      ['Sales against target', settings.weight_sales, on.sales],
      ['Stock accuracy', settings.weight_accuracy, on.accuracy],
      ['Reporting consistency', settings.weight_consistency, true],
      ['Expiry handling', settings.weight_expiry, on.expiry],
    ] as const
  ).filter(([, , shown]) => shown)
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-1.5">
        {rows.map(([label, weight]) => (
          <li key={label} className="flex items-center gap-3">
            <span className="w-44 shrink-0">{label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-tint">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${weight}%` }} />
            </span>
            <span className="w-10 text-right font-semibold">{weight}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        Bands: Poor 0–{settings.band_poor_below - 1} · Average {settings.band_poor_below}–{settings.band_strong_from - 1} ·
        Strong {settings.band_strong_from}–100.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {on.accuracy && <li>A count within {settings.tolerance_pct}% of the expected stock is accurate.</li>}
        {on.sales && (
          <li>Sales are on time if taken before {settings.sales_grace_hours ? `${settings.sales_grace_hours} hours after ` : ''}the end of the day.</li>
        )}
        <li>A stock count is due at least every {settings.count_interval_days} day{settings.count_interval_days === 1 ? '' : 's'}.</li>
        {on.expiry && (
          <li>
            Expiry alerts at {settings.alert_windows_days.map(windowLabel).join(', ')} before a batch expires.
          </li>
        )}
      </ul>
    </div>
  )
}
