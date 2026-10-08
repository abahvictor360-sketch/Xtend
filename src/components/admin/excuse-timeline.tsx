import { atStore, type ExcuseEvidence, type MoreEvidence } from '@/lib/excuse'
import { formatLagos, metres } from '@/lib/utils'

/*
 * The window on one line, so the gaps and the evidence can be seen at a
 * glance: when Xtend heard from the phone, what it kept offline, where it
 * was (at the store or away), what went wrong, and the battery. Shades of
 * the brand orange; each kind also has its own shape, and every mark says
 * what it is on hover.
 */

const HEARD = '#d1511a'
const OFFLINE = '#e8833a'
const AT_STORE = '#9b3517'
const AWAY = '#52281a'
const ROUGH = '#f2b48a'

const ROWS = ['Phone heard', 'Kept offline', 'Location', 'Problems', 'Battery'] as const

function when(t: string) {
  return formatLagos(t, true)
}

export function ExcuseTimeline({
  from,
  to,
  evidence: e,
  more: m,
}: {
  from: string
  to: string
  evidence: ExcuseEvidence
  more: MoreEvidence | null
}) {
  const start = Date.parse(from)
  const end = Date.parse(to)
  const span = Math.max(1, end - start)
  const x = (t: string) => Math.min(100, Math.max(0, ((Date.parse(t) - start) / span) * 100))

  // Silences over 30 minutes between anything heard from the phone.
  const heardTimes = e.contacts.map((c) => Date.parse(c.at)).sort((a, b) => a - b)
  const edges = [start, ...heardTimes, end]
  const gaps: { from: number; to: number }[] = []
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] > 30 * 60_000) gaps.push({ from: edges[i - 1], to: edges[i] })
  }

  // Hour ticks; every few hours across several days.
  const hours = span / 3_600_000
  const stepH = hours <= 6 ? 1 : hours <= 14 ? 2 : hours <= 30 ? 4 : 12
  const ticks: number[] = []
  const first = new Date(start)
  first.setUTCMinutes(0, 0, 0)
  for (let t = first.getTime(); t <= end; t += stepH * 3_600_000) if (t >= start) ticks.push(t)

  const battery = [
    ...(e.before?.battery_pct != null ? [{ at: e.before.at, pct: e.before.battery_pct }] : []),
    ...e.contacts.filter((c) => c.battery_pct != null).map((c) => ({ at: c.at, pct: c.battery_pct! })),
    ...(e.after?.battery_pct != null ? [{ at: e.after.at, pct: e.after.battery_pct }] : []),
  ].filter((b) => Date.parse(b.at) >= start - 12 * 3_600_000)

  const positions = m?.positions ?? []
  const problems = [
    ...(m?.location_problems ?? []).map((p) => ({ at: p.at, label: `Location problem: ${p.kind.replace('_', ' ')}` })),
    ...(m?.photos_refused ?? []).map((p) => ({ at: p.at, label: `Photo refused${p.message ? `: ${p.message}` : ''}` })),
  ]
  const offline = [
    ...e.offline_records.map((r) => ({ at: r.taken_at, label: `${r.what === 'clock_in' ? 'Clock-in' : 'Clock-out'} taken offline, sent ${when(r.sent_at)}` })),
    ...(e.offline_positions ?? []).map((p) => ({ at: p.at, label: 'Position kept offline' })),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Key shape="dot" colour={HEARD} label="Phone heard (had network)" />
        <Key shape="ring" colour={OFFLINE} label="Kept offline" />
        <Key shape="square" colour={AT_STORE} label="At their store" />
        <Key shape="diamond" colour={AWAY} label="Away from store" />
        <Key shape="square" colour={ROUGH} label="Rough position" />
        <Key shape="cross" colour={AWAY} label="Problem" />
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,#efe6e1_0_3px,transparent_3px_6px)] ring-1 ring-border" />
          Silent over 30 min
        </span>
      </div>

      <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 text-xs">
        {ROWS.map((row) => (
          <div key={row} className="contents">
            <span className={`flex items-center text-muted-foreground ${row === 'Battery' ? 'h-16' : 'h-9'}`}>{row}</span>
            <div className={`relative border-b border-dashed border-border ${row === 'Battery' ? 'my-1 h-14' : 'h-9'}`}>
              {row === 'Phone heard' && (
                <>
                  {gaps.map((g) => (
                    <span
                      key={g.from}
                      className="absolute inset-y-1 rounded bg-[repeating-linear-gradient(135deg,#efe6e1_0_3px,transparent_3px_6px)]"
                      style={{ left: `${((g.from - start) / span) * 100}%`, width: `${((g.to - g.from) / span) * 100}%` }}
                      title={`Nothing heard from ${formatLagos(new Date(g.from), true)} to ${formatLagos(new Date(g.to), true)}`}
                    />
                  ))}
                  {e.contacts.map((c, i) => (
                    <Mark key={i} left={x(c.at)} shape="dot" colour={HEARD} title={`${when(c.at)}: ${c.what.replace('app_', 'app ').replace('_', ' ')}${c.connection ? `, ${c.connection.toUpperCase()}` : ''}${c.battery_pct != null ? `, battery ${c.battery_pct}%` : ''}`} />
                  ))}
                </>
              )}
              {row === 'Kept offline' &&
                offline.map((o, i) => <Mark key={i} left={x(o.at)} shape="ring" colour={OFFLINE} title={`${when(o.at)}: ${o.label}`} />)}
              {row === 'Location' &&
                positions.map((p, i) => {
                  const rough = !(p.accuracy_m != null && p.accuracy_m <= 100)
                  const here = atStore(p)
                  const colour = rough ? ROUGH : here === false ? AWAY : AT_STORE
                  return (
                    <Mark
                      key={i}
                      left={x(p.at)}
                      shape={!rough && here === false ? 'diamond' : 'square'}
                      colour={colour}
                      title={`${when(p.at)}: ${p.source.replace('_', ' ')}, accurate to ${p.accuracy_m != null ? `${Math.round(p.accuracy_m)} m` : 'unknown'}${p.store ? `, ${metres(p.store_m ?? 0)} from ${p.store}${here === true ? ' (at the store)' : here === false ? ' (away)' : ''}` : ''}`}
                    />
                  )
                })}
              {row === 'Problems' &&
                problems.map((p, i) => <Mark key={i} left={x(p.at)} shape="cross" colour={AWAY} title={`${when(p.at)}: ${p.label}`} />)}
              {row === 'Battery' && <BatteryLine points={battery} x={x} />}
            </div>
          </div>
        ))}
        <span />
        <div className="relative h-5">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground" style={{ left: `${((t - start) / span) * 100}%` }}>
              {hours > 24 ? formatLagos(new Date(t), true).replace(/:00$/, '') : formatLagos(new Date(t), false)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Mark({ left, shape, colour, title }: { left: number; shape: 'dot' | 'ring' | 'square' | 'diamond' | 'cross'; colour: string; title: string }) {
  return (
    <span className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5" style={{ left: `${left}%` }} title={title}>
      <Shape shape={shape} colour={colour} />
    </span>
  )
}

function Shape({ shape, colour }: { shape: 'dot' | 'ring' | 'square' | 'diamond' | 'cross'; colour: string }) {
  if (shape === 'cross') {
    return (
      <span className="relative block h-3 w-3" aria-hidden>
        <span className="absolute left-1/2 top-0 h-3 w-[3px] -translate-x-1/2 rotate-45 rounded" style={{ background: colour }} />
        <span className="absolute left-1/2 top-0 h-3 w-[3px] -translate-x-1/2 -rotate-45 rounded" style={{ background: colour }} />
      </span>
    )
  }
  if (shape === 'diamond') {
    return <span aria-hidden className="block h-2.5 w-2.5 rotate-45 rounded-[2px] ring-2 ring-white" style={{ background: colour }} />
  }
  return (
    <span
      aria-hidden
      className={shape === 'square' ? 'block h-2.5 w-2.5 rounded-[3px] ring-2 ring-white' : 'block h-3 w-3 rounded-full ring-2 ring-white'}
      style={shape === 'ring' ? { border: `2.5px solid ${colour}`, background: 'white' } : { background: colour }}
    />
  )
}

function Key({ shape, colour, label }: { shape: 'dot' | 'ring' | 'square' | 'diamond' | 'cross'; colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Shape shape={shape} colour={colour} />
      {label}
    </span>
  )
}

function BatteryLine({ points, x }: { points: { at: string; pct: number }[]; x: (t: string) => number }) {
  if (!points.length) return <span className="absolute inset-0 flex items-center text-muted-foreground">No battery readings</span>
  const pts = points.map((p) => `${x(p.at)},${100 - p.pct}`).join(' ')
  const last = points[points.length - 1]
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <polyline points={pts} fill="none" stroke={HEARD} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {points.map((p, i) => (
        <span
          key={i}
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
          style={{ left: `${x(p.at)}%`, top: `${100 - p.pct}%`, background: HEARD }}
          title={`${formatLagos(p.at, true)}: battery ${p.pct}%`}
        />
      ))}
      <span className="absolute right-0 top-0 text-[10px] font-semibold text-muted-foreground">{last.pct}%</span>
    </>
  )
}
