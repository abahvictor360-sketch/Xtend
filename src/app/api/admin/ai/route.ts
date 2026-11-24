import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, ApiError } from '@/lib/auth'
import { requireRecentAuth } from '@/lib/reconfirm'
import { audit } from '@/lib/audit'
import { seal, unseal } from '@/lib/ai/secret-box'
import { forgetAiSettings } from '@/lib/ai/config'
import { compatPing } from '@/lib/ai/compat'
import { keyHint, keyProblem, PROVIDER_IDS, providerInfo, type AiProvider } from '@/lib/ai/providers'

const provider = z.enum(PROVIDER_IDS as [AiProvider, ...AiProvider[]])
/** The most the office can write for the AI (0104). */
const KNOWLEDGE_MAX = 20_000

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_knowledge'),
    body: z.string().max(KNOWLEDGE_MAX, `Keep it under ${KNOWLEDGE_MAX.toLocaleString('en-GB')} characters`),
  }),
  z.object({ action: z.literal('save_key'), provider, key: z.string().max(400) }),
  z.object({ action: z.literal('remove_key'), provider }),
  z.object({ action: z.literal('test'), provider, model: z.string().trim().max(120).optional() }),
  z.object({
    action: z.literal('set_feature'),
    feature: z.enum(['staff_helper', 'admin_assistant']),
    provider,
    model: z.string().trim().min(1, 'Type a model name').max(120),
  }),
])

/**
 * Settings → AI (0102). Admins only. A key is encrypted before it is stored
 * and never sent back: only its last 4 characters. Saving or removing a key
 * asks for the password again; every change is in the audit log (without
 * the key).
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? 'Invalid request', 400)
    const input = parsed.data
    const admin = createAdminSupabase()
    const supabase = await createServerSupabase()

    // What the AI should know (0104): the office's own notes, read by the
    // staff helper and Ask Xtend with every question.
    if (input.action === 'set_knowledge') {
      const body = input.body.replace(/\r\n/g, '\n').trim()
      const { error } = await admin.from('ai_knowledge').upsert({
        id: true,
        body,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      })
      if (error) throw new ApiError('That could not be saved. Has migration 0104 been run?', 400)
      forgetAiSettings()
      await audit(supabase, 'ai.knowledge_set', 'ai_knowledge', null, { characters: body.length })
      return Response.json({ ok: true, message: body ? 'Saved. The AI uses it from the next question.' : 'Cleared.' })
    }

    const label = providerInfo(input.provider)!.label

    if (input.action === 'save_key') {
      const problem = keyProblem(input.provider, input.key)
      if (problem) throw new ApiError(problem, 400)
      await requireRecentAuth(session)
      const key = input.key.trim()
      const { error } = await admin.from('ai_provider_keys').upsert({
        provider: input.provider,
        key_cipher: seal(key),
        key_hint: keyHint(key),
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      })
      if (error) throw new ApiError('The key could not be saved. Has migration 0102 been run?', 400)
      forgetAiSettings()
      await audit(supabase, 'ai.key_saved', 'ai_provider_keys', null, { provider: input.provider, ends_with: keyHint(key) })
      return Response.json({ ok: true, message: `${label} key saved.` })
    }

    if (input.action === 'remove_key') {
      await requireRecentAuth(session)
      await admin.from('ai_provider_keys').delete().eq('provider', input.provider)
      forgetAiSettings()
      await audit(supabase, 'ai.key_removed', 'ai_provider_keys', null, { provider: input.provider })
      return Response.json({ ok: true, message: `${label} key removed.` })
    }

    if (input.action === 'set_feature') {
      const { error } = await admin.from('ai_feature_settings').upsert({
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      })
      if (error) throw new ApiError('That could not be saved. Has migration 0102 been run?', 400)
      forgetAiSettings()
      await audit(supabase, 'ai.feature_set', 'ai_feature_settings', null, input)
      return Response.json({ ok: true, message: 'Saved.' })
    }

    // Test: a tiny request with the saved key (or the server's Anthropic key).
    const { data: row } = await admin
      .from('ai_provider_keys')
      .select('key_cipher')
      .eq('provider', input.provider)
      .maybeSingle<{ key_cipher: string }>()
    const apiKey =
      (row ? unseal(row.key_cipher) : null) ??
      (input.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY?.trim() || null : null)
    if (!apiKey) {
      throw new ApiError(row ? 'The saved key cannot be read any more (the server secret changed). Paste it again.' : `No ${label} key is saved.`, 400)
    }
    const model = input.model || providerInfo(input.provider)!.defaultModel
    try {
      if (input.provider === 'anthropic') {
        await new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 }).messages.create({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        })
      } else {
        await compatPing({ provider: input.provider, model, apiKey, baseUrl: providerInfo(input.provider)!.baseUrl })
      }
    } catch (err) {
      const why = err instanceof Error ? err.message.replace(apiKey, '[key]').slice(0, 240) : 'No answer'
      return Response.json({ ok: false, message: `${label} did not answer with ${model}: ${why}` })
    }
    return Response.json({ ok: true, message: `${label} answered with ${model}. It works.` })
  } catch (error) {
    return apiError(error)
  }
}
