/**
 * Checks Ask Xtend's dashboard actions without the model or a database:
 * the cards it builds from references, what Apply accepts, and who may do
 * the admin-only ones.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-assistant-actions.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActionBuilder } from '@/lib/assistant-actions'
import { actionSchema } from '@/lib/assistant-action-types'
import type { AllocationContext } from '@/lib/assistant-allocate'

let failed = 0
function check(ok: boolean, label: string, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}: ${label}${ok ? '' : ` (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}
async function throws(p: Promise<unknown>, like: RegExp, label: string) {
  try {
    await p
    check(false, label, 'no error')
  } catch (e) {
    check(like.test((e as Error).message), label, (e as Error).message)
  }
}

const ADA = '11111111-1111-4111-8111-111111111111'
const BALA = '22222222-2222-4222-8222-222222222222'
const KEMI = '33333333-3333-4333-8333-333333333333'
const MALL = '44444444-4444-4444-8444-444444444444'
const refs: Record<string, { kind: string; id: string }> = {
  P1: { kind: 'person', id: ADA },
  P2: { kind: 'person', id: BALA },
  P3: { kind: 'person', id: KEMI },
  S1: { kind: 'store', id: MALL },
}
const allocation = {
  load: async () => {},
  people: [
    { id: ADA, name: 'Ada Obi', role: 'merchandiser', home: null, stores: ['Ikeja City Mall'], supervisor_id: null },
    { id: BALA, name: 'Bala Musa', role: 'merchandiser', home: null, stores: [], supervisor_id: null },
    { id: KEMI, name: 'Kemi Ade', role: 'marketer', home: null, stores: [], supervisor_id: null },
  ],
  stores: [{ id: MALL, name: 'Ikeja City Mall', address: null }],
  resolve(ref: unknown, kind: string) {
    const r = refs[String(ref)]
    if (!r || r.kind !== kind) throw new Error(`"${String(ref)}" is not a ${kind} reference from match_names`)
    return r.id
  },
} as unknown as AllocationContext

// resolve_notification_targets, as the database would answer it.
const supabase = {
  rpc: async (_name: string, args: { p_audience: string; p_detail: { user_ids?: string[] } }) => ({
    data:
      args.p_audience === 'users'
        ? (args.p_detail.user_ids ?? []).map((id) => ({ full_name: id === ADA ? 'Ada Obi' : 'Bala Musa', devices: id === ADA ? 1 : 0 }))
        : [
            { full_name: 'Ada Obi', devices: 1 },
            { full_name: 'Bala Musa', devices: 2 },
          ],
    error: null,
  }),
} as unknown as SupabaseClient

async function main() {
  const admin = new ActionBuilder(supabase, allocation, true)
  const supervisor = new ActionBuilder(supabase, allocation, false)

  const n = await admin.notify({ title: 'Clock in now', message: 'Please clock in.', audience: 'people', people: ['P1', 'P2', 'P1'], open_page: '/field', role: null, store: null })
  check(n.title === 'Send a notification to 2 people' && 'user_ids' in n.payload && n.payload.user_ids.length === 2, 'a notification to named people, each once', n)
  check(/1 of them has notifications off/.test(n.warning ?? ''), 'it warns about who will not get it', n.warning)
  check(actionSchema.safeParse({ kind: n.kind, payload: n.payload }).success, 'what the card sends back is what Apply accepts')
  const off = await admin.notify({ title: 'Hi', message: 'Hello', audience: 'everyone', open_page: 'https://evil.example', people: [], role: null, store: null })
  check('url' in off.payload && off.payload.url === null, 'a link off Xtend is dropped from a notification')
  await throws(admin.notify({ title: 'Hi', message: 'x', audience: 'people', people: ['Ada'] }), /not a person reference/, 'a name instead of a reference is refused')

  const c = await admin.countRequest({ group: 'all_merchandisers', people: [], due_date: '2000-01-01', note: '' })
  check('due_date' in c.payload && c.payload.user_ids.length === 2 && c.payload.due_date > '2000-01-01', 'all merchandisers, and a past date becomes tomorrow', c.payload)
  const all = await admin.countRequest({ group: 'all_field_staff', people: [], due_date: null, note: 'Shelf A' })
  check('user_ids' in all.payload && all.payload.user_ids.length === 3, 'all field staff includes marketers')

  await throws(supervisor.salesTarget({ month: '2026-10', person: 'P1', store: null, units: 50 }), /Only an admin/, 'a supervisor cannot set targets')
  const t = await admin.salesTarget({ month: '2026-10', person: null, store: 'S1', units: 500 })
  check('target_units' in t.payload && t.payload.outlet_id === MALL && t.payload.user_id === null, 'a store target', t.payload)
  await throws(supervisor.xmStore({ store: 'S1', enrol: true }), /Only an admin/, 'a supervisor cannot change X Metrics stores')

  const d = await supervisor.deactivate({ person: 'P2' })
  check(d.kind === 'deactivate' && d.verb === 'Deactivate' && d.warning != null, 'deactivating is shown with its consequence')

  const link = await admin.link({ page: 'movement', person: 'P1', from: '2026-10-06', to: '2026-10-08', label: '' })
  check(link.href === `/admin/tracking?person=${ADA}&date=2026-10-06&until=2026-10-08` && link.label === 'Movement: Ada Obi', 'a movement link for a person and days', link)
  const a = await admin.link({ page: 'attendance', person: 'P1', from: '2026-10-08', to: null, label: 'Today' })
  check(a.href === `/admin/attendance?user_id=${ADA}&from=2026-10-08`, 'an attendance link', a)
  await throws(admin.link({ page: 'settings' }), /Unknown page/, 'only known pages')

  check(!actionSchema.safeParse({ kind: 'delete_everything', payload: {} }).success, 'Apply refuses an unknown action')
  check(!actionSchema.safeParse({ kind: 'deactivate', payload: { user_id: 'Ada' } }).success, 'Apply refuses a non-id')

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nALL ASSISTANT ACTION CHECKS PASSED')
}
main()
