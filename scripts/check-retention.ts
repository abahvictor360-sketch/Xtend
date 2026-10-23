/**
 * Checks the 14-day rule and the day-before notice (src/lib/retention.ts,
 * migration 0067): the rule itself, the words admins and supervisors get,
 * where the notice links, and how people with the same words are grouped.
 * The database decides who is due what (retention_notice_due, tested in
 * supabase/tests/rules.sql); this checks what they are told.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-retention.ts
 */
import {
  RETENTION_DAYS,
  SELFIE_RETENTION_HOURS,
  SELFIE_RETENTION_NOTE,
  groupRetentionNotices,
  retentionDateLabel,
  retentionMessage,
  type RetentionDue,
} from '@/lib/retention'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

// 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos.
const through = '2026-10-09T23:30:00Z'

check(RETENTION_DAYS === 14 && SELFIE_RETENTION_HOURS === 336, 'the rule is 14 days')
check(SELFIE_RETENTION_NOTE.includes('14 days') && !SELFIE_RETENTION_NOTE.includes('24 hours'),
  'the office is told 14 days', SELFIE_RETENTION_NOTE)
check(retentionDateLabel(through) === '10 Oct 2026', 'dates are Lagos dates', retentionDateLabel(through))

const admin: RetentionDue = { user_id: 'a1', role: 'admin', selfies: 12, report_photos: 2, report_files: 1 }
const m = retentionMessage(admin, through)!
check(m.title === 'Files deleted tomorrow', 'the title says what happens', m.title)
check(m.body.startsWith('Tomorrow Xtend will delete 12 clock-in photos, 2 unused report photos and 1 unused report document older than 14 days (from before 10 Oct 2026).'),
  'an admin is told every kind and how many, and from when', m.body)
check(m.body.includes('Download anything you need from Attendance today.') && m.url === '/admin/attendance',
  'clock-in photos send them to Attendance', m)
check(m.body.includes('Reports and the files on them are kept.'), 'and that reports stay')
check(m.body.length <= 400 && m.title.length <= 80, 'it fits a notification')

const sup = retentionMessage({ user_id: 's1', role: 'supervisor', selfies: 1, report_photos: 0, report_files: 0 }, through)!
check(sup.body.startsWith('Tomorrow Xtend will delete 1 clock-in photo from your team older than 14 days'),
  'a supervisor hears about their own team, one in the singular', sup.body)

const files = retentionMessage({ user_id: 's2', role: 'supervisor', selfies: 0, report_photos: 3, report_files: 0 }, through)!
check(files.body.startsWith('Tomorrow Xtend will delete 3 unused report photos from your team')
  && files.url === '/admin/marketer-reports' && files.body.includes('from Marketer reports today'),
  'only unused report files send them to Marketer reports', files)

check(retentionMessage({ user_id: 'x', role: 'admin', selfies: 0, report_photos: 0, report_files: 0 }, through) === null,
  'nobody is told when nothing is due')
check(!/location|monitor|integrity|tracked/i.test(m.body + sup.body + files.body), 'the notice says nothing about monitoring')

const groups = groupRetentionNotices([
  admin,
  { ...admin, user_id: 'a2' },
  { ...admin, user_id: 'a2' },
  { user_id: 's1', role: 'supervisor', selfies: 1, report_photos: 0, report_files: 0 },
  { user_id: 's3', role: 'supervisor', selfies: 1, report_photos: 0, report_files: 0 },
  { user_id: 's4', role: 'supervisor', selfies: 0, report_photos: 0, report_files: 0 },
], through)
check(groups.length === 2, 'people with the same words share one notification', groups.length)
check(groups[0].userIds.join() === 'a1,a2' && groups[1].userIds.join() === 's1,s3',
  'each person once, and nobody with nothing due', groups.map((g) => g.userIds))

if (failed) {
  console.log(`\n${failed} RETENTION CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL RETENTION CHECKS PASSED')
