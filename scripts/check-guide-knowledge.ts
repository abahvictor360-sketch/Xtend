/**
 * Checks the AI answers from the staff guide (0104): its copy of the guide
 * is current, covers every pop-up, never mentions how staff are monitored,
 * and the staff helper and Ask Xtend read the office's notes, which only
 * the server reads and only an admin changes (audited).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-guide-knowledge.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { guideFile, GUIDE_TEXT_FILE } from './make-guide-knowledge'
import { GUIDE_PROBLEMS, guideFor } from '@/lib/field-guide'

let failed = 0
function check(ok: boolean, label: string) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`)
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const { text, file } = guideFile()
check(fs.readFileSync(GUIDE_TEXT_FILE, 'utf8') === file, "the AI's copy of the staff guide is current (else run scripts/make-guide-knowledge.ts)")
check(text.length > 15_000 && text.length < 40_000, `the guide is rich but not too long for every question (${text.length} characters)`)
check(!/<[a-z][^>]*>/i.test(text) && !/&(amp|quot|#39);/.test(text), 'it is plain text: no HTML left in it')
check(GUIDE_PROBLEMS.length === 16, 'every pop-up problem is listed')
for (const p of GUIDE_PROBLEMS) {
  const a = guideFor(p, 'android', 'clock in or check in')
  const i = guideFor(p, 'ios', 'clock in or check in')
  check(text.includes(`### ${a.title}`) && a.steps.every((s) => text.includes(s)) && i.steps.every((s) => text.includes(s)),
    `the guide gives the pop-up's own steps for "${a.title}" (Android and iPhone)`)
}
for (const q of ['How does Xtend know which store I am clocking in at?', 'The store I am at is not on my list', 'I forgot to check out of a store', 'What time should I clock in?', 'There is no signal in my store'])
  check(text.includes(`Q: ${q}`), `the questions staff ask include "${q}"`)
check(text.includes('Pick the store you are starting at') && text.includes('today does not count'), 'the clock-in section explains the marketer start of day')
check(!/monitor|tracking|tracked|integrity|fake location|\bvpn\b|follow/i.test(text), 'the guide never tells staff how they are monitored')

const helper = read('src/lib/support-assistant.ts')
check(helper.includes("import { STAFF_GUIDE_TEXT } from '@/lib/generated/staff-guide-text'") && helper.includes('${STAFF_GUIDE_TEXT}'), 'the staff helper reads the guide')
check(helper.includes('aiKnowledge()') && helper.includes('memberDay(admin, thread.user_id)'), "the staff helper reads the office's notes and the member's day")
check(helper.includes("cache_control: { type: 'ephemeral' }"), 'the guide part of the prompt is cached')
check(helper.includes('You → How to use Xtend') && !helper.includes('Account → Staff guide'), 'it points to where the guide really is')
check(helper.includes('do not guess: escalate'), 'what the guide and notes do not cover goes to the office')
check(read('src/lib/assistant.ts').includes('await aiKnowledge()'), "Ask Xtend reads the office's notes too")

const sql = read('supabase/migrations/0104_ai_knowledge.sql')
check(/enable row level security/.test(sql) && /revoke all on public\.ai_knowledge from anon, authenticated/.test(sql), 'the notes are the server’s alone (0104)')
check(/length\(body\) <= 20000/.test(sql) && /check \(id\)/.test(sql), 'one box of notes, capped at 20,000 characters')
const route = read('src/app/api/admin/ai/route.ts')
check(route.includes("requireApiSession(['admin'])") && route.includes("'ai.knowledge_set'") && route.includes('forgetAiSettings()'), 'only an admin saves the notes, it is audited, and the AI uses them at once')
check(read('src/lib/ai/config.ts').includes("from('ai_knowledge')"), 'the server reads the notes with the AI settings')
check(read('src/lib/system-reset.ts').includes("table: 'ai_knowledge'"), 'a system reset keeps the notes')

if (failed) {
  console.log(`${failed} FAILED`)
  process.exit(1)
}
console.log('ALL GUIDE KNOWLEDGE CHECKS PASSED')
