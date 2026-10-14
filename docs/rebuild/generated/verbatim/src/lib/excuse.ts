/**
 * Words a verdict on "my network was bad" or "my phone was off" from the
 * evidence check_excuse() gathers (migration 026). Shared by the Check an
 * excuse page and Ask Xtend, so both say the same thing.
 */
import { formatLagos, metres } from '@/lib/utils'

export type Claim = 'no_network' | 'phone_off' | 'gps_failed' | 'at_store' | 'app_failed'

export const CLAIMS: Record<Claim, string> = {
  no_network: 'My network was bad / no data',
  phone_off: 'My phone was off / battery died',
  gps_failed: 'My location / GPS would not work',
  at_store: 'I was at my store the whole time',
  app_failed: 'The app would not let me clock in',
}

export function isClaim(v: unknown): v is Claim {
  return typeof v === 'string' && v in CLAIMS
}

/** What else the phone and the app recorded (check_excuse_more, 048). */
export interface MoreEvidence {
  stores: { name: string; radius_m: number }[]
  positions: {
    at: string
    lat: number
    lng: number
    accuracy_m: number | null
    source: 'tracking' | 'offline' | 'app' | 'clock_in' | 'clock_out'
    store: string | null
    store_m: number | null
    radius_m: number | null
  }[]
  location_problems: { at: string; kind: string; distance_m: number | null }[]
  photos_refused: { at: string; kind: string; problem: string | null; message: string | null }[]
  queued: { most: number | null; oldest: string | null } | null
  clock: { at: string; type: string; status: string | null; distance_m: number | null }[]
  visits: { at: string; status: string | null }[]
}

/** A position good enough to place someone: inside the 100 m ceiling. */
const good = (p: MoreEvidence['positions'][number]) => p.accuracy_m != null && p.accuracy_m <= 100

/** Whether a position is at their store: inside its fence, give or take the fix's accuracy. */
export function atStore(p: MoreEvidence['positions'][number]) {
  if (p.store_m == null || p.radius_m == null) return null
  return p.store_m <= p.radius_m + Math.min(p.accuracy_m ?? 0, 100) + 25
}

const PROBLEM: Record<string, string> = {
  permission_denied: 'location permission was off',
  low_accuracy: 'the location was too rough',
  left_geofence: 'it left the store',
  off_site_clock: 'it clocked in away from the store',
}

interface Contact {
  at: string
  what: string
  battery_pct: number | null
  charging: boolean | null
  connection: string | null
  outbox_count: number | null
  lat: number | null
  lng: number | null
  clock_off_s: number | null
}

interface Reading {
  at: string
  battery_pct?: number | null
  charging?: boolean | null
  lat: number | null
  lng: number | null
}

export interface ExcuseEvidence {
  contacts: Contact[]
  offline_records: {
    what: string
    taken_at: string
    sent_at: string
    verdict: string | null
    lat: number
    lng: number
  }[]
  /** Heartbeat positions the phone kept while offline (migration 029). */
  offline_positions?: { at: string; received_at: string | null; lat: number; lng: number }[]
  before: Reading | null
  after: Reading | null
  place_before: Reading | null
  place_after: Reading | null
  phone_checks: {
    sent_at: string
    delivered_at: string | null
    opened_at: string | null
    devices: number
  }[]
  has_push: boolean
  ever_reported: boolean
}

export interface ExcuseVerdict {
  /** false: the evidence contradicts the claim; doubtful: it points against it. */
  verdict: 'false' | 'doubtful' | 'fits' | 'unknown'
  headline: string
  points: string[]
}

const WHAT: Record<string, string> = {
  app_open: 'opened Xtend',
  app_visible: 'came back to Xtend',
  app_hidden: 'left Xtend',
  app_online: 'got its network back',
  app_interval: 'had Xtend open',
  location: 'sent its location',
  clock_in: 'clocked in',
  clock_out: 'clocked out',
  store_visit: 'checked in at a store',
  push_delivered: 'received a check from a supervisor',
}

const time = (t: string) => formatLagos(t, false)

function distance(a: Reading | null, b: Reading | null) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

