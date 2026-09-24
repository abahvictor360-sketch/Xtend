import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceDetail, Profile } from '@/lib/types'
import { FIELD_ROLES } from '@/lib/auth'
import { addDays, formatLagos, lagosDateString, longDate } from '@/lib/utils'

/**
 * "Ask Xtend": an admin or supervisor types a question ("who hasn't clocked
 * in?", "when did Tunde clock out yesterday?") and Claude answers it by
 * calling the read-only tools below.
 *
 * Every tool queries through the caller's own Supabase client, so RLS decides
 * what the model can see: a supervisor's assistant only ever knows about that
 * supervisor's people. Nothing here writes.
 */

const MODEL = 'claude-opus-5'
const MAX_TOOL_ROUNDS = 6
const MAX_RANGE_DAYS = 62

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function assistantConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM = `You are Xtend's attendance assistant for Xpel Beauty. Office staff (admins and supervisors) ask you about field staff attendance: who clocked in, who clocked out, who has not clocked in or out, who was late, who clocked in away from their store, and a person's history.

Answer only from what the tools return. Never guess a time, a name or a count; if the tools return nothing, say so. Call a tool for every question about attendance, even one you think you answered earlier, because the data changes through the day.

How attendance works:
- A "clock in" is an opening record; a "clock out" is a closing record. Each has a time, a location and a status: on_site (inside the store's radius), off_site (outside it) or flagged.
- Late means the clock in was after the store's shift start.
- A person is "not clocked in" when they have no opening record that day, and "still on shift" when they clocked in but have not clocked out.
- All times and dates are Africa/Lagos.

Resolve relative dates ("today", "yesterday", "last Monday", "this week") against today's date, given below, and pass them as YYYY-MM-DD.

Write for someone reading on a phone: lead with the direct answer and the count, then a short list of names (with store and time where useful). Use plain text with simple "- " bullets. No tables, no headings, no markdown bold.`

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'attendance_on_day',
    description:
      'Everyone the caller can see on one day, split into: clocked in and out, still on shift (in but not out), and not clocked in. Each person has their role, store, clock-in and clock-out times, status, whether they were late, and where they clocked in. Use this for any "who has / hasn\'t clocked in or out" question.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: ['string', 'null'],
          description: 'YYYY-MM-DD in Africa/Lagos. Null for today.',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'staff_history',
    description:
      "One or more people's clock-ins and clock-outs, day by day, over a date range. Matches staff by part of their name. Use for questions about a named person.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial staff name, e.g. "Ngozi".' },
        from: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for 7 days ago.' },
        to: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for today.' },
      },
      required: ['name', 'from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'attendance_summary',
    description: `Per-person totals over a date range (at most ${MAX_RANGE_DAYS} days): days clocked in, days clocked out, days clocked in but never out, late days and off-site clock-ins. Use for "who was late most this week", "who missed clock-outs this month" and similar.`,
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
]

type Roster = Pick<Profile, 'id' | 'full_name' | 'role'> & { outlet_name: string | null }

const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkDate(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new Error(`"${String(value)}" is not a YYYY-MM-DD date`)
  }
  return value
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

async function fetchRoster(supabase: SupabaseClient): Promise<Roster[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, outlets(name)')
    .eq('is_active', true)
    .in('role', FIELD_ROLES)
    .order('full_name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const outlet = (row as { outlets: { name: string } | { name: string }[] | null }).outlets
    const name = Array.isArray(outlet) ? outlet[0]?.name : outlet?.name
    return { id: row.id, full_name: row.full_name, role: row.role, outlet_name: name ?? null }
  })
}

