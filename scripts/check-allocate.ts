/**
 * Checks the Ask Xtend allocation helpers without a database or the API:
 * name matching against the real stockist list, plan building from the
 * references the model is given, and reading attached files.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-allocate.ts
 */
import { readFileSync } from 'fs'
import { AllocationContext, similarity } from '@/lib/assistant-allocate'
import { attachmentBlocks } from '@/lib/assistant-attachment'

let fails = 0
const ok = (cond: boolean, label: string) => { console.log(cond ? 'ok  ' : 'FAIL', label); if (!cond) fails++ }

const stores = readFileSync('data/stockists-july.csv', 'utf8').split('\n').slice(1).filter(Boolean)
  .map((line, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, name: line.match(/^"([^"]+)"|^([^,]+)/)![1] ?? line.split(',')[0], address: null }))
const people = [
  { user_id: 'a1', staff_name: 'Ada Okafor', role: 'merchandiser', is_active: true, home_outlet_name: null, outlet_names: [stores[3].name] },
  { user_id: 'b2', staff_name: 'Bala Yusuf', role: 'merchandiser', is_active: true, home_outlet_name: null, outlet_names: [] },
  { user_id: 'c3', staff_name: 'Chiamaka Obi', role: 'merchandiser', is_active: true, home_outlet_name: null, outlet_names: [] },
  { user_id: 'c4', staff_name: 'Chioma Obi', role: 'merchandiser', is_active: true, home_outlet_name: null, outlet_names: [] },
]
const sups = [{ id: 's1', full_name: 'Tunde Bello', role: 'supervisor' }]
const fake: any = {
  from: (t: string) => {
    const q: any = { select: () => q, eq: () => q, limit: () => q,
      then: (r: any) => r({ data: t === 'staff_allocation' ? people : stores, error: null }) }
    return q
  },
  rpc: (fn: string) => Promise.resolve({ data: fn === 'available_supervisors' ? sups : people.map(p => ({ id: p.user_id, supervisor_id: null })), error: null }),
}

;(async () => {
  console.log('store sample:', stores.slice(0, 3).map(s => s.name))
  ok(similarity('Justrite Bariga', 'Justrite Superstore Bariga, Lagos') > 0.8, 'short store name matches the long one')
  ok(similarity('ada okafor', 'Ada Okafor') === 1, 'names match whatever the case')
  ok(similarity('Ada Okafor', 'Bala Yusuf') < 0.35, 'different people do not match')

  const ctx = new AllocationContext(fake, true)
  const m: any = await ctx.match({ people: ['ADA okafor', 'Chioma Obi', 'Nobody Here'], stores: [stores[10].name.toLowerCase(), 'Zzzz Qqqq'], supervisors: ['tunde'] })
  ok(m.people[0].candidates[0].name === 'Ada Okafor', 'finds Ada in capitals')
  ok(m.people[1].candidates[0].name === 'Chioma Obi' && m.people[1].candidates.length >= 1, 'finds Chioma over Chiamaka')
  console.log('  Chioma candidates:', m.people[1].candidates.map((c: any) => `${c.name} ${c.score}`))
  ok(m.people[2].candidates.length === 0, 'an unknown person has no candidates')
  ok(m.stores[0].candidates[0].name === stores[10].name, `finds store "${stores[10].name}" among ${stores.length}`)
  ok(m.stores[1].candidates.length === 0, 'a nonsense store has no candidates')
  ok(m.supervisors[0].candidates[0].name === 'Tunde Bello', 'finds the supervisor by first name')
  ok(m.people[0].candidates[0].allocated_stores[0] === stores[3].name, 'a person comes with their current stores')

  const P = m.people[0].candidates[0].ref, S = m.stores[0].candidates[0].ref, V = m.supervisors[0].candidates[0].ref
  const plan = await ctx.plan({
    store_allocations: [{ person: P, stores: [S], mode: 'add' }, { person: P.toLowerCase(), stores: [S], mode: 'add' }],
    supervisor_assignments: [{ person: P, supervisor: V }],
    unmatched: ['Nobody Here: not on the staff list'],
  })
  ok(plan.stores.length === 1 && plan.stores[0].outlet_ids.length === 1, 'the same person twice becomes one change')
  ok(plan.stores[0].current_names[0] === stores[3].name, 'the plan shows what they have now')
  ok(plan.supervisors[0].supervisor_name === 'Tunde Bello', 'the plan names the supervisor')
  let threw = ''
  try { await ctx.plan({ store_allocations: [{ person: 'P99', stores: [S], mode: 'add' }] }) } catch (e: any) { threw = e.message }
  ok(threw.includes('not a person reference'), 'an invented reference is refused')
  try { await ctx.plan({ store_allocations: [{ person: S, stores: [S], mode: 'add' }] }) } catch (e: any) { threw = e.message }
  ok(threw.includes('not a person reference'), 'a store reference used as a person is refused')

  const sup = new AllocationContext(fake, false)
  const m2: any = await sup.match({ people: ['Ada'], stores: [], supervisors: ['Tunde'] })
  ok(typeof m2.supervisors === 'string', 'a supervisor is told they cannot assign supervisors')
  threw = ''
  try { await sup.plan({ supervisor_assignments: [{ person: 'P1', supervisor: null }] }) } catch (e: any) { threw = e.message }
  ok(threw.includes('Only an admin'), 'and cannot put it in a plan')

  // Attachments
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('July')
  ws.addRow(['Merchandiser', 'Store']); ws.addRow(['Ada Okafor', 'Justrite, Bariga']); ws.addRow(['Bala Yusuf', { formula: '1+1', result: 2 }])
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')
  const blocks: any = await attachmentBlocks({ name: 'alloc.xlsx', type: '', data: xlsx })
  console.log('  xlsx ->', JSON.stringify(blocks[0].text))
  ok(blocks[0].text.includes('Ada Okafor,"Justrite, Bariga"') && blocks[0].text.includes('Bala Yusuf,2'), 'an Excel file becomes CSV text, formulas as their values')
  const csv: any = await attachmentBlocks({ name: 'a.csv', type: 'text/csv', data: Buffer.from('name,store\nAda,Ikeja').toString('base64') })
  ok(csv[0].text.includes('Ada,Ikeja'), 'a CSV is passed as text')
  const pdf: any = await attachmentBlocks({ name: 'a.pdf', type: 'application/pdf', data: 'JVBERi0=' })
  ok(pdf[0].type === 'document', 'a PDF goes to the model as a document')
  const img: any = await attachmentBlocks({ name: 'a.jpg', type: 'image/jpeg', data: '/9j/' })
  ok(img[1].type === 'image', 'a photo goes as an image')
  threw = ''
  try { await attachmentBlocks({ name: 'x.bin', type: 'application/octet-stream', data: Buffer.from([0, 1, 2, 0]).toString('base64') }) } catch (e: any) { threw = e.message }
  ok(threw.includes('cannot be read'), 'a binary file is refused')

  console.log(fails ? `${fails} FAILED` : 'ALL OK')
  process.exit(fails ? 1 : 0)
})()
