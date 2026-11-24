import 'server-only'
import type { AiConnection } from '@/lib/ai/config'

/**
 * Talking to OpenAI, Gemini, NVIDIA and OpenRouter, which all take the
 * OpenAI chat format at their own address (lib/ai/providers.ts). Xtend's
 * conversations are kept in Anthropic's shape (text, tool_use and
 * tool_result blocks), so each round is translated there and back: the rest
 * of Ask Xtend and the staff helper never need to know which AI answered.
 */

type Json = Record<string, unknown>

/** Anthropic-shaped pieces this file reads and writes. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: string; [k: string]: unknown }

export interface ConvMessage {
  role: 'user' | 'assistant'
  content: string | Block[]
}

export interface ToolDef {
  name: string
  description?: string
  input_schema: Json
}

interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | Json[]
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as Block).type === 'text' ? String((b as { text: string }).text) : ''))
      .filter(Boolean)
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** Anthropic-shaped turns → OpenAI chat messages. */
export function toOpenAiMessages(system: string, messages: ConvMessage[]): OaMessage[] {
  const out: OaMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => String((b as { text: string }).text)).join('\n')
      const calls = m.content
        .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    // A user turn: tool results become "tool" messages; the rest one user message.
    const parts: Json[] = []
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const r = b as Extract<Block, { type: 'tool_result' }>
        out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: textOf(r.content) || '(no result)' })
      } else if (b.type === 'text') {
        parts.push({ type: 'text', text: String((b as { text: string }).text) })
      } else if (b.type === 'image') {
        const src = (b as Extract<Block, { type: 'image' }>).source
        parts.push({ type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } })
      } else {
        parts.push({ type: 'text', text: '[A file was attached that this AI cannot read. Ask for the key figures to be typed in.]' })
      }
    }
    if (parts.length) {
      out.push({
        role: 'user',
        content: parts.every((p) => p.type === 'text') ? parts.map((p) => String(p.text)).join('\n') : parts,
      })
    }
  }
  return out
}

export function toOpenAiTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }))
}

async function post(conn: AiConnection, body: Json, timeoutMs: number): Promise<Json> {
  if (!conn.baseUrl) throw new Error('Not an OpenAI-format provider')
  const res = await fetch(`${conn.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${conn.apiKey}`,
      ...(conn.provider === 'openrouter' ? { 'X-Title': 'Xtend' } : {}),
    },
    body: JSON.stringify({ model: conn.model, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await res.json().catch(() => null)) as Json | null
  if (!res.ok || !data) {
    const message = (data?.error as Json | undefined)?.message
    // The provider's words, never the key.
    throw new Error(`The AI service answered ${res.status}${typeof message === 'string' ? `: ${message.slice(0, 200)}` : ''}`)
  }
  return data
}

/**
 * One round of a tool-using conversation, answered in Anthropic's shape:
 * text and tool_use blocks, and whether it stopped to use tools.
 */
export async function compatRound(
  conn: AiConnection,
  opts: { system: string; messages: ConvMessage[]; tools: ToolDef[]; maxTokens?: number; timeoutMs?: number },
): Promise<{ content: Block[]; stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' }> {
  const data = await post(
    conn,
    {
      messages: toOpenAiMessages(opts.system, opts.messages),
      ...(opts.tools.length ? { tools: toOpenAiTools(opts.tools), tool_choice: 'auto' } : {}),
      max_tokens: opts.maxTokens ?? 4000,
    },
    opts.timeoutMs ?? 90_000,
  )
  const choice = ((data.choices as Json[] | undefined) ?? [])[0] ?? {}
  const message = (choice.message as Json | undefined) ?? {}
  const content: Block[] = []
  if (typeof message.content === 'string' && message.content.trim()) content.push({ type: 'text', text: message.content })
  const calls = (message.tool_calls as { id?: string; function?: { name?: string; arguments?: string } }[] | undefined) ?? []
  calls.forEach((c, i) => {
    let input: unknown = {}
    try {
      input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}
    } catch {
      input = {}
    }
    content.push({ type: 'tool_use', id: c.id || `call_${i}`, name: c.function?.name ?? '', input })
  })
  const finish = String(choice.finish_reason ?? '')
  return {
    content,
    stop_reason: calls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
  }
}

/**
 * Asks for one answer through one tool (the staff helper's "respond"), and
 * returns its arguments. A model that answers in plain text instead is
 * read as JSON if it can be, else as the reply itself.
 */
export async function compatToolAnswer<T extends Json>(
  conn: AiConnection,
  opts: { system: string; messages: ConvMessage[]; tool: ToolDef; timeoutMs?: number },
): Promise<T | { reply: string }> {
  const data = await post(
    conn,
    {
      messages: toOpenAiMessages(opts.system, opts.messages),
      tools: toOpenAiTools([opts.tool]),
      tool_choice: { type: 'function', function: { name: opts.tool.name } },
      max_tokens: 1024,
    },
    opts.timeoutMs ?? 45_000,
  )
  const message = ((((data.choices as Json[] | undefined) ?? [])[0] ?? {}).message as Json | undefined) ?? {}
  const call = ((message.tool_calls as { function?: { arguments?: string } }[] | undefined) ?? [])[0]
  const raw = call?.function?.arguments ?? (typeof message.content === 'string' ? message.content : '')
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // Not JSON: the text is the reply.
  }
  return { reply: raw.trim() }
}

/** A tiny request to check a key works (Settings → AI, "Test"). */
export async function compatPing(conn: AiConnection): Promise<void> {
  await post(conn, { messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 5 }, 20_000)
}