async function fetchRecords(
  supabase: SupabaseClient,
  from: string,
  to: string,
  userIds?: string[],
): Promise<AttendanceDetail[]> {
  let query = supabase
    .from('attendance_detail')
    .select('*')
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (userIds) query = query.in('user_id', userIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AttendanceDetail[]
}

function describeClock(record: AttendanceDetail | undefined) {
  if (!record) return null
  return {
    time: formatLagos(record.created_at, false),
    status: record.status,
    late: record.type === 'opening' ? record.is_late : undefined,
    location: record.location_label,
    store: record.outlet_name,
  }
}

/** The first opening and last closing per person per day. */
function firstAndLast(records: AttendanceDetail[]) {
  const byKey = new Map<string, { opening?: AttendanceDetail; closing?: AttendanceDetail }>()
  for (const r of records) {
    const key = `${r.user_id}|${r.attendance_date}`
    const entry = byKey.get(key) ?? {}
    if (r.type === 'opening' && !entry.opening) entry.opening = r
    if (r.type === 'closing') entry.closing = r
    byKey.set(key, entry)
  }
  return byKey
}

async function attendanceOnDay(supabase: SupabaseClient, input: Record<string, unknown>) {
  const today = lagosDateString()
  const date = checkDate(input.date, today)
  const [roster, records] = await Promise.all([
    fetchRoster(supabase),
    fetchRecords(supabase, date, date),
  ])
  const days = firstAndLast(records)

  const clockedInAndOut = []
  const stillOnShift = []
  const notClockedIn = []

  for (const person of roster) {
    const day = days.get(`${person.id}|${date}`)
    const base = { name: person.full_name, role: person.role, store: person.outlet_name }
    if (!day?.opening) {
      notClockedIn.push({
        ...base,
        // A clock-out with no clock-in is worth pointing out.
        ...(day?.closing ? { clocked_out_without_clocking_in: describeClock(day.closing) } : {}),
      })
    } else if (!day.closing) {
      stillOnShift.push({ ...base, clock_in: describeClock(day.opening) })
    } else {
      clockedInAndOut.push({
        ...base,
        clock_in: describeClock(day.opening),
        clock_out: describeClock(day.closing),
      })
    }
  }

  return {
    date,
    day: longDate(date),
    is_today: date === today,
    staff_total: roster.length,
    counts: {
      clocked_in: clockedInAndOut.length + stillOnShift.length,
      clocked_out: clockedInAndOut.length,
      still_on_shift_not_clocked_out: stillOnShift.length,
      not_clocked_in: notClockedIn.length,
    },
    clocked_in_and_out: clockedInAndOut,
    still_on_shift_not_clocked_out: stillOnShift,
    not_clocked_in: notClockedIn,
  }
}

async function staffHistory(supabase: SupabaseClient, input: Record<string, unknown>) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('A name is required')
  const to = checkDate(input.to, lagosDateString())
  const from = checkDate(input.from, addDays(to, -7))
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new Error(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
  }

  const roster = await fetchRoster(supabase)
  const needle = name.toLowerCase()
  const people = roster.filter((p) => p.full_name.toLowerCase().includes(needle))
  if (people.length === 0) {
    return { from, to, matches: [], note: `No staff you can see match "${name}".` }
  }
  if (people.length > 10) {
    return {
      from,
      to,
      note: `"${name}" matches ${people.length} people; ask the user which one.`,
      matches: people.map((p) => ({ name: p.full_name, store: p.outlet_name })),
    }
  }

  const records = await fetchRecords(
    supabase,
    from,
    to,
    people.map((p) => p.id),
  )
  const days = firstAndLast(records)

  return {
    from,
    to,
    matches: people.map((person) => {
      const history = []
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = days.get(`${person.id}|${d}`)
        history.push({
          date: d,
          clock_in: describeClock(day?.opening) ?? 'none',
          clock_out: describeClock(day?.closing) ?? 'none',
        })
      }
      return { name: person.full_name, role: person.role, store: person.outlet_name, history }
    }),
  }
}

async function attendanceSummary(supabase: SupabaseClient, input: Record<string, unknown>) {
  const from = checkDate(input.from, lagosDateString())
  const to = checkDate(input.to, lagosDateString())
  if (to < from) throw new Error('"to" is before "from"')
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new Error(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
  }

  const [roster, records] = await Promise.all([
    fetchRoster(supabase),
    fetchRecords(supabase, from, to),
  ])
  const days = firstAndLast(records)

  return {
    from,
    to,
    calendar_days: daysBetween(from, to) + 1,
    people: roster.map((person) => {
      let clockedIn = 0
      let clockedOut = 0
      let neverOut = 0
      let late = 0
      let offSite = 0
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const day = days.get(`${person.id}|${d}`)
        if (day?.opening) {
          clockedIn++
          if (!day.closing) neverOut++
          if (day.opening.is_late) late++
          if (day.opening.status && day.opening.status !== 'on_site') offSite++
        }
        if (day?.closing) clockedOut++
      }
      return {
        name: person.full_name,
        role: person.role,
        store: person.outlet_name,
        days_clocked_in: clockedIn,
        days_clocked_out: clockedOut,
        days_clocked_in_but_not_out: neverOut,
        late_days: late,
        off_site_clock_ins: offSite,
      }
    }),
  }
}

const HANDLERS: Record<
  string,
  (supabase: SupabaseClient, input: Record<string, unknown>) => Promise<unknown>
> = {
  attendance_on_day: attendanceOnDay,
  staff_history: staffHistory,
  attendance_summary: attendanceSummary,
}

async function runTool(
  supabase: SupabaseClient,
  block: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const handler = HANDLERS[block.name]
  try {
    if (!handler) throw new Error(`Unknown tool ${block.name}`)
    const result = await handler(supabase, (block.input ?? {}) as Record<string, unknown>)
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }
  } catch (error) {
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      is_error: true,
      content: error instanceof Error ? error.message : 'The lookup failed',
    }
  }
}

/** Runs one question through Claude and the tools, and returns the answer. */
export async function askAssistant(
  supabase: SupabaseClient,
  history: ChatTurn[],
  askedBy: string,
): Promise<string> {
  const client = new Anthropic()
  const today = lagosDateString()

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }))

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `Today is ${longDate(today)} (${today}). You are talking to ${askedBy}.`,
        },
      ],
      tools,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return "I can't help with that one. Try asking about who clocked in or out."
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    )
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return text || "I couldn't find an answer to that."
    }

    messages.push({ role: 'assistant', content: response.content })
    const results = await Promise.all(toolUses.map((block) => runTool(supabase, block)))
    messages.push({ role: 'user', content: results })
  }

  return 'That took too many lookups. Try a narrower question, such as one day or one person.'
}
