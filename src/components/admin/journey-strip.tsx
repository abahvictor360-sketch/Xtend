import type { Leg } from "@/lib/movement";
import { duration } from "@/lib/movement";
import { formatLagos, metres, weekdayShort, dayOfMonth } from "@/lib/utils";

/*
 * One day on one line: where the person stayed (at a store, or somewhere
 * else), when they were travelling, and when Xtend heard nothing. Shades of
 * the brand orange; silences are hatched grey. Every block says what it is
 * on hover.
 */

export const LEG_COLOUR = {
  store: "#d1511a",
  elsewhere: "#52281a",
  move: "#e8833a",
  gap: "#9a8f88",
  off: "#f6e4d8",
} as const;

const lagos = (date: string, hm: string) =>
  Date.parse(`${date}T${hm}:00+01:00`);

function legColour(l: Leg) {
  if (l.kind === "stop")
    return l.inStore ? LEG_COLOUR.store : LEG_COLOUR.elsewhere;
  return LEG_COLOUR[l.kind];
}

export function legTitle(l: Leg) {
  const span = `${formatLagos(l.from, false)}–${formatLagos(l.to, false)} (${duration(l.minutes)})`;
  if (l.kind === "stop")
    return `${l.inStore ? "At" : "Stayed at"} ${l.name}, ${span}`;
  if (l.kind === "move")
    return `Travelling ${metres(l.distanceM)}, ${span}${l.kmh ? `, about ${Math.round(l.kmh)} km/h` : ""}`;
  if (l.kind === "gap") return `Nothing heard, ${span}`;
  return `Clocked out, ${span}`;
}

export function JourneyStrip({ date, legs }: { date: string; legs: Leg[] }) {
  // The working day, widened to whatever happened outside it.
  const dayStart = lagos(date, "00:00");
  const dayEnd = dayStart + 24 * 3_600_000;
  const inDay = legs
    .map((l) => ({
      l,
      a: Math.max(Date.parse(l.from), dayStart),
      b: Math.min(Date.parse(l.to), dayEnd),
    }))
    .filter((x) => x.b > x.a || (x.b === x.a && x.l.kind === "stop"));
  const clip = (t: number) => Math.min(Math.max(t, start), end);
  // Time off after clocking out runs overnight; it should not stretch the day.
  const worked = inDay.filter((x) => x.l.kind !== "off");
  const start = Math.min(lagos(date, "06:00"), ...worked.map((x) => x.a));
  const end = Math.max(lagos(date, "20:00"), ...worked.map((x) => x.b));
  const span = end - start;
  const pct = (t: number) => ((t - start) / span) * 100;

  const ticks: number[] = [];
  for (
    let t = Math.ceil(start / 7_200_000) * 7_200_000;
    t <= end;
    t += 7_200_000
  )
    ticks.push(t);

  return (
    <div className="flex items-center gap-3">
      <div className="w-12 shrink-0 text-xs leading-tight">
        <p className="font-semibold">{weekdayShort(date)}</p>
        <p className="text-muted-foreground">{dayOfMonth(date)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-7 overflow-hidden rounded-md bg-[#f6e4d8]/60 dark:bg-white/5">
          {inDay.map(({ l, a: from, b: to }, i) => {
            const a = clip(from);
            const b = clip(to);
            if (b < a || (b === a && l.kind !== "stop")) return null;
            return (
              <span
                key={i}
                title={legTitle(l)}
                className="absolute inset-y-0"
                style={{
                  left: `${pct(a)}%`,
                  width: `max(${pct(b) - pct(a)}%, 3px)`,
                  background:
                    l.kind === "gap"
                      ? `repeating-linear-gradient(45deg, ${LEG_COLOUR.gap} 0 3px, transparent 3px 6px)`
                      : legColour(l),
                  opacity: l.kind === "off" ? 0.9 : 1,
                }}
              />
            );
          })}
        </div>
        <div className="relative mt-0.5 h-3.5 text-[10px] text-muted-foreground">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`absolute -translate-x-1/2 tabular-nums ${i % 2 ? "max-sm:hidden" : ""}`}
              style={{ left: `${pct(t)}%` }}
            >
              {formatLagos(new Date(t), false)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function JourneyKey() {
  const item = (colour: string, label: string, hatch = false) => (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-4 rounded-sm"
        style={{
          background: hatch
            ? `repeating-linear-gradient(45deg, ${colour} 0 2px, transparent 2px 4px)`
            : colour,
        }}
      />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item(LEG_COLOUR.store, "At a store")}
      {item(LEG_COLOUR.elsewhere, "Stayed somewhere else")}
      {item(LEG_COLOUR.move, "Travelling")}
      {item(LEG_COLOUR.gap, "Nothing heard", true)}
      {item(LEG_COLOUR.off, "Clocked out")}
    </div>
  );
}
