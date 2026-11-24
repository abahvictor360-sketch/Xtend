import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { unseal } from '@/lib/ai/secret-box'
import { providerInfo, resolveAi, type AiFeature, type AiProvider } from '@/lib/ai/providers'

/**
 * Which AI a feature uses right now, with its key (0102): the admin's
 * choice on Settings → AI, else the server's ANTHROPIC_API_KEY, else any
 * key the admin saved. Read once a minute at most; saving on the AI page
 * clears it at once on that server.
 */
export interface AiConnection {
  provider: AiProvider
  model: string
  apiKey: string
  /** OpenAI-format address; null for Anthropic. */
  baseUrl: string | null
}

interface Stored {
  keys: Map<AiProvider, string>
  chosen: { feature: AiFeature; provider: AiProvider; model: string }[]
  /** What the office told the AI (0104), or ''. */
  knowledge: string
  at: number
}

let stored: Stored | null = null
const TTL_MS = 60_000

export function forgetAiSettings() {
  stored = null
}

async function load(): Promise<Stored> {
  if (stored && Date.now() - stored.at < TTL_MS) return stored
  const keys = new Map<AiProvider, string>()
  let chosen: Stored['chosen'] = []
  let knowledge = ''
  try {
    const admin = createAdminSupabase()
    const [{ data: keyRows }, { data: featureRows }] = await Promise.all([
      admin.from('ai_provider_keys').select('provider, key_cipher'),
      admin.from('ai_feature_settings').select('feature, provider, model'),
    ])
    for (const row of (keyRows ?? []) as { provider: AiProvider; key_cipher: string }[]) {
      const key = unseal(row.key_cipher)
      if (key) keys.set(row.provider, key)
    }
    chosen = (featureRows ?? []) as Stored['chosen']
    // Before 0104 there is no table: no notes.
    const { data: note } = await admin.from('ai_knowledge').select('body').maybeSingle<{ body: string }>()
    knowledge = note?.body?.trim() ?? ''
  } catch {
    // Before 0102, or the database is busy: only the server's own key.
  }
  stored = { keys, chosen, knowledge, at: Date.now() }
  return stored
}

/** What the office wrote under "What the AI should know" (0104), or ''. */
export async function aiKnowledge(): Promise<string> {
  return (await load()).knowledge
}

const serverKey = () => process.env.ANTHROPIC_API_KEY?.trim() || null

export async function aiFor(feature: AiFeature): Promise<AiConnection | null> {
  const { keys, chosen } = await load()
  const resolved = resolveAi(
    feature,
    [...keys.keys()],
    chosen,
    Boolean(serverKey()),
    feature === 'admin_assistant' ? process.env.ASSISTANT_MODEL : null,
  )
  if (!resolved) return null
  const apiKey = keys.get(resolved.provider) ?? (resolved.provider === 'anthropic' ? serverKey() : null)
  if (!apiKey) return null
  return { provider: resolved.provider, model: resolved.model, apiKey, baseUrl: providerInfo(resolved.provider)!.baseUrl }
}

/**
 * An Anthropic key for the parts only Claude does (checking photos, reading
 * PDF and Word invoices): the server's own, or the one saved on the AI page.
 */
export async function anthropicKey(): Promise<string | null> {
  if (serverKey()) return serverKey()
  const { keys } = await load()
  return keys.get('anthropic') ?? null
}
