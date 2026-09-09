import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * The Xpel X, redrawn as two bowed strokes so it stays legible at 20px where
 * the full lockup turns to mush. `tone="brand"` keeps the terracotta-to-gold
 * gradient of the printed logo; `tone="light"` is the flat white version for
 * use on the brand block.
 */
export function XpelMark({
  className,
  tone = 'brand',
}: {
  className?: string
  tone?: 'brand' | 'light'
}) {
  const id = tone === 'brand' ? 'xpel-gradient' : 'xpel-light'

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Xpel Beauty" className={cn('h-6 w-6', className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          {tone === 'brand' ? (
            <>
              <stop offset="0%" stopColor="#C1572A" />
              <stop offset="100%" stopColor="#C49420" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#ffffff" />
            </>
          )}
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="15.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 9 Q40 52 83 91" />
        <path d="M13 93 Q42 55 86 10" />
      </g>
    </svg>
  )
}

/** The app icon: the mark on the white tile, as it appears on a home screen. */
export function XpelTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-soft',
        className,
      )}
    >
      <XpelMark className="h-8 w-8" />
    </span>
  )
}

/** The full printed lockup. Only where there is room for it to be read. */
export function XpelLockup({ className, width = 168 }: { className?: string; width?: number }) {
  return (
    <Image
      src="/brand/xpel-logo.png"
      alt="Xpel Beauty NG"
      width={width}
      height={Math.round((width * 585) / 900)}
      priority={false}
      className={cn('h-auto', className)}
    />
  )
}
