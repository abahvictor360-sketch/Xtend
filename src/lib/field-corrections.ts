/**
 * The office fixing someone's day (0090): the actions, what each is
 * called, and what the person is told. Pure, so
 * scripts/check-field-corrections.ts can test it.
 */

export const CORRECTION_ACTIONS = [
  'office_clock_in',
  'office_clock_out',
  'office_check_in',
  'office_check_out',
  'redo_clock_in',
  'redo_clock_out',
  'redo_check_in',
  'redo_check_out',
  'reset_clock_out',
] as const

export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number]

/** How each shows on the office's screen and in the history. */
export const CORRECTION_LABELS: Record<CorrectionAction, string> = {
  office_clock_in: 'Clocked in by the office',
  office_clock_out: 'Clocked out by the office',
  office_check_in: 'Checked in by the office',
  office_check_out: 'Checked out by the office',
  redo_clock_in: 'Asked to clock in again',
  redo_clock_out: 'Asked to clock out again',
  redo_check_in: 'Asked to check in again',
  redo_check_out: 'Asked to check out again',
  reset_clock_out: 'Clock-out undone: back on shift',
}

/** What the person is told: plain words, with the office's reason. */
export function correctionNotice(
  action: CorrectionAction,
  d: { by: string; store: string | null; time: string; reason: string },
): { title: string; body: string } {
  const at = d.store ? ` at ${d.store}` : ''
  const why = d.reason.trim()
  switch (action) {
    case 'office_clock_in':
      return { title: 'You were clocked in', body: `${d.by} clocked you in${at} at ${d.time}. ${why}` }
    case 'office_clock_out':
      return { title: 'You were clocked out', body: `${d.by} clocked you out${at} at ${d.time}. ${why}` }
    case 'office_check_in':
      return { title: 'You were checked in', body: `${d.by} checked you in${at}. ${why}` }
    case 'office_check_out':
      return { title: 'You were checked out', body: `${d.by} checked you out of the store. ${why}` }
    case 'redo_clock_in':
      return { title: 'Please clock in again', body: `${d.by} asked you to clock in again: ${why}` }
    case 'redo_clock_out':
      return { title: 'Please clock out again', body: `${d.by} asked you to clock out again: ${why}` }
    case 'redo_check_in':
      return { title: 'Please check in again', body: `${d.by} asked you to check in at the store again: ${why}` }
    case 'redo_check_out':
      return { title: 'Please check out again', body: `${d.by} asked you to check out of the store again: ${why}` }
    case 'reset_clock_out':
      return {
        title: 'You are back on shift',
        body: `${d.by} undid your clock-out: ${why} Clock out again at the end of your shift.`,
      }
  }
}

/** The words on Home for a request still to be done. */
export function redoBanner(action: string): string | null {
  if (action === 'redo_clock_in') return 'The office asked you to clock in again.'
  if (action === 'redo_clock_out') return 'The office asked you to clock out again.'
  return null
}

/** A person's day today, as Ask Xtend needs it to propose a correction. */
export interface CorrectionDay {
  name: string
  role: string
  active: boolean
  homeStoreId: string | null
  /** Their stores with a location: where the office can record them. */
  stores: { id: string; name: string }[]
  clockedIn: boolean
  clockedOut: boolean
  visits: { id: string; storeId: string | null; name: string; status: string }[]
}

export interface CorrectionAsk {
  action: CorrectionAction
  storeId: string | null
  /** "HH:MM" today, already in 24-hour form; null for now. */
  time: string | null
  reason: string
}

export interface CorrectionPlan {
  title: string
  lines: string[]
  warning: string | null
  payload: {
    user_id: string
    action: CorrectionAction
    reason: string
    outlet_id: string | null
    at: string | null
    visit_id: string | null
  }
}

/**
 * What Ask Xtend's card for fixing someone's day says and sends (0090),
 * with the same choices the Fix today's record panel offers. It throws
 * plain words when the request does not fit their day; the database
 * checks it all again when Apply is pressed.
 */
