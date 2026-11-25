/**
 * Checks the AI keys an admin adds (0102): which provider each feature
 * uses, the key checks, the encryption (never stored or shown in plain),
 * the translation to the OpenAI chat format (OpenAI, Gemini, NVIDIA,
 * OpenRouter), and that the page and route never send a key back.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-ai-providers.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { keyHint, keyProblem, PROVIDERS, resolveAi } from '@/lib/ai/providers'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

async function main() {
  check(PROVIDERS.map((p) => p.id).join(',') === 'anthropic,openai,gemini,nvidia,openrouter', 'five providers: Anthropic, OpenAI, Gemini, NVIDIA, OpenRouter')
  check(PROVIDERS.filter((p) => p.id !== 'anthropic').every((p) => p.baseUrl?.startsWith('https://')), 'the other four are reached over https in the OpenAI format')

  // Which AI answers.
  const chosen = [{ feature: 'staff_helper' as const, provider: 'openai' as const, model: 'gpt-x' }]
  check(resolveAi('staff_helper', ['openai'], chosen, false)?.provider === 'openai' && resolveAi('staff_helper', ['openai'], chosen, false)?.model === 'gpt-x', 'the admin’s choice is used when its key is saved')
  check(resolveAi('staff_helper', [], chosen, true)?.provider === 'anthropic', 'a choice without its key falls back to the server key')
  check(resolveAi('admin_assistant', [], [], true, 'claude-x')?.model === 'claude-x', 'with nothing chosen, the server key and ASSISTANT_MODEL, as before')
  check(resolveAi('admin_assistant', ['gemini', 'nvidia'], [], false)?.provider === 'gemini', 'else the first saved key, with its starting model')
  check(resolveAi('staff_helper', [], [], false) === null, 'no key at all: no AI (the office answers)')

  // Key checks.
  check(keyProblem('openai', 'sk-proj-' + 'a'.repeat(40)) === null && keyProblem('anthropic', 'sk-ant-' + 'b'.repeat(40)) === null, 'real-looking keys pass')
  check(keyProblem('nvidia', 'sk-' + 'a'.repeat(40)) !== null && keyProblem('openrouter', 'sk-ant-' + 'a'.repeat(30)) !== null, 'a key for another service is caught')
  check(keyProblem('openai', 'sk-abc def') !== null && keyProblem('gemini', '') !== null, 'spaces or nothing are caught')
  check(keyHint('sk-1234567890abcd') === 'abcd', 'only the last 4 characters are ever shown')

  // Encryption (with a test secret).
  process.env.AI_KEYS_SECRET = 'test-secret-for-the-check'
  const { seal, unseal } = await import('@/lib/ai/secret-box')
  const secret = 'sk-ant-' + 'z'.repeat(40)
  const box = seal(secret)
  check(box.startsWith('v1:') && !box.includes(secret) && seal(secret) !== box, 'a key is stored encrypted, differently each time')
  check(unseal(box) === secret, 'and read back by the server')
  check(unseal(box.slice(0, -4) + 'AAAA') === null, 'a changed box is refused')
  process.env.AI_KEYS_SECRET = 'another-secret'
  check(unseal(box) === null, 'with another server secret it cannot be read (enter the key again)')

  // Translation.
  const { toOpenAiMessages, toOpenAiTools } = await import('@/lib/ai/compat')
  const oa = toOpenAiMessages('SYS', [
    { role: 'user', content: 'Who clocked in?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'lookup', input: { day: 'today' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '[{"name":"Ada"}]' }] },
  ])
  check(oa[0].role === 'system' && oa[1].content === 'Who clocked in?', 'system and question carried over')
  check(oa[2].tool_calls?.[0].function.name === 'lookup' && JSON.parse(oa[2].tool_calls[0].function.arguments).day === 'today', 'a tool call becomes a function call')
  check(oa[3].role === 'tool' && oa[3].tool_call_id === 't1' && String(oa[3].content).includes('Ada'), 'its result becomes a tool message')
  check(toOpenAiTools([{ name: 'x', description: 'd', input_schema: { type: 'object' } }])[0].function.parameters.type === 'object', 'tools become functions')
  const { plainSchema, outputCap } = await import('@/lib/ai/compat')
  const plain = plainSchema({
    type: 'object',
    additionalProperties: false,
    properties: { day: { type: 'string', format: 'date', description: 'd' }, who: { type: 'array', items: { type: 'string', pattern: 'x' } } },
    required: ['day'],
  }) as { additionalProperties?: unknown; properties: { day: { format?: unknown; type: string }; who: { items: { pattern?: unknown } } }; required: string[] }
  check(plain.additionalProperties === undefined && plain.properties.day.format === undefined && plain.properties.day.type === 'string'
    && plain.properties.who.items.pattern === undefined && plain.required[0] === 'day', 'tool shapes are made plain for services that refuse unknown words')
  check(outputCap('nvidia', 8000) === 4096 && outputCap('openai', 8000) === 8000, 'NVIDIA is never asked for more than about 4,000 words of answer')
  const compatSrc = read('src/lib/ai/compat.ts')
  check(compatSrc.includes("content: text || ''") && compatSrc.includes('postWithRetry') && compatSrc.includes("{ tool_choice: 'auto' }"),
    'a refused request is tried once more, plainer and shorter; no empty assistant content')
  check(compatSrc.includes("replaceAll(conn.apiKey, '[key]')"), "the service's error words never carry the key")
  const { aiServiceAdvice } = await import('@/lib/ai/providers')
  check(/did not accept the key/.test(aiServiceAdvice({ status: 401, message: 'The AI service answered 401: Unauthorized' })), 'a refused key is named')
  check(/does not know that model/.test(aiServiceAdvice({ status: 404, message: 'The AI service answered 404: Not found' })), 'an unknown model is named')
  check(/"max_tokens too big"/.test(aiServiceAdvice({ status: 400, message: 'The AI service answered 400: max_tokens too big' })), "a refused question shows the service's own words")
  check(/retired/.test(aiServiceAdvice({ status: 410, message: 'The AI service answered 410: end of life' })) && /press Test/.test(aiServiceAdvice({ status: 410, message: 'x' })),
    'a retired model is named, with how to find one that works')
  const { suggestModels } = await import('@/lib/ai/providers')
  const picks = suggestModels(['nvidia/nv-embedqa-e5-v5', 'meta/llama-guard-4-12b', 'moonshotai/kimi-k2-instruct', 'meta/llama-3.1-8b-instruct', 'openai/gpt-oss-120b', 'qwen/qwen2.5-coder-32b-instruct'])
  check(picks[0] === 'moonshotai/kimi-k2-instruct' && picks[1] === 'openai/gpt-oss-120b' && !picks.some((p) => /embed|guard|coder/.test(p)),
    'Test suggests chat models, strong tool users first, never embeddings or filters')
  check(read('src/app/api/admin/ai/route.ts').includes('listModels(') && read('src/app/api/admin/ai/route.ts').includes('offers now include'),
    'Test lists the models the service offers when the model is unknown or retired')
  check(!read('src/lib/ai/providers.ts').includes("defaultModel: 'meta/llama-3.3-70b-instruct'"), 'the retired NVIDIA model is no longer the default')
  const compatNow = read('src/lib/ai/compat.ts')
  check(/err\.status !== 404 && err\.status !== 410/.test(compatNow) && compatNow.includes('suggestModels(await listModels(conn))') && compatNow.includes('replacements.set(key, model)'),
    'a retired or unknown model is replaced by the best current one the service offers, and remembered')
  const askRoute = read('src/app/api/admin/ask/route.ts')
  check(askRoute.includes('error instanceof AiServiceError') && askRoute.includes('aiServiceAdvice(error)'), 'Ask Xtend says what the AI service said instead of "Something went wrong"')

  // Never sent back.
  const page = read('src/app/admin/ai/page.tsx')
  check(/select\('provider, key_hint, updated_at'\)/.test(page) && !/key_cipher/.test(page), 'the page reads only the hint and the date')
  const route = read('src/app/api/admin/ai/route.ts')
  check(/requireApiSession\(\['admin'\]\)/.test(route) && /requireRecentAuth\(session\)/.test(route), 'admins only, password again to save or remove')
  check(route.split('\n').filter((l) => l.includes('Response.json')).every((l) => !/apiKey|key_cipher|input\.key/.test(l))
        && /replace\(apiKey, '\[key\]'\)/.test(route), 'no answer carries a key, not even in an error')
  check(/ends_with: keyHint\(key\)/.test(route) && !/key: input\.key/.test(route), 'the audit log records the provider and last 4 only')
  check(/ai_provider_keys/.test(read('supabase/migrations/0102_ai_providers.sql')) && /revoke all on public\.ai_provider_keys/.test(read('supabase/migrations/0102_ai_providers.sql')), 'the database lets only the server read them')
  check(/aiFor\('staff_helper'\)/.test(read('src/lib/support-assistant.ts')) && /aiFor\('admin_assistant'\)/.test(read('src/lib/assistant.ts')), 'the staff helper and Ask Xtend use the chosen AI')
  check(/Read the staff guide|staff guide/.test(read('src/lib/support-assistant.ts')) && /Google Maps link/.test(read('src/lib/support-assistant.ts')), 'the staff helper explains the new refusals and points to the guide')

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL AI PROVIDER CHECKS PASSED')
}
void main()