function describeContact(c: Contact) {
  const bits = [`${time(c.at)}: the phone ${WHAT[c.what] ?? c.what}`]
  const extra: string[] = []
  if (c.connection) extra.push(`on ${c.connection.toUpperCase()}`)
  if (c.battery_pct != null)
    extra.push(`battery ${c.battery_pct}%${c.charging ? ', charging' : ''}`)
  if (extra.length) bits.push(`(${extra.join(', ')})`)
  return bits.join(' ')
}

/** "HH:MM" on a Lagos date, as an instant. Lagos is UTC+1 all year. */
export function lagosInstant(date: string, hm: string) {
  return new Date(`${date}T${hm}:00+01:00`).toISOString()
}

export function judgeExcuse(e: ExcuseEvidence, claim: Claim, more?: MoreEvidence): ExcuseVerdict {
  if (more && (claim === 'gps_failed' || claim === 'at_store' || claim === 'app_failed')) {
    return judgeMore(e, claim, more)
  }
  const points: string[] = []
  const heard = e.contacts
  const offline = e.offline_records
  const faked = offline.filter((r) => r.verdict === 'backdated')
  const clockOff = heard.filter((c) => c.clock_off_s != null && Math.abs(c.clock_off_s) > 300)

  if (heard.length) {
    points.push(
      `Xtend heard from the phone ${heard.length} time${heard.length === 1 ? '' : 's'} in this window:`,
      ...heard.slice(0, 8).map(describeContact),
    )
    if (heard.length > 8) points.push(`…and ${heard.length - 8} more.`)
  }
  for (const r of offline) {
    points.push(
      `A ${r.what === 'clock_in' ? 'clock-in' : 'clock-out'} was taken at ${time(r.taken_at)} without network and reached Xtend at ${time(r.sent_at)}` +
        (r.verdict === 'backdated' ? ', but its time was faked on the phone.' : '.'),
    )
  }
  const kept = e.offline_positions ?? []
  if (kept.length) {
    points.push(
      `The phone recorded ${kept.length} position${kept.length === 1 ? '' : 's'} without network, from ${time(kept[0].at)} to ${time(kept[kept.length - 1].at)}` +
        (kept[0].received_at
          ? `, sent when it reconnected at ${time(kept[kept.length - 1].received_at!)}.`
          : '.'),
    )
  }
  if (clockOff.length) {
    const worst = Math.max(...clockOff.map((c) => Math.abs(c.clock_off_s ?? 0)))
    points.push(
      `The phone's clock was about ${Math.round(worst / 60)} minutes wrong: someone changed it.`,
    )
  }

  const moved = distance(e.place_before, e.place_after)
  if (moved != null && moved > 500 && e.place_before && e.place_after) {
    points.push(
      `It was last located at ${time(e.place_before.at)} and next at ${time(e.place_after.at)}, ${metres(moved)} apart.`,
    )
  }
  if (e.before?.battery_pct != null) {
    points.push(
      `Battery before: ${e.before.battery_pct}% at ${time(e.before.at)}${e.before.charging ? ' (charging)' : ''}.`,
    )
  }
  if (e.after?.battery_pct != null) {
    points.push(
      `Battery after: ${e.after.battery_pct}% at ${time(e.after.at)}${e.after.charging ? ' (charging)' : ''}.`,
    )
  }
  for (const c of e.phone_checks) {
    points.push(
      c.delivered_at
        ? `A phone check sent at ${time(c.sent_at)} reached the phone at ${time(c.delivered_at)}${c.opened_at ? ` and was opened at ${time(c.opened_at)}` : ', but was not opened'}.`
        : `A phone check sent at ${time(c.sent_at)} ${c.devices ? 'never reached the phone' : 'could not be sent: notifications are off on that phone'}.`,
    )
  }

  // Anything that reached Xtend needed network to get there.
  const online = heard
  if (faked.length) {
    return {
      verdict: 'false',
      headline: 'Not true: the time on the phone was changed to make a clock-in look earlier.',
      points,
    }
  }

  if (claim === 'no_network') {
    if (online.length) {
      return {
        verdict: 'false',
        headline: `Not true: the phone had network. It reached Xtend at ${online
          .slice(0, 3)
          .map((c) => time(c.at))
          .join(', ')}${online.length > 3 ? ' and more' : ''}.`,
        points,
      }
    }
    if (offline.length || kept.length) {
      return {
        verdict: 'fits',
        headline: 'It fits: the phone was on but had no network, and saved its work to send later.',
        points,
      }
    }
    return noTrace(
      e,
      points,
      'That fits no network, but equally the app being closed or the phone off.',
    )
  }

  // phone_off
  if (heard.length || offline.length || kept.length) {
    return {
      verdict: 'false',
      headline: `Not true: the phone was on. ${
        heard.length
          ? `Xtend heard from it at ${time(heard[0].at)}`
          : offline.length
            ? `It recorded a clock event at ${time(offline[0].taken_at)}`
            : `It recorded its position at ${time(kept[0].at)}, offline`
      }${heard.length > 1 ? ` and ${heard.length - 1} more time${heard.length === 2 ? '' : 's'}` : ''}.`,
      points,
    }
  }
  const before = e.before?.battery_pct
  const after = e.after?.battery_pct
  if (before != null && before <= 10) {
    return {
      verdict: 'fits',
      headline: `It fits: the battery was down to ${before}% at ${time(e.before!.at)}.`,
      points,
    }
  }
  if (
    before != null &&
    before >= 25 &&
    after != null &&
    !e.after?.charging &&
    after >= before - 15
  ) {
    return {
      verdict: 'doubtful',
      headline: `Doubtful: the battery did not run flat (${before}% before, ${after}% after, not charging). If the phone was off, it was switched off.`,
      points,
    }
  }
  return noTrace(e, points, 'Xtend cannot tell whether it was off or only had the app closed.')
}