export function planCorrection(
  userId: string,
  day: CorrectionDay,
  ask: CorrectionAsk,
  today: string,
  nowHHMM: string,
): CorrectionPlan {
  const first = day.name.split(' ')[0]
  if (!day.active || (day.role !== 'merchandiser' && day.role !== 'marketer')) {
    throw new Error('Only an active merchandiser or marketer can have their day fixed.')
  }
  const reason = ask.reason.trim().slice(0, 500)
  if (reason.length < 3) throw new Error('Say why, in a few words (they see it).')

  const a = ask.action
  const needsStore = a === 'office_clock_in' || a === 'office_clock_out' || a === 'office_check_in'
  const isClock = a === 'office_clock_in' || a === 'office_clock_out'
  const openVisit = day.visits.find((v) => v.status === 'open') ?? null

  if (a === 'office_clock_out' && !day.clockedIn) throw new Error(`${first} has not clocked in today. Clock them in first.`)
  if (a === 'redo_clock_in' && !day.clockedIn) throw new Error(`${first} has not clocked in today, so there is nothing to redo. Clock them in instead.`)
  if (a === 'redo_clock_in' && day.clockedOut) throw new Error(`${first} has already clocked out. Clock them in again yourself instead.`)
  if (a === 'redo_clock_out' && !day.clockedOut) throw new Error(`${first} has not clocked out today, so there is nothing to redo.`)
  if (a === 'reset_clock_out' && !day.clockedOut) throw new Error(`${first} has not clocked out today, so there is nothing to undo.`)
  if (a === 'office_check_in' || a === 'office_check_out' || a === 'redo_check_in' || a === 'redo_check_out') {
    if (day.role !== 'marketer') throw new Error('Store check-ins are for marketers.')
  }
  if (a === 'office_check_in') {
    if (!day.clockedIn) throw new Error(`${first} has not clocked in today. Clock them in first.`)
    if (day.clockedOut) throw new Error(`${first} has clocked out for the day.`)
    if (openVisit) throw new Error(`${first} is still checked in at ${openVisit.name}. Check them out of it first.`)
  }
  if (a === 'office_check_out' && !openVisit) throw new Error(`${first} is not checked in at any store now.`)

  let store: { id: string; name: string } | null = null
  if (needsStore) {
    if (!day.stores.length) throw new Error(`${first} has no store with a location. Set one on Stores first.`)
    if (ask.storeId) {
      store = day.stores.find((s) => s.id === ask.storeId) ?? null
      if (!store) throw new Error(`That store is not one of ${first}'s stores. Theirs: ${day.stores.map((s) => s.name).join(', ')}.`)
    } else {
      store = day.stores.find((s) => s.id === day.homeStoreId) ?? (day.stores.length === 1 ? day.stores[0] : null)
      if (!store) throw new Error(`Say which store: ${day.stores.map((s) => s.name).join(', ')}.`)
    }
  }

  let at: string | null = null
  if (isClock && ask.time) {
    if (!/^\d{2}:\d{2}$/.test(ask.time)) throw new Error('Give the time like 08:05.')
    if (ask.time > nowHHMM) throw new Error('The time cannot be later than now.')
    // Lagos is UTC+1 all year.
    at = `${today}T${ask.time}:00+01:00`
  }

  let visit: CorrectionDay['visits'][number] | null = null
  if (a === 'redo_check_in' || a === 'redo_check_out') {
    const fits = day.visits.filter((v) => (a === 'redo_check_in' ? v.status !== 'abandoned' : v.status === 'closed'))
    const atStore = ask.storeId ? fits.filter((v) => v.storeId === ask.storeId) : fits
    if (!atStore.length) {
      throw new Error(
        a === 'redo_check_in'
          ? `${first} has no store check-in today${ask.storeId ? ' at that store' : ''} to redo.`
          : `${first} has no store check-out today${ask.storeId ? ' at that store' : ''} to redo.`,
      )
    }
    if (atStore.length > 1 && !ask.storeId && new Set(atStore.map((v) => v.storeId)).size > 1) {
      throw new Error(`Say which store visit: ${[...new Set(atStore.map((v) => v.name))].join(', ')}.`)
    }
    visit = atStore[atStore.length - 1]
  }
  if (a === 'office_check_out') visit = openVisit

  const where = store?.name ?? visit?.name ?? null
  const titles: Record<CorrectionAction, string> = {
    office_clock_in: day.clockedIn ? `Clock ${day.name} in again` : `Clock ${day.name} in`,
    office_clock_out: day.clockedOut ? `Clock ${day.name} out again` : `Clock ${day.name} out`,
    office_check_in: `Check ${day.name} in at ${where}`,
    office_check_out: `Check ${day.name} out of ${where}`,
    redo_clock_in: `Ask ${day.name} to clock in again`,
    redo_clock_out: `Ask ${day.name} to clock out again`,
    redo_check_in: `Ask ${day.name} to check in at ${where} again`,
    redo_check_out: `Ask ${day.name} to check out of ${where} again`,
    reset_clock_out: `Undo ${day.name}'s clock-out (back on shift)`,
  }
  const office = a.startsWith('office_')
  const replaces = (a === 'office_clock_in' && day.clockedIn) || (a === 'office_clock_out' && day.clockedOut)
  return {
    title: titles[a],
    lines: [
      ...(where ? [`Store: ${where}`] : []),
      ...(isClock ? [`Time: ${ask.time ?? 'now'}, today`] : []),
      `Why: ${reason}`,
      a === 'reset_clock_out'
        ? 'Their clock-out is taken off: they are on shift again, their location is followed again, and they clock out again at the end of the shift.'
        : office
          ? 'Recorded for them, marked By the office, with no selfie.'
          : 'Their Home shows the request; what they capture next replaces the old record.',
      'They get a notification with your reason. The old record is kept.',
    ],
    warning: replaces ? `This replaces the ${a === 'office_clock_in' ? 'clock-in' : 'clock-out'} they already have today.` : null,
    payload: {
      user_id: userId,
      action: a,
      reason,
      outlet_id: store?.id ?? null,
      at,
      visit_id: a === 'redo_check_in' || a === 'redo_check_out' ? (visit?.id ?? null) : null,
    },
  }
}

