/**
 * Checks the staff app as a guide: the pop-up that says why something did
 * not work and what to do (lib/field-guide.ts), "Your next step" on Home
 * (lib/next-step.ts), the check-in prompt after a marketer clocks in, and
 * the "check out of the store before you leave" reminders (0099).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-field-guide.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { guideFor, problemFromGeo } from '@/lib/field-guide'
import { nextStep, type NextStepState } from '@/lib/next-step'
import { visitReminderMessage, VISIT_REMINDER_MINUTES } from '@/lib/visit-reminder'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}`, got === undefined ? '' : JSON.stringify(got))
  }
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

// The pop-up.
check(problemFromGeo('permission_denied') === 'location_permission' && problemFromGeo('position_unavailable') === 'location_off'
  && problemFromGeo('low_accuracy') === 'low_accuracy' && problemFromGeo('unsupported') === 'location_unsupported',
  'each location problem has its guide')
for (const p of ['location_permission', 'location_off', 'low_accuracy', 'location_unsupported', 'phone_settings'] as const) {
  for (const platform of ['android', 'ios', null] as const) {
    const g = guideFor(p, platform)
    check(g.title.length > 0 && g.why.length > 0 && g.steps.length >= 2 && g.actionLabel.length > 0, `${p} on ${platform ?? 'a browser'}: a title, why, steps and a button`)
  }
}
check(/Allow all the time/.test(guideFor('location_permission', 'android').steps.join(' ')), 'Android is told to allow location all the time')
check(/Unrestricted/.test(guideFor('phone_settings', 'android').steps.join(' ')), 'Android is told to set battery to Unrestricted')
check(/Precise Location/.test(guideFor('location_permission', 'ios').steps.join(' ')), 'iPhone is told to turn on Precise Location')
check(guideFor('phone_settings', 'android', 'check in at the store').title.includes('check in at the store'), 'the guide names what they were doing')
const allText = JSON.stringify(['location_permission', 'location_off', 'low_accuracy', 'phone_settings'].map((p) => guideFor(p as never, 'android')))
check(!/monitor|track|alert|integrity|supervisor will see/i.test(allText), 'the guide never mentions monitoring')

// Your next step.
const base: NextStepState = { clockedIn: false, clockedOut: false, offDay: false, reportRequired: true, reportFiled: false, visitsStores: true, openVisit: null, visitsDone: 0 }
check(nextStep(base).key === 'clock_in' && nextStep(base).action === 'clock', 'first: clock in')
check(/first store/.test(nextStep(base).description), 'a marketer is told the store comes next')
check(nextStep({ ...base, clockedIn: true }).key === 'first_store' && nextStep({ ...base, clockedIn: true }).action === 'check_in', 'clocked in: check in at the first store')
const inStore = nextStep({ ...base, clockedIn: true, openVisit: { store: 'Justrite Ogba', since: '10:05' } })
check(inStore.key === 'in_store' && inStore.action === 'check_out' && /Check out of Justrite Ogba before you leave/.test(inStore.description) && /10:05/.test(inStore.description),
  'in a store: check out before you leave, with the store and time', inStore)
check(nextStep({ ...base, clockedIn: true, visitsDone: 2 }).key === 'next_store', 'between stores: the next store')
check(nextStep({ ...base, clockedIn: true, clockedOut: true }).key === 'report', 'clocked out with no report: the report')
check(nextStep({ ...base, clockedIn: true, clockedOut: true, reportFiled: true }).key === 'done', 'all done')
check(nextStep({ ...base, visitsStores: false, clockedIn: true, reportRequired: false }).key === 'on_shift', 'a merchandiser on shift')
check(nextStep({ ...base, offDay: true }).key === 'off', 'a day off')

// The reminder.
const m = visitReminderMessage('Justrite Ogba', '10:05')
check(m.title === 'Still at Justrite Ogba?' && m.body === 'Check out of Justrite Ogba before you leave. You checked in at 10:05.', 'the reminder says the store and when', m)
check(visitReminderMessage(null, 'x').body === 'Check out of the store before you leave.', 'with no store or time it still reads')
const mig = read('supabase/migrations/0099_store_checkout_reminders.sql')
check(mig.includes(`select ${VISIT_REMINDER_MINUTES} $$`), 'the database reminds every 25 minutes, as the app says')
check(/flushVisitCheckoutReminders\(\)/.test(read('src/app/api/cron/alerts/route.ts')), 'the five-minute job sends them')

// Wiring.
const home = read('src/components/field/field-home.tsx')
check(/xt-checkin-ask-/.test(home) && /You are clocked in\. Now check in at a store/.test(home), 'after clocking in a marketer is asked to check in at a store (once a day)')
check(/ask=\{visitAsk\}/.test(home) && /<TodayFocus/.test(home), 'Your next step starts the check-in or check-out')
check(/setGuide\(problemFromGeo/.test(read('src/components/field/clock-panel.tsx')) && /setGuide\('phone_settings'\)/.test(read('src/components/field/clock-panel.tsx')),
  'clock-in shows the guide when location or settings are in the way')
check((read('src/components/field/store-visits.tsx').match(/setGuide\(problemFromGeo/g) ?? []).length === 4, 'store check-in and check-out show it too')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL FIELD GUIDE CHECKS PASSED')