function noTrace(e: ExcuseEvidence, points: string[], tail: string): ExcuseVerdict {
  if (!e.ever_reported) {
    points.push(
      'This phone has not reported to Xtend yet. It will once the person opens the updated app.',
    )
  }
  if (!e.has_push) {
    points.push(
      'Notifications are off on this phone, so it cannot be checked live. Ask them to turn them on.',
    )
  }
  return {
    verdict: 'unknown',
    headline: `Xtend heard nothing from the phone in this time. ${tail}`,
    points,
  }
}

/* ------------------------------------------------------------------ */
/* The excuses that need positions and what the app recorded (048)     */
/* ------------------------------------------------------------------ */

function judgeMore(e: ExcuseEvidence, claim: 'gps_failed' | 'at_store' | 'app_failed', m: MoreEvidence): ExcuseVerdict {
  const points: string[] = []
  const fixes = m.positions.filter(good)
  const best = fixes.length ? Math.min(...fixes.map((p) => p.accuracy_m ?? 999)) : null

  for (const prob of m.location_problems) {
    points.push(`${time(prob.at)}: the phone reported that ${PROBLEM[prob.kind] ?? prob.kind}.`)
  }
  for (const ph of m.photos_refused) {
    points.push(`${time(ph.at)}: a ${ph.kind === 'selfie' ? 'selfie' : 'photo'} was refused${ph.message ? ` (${ph.message})` : ''}.`)
  }
  if (m.queued?.most) {
    points.push(
      `The phone had ${m.queued.most} thing${m.queued.most === 1 ? '' : 's'} waiting to send${m.queued.oldest ? `, the oldest from ${time(m.queued.oldest)}` : ''}.`,
    )
  }
  if (m.positions.length) {
    points.push(
      `The phone gave ${m.positions.length} position${m.positions.length === 1 ? '' : 's'}, ${fixes.length} accurate to 100 m or better${best != null ? ` (best ${Math.round(best)} m)` : ''}.`,
    )
  }
  for (const c of m.clock) {
    points.push(`${time(c.at)}: ${c.type === 'opening' ? 'clocked in' : 'clocked out'}${c.status ? ` (${c.status.replace('_', ' ')})` : ''}.`)
  }
  if (e.contacts.length) points.push(`Xtend heard from the phone ${e.contacts.length} time${e.contacts.length === 1 ? '' : 's'}.`)

  if (claim === 'gps_failed') {
    const blocked = m.location_problems.filter((p) => p.kind === 'permission_denied' || p.kind === 'low_accuracy')
    if (fixes.length) {
      const first = fixes[0]
      return {
        verdict: blocked.length ? 'doubtful' : 'false',
        headline: blocked.length
          ? `Doubtful: the location failed at ${time(blocked[0].at)}, but the phone also gave ${fixes.length} accurate position${fixes.length === 1 ? '' : 's'}, the first at ${time(first.at)}.`
          : `Not true: the phone gave ${fixes.length} accurate position${fixes.length === 1 ? '' : 's'} (best ${Math.round(best!)} m), the first at ${time(first.at)}.`,
        points,
      }
    }
    if (blocked.length) {
      return {
        verdict: 'fits',
        headline: `It fits: the phone reported its location failing at ${blocked
          .slice(0, 3)
          .map((b) => time(b.at))
          .join(', ')}${blocked.length > 3 ? ' and more' : ''}.`,
        points,
      }
    }
    if (m.positions.length) {
      return {
        verdict: 'fits',
        headline: `It fits: every position the phone gave was rougher than 100 m (best ${Math.round(Math.min(...m.positions.map((p) => p.accuracy_m ?? 9999)))} m).`,
        points,
      }
    }
    return noTrace(e, points, e.contacts.length ? 'The app was open but no location was asked for or given.' : 'The app may simply not have been opened.')
  }

  if (claim === 'at_store') {
    if (!m.stores.length) {
      return {
        verdict: 'unknown',
        headline: 'Xtend cannot tell: none of their stores has a location yet.',
        points,
      }
    }
    const placed = fixes.filter((p) => atStore(p) !== null)
    if (!placed.length) {
      return noTrace(e, points, 'There is no accurate position in this time to place them.')
    }
    const away = placed.filter((p) => atStore(p) === false)
    const at = placed.length - away.length
    if (!away.length) {
      return {
        verdict: 'fits',
        headline: `It fits: all ${placed.length} accurate position${placed.length === 1 ? '' : 's'} were at ${placed[0].store}.`,
        points,
      }
    }
    const far = away.reduce((a, b) => ((b.store_m ?? 0) > (a.store_m ?? 0) ? b : a))
    points.unshift(
      ...away.slice(0, 6).map((p) => `${time(p.at)}: ${metres(p.store_m ?? 0)} from ${p.store} (accurate to ${Math.round(p.accuracy_m ?? 0)} m).`),
    )
    return {
      verdict: (far.store_m ?? 0) > (far.radius_m ?? 0) + 300 ? 'false' : 'doubtful',
      headline: `${(far.store_m ?? 0) > (far.radius_m ?? 0) + 300 ? 'Not true' : 'Doubtful'}: ${away.length} of ${placed.length} accurate positions were away from the store, up to ${metres(far.store_m ?? 0)} from ${far.store} at ${time(far.at)}.${at ? ` ${at} were at the store.` : ''}`,
      points,
    }
  }

  // app_failed: "the app would not let me clock in"
  const clockedIn = m.clock.filter((c) => c.type === 'opening')
  if (clockedIn.length) {
    return {
      verdict: 'false',
      headline: `Not true: a clock-in went through at ${time(clockedIn[0].at)}.`,
      points,
    }
  }
  const reasons: string[] = []
  if (m.location_problems.some((p) => p.kind === 'permission_denied')) reasons.push('location permission was off')
  if (m.location_problems.some((p) => p.kind === 'low_accuracy')) reasons.push('the location was too rough')
  if (m.photos_refused.length) reasons.push(`the selfie was refused ${m.photos_refused.length === 1 ? 'once' : `${m.photos_refused.length} times`}`)
  if (m.queued?.most) reasons.push('work was waiting on the phone without network')
  if (reasons.length) {
    return {
      verdict: 'fits',
      headline: `It fits: they tried, and the app stopped them because ${reasons.join(', ')}.`,
      points,
    }
  }
  if (e.contacts.length) {
    return {
      verdict: 'doubtful',
      headline: `Doubtful: the app was open with network at ${time(e.contacts[0].at)}, and nothing stopped a clock-in: no location problem, no refused photo, nothing waiting.`,
      points,
    }
  }
  return noTrace(e, points, 'There is no sign they opened the app to try.')
}