/**
 * Reads a command typed into Fix today's record ("clock her out at 5pm,
 * phone died", "undo the clock-out, tapped by mistake", "check in at Spar
 * Lekki", "ask him to check out again") into what planCorrection needs.
 * Plain rules, no AI: the office sees the result and confirms it, and the
 * database checks it all again. Throws plain words when it cannot tell.
 */
export function parseCorrectionCommand(
  text: string,
  stores: { id: string; name: string }[],
): CorrectionAsk {
  const raw = text.trim().replace(/\s+/g, ' ')
  if (raw.length < 3) throw new Error('Type what to do, for example: clock in at 8:05, phone would not open.')
  const t = ` ${raw.toLowerCase().replace(/[‐-―]/g, '-')} `

  // "clock in", "clock-in", and "clock Ada in" / "check him out" (one word
  // between, never "in" or "out" itself: "clocked out in the morning").
  const verb = (v: string, dir: 'in' | 'out') =>
    new RegExp(`\\b${v}(?:ed|ing)?(?:[\\s-]+|\\s+(?!(?:in|out)\\b)[a-z']+\\s+)${dir}\\b|\\b${v}${dir}\\b`).test(t)
  const clockIn = verb('clock', 'in')
  const clockOut = verb('clock', 'out')
  const checkIn = verb('check', 'in')
  const checkOut = verb('check', 'out')
  const undo = /\b(undo|reset|reverse|remove|cancel|take off|delete)\b|\bback on shift\b|\bby mistake\b|\bmistaken(ly)?\b/.test(t)
  const ask = /\b(ask|tell|request|redo|let (him|her|them)|make (him|her|them)|get (him|her|them))\b/.test(t)

  const kinds = [clockIn, clockOut, checkIn, checkOut].filter(Boolean).length
  let action: CorrectionAction
  if (clockOut && (undo || /\bback on shift\b/.test(t)) && !ask) action = 'reset_clock_out'
  else if (/\bback on shift\b/.test(t) && !kinds) action = 'reset_clock_out'
  else if (kinds === 0) throw new Error('Say clock in, clock out, check in or check out (or undo the clock-out).')
  else if (kinds > 1) throw new Error('One thing at a time: clock in, clock out, check in or check out.')
  else if (undo && !clockOut) throw new Error('Only a clock-out can be undone. To redo a clock-in, ask them to clock in again.')
  else if (clockIn) action = ask ? 'redo_clock_in' : 'office_clock_in'
  else if (clockOut) action = ask ? 'redo_clock_out' : 'office_clock_out'
  else if (checkIn) action = ask ? 'redo_check_in' : 'office_check_in'
  else action = ask ? 'redo_check_out' : 'office_check_out'

  // A time: "at 8", "8:05", "8.05am", "5pm", "17:30". Without am/pm, 1 to 6
  // is read as the afternoon (no shift starts at 3 in the morning).
  let time: string | null = null
  const m =
    t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/) ??
    t.match(/\b(\d{1,2})[:.](\d{2})\b/) ??
    t.match(/\bat (\d{1,2})\b(?![:.\d])/)
  if (m && (action === 'office_clock_in' || action === 'office_clock_out')) {
    let h = Number(m[1])
    const min = m[2] ? Number(m[2]) : 0
    const half = m[3]
    if (half === 'pm' && h < 12) h += 12
    if (half === 'am' && h === 12) h = 0
    if (!half && h >= 1 && h <= 6) h += 12
    if (h > 23 || min > 59) throw new Error('That time does not look right. Write it like 8:05 or 5pm.')
    time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }

  // A store: the longest store name, or its first word, found in the text.
  const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const ft = ` ${fold(raw)} `
  let storeId: string | null = null
  let best = 0
  for (const s of stores) {
    const name = fold(s.name)
    const words = name.split(' ').filter((w) => w.length >= 4 && !['store', 'shop', 'mall', 'supermarket', 'mart'].includes(w))
    const hit = ft.includes(` ${name} `) ? name.length + 100 : words.some((w) => ft.includes(` ${w} `)) ? Math.max(...words.map((w) => (ft.includes(` ${w} `) ? w.length : 0))) : 0
    if (hit > best) {
      best = hit
      storeId = s.id
    }
  }

  // The reason: what follows "because", "as", "since", a comma or a dash;
  // otherwise the whole command. They see it.
  const why = raw.match(/(?:\bbecause\b|\bsince\b|\breason:?|\bas\b(?= (?:her|his|their|the|she|he|they|phone|network|gps)\b)|[,;–—]| - )\s*(.{3,})$/i)?.[1]
  const reason = (why ?? raw).trim().replace(/^[,;:\s-]+/, '')
  return { action, storeId, time, reason: reason.charAt(0).toUpperCase() + reason.slice(1) }
}
