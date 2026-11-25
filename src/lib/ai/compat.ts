import 'server-only'
import type { AiConnection } from '@/lib/ai/config'
import { suggestModels } from '@/lib/ai/providers'

/**
 * Talking to OpenAI, Gemini, NVIDIA and OpenRouter, which all take the
 * OpenAI chat format at their own address (lib/ai/providers.ts). Xtend's
 * conversations are kept in Anthropic's shape (text, tool_use and
 * tool_result blocks), so each round is translated there and back: the rest
 * of Ask Xtend and the staff helper never need to know which AI answered.
 */

type Json = Record<string, unknown>

/**
 * The AI service refused or did not answer. `message` is written for the
 * admin (the service's own words, never the key) so Ask Xtend can say what
 * is wrong instead of "Something went wrong".
 */
export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly serviceSaid: string | null,
  ) {
    super(message)
    this.name = 'AiServiceError'
  }
}

/**
 * The most each service is asked to write in one answer. NVIDIA's hosted
 * models refuse requests above about 4,000; the others take more.
 */
export function outputCap(provider: string, wanted: number): number {
  return provider === 'nvidia' ? Math.min(wanted, 4096) : wanted
}

/**
 * Tool shapes every OpenAI-format service accepts: only the plain JSON
 * Schema words (type, properties, items, required, enum, description).
 * Some servers (NVIDIA's among them) refuse a request over a word they do
 * not know, such as "additionalProperties" or "format".
 */
export function plainSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(plainSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Json = {}
  for (const [k, v] of Object.entries(schema as Json)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Json).map(([name, sub]) => [name, plainSchema(sub)]))
    } else if (k === 'items' || k === 'anyOf') {
      out[k] = plainSchema(v)
    } else if (['type', 'required', 'enum', 'description', 'minimum', 'maximum', 'minItems', 'maxItems', 'nullable'].includes(k)) {
      out[k] = v
    }
  }
  return out
}

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
      // An empty string, not null: some servers refuse a null content.
      out.push({ role: 'assistant', content: text || '', ...(calls.length ? { tool_calls: calls } : {}) })
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

export function toOpenAiTools(tools: ToolDef[], plain = false) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: (t.description ?? '').slice(0, 1024),
      parameters: plain ? (plainSchema(t.input_schema) as Json) : t.input_schema,
    },
  }))
}

/** What the service said went wrong, from the usual error shapes. */
function serviceWords(data: Json | null, raw: string): string | null {
  const err = data?.error
  const said =
    (err && typeof err === 'object' ? (err as Json).message : typeof err === 'string' ? err : null) ??
    data?.detail ??
    data?.message ??
    (raw && !raw.trim().startsWith('<') ? raw : null)
  return typeof said === 'string' && said.trim() ? said.trim().slice(0, 300) : null
}

