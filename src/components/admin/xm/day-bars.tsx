/** Units sold per day across a month, as plain bars. */
export function DayBars({ month, byDay }: { month: string; byDay: Map<string, number> }) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const keys = Array.from({ length: days }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)
  const max = Math.max(1, ...keys.map((k) => byDay.get(k) ?? 0))
  return (
    <div className="flex h-28 items-end gap-[2px]" role="img" aria-label="Units sold per day">
      {keys.map((k, i) => {
        const v = byDay.get(k) ?? 0
        return (
          <div key={k} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${k}: ${v}`}>
            <div className="w-full rounded-t bg-brand/80" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
            <span className="text-[9px] text-muted-foreground">{(i + 1) % 5 === 1 ? i + 1 : ''}</span>
          </div>
        )
      })}
    </div>
  )
}
