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
  countRequests,
  storeCounts,
  storeVisits,
} from '@/lib/assistant-data'
import { AllocationContext } from '@/lib/assistant-allocate'
import type { ChangePlan } from '@/lib/assistant-plan'
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
const MAX_TOOL_ROUNDS = 10

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantReply {
  answer: string
  /** Reports created this turn; the chat shows download buttons for each. */
  reports: ReportSpec[]
  /** Changes proposed this turn; the chat shows each with an Apply button. */
  plans: ChangePlan[]
}

export interface Asker {
  name: string
  role: 'admin' | 'supervisor'
}

export function assistantConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const SYSTEM = `You are Xtend's assistant for Xpel Beauty. Office staff (admins and supervisors) ask you about field staff: who clocked in, who clocked out, who has not clocked in or out, who was late, who clocked in away from their store, a person's history, the daily reports marketers file, store visits, and store counts (merchandisers count the products physically in their store and report, product by product, how many are left and how many were sold since their previous count; product names are as they typed them). Store counts are taken when a supervisor or admin asks for one, and by everyone in the last three days of each month. You also produce downloadable reports, and you prepare store allocations and team changes for the user to approve.

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
- store_counts: merchandisers' product counts (left in store and sold) over a range.
Ranges are at most ${MAX_RANGE_DAYS} days.

Allocations and teams: the user may paste a list or attach a file (CSV, Excel, PDF, a photo of a sheet) saying which stores go to which merchandisers, or which people report to which supervisor. To prepare it:
1. Read every line. Collect each distinct person, store and supervisor name exactly as written.
2. Call match_names once with all of them. Each candidate has a reference (P…, S…, V…) and a score from 0 to 1.
3. Pick the right candidate for each name. Take a clear best match (score about 0.8 or more, well ahead of the rest). When two candidates are close, or nothing is close, do not guess: leave that line out and list it in "unmatched".
4. Call propose_changes once with every change. Use mode "add" (keep the stores they already have) unless the user says the list replaces what people have, then "replace".
5. Reply in two or three sentences: how many people and stores are in the plan, anything unmatched and why, and that nothing changes until they press Apply below. Never say the changes are made: only the Apply button makes them.
Only admins can change who somebody reports to; for a supervisor, say so and prepare only store allocations. If the user just asks for an allocation in words ("give Ada Ikeja Mall"), follow the same steps.

Resolve relative dates ("today", "yesterday", "last Monday", "this week", "last month") against today's date, given below, and pass them as YYYY-MM-DD. A week runs Monday to Sunday.

Write for someone reading on a phone: lead with the direct answer and the count, then a short list of names (with store and time where useful). Use plain text with simple "- " bullets. No tables, no headings, no markdown bold.`

const range = {
  from: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for 7 days ago.' },
  to: { type: ['string', 'null'], description: 'YYYY-MM-DD. Null for today.' },
}

const nameList = { type: 'array', items: { type: 'string' } }

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
    name: 'store_counts',
    description:
      "Merchandisers' store counts over a date range: for each store and product, how many units were left in the store and how many sold since that person's previous count, and who counted.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: range,
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'count_requests',
    description:
      'Recent store count requests: who asked, the due date, whether it is still open, how many of the people asked have counted, and who is still waiting to count.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'match_names',
    description:
      'Looks up people, stores and supervisors by name, as written in a file or message, and returns up to three likely matches for each with a reference to use in propose_changes. People come with their current stores and supervisor.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        people: { ...nameList, description: 'Merchandiser or marketer names.' },
        stores: { ...nameList, description: 'Store names, as written.' },
        supervisors: { ...nameList, description: 'Supervisor names. Empty if none.' },
      },
      required: ['people', 'stores', 'supervisors'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_changes',
    description:
      'Shows the user a plan of store allocations and supervisor assignments, with an Apply button. Nothing is changed until they press it. Use only references returned by match_names.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        store_allocations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              person: { type: 'string', description: 'A P… reference.' },
              stores: { ...nameList, description: 'S… references.' },
              mode: { type: 'string', enum: ['add', 'replace'] },
            },
            required: ['person', 'stores', 'mode'],
            additionalProperties: false,
          },
        },
        supervisor_assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              person: { type: 'string', description: 'A P… reference.' },
              supervisor: {
                type: ['string', 'null'],
                description: 'A V… reference, or null to take them off their supervisor.',
              },
            },
            required: ['person', 'supervisor'],
            additionalProperties: false,
          },
        },
        unmatched: {
          ...nameList,
          description: 'Lines or names that could not be matched confidently, with a few words on why.',
        },
      },
      required: ['store_allocations', 'supervisor_assignments', 'unmatched'],
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

interface Turn {
  supabase: SupabaseClient
  allocation: AllocationContext
  reports: ReportSpec[]
  plans: ChangePlan[]
}

async function runTool(
  turn: Turn,
  block: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const { supabase, reports } = turn
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
      case 'store_counts':
        result = await storeCounts(supabase, input.from, input.to)
        break
      case 'count_requests':
        result = await countRequests(supabase)
        break
      case 'match_names':
        result = await turn.allocation.match(input)
        break
      case 'propose_changes': {
        const plan = await turn.allocation.plan(input)
        turn.plans.push(plan)
        result = {
          shown_to_user: true,
          store_allocations: plan.stores.length,
          supervisor_assignments: plan.supervisors.length,
          unmatched: plan.unmatched.length,
          note: 'Nothing is changed until the user presses Apply.',
        }
        break
      }
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
  asker: Asker,
  attachment: Anthropic.Beta.BetaContentBlockParam[] = [],
): Promise<AssistantReply> {
  const client = new Anthropic()
  const today = lagosDateString()
  const turn: Turn = {
    supabase,
    allocation: new AllocationContext(supabase, asker.role === 'admin'),
    reports: [],
    plans: [],
  }
  const { reports, plans } = turn

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t, i) =>
    // A file rides with the question it was attached to, the last one.
    i === history.length - 1 && attachment.length
      ? { role: t.role, content: [...attachment, { type: 'text', text: t.content }] }
      : { role: t.role, content: t.content },
  )

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
          text: `Today is ${longDate(today)} (${today}). You are talking to ${asker.name} (${asker.role}).`,
        },
      ],
      tools,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return {
        answer: "I can't help with that one. Try asking about who clocked in or out.",
        reports,
        plans,
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
        answer:
          text ||
          (plans.length
            ? 'Review the changes below and press Apply to make them.'
            : reports.length
              ? 'Your report is ready.'
              : "I couldn't find an answer to that."),
        reports,
        plans,
      }
    }

    messages.push({ role: 'assistant', content: response.content })
    const results = await Promise.all(toolUses.map((block) => runTool(turn, block)))
    messages.push({ role: 'user', content: results })
  }

  return {
    answer: reports.length
      ? 'Your report is ready.'
      : 'That took too many lookups. Try a narrower question, such as one day or one person.',
    reports,
    plans,
  }
}