async function post(conn: AiConnection, body: Json, timeoutMs: number): Promise<Json> {
  if (!conn.baseUrl) throw new Error('Not an OpenAI-format provider')
  let res: Response
  try {
    res = await fetch(`${conn.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${conn.apiKey}`,
        ...(conn.provider === 'openrouter' ? { 'X-Title': 'Xtend' } : {}),
      },
      body: JSON.stringify({ model: conn.model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new AiServiceError(
      timedOut
        ? `The AI service took longer than ${Math.round(timeoutMs / 1000)} seconds to answer.`
        : 'The server could not reach the AI service.',
      null,
      null,
    )
  }
  const raw = await res.text().catch(() => '')
  let data: Json | null = null
  try {
    data = raw ? (JSON.parse(raw) as Json) : null
  } catch {
    data = null
  }
  if (!res.ok || !data) {
    // The provider's words, never the key.
    const said = serviceWords(data, raw)?.replaceAll(conn.apiKey, '[key]') ?? null
    throw new AiServiceError(`The AI service answered ${res.status}${said ? `: ${said}` : ''}`, res.status, said)
  }
  return data
}

/**
 * Posts once; if the service refuses the request itself (400 or 422, often
 * over a tool shape or the answer length), tries once more with plain tool
 * shapes and a shorter answer before giving up.
 */
/**
 * Models a service has retired (404 or 410) and the model Xtend found to
 * use instead, until the server restarts: "nvidia:openai/gpt-oss-120b" →
 * "moonshotai/kimi-k2-instruct". The admin's choice on Settings → AI keys
 * is not changed; Test there says the model is gone.
 */
const replacements = new Map<string, string>()

/** The model actually used for a chosen one (its replacement, if retired). */
export function modelInUse(conn: AiConnection): string {
  return replacements.get(`${conn.provider}:${conn.model}`) ?? conn.model
}

/**
 * Posts with the chosen model; if the service says that model is unknown
 * or retired, asks it which models it offers now and uses the best that
 * answers (up to three tried), and remembers it so later questions go
 * straight there.
 */
async function postWithRetry(conn: AiConnection, body: Json, tools: ToolDef[], timeoutMs: number): Promise<Json> {
  const key = `${conn.provider}:${conn.model}`
  const known = replacements.get(key)
  const first = known ? { ...conn, model: known } : conn
  try {
    return await postShaped(first, body, tools, timeoutMs)
  } catch (err) {
    if (!(err instanceof AiServiceError) || (err.status !== 404 && err.status !== 410)) throw err
    if (known) replacements.delete(key)
    const offered = suggestModels(await listModels(conn)).filter((m) => m !== conn.model && m !== known)
    for (const model of offered.slice(0, 3)) {
      try {
        const data = await postShaped({ ...conn, model }, body, tools, timeoutMs)
        replacements.set(key, model)
        console.error(`AI model ${conn.provider} ${conn.model} is retired or unknown; using ${model} instead. Choose a model on Settings → AI keys.`)
        return data
      } catch (next) {
        if (!(next instanceof AiServiceError) || next.status === null || next.status >= 500 || next.status === 401 || next.status === 403 || next.status === 429) throw next
      }
    }
    throw err
  }
}

async function postShaped(conn: AiConnection, body: Json, tools: ToolDef[], timeoutMs: number): Promise<Json> {
  try {
    return await post(conn, { ...body, ...(tools.length ? { tools: toOpenAiTools(tools, conn.provider === 'nvidia') } : {}) }, timeoutMs)
  } catch (err) {
    if (!(err instanceof AiServiceError) || (err.status !== 400 && err.status !== 422)) throw err
    console.error(`AI service refused a request (${conn.provider} ${conn.model}): ${err.message}`)
    const shorter = typeof body.max_tokens === 'number' ? Math.min(body.max_tokens, 2048) : 2048
    // A named tool choice is not supported everywhere: 'auto' instead.
    const choice = body.tool_choice && typeof body.tool_choice === 'object' ? { tool_choice: 'auto' } : {}
    return post(
      conn,
      { ...body, ...choice, max_tokens: shorter, ...(tools.length ? { tools: toOpenAiTools(tools, true) } : {}) },
      timeoutMs,
    )
  }
}

/**
 * One round of a tool-using conversation, answered in Anthropic's shape:
 * text and tool_use blocks, and whether it stopped to use tools.
 */
export async function compatRound(
  conn: AiConnection,
  opts: { system: string; messages: ConvMessage[]; tools: ToolDef[]; maxTokens?: number; timeoutMs?: number },
): Promise<{ content: Block[]; stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' }> {
  const data = await postWithRetry(
    conn,
    {
      messages: toOpenAiMessages(opts.system, opts.messages),
      ...(opts.tools.length ? { tool_choice: 'auto' } : {}),
      max_tokens: outputCap(conn.provider, opts.maxTokens ?? 4000),
    },
    opts.tools,
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
  const data = await postWithRetry(
    conn,
    {
      messages: toOpenAiMessages(opts.system, opts.messages),
      tool_choice: { type: 'function', function: { name: opts.tool.name } },
      max_tokens: 1024,
    },
    [opts.tool],
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

/** The models the service offers now (GET /models), or [] if it will not say. */
export async function listModels(conn: AiConnection): Promise<string[]> {
  if (!conn.baseUrl) return []
  try {
    const res = await fetch(`${conn.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${conn.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { id?: unknown }[] }
    return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/** A tiny request to check a key works (Settings → AI, "Test"). */
export async function compatPing(conn: AiConnection): Promise<void> {
  await post(conn, { messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 5 }, 20_000)
}
