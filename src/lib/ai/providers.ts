/**
 * The AI providers an admin can add a key for (migration 0102), and which
 * one each feature uses. Pure, so scripts/check-ai-providers.ts can test it.
 *
 * Anthropic is called with its own API; the other four speak the OpenAI
 * chat format at their own address (lib/ai/compat.ts).
 */

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'nvidia' | 'openrouter'
export type AiFeature = 'staff_helper' | 'admin_assistant'

/** Model families that answer well with tools, best first (a hint, not a rule). */
const STRONG = ['kimi-k2', 'qwen3', 'gpt-oss', 'deepseek-v3', 'llama-4', 'nemotron', 'llama-3.1-405b', 'mistral-large', 'mistral-medium']
/** Not for chatting: pictures, embeddings, safety filters, speech, code-only. */
const NOT_CHAT = /embed|rerank|guard|safety|reward|vision-only|clip|whisper|tts|asr|parakeet|retriev|-vl\b|coder|deplot|kosmos|fuyu|paligemma|neva|vila|cosmos|sdxl|flux|stable-diffusion/i

/**
 * From the models a service lists (GET /models), a few worth trying for
 * Ask Xtend and the staff helper: chat models, strong tool users first.
 * Pure, so check-ai-providers tests it.
 */
export function suggestModels(ids: string[], max = 8): string[] {
  const chat = [...new Set(ids)].filter((id) => !NOT_CHAT.test(id))
  const rank = (id: string) => {
    const i = STRONG.findIndex((f) => id.toLowerCase().includes(f))
    return i === -1 ? STRONG.length + (/instruct|chat/i.test(id) ? 0 : 1) : i
  }
  return chat.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, max)
}

/**
 * What someone is told when they have used their AI allowance (0109):
 * which one (this hour or today) and when it comes back. Pure, so
 * check-ai-limits can test it.
 */
export function aiLimitMessage(q: { period: 'hour' | 'day'; limit: number }, what = 'questions'): string {
  return q.period === 'day'
    ? `You have used today's ${q.limit} ${what}. It starts again tomorrow (midnight, Lagos time).`
    : `You have used ${q.limit} ${what} in the last hour, the most allowed. Try again a little later.`
}

/**
 * What an admin is told when the chosen AI service refuses Ask Xtend: what
 * the service said, and what to try. Pure, so check-ai-providers tests it.
 */
export function aiServiceAdvice(err: { status: number | null; message: string }): string {
  const said = err.message.replace(/^The AI service answered \d+:?\s*/, '').trim()
  const where = 'Settings → AI keys'
  if (err.status === 401 || err.status === 403) {
    return `The AI service did not accept the key${said ? ` ("${said}")` : ''}. Paste the key again on ${where} and press Test.`
  }
  if (err.status === 404 || err.status === 410) {
    return `${err.status === 410 ? 'That model has been retired by the AI service' : 'The AI service does not know that model'}${said ? ` ("${said}")` : ''}. On ${where}, press Test next to the key to see the models it offers now, then choose one for Ask Xtend under Which AI answers.`
  }
  if (err.status === 429) {
    return `The AI service says you have used your allowance for now${said ? ` ("${said}")` : ''}. Wait a few minutes, or add credit with the service.`
  }
  if (err.status === 400 || err.status === 422) {
    return `The AI service refused the question${said ? `: "${said}"` : ''}. Ask Xtend needs a model that can use tools. On ${where}, try another model for Ask Xtend, or another service.`
  }
  if (err.status === null) return `${err.message} Try again in a moment.`
  return `The AI service could not answer (error ${err.status}${said ? `: "${said}"` : ''}). Try again in a moment.`
}

export interface ProviderInfo {
  id: AiProvider
  label: string
  /** OpenAI-format base address; null for Anthropic's own API. */
  baseUrl: string | null
  /** A sensible model to start with; the admin can type another. */
  defaultModel: string
  /** Where the admin gets a key. */
  keysUrl: string
  /** What a key looks like, to catch a paste of the wrong thing. */
  keyPattern: RegExp
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: null,
    defaultModel: 'claude-opus-5',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    keysUrl: 'https://platform.openai.com/api-keys',
    keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    keyPattern: /^[A-Za-z0-9_-]{30,}$/,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    // meta/llama-3.3-70b-instruct was retired by NVIDIA on 2026-08-26.
    defaultModel: 'openai/gpt-oss-120b',
    keysUrl: 'https://build.nvidia.com/settings/api-keys',
    keyPattern: /^nvapi-[A-Za-z0-9_-]{20,}$/,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    keysUrl: 'https://openrouter.ai/settings/keys',
    keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/,
  },
]

export const FEATURES: { id: AiFeature; label: string; note: string }[] = [
  {
    id: 'staff_helper',
    label: 'Staff helper',
    note: 'Answers staff in Support, explains why something is not working and what to do, and passes anything it cannot handle to the office.',
  },
  {
    id: 'admin_assistant',
    label: 'Ask Xtend (office)',
    note: 'Answers admins’ and supervisors’ questions about attendance, builds reports and proposes changes for you to confirm.',
  },
]

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id)

export function providerInfo(id: string): ProviderInfo | null {
  return PROVIDERS.find((p) => p.id === id) ?? null
}

/** The last 4 characters, the only part of a key ever shown back. */
export function keyHint(key: string) {
  return key.trim().slice(-4)
}

/** Null when it looks like a key for that provider; else what is wrong. */
export function keyProblem(provider: AiProvider, key: string): string | null {
  const k = key.trim()
  if (!k) return 'Paste the key.'
  if (/\s/.test(k)) return 'A key has no spaces. Copy it again.'
  if (k.length > 400) return 'That is too long to be a key.'
  const info = providerInfo(provider)
  if (info && !info.keyPattern.test(k)) return `That does not look like a ${info.label} key. Check you copied the whole key from the right page.`
  return null
}

export interface ResolvedAi {
  provider: AiProvider
  model: string
  /** Where it came from: the admin's choice, the server setting, or the only saved key. */
  source: 'chosen' | 'server' | 'saved'
}

/**
 * Which provider and model a feature uses: the admin's choice when its key
 * is saved; otherwise the server's own Anthropic key if there is one; then
 * any saved key, in the order above, with its starting model. Null when
 * there is no key at all (the feature then hands over to a person).
 */
export function resolveAi(
  feature: AiFeature,
  saved: AiProvider[],
  chosen: { feature: AiFeature; provider: AiProvider; model: string }[],
  serverAnthropic: boolean,
  serverModel?: string | null,
): ResolvedAi | null {
  const pick = chosen.find((c) => c.feature === feature)
  if (pick && (saved.includes(pick.provider) || (pick.provider === 'anthropic' && serverAnthropic))) {
    return { provider: pick.provider, model: pick.model.trim() || providerInfo(pick.provider)!.defaultModel, source: 'chosen' }
  }
  if (serverAnthropic) {
    return { provider: 'anthropic', model: serverModel?.trim() || providerInfo('anthropic')!.defaultModel, source: 'server' }
  }
  const first = PROVIDERS.find((p) => saved.includes(p.id))
  return first ? { provider: first.id, model: first.defaultModel, source: 'saved' } : null
}
