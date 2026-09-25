/**
 * Words a verdict on "my network was bad" or "my phone was off" from the
 * evidence check_excuse() gathers (migration 026). Shared by the Check an
 * excuse page and Ask Xtend, so both say the same thing.
 */
import { formatLagos, metres } from '@/lib/utils'

export type Claim = 'no_network' | 'phone_off'

export const CLAIMS: Record<Claim, string> = {
  no_network: 'My network was bad / no data',
  phone_off: 'My phone was off / battery died',
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
  before: Reading | null
  after: Reading | null
  place_before: Reading | null
  place_after: Reading | null
  phone_checks: { sent_at: string; delivered_at: string | null; opened_at: string | null; devices: number }[]
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
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

function describeContact(c: Contact) {
  const bits = [`${time(c.at)}: the phone ${WHAT[c.what] ?? c.what}`]
  const extra: string[] = []
  if (c.connection) extra.push(`on ${c.connection.toUpperCase()}`)
  if (c.battery_pct != null) extra.push(`battery ${c.battery_pct}%${c.charging ? ', charging' : ''}`)
  if (extra.length) bits.push(`(${extra.join(', ')})`)
  return bits.join(' ')
}

/** "HH:MM" on a Lagos date, as an instant. Lagos is UTC+1 all year. */
export function lagosInstant(date: string, hm: string) {
  return new Date(`${date}T${hm}:00+01:00`).toISOString()
}

export function judgeExcuse(e: ExcuseEvidence, claim: Claim): ExcuseVerdict {
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
  if (clockOff.length) {
    const worst = Math.max(...clockOff.map((c) => Math.abs(c.clock_off_s ?? 0)))
    points.push(`The phone's clock was about ${Math.round(worst / 60)} minutes wrong: someone changed it.`)
  }

  const moved = distance(e.place_before, e.place_after)
  if (moved != null && moved > 500 && e.place_before && e.place_after) {
    points.push(
      `It was last located at ${time(e.place_before.at)} and next at ${time(e.place_after.at)}, ${metres(moved)} apart.`,
    )
  }
  if (e.before?.battery_pct != null) {
    points.push(`Battery before: ${e.before.battery_pct}% at ${time(e.before.at)}${e.before.charging ? ' (charging)' : ''}.`)
  }
  if (e.after?.battery_pct != null) {
    points.push(`Battery after: ${e.after.battery_pct}% at ${time(e.after.at)}${e.after.charging ? ' (charging)' : ''}.`)
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
    if (offline.length) {
      return {
        verdict: 'fits',
        headline: 'It fits: the phone was on but had no network, and saved its work to send later.',
        points,
      }
    }
    return noTrace(e, points, 'That fits no network, but equally the app being closed or the phone off.')
  }

  // phone_off
  if (heard.length || offline.length) {
    return {
      verdict: 'false',
      headline: `Not true: the phone was on. ${
        heard.length ? `Xtend heard from it at ${time(heard[0].at)}` : `It recorded a clock event at ${time(offline[0].taken_at)}`
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
  if (before != null && before >= 25 && after != null && !e.after?.charging && after >= before - 15) {
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
    points.push('This phone has not reported to Xtend yet. It will once the person opens the updated app.')
  }
  if (!e.has_push) {
    points.push('Notifications are off on this phone, so it cannot be checked live. Ask them to turn them on.')
  }
  return { verdict: 'unknown', headline: `Xtend heard nothing from the phone in this time. ${tail}`, points }
}
