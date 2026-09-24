import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lagosDateString, longDate } from '@/lib/utils'
import {
  MAX_RANGE_DAYS,
  attendanceOnDay,
  attendanceSummary,
  fieldReports,
  staffHistory,
  storeVisits,
} from '@/lib/assistant-data'
import { buildReportSheet } from '@/lib/assistant-report'
import { REPORT_KINDS, reportSpecSchema, type ReportSpec } from '@/lib/assistant-report-spec'

/**
 * "Ask Xtend": an admin or supervisor types a question ("who hasn't clocked
 * in?", "give me this week's attendance report") and Claude answers it by
 * calling the read-only tools below.
 *
 * Every tool queries through the caller's own Supabase client, so RLS decides
 * what the model can see: a supervisor's assistant only ever knows about that
 * supervisor's people. Nothing here writes.
 */

const MODEL = 'claude-opus-5'
const MAX_TOOL_ROUNDS = 8

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantReply {
  answer: string
  /** Reports created this turn; the chat shows download buttons for each. */
  reports: ReportSpec[]
}

export function assistantConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM = `You are Xtend's assistant for Xpel Beauty. Office staff (admins and supervisors) ask you about field staff: who clocked in, who clocked out, who has not clocked in or out, who was late, who clocked in away from their store, a person's history, the daily reports marketers file, and store visits. You also produce downloadable reports.

Answer only from what the tools return. Never guess a time, a name or a count; if the tools return nothing, say so. Call a tool for every question about the data, even one you think you answered earlier, because the data changes through the day.

How attendance works:
- A "clock in" is an opening record; a "clock out" is a closing record. Each has a time, a location and a status: on_site (inside the store's radius), off_site (outside it) or flagged.
- Late means the clock in was after the store's shift start.
- A person is "not clocked in" when they have no opening record that day, and "still on shift" when they clocked in but have not clocked out.
- All times and dates are Africa/Lagos.

Reports: when the user asks for a report, a summary to share, an export or a download, first read the data with the lookup tools, then call create_report with the matching kind and a short written summary: the headline numbers, who stands out (absent, late, off site, missing clock-outs, issues raised in field reports) and anything that needs follow-up. The report's table is filled in from the database automatically, so do not repeat the rows in your reply. After create_report, reply with two or three sentences giving the key findings and saying the download buttons are below. Pick the kind:
- daily_attendance: one day, everyone's clock in and out (use "from" for the day).
- attendance_summary: per-person totals over a range.
- staff_history: one person day by day (set "name").
- field_reports: the marketers' daily reports over a range.
- store_visits: store visits over a range.
Ranges are at most ${MAX_RANGE_DAYS} days.

Resolve relative dates ("today", "yesterday", "last Monday", "this week", "last month") against today's date, given below, and pass them as YYYY-MM-DD. A week runs Monday to Sunday.

Write for someone reading on a phone: lead with the direct answer and the count, then a short list of names (with store and time where useful). Use plain text with simple "- " bullets. No tables, no headings, no markdown bold.`

const range = {
  from: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for 7 days ago.' },
  to: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for today.' },
}

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
        ...range,
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
      properties: range,
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'field_reports',
    description:
      'The daily reports marketers file from the field over a date range: sales, stock status, competitor activity, issues and notes, with who filed each and for which store. Long text is shortened.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: range,
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'store_visits',
    description:
      'Store visits over a date range: who visited which store, when they arrived and left, how many minutes they stayed, and whether they arrived on site.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: range,
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_report',
    description:
      'Creates a downloadable report (PDF, Excel, Word and CSV) for the user. The table is filled in from the database; you supply the kind, the dates, a title and a written summary. Read the data with the other tools first so the summary is accurate.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...REPORT_KINDS] },
        from: {
          type: 'string',
          description: 'YYYY-MM-DD. The day, for daily_attendance; otherwise the first day.',
        },
        to: {
          type: ['string', 'null'],
          description: 'YYYY-MM-DD, the last day. Null for daily_attendance.',
        },
        name: {
          type: ['string', 'null'],
          description: 'The staff name, for staff_history only. Otherwise null.',
        },
        title: { type: 'string', description: 'e.g. "Attendance report, 15 to 21 September 2026".' },
        summary: {
          type: 'string',
          description:
            'Plain-text summary printed above the table, at most about 150 words. Separate paragraphs with a newline.',
        },
      },
      required: ['kind', 'from', 'to', 'name', 'title', 'summary'],
      additionalProperties: false,
    },
  },
]

type Input = Record<string, unknown>

async function runTool(
  supabase: SupabaseClient,
  block: Anthropic.Beta.BetaToolUseBlock,
  reports: ReportSpec[],
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const input = (block.input ?? {}) as Input
  try {
    let result: unknown
    switch (block.name) {
      case 'attendance_on_day':
        result = await attendanceOnDay(supabase, input.date)
        break
      case 'staff_history':
        result = await staffHistory(supabase, input.name, input.from, input.to)
        break
      case 'attendance_summary':
        result = await attendanceSummary(supabase, input.from, input.to)
        break
      case 'field_reports':
        result = await fieldReports(supabase, input.from, input.to)
        break
      case 'store_visits':
        result = await storeVisits(supabase, input.from, input.to)
        break
      case 'create_report': {
        const parsed = reportSpecSchema.safeParse({
          ...input,
          summary: typeof input.summary === 'string' ? input.summary.slice(0, 2000) : '',
        })
        if (!parsed.success) {
          throw new Error(parsed.error.issues[0]?.message ?? 'Invalid report')
        }
        if (parsed.data.kind === 'staff_history' && !parsed.data.name) {
          throw new Error('staff_history needs a name')
        }
        // Build it once now, so a bad range fails here rather than on download.
        const sheet = await buildReportSheet(supabase, parsed.data)
        reports.push(parsed.data)
        result = { created: true, rows: sheet.rows.length, shown_to_user_as: 'download buttons' }
        break
      }
      default:
        throw new Error(`Unknown tool ${block.name}`)
    }
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
): Promise<AssistantReply> {
  const client = new Anthropic()
  const today = lagosDateString()
  const reports: ReportSpec[] = []

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
      return {
        answer: "I can't help with that one. Try asking about who clocked in or out.",
        reports,
      }
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
      return {
        answer: text || (reports.length ? 'Your report is ready.' : "I couldn't find an answer to that."),
        reports,
      }
    }

    messages.push({ role: 'assistant', content: response.content })
    const results = await Promise.all(toolUses.map((block) => runTool(supabase, block, reports)))
    messages.push({ role: 'user', content: results })
  }

  return {
    answer: reports.length
      ? 'Your report is ready.'
      : 'That took too many lookups. Try a narrower question, such as one day or one person.',
    reports,
  }
}
