/**
 * Checks each person's AI allowance (0109): counted in the database before
 * every answer, the message says which limit and when it comes back, the
 * staff helper hands over to the office past it, and only admins change it.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-ai-limits.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { aiLimitMessage } from '@/lib/ai/providers'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

check(/today's 200 Ask Xtend questions\. It starts again tomorrow/.test(aiLimitMessage({ period: 'day', limit: 200 }, 'Ask Xtend questions')),
  'past the daily limit: says so, and that it starts again tomorrow')
check(/40 questions in the last hour/.test(aiLimitMessage({ period: 'hour', limit: 40 })), 'past the hourly limit: says so')

const m = read('supabase/migrations/0109_ai_limits.sql')
check(/pg_advisory_xact_lock/.test(m) && /'period', 'day'/.test(m) && /'period', 'hour'/.test(m) && /check \(per_day >= per_hour\)/.test(m),
  'the database counts each use, one request at a time, against an hourly and a daily limit')
check(/revoke all on public\.ai_limits, public\.ai_usage from anon, authenticated/.test(m) && /grant execute on function public\.consume_ai_use\(uuid, text\) to service_role/.test(m),
  'only the server reads the counts and counts a use')
const ask = read('src/app/api/admin/ask/route.ts')
check(/takeAiUse\(session\.userId, 'admin_assistant'\)/.test(ask) && /status: 429/.test(ask), 'Ask Xtend checks the allowance before every question')
const helper = read('src/lib/support-assistant.ts')
check(/takeAiUse\(thread\.user_id, 'staff_helper'\)/.test(helper) && helper.indexOf("takeAiUse(thread.user_id") > helper.indexOf("aiFor('staff_helper')"),
  'the staff helper checks it before answering (after there is a key at all), and past it the office answers')
const route = read('src/app/api/admin/ai/route.ts')
check(/action: z\.literal\('set_limits'\)/.test(route) && /'ai\.limits_set'/.test(route) && /requireApiSession\(\['admin'\]\)/.test(route),
  'only admins change the limits, and it is audited')
check(read('src/components/admin/ai-settings.tsx').includes('Limits per person'), 'Settings → AI keys has the limits, with today’s use')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL AI LIMITS CHECKS PASSED')
