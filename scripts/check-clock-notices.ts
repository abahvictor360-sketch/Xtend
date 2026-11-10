/**
 * Checks the notice a person gets when a clock-in or clock-out made with no
 * signal was NOT recorded after all (src/lib/clock-notices.ts): the words
 * name what and when and say to do it again, notices wait on the phone until
 * shown, repeat ones are not doubled, and a phone with no storage is fine.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-clock-notices.ts
 */
import { CLOCK_NOTICES_KEY, addClockNotice, clockNotice, takeClockNotices, type NoticeStore } from '@/lib/clock-notices'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  if (ok) console.log(`ok: ${label}`)
  else {
    failed += 1
    console.log(`FAIL: ${label}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`)
  }
}

function memoryStore(): NoticeStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

// The words.
const a = clockNotice('opening', '08:12', 'Turn on Xtend notifications before clocking in')
check(a.includes('clock-in') && a.includes('08:12') && a.includes('NOT recorded'), 'a clock-in notice names what, when, and says not recorded', a)
check(a.includes('Turn on Xtend notifications before clocking in') && a.endsWith('Clock in again now.'), 'it gives the server\'s reason and says to clock in again', a)
const b = clockNotice('closing', '17:40', 'The selfie must be taken in the app just now.')
check(b.includes('clock-out') && b.endsWith('Clock out again now.'), 'a clock-out notice says clock out again', b)
check(!b.includes('now..'), 'a reason that already ends in a full stop is not doubled', b)
const c = clockNotice('opening', '09:05', null)
check(c.includes('could not be sent in time') && c.includes('NOT recorded'), 'no reason: says it could not be sent in time', c)
check(clockNotice('opening', '09:05', '   ').includes('could not be sent in time'), 'a blank reason is treated as none')

// Waiting on the phone.
const store = memoryStore()
check(takeClockNotices(store).length === 0, 'nothing waiting gives nothing')
addClockNotice(store, a)
addClockNotice(store, b)
addClockNotice(store, a)
check(JSON.parse(store.data.get(CLOCK_NOTICES_KEY) ?? '[]').length === 2, 'the same notice is not kept twice')
const taken = takeClockNotices(store)
check(taken.length === 2 && taken.includes(a) && taken.includes(b), 'waiting notices come back', taken)
check(takeClockNotices(store).length === 0 && !store.data.has(CLOCK_NOTICES_KEY), 'once shown they are cleared')

const many = memoryStore()
for (let i = 0; i < 8; i++) addClockNotice(many, clockNotice('opening', `0${i}:00`, `reason ${i}`))
const kept = takeClockNotices(many)
check(kept.length === 5 && kept[4].includes('reason 7') && !kept.some((n) => n.includes('reason 0')), 'only the latest five are kept', kept.length)

// A phone with no storage, or garbage in it, never breaks anything.
addClockNotice(null, a)
check(takeClockNotices(null).length === 0 && takeClockNotices(undefined).length === 0, 'no storage: nothing shown, nothing breaks')
const broken = memoryStore()
broken.data.set(CLOCK_NOTICES_KEY, '{not json')
check(takeClockNotices(broken).length === 0, 'unreadable saved notices are ignored')
const throwing: NoticeStore = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
  removeItem: () => { throw new Error('denied') },
}
addClockNotice(throwing, a)
check(takeClockNotices(throwing).length === 0, 'storage that throws is survived')

if (failed) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nALL CLOCK NOTICE CHECKS PASSED')
