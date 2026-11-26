import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AllocationContext } from '@/lib/assistant-allocate'
import { PAGES, type PageLink, type PageName, type ProposedAction } from '@/lib/assistant-action-types'
import { TZ, addDays, lagosDateString, longDate, monthLabel } from '@/lib/utils'
import { CORRECTION_ACTIONS, planCorrection, type CorrectionAction, type CorrectionDay } from '@/lib/field-corrections'
import { placeFromMapLink } from '@/lib/map-place'

/**
 * Turns what the model proposes (with P…, S…, F…, R… references) into an
 * action card the person can check and Apply. Names and counts are read
 * here, under the caller's own RLS, so the card says exactly who it
 * reaches. Nothing is written: the Apply button does that, through the
 * page's own route.
 */

type Input = Record<string, unknown>

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown) => (Array.isArray(v) ? v : [])
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Normalise "8", "8:00", "8am", "9:30 pm", "18:00" to 24h "HH:MM", or null. */
function normTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ap = m[3]
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
let counter = 0
const key = (kind: string) => `${kind}-${Date.now().toString(36)}-${(counter++).toString(36)}`

function names(all: string[], max = 8) {
  return all.length <= max ? all.join(', ') : `${all.slice(0, max).join(', ')} and ${all.length - max} more`
}

const ROLE_WORDS = {
  merchandiser: 'merchandisers',
  marketer: 'marketers',
  supervisor: 'supervisors',
  admin: 'admins',
} as const

export class ActionBuilder {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly people: AllocationContext,
    private readonly isAdmin: boolean,
  ) {}

  private adminOnly(what: string) {
    if (!this.isAdmin) throw new Error(`Only an admin can ${what}.`)
  }

  private async person(ref: unknown) {
    await this.people.load()
    const id = this.people.resolve(ref, 'person')
    const p = this.people.people.find((x) => x.id === id)
    if (!p) throw new Error('That person is not one you can manage.')
    return p
  }

  private async store(ref: unknown) {
    await this.people.load()
    const id = this.people.resolve(ref, 'store')
    const s = this.people.stores.find((x) => x.id === id)
    if (!s) throw new Error('That store is not one you can see.')
    return s
  }

  async notify(input: Input): Promise<ProposedAction> {
    const title = str(input.title, 80)
    const body = str(input.message, 400)
    if (!title || !body) throw new Error('A notification needs a title and a message.')
    const url = typeof input.open_page === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(input.open_page) ? input.open_page : null
    const audience = input.audience as string
    let detail: Record<string, unknown> = {}
    let who = ''
    const payload = {
      title,
      body,
      url,
      audience: 'everyone' as 'everyone' | 'role' | 'outlet' | 'users',
      role: null as 'merchandiser' | 'marketer' | 'supervisor' | 'admin' | null,
      outlet_id: null as string | null,
      user_ids: [] as string[],
    }
    if (audience === 'role') {
      const role = input.role as keyof typeof ROLE_WORDS
      if (!(role in ROLE_WORDS)) throw new Error('Say which role: merchandiser, marketer, supervisor or admin.')
      payload.audience = 'role'
      payload.role = role
      detail = { role }
      who = `all ${ROLE_WORDS[role]}`
    } else if (audience === 'store') {
      const store = await this.store(input.store)
      payload.audience = 'outlet'
      payload.outlet_id = store.id
      detail = { outlet_id: store.id }
      who = `everyone at ${store.name}`
    } else if (audience === 'people') {
      const people = await Promise.all(list(input.people).map((r) => this.person(r)))
      if (!people.length) throw new Error('Name at least one person.')
      payload.audience = 'users'
      payload.user_ids = [...new Set(people.map((p) => p.id))]
      detail = { user_ids: payload.user_ids }
      who = names(people.map((p) => p.name))
    } else {
      who = 'everyone'
    }

    // The same reach the send will have, so the card can say how many.
    const { data, error } = await this.supabase.rpc('resolve_notification_targets', {
      p_audience: payload.audience,
      p_detail: detail,
    })
    if (error) throw new Error(error.message)
    const targets = (data ?? []) as { full_name: string; devices: number }[]
    if (!targets.length) throw new Error(`Nobody matches "${who}".`)
    const noDevice = targets.filter((t) => t.devices === 0).length

    return {
      key: key('notify'),
      kind: 'notify',
      title: `Send a notification to ${targets.length} ${targets.length === 1 ? 'person' : 'people'}`,
      lines: [
        `To: ${who}${payload.audience === 'users' ? '' : ` (${names(targets.map((t) => t.full_name), 6)})`}`,
        `Title: ${title}`,
        `Message: ${body}`,
        ...(url ? [`Opens: ${url}`] : []),
      ],
      warning: noDevice
        ? `${noDevice} of them ${noDevice === 1 ? 'has' : 'have'} notifications off on every phone and will not get it.`
        : null,
      verb: 'Send',
      payload,
    }
  }

  async countRequest(input: Input): Promise<ProposedAction> {
    await this.people.load()
    const group = input.group as string
    let people
    if (group === 'people') {
      people = await Promise.all(list(input.people).map((r) => this.person(r)))
    } else {
      const role = group === 'all_merchandisers' ? 'merchandiser' : group === 'all_marketers' ? 'marketer' : null
      people = this.people.people.filter((p) => (role ? p.role === role : p.role === 'merchandiser' || p.role === 'marketer'))
    }
    people = [...new Map(people.map((p) => [p.id, p])).values()]
    if (!people.length) throw new Error('Nobody to ask.')
    const today = lagosDateString()
    const due = isDate(input.due_date) && input.due_date >= today ? input.due_date : addDays(today, 1)
    const note = str(input.note, 500)
    return {
      key: key('count'),
      kind: 'count_request',
      title: `Ask ${people.length} ${people.length === 1 ? 'person' : 'people'} for a stock count`,
      lines: [`Who: ${names(people.map((p) => p.name))}`, `By: ${longDate(due)}`, ...(note ? [`Note: ${note}`] : [])],
      warning: null,
      verb: 'Request',
      payload: { user_ids: people.map((p) => p.id), due_date: due, note },
    }
  }

  async closeCountRequest(input: Input): Promise<ProposedAction> {
    const id = this.people.resolve(input.request, 'request')
    const { data } = await this.supabase
      .from('count_request_progress')
      .select('due_date, people, counted, is_open, requested_by_name')
      .eq('id', id)
      .maybeSingle()
    if (!data) throw new Error('That request is not one you can see.')
    if (!data.is_open) throw new Error('That request is already closed.')
    return {
      key: key('close'),
      kind: 'close_count_request',
      title: 'Close a stock count request early',
      lines: [
        `Asked by ${data.requested_by_name}, due ${longDate(data.due_date as string)}`,
        `${data.counted} of ${data.people} have counted`,
      ],
      warning: (data.counted as number) < (data.people as number) ? 'The people who have not counted will no longer be asked.' : null,
      verb: 'Close it',
      payload: { request_id: id },
    }
  }

  async phoneCheck(input: Input): Promise<ProposedAction> {
    const p = await this.person(input.person)
    return {
      key: key('phone'),
      kind: 'phone_check',
      title: `Check ${p.name}'s phone now`,
      lines: [
        'A silent check goes to their phone. If it answers, the phone is on and has network right now.',
        'The result shows on Check an excuse and on their record.',
      ],
      warning: null,
      verb: 'Check now',
      payload: { user_id: p.id },
    }
  }

  async reviewFlags(input: Input): Promise<ProposedAction> {
    const ids = [...new Set(list(input.flags).map((r) => this.people.resolve(r, 'flag')))]
    if (!ids.length) throw new Error('Name at least one flag from integrity_flags.')
    const { data } = await this.supabase
      .from('integrity_flag_detail')
      .select('id, staff_name, summary, flag_date, reviewed_at')
      .in('id', ids)
    const rows = (data ?? []) as { id: string; staff_name: string; summary: string; flag_date: string; reviewed_at: string | null }[]
    const open = rows.filter((r) => !r.reviewed_at)
    if (!open.length) throw new Error('Those flags are already reviewed.')
    const note = str(input.note, 500)
    return {
      key: key('flags'),
      kind: 'review_flags',
      title: `Mark ${open.length} flag${open.length === 1 ? '' : 's'} as reviewed`,
      lines: [
        ...open.slice(0, 8).map((r) => `${r.staff_name}, ${r.flag_date}: ${r.summary}`),
        ...(open.length > 8 ? [`and ${open.length - 8} more`] : []),
        ...(note ? [`Note: ${note}`] : []),
      ],
      warning: null,
      verb: 'Mark reviewed',
      payload: { flag_ids: open.map((r) => r.id), note },
    }
  }

  async salesTarget(input: Input): Promise<ProposedAction> {
    this.adminOnly('set sales targets')
    const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month) ? input.month : lagosDateString().slice(0, 7)
    const units = Math.round(Number(input.units))
    if (!Number.isFinite(units) || units < 1) throw new Error('A target is at least 1 unit.')
    const person = input.person ? await this.person(input.person) : null
    const store = !person && input.store ? await this.store(input.store) : null
    if (!person && !store) throw new Error('Say whose target: a person or a store.')
    return {
      key: key('target'),
      kind: 'sales_target',
      title: `Set ${person?.name ?? store!.name}'s sales target for ${monthLabel(`${month}-01`)}`,
      lines: [`${units.toLocaleString('en-NG')} units`, 'Any earlier target for that month is kept in the history; this one counts.'],
      warning: null,
      verb: 'Set target',
      payload: { month, user_id: person?.id ?? null, outlet_id: store?.id ?? null, target_units: units },
    }
  }

  /** Working hours belong to people, wherever they clock in (0100). */
  async staffHours(input: Input): Promise<ProposedAction> {
    await this.people.load()
    const start = normTime(input.shift_start)
    const end = normTime(input.shift_end)
    if (!start || !end) {
      throw new Error('Give both a clock-in and a clock-out time, like 09:00 and 18:00.')
    }
    if (end <= start) throw new Error('The clock-out time must be after the clock-in time.')
    // 0105: optional; empty leaves each person's window as it is.
    const leaveFrom = input.clock_out_from ? normTime(input.clock_out_from) : null
    if (input.clock_out_from && !leaveFrom) throw new Error('Give the clock-out-from time like 18:00.')
    if (leaveFrom && (leaveFrom <= start || leaveFrom > end)) {
      throw new Error('They can only clock out from a time after the start and no later than the end of the day.')
    }
    const group = input.group as string
    let people
    if (group === 'people' || (!group && list(input.people).length)) {
      people = await Promise.all(list(input.people).map((r) => this.person(r)))
    } else {
      const role = group === 'all_merchandisers' ? 'merchandiser' : group === 'all_marketers' ? 'marketer' : null
      people = this.people.people.filter((p) =>
        role ? p.role === role : p.role === 'merchandiser' || p.role === 'marketer',
      )
    }
    people = [...new Map(people.map((p) => [p.id, p])).values()]
    if (!people.length) throw new Error('Name at least one person, or a group.')
    return {
      key: key('hours'),
      kind: 'staff_hours',
      title: `Set the working hours for ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      lines: [
        `Who: ${names(people.map((p) => p.name))}`,
        `Clock in by ${start}, day ends at ${end}`,
        ...(leaveFrom ? [`They can clock out from ${leaveFrom}: clocking out from then is not early.`] : []),
        'Applies wherever they clock in; it sets who counts as late.',
      ],
      warning: null,
      verb: 'Set hours',
      payload: { user_ids: people.map((p) => p.id), shift_start: start, shift_end: end, ...(leaveFrom ? { clock_out_from: leaveFrom } : {}) },
    }
  }

  async workPattern(input: Input): Promise<ProposedAction> {
    await this.people.load()
    const group = input.group as string
    let people
    if (group === 'people' || (!group && list(input.people).length)) {
      people = await Promise.all(list(input.people).map((r) => this.person(r)))
    } else {
      const role = group === 'all_merchandisers' ? 'merchandiser' : group === 'all_marketers' ? 'marketer' : null
      people = this.people.people.filter((p) =>
        role ? p.role === role : p.role === 'merchandiser' || p.role === 'marketer',
      )
    }
    people = [...new Map(people.map((p) => [p.id, p])).values()].filter(
      (p) => p.role === 'merchandiser' || p.role === 'marketer',
    )
    if (!people.length) throw new Error('Schedules are for merchandisers and marketers. Name at least one.')

    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const days = [...new Set(list(input.days).map((d) => Number(d)))]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b)
    if (!days.length) throw new Error('Say which days they work, like Monday to Friday.')

    const off = [0, 1, 2, 3, 4, 5, 6].filter((d) => !days.includes(d))
    return {
      key: key('schedule'),
      kind: 'work_pattern',
      title: `Set the work schedule for ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      lines: [
        `Who: ${names(people.map((p) => p.name))}`,
        `Working days: ${days.map((d) => DOW[d]).join(', ')}`,
        `Days off: ${off.length ? off.map((d) => DOW[d]).join(', ') : 'none'}`,
        'On a day off they are not counted absent and get no clock-in reminder.',
      ],
      warning: null,
      verb: 'Set schedule',
      payload: { user_ids: people.map((p) => p.id), days },
    }
  }

  /** The active products, loaded once, for matching names the model gives. */
  private productList: { id: string; name: string }[] | null = null
  private async products() {
    if (this.productList) return this.productList
    const { data, error } = await this.supabase.from('products').select('id, name').eq('is_active', true)
    if (error) throw new Error(error.message)
    this.productList = (data ?? []) as { id: string; name: string }[]
    return this.productList
  }

  /** Match a product name the model gave to one active product, or null. */
  private matchProduct(all: { id: string; name: string }[], raw: unknown) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const q = norm(str(raw, 120))
    if (!q) return null
    const exact = all.filter((p) => norm(p.name) === q)
    if (exact.length === 1) return exact[0]
    const edge = all.filter((p) => norm(p.name).startsWith(q) || q.startsWith(norm(p.name)))
    if (edge.length === 1) return edge[0]
    const incl = all.filter((p) => norm(p.name).includes(q) || q.includes(norm(p.name)))
    if (incl.length === 1) return incl[0]
    return null
  }

  /**
   * Reads the model's product lines (each with a name) into matched products,
   * failing with the names it could not place so the person can correct them.
   */
  private async resolveLines(rawLines: unknown) {
    const products = await this.products()
    const rows = list(rawLines)
    if (!rows.length) throw new Error('List at least one product.')
    const unmatched: string[] = []
    const out = rows.map((r) => {
      const line = (r ?? {}) as Input
      const p = this.matchProduct(products, line.product)
      if (!p) unmatched.push(str(line.product, 60) || '(no name)')
      return { line, product: p }
    })
    if (unmatched.length) {
      throw new Error(
        `These products are not in the list (add them under Products first, or check the spelling): ${names(unmatched, 10)}.`,
      )
    }
    return out as { line: Input; product: { id: string; name: string } }[]
  }

  async stockCount(input: Input): Promise<ProposedAction> {
    this.adminOnly('record a stock count')
    const store = await this.store(input.store)
    const resolved = await this.resolveLines(input.lines)
    const seen = new Set<string>()
    const lines = resolved.map(({ line, product }) => {
      const onShelf = Math.round(Number(line.on_shelf ?? 0))
      const inBack = Math.round(Number(line.in_backroom ?? line.backroom ?? 0))
      if (![onShelf, inBack].every((n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000)) {
        throw new Error(`Give whole counts from 0 up for ${product.name}.`)
      }
      const batch = str(line.batch, 60)
      const expiry = isDate(line.expiry_date) ? line.expiry_date : isDate(line.expiry) ? (line.expiry as string) : null
      const dedupe = `${product.id}|${batch.toLowerCase()}`
      if (seen.has(dedupe)) throw new Error(`${product.name}${batch ? ` (batch ${batch})` : ''} is counted twice.`)
      seen.add(dedupe)
      return { product_id: product.id, on_shelf: onShelf, in_backroom: inBack, batch, expiry_date: expiry, _name: product.name }
    })
    const shown = lines
      .slice(0, 8)
      .map((l) => `${l._name}: ${l.on_shelf + l.in_backroom} on hand${l.expiry_date ? `, expires ${longDate(l.expiry_date)}` : ''}`)
    return {
      key: key('xmcount'),
      kind: 'xm_count',
      title: `Record a stock count at ${store.name}`,
      lines: [
        `Store: ${store.name}`,
        `Products: ${lines.length}`,
        ...shown,
        ...(lines.length > 8 ? [`and ${lines.length - 8} more`] : []),
        'Recorded in your name, it counts in X Metrics like a count from the store.',
      ],
      warning: null,
      verb: 'Record count',
      payload: { outlet_id: store.id, lines: lines.map(({ _name, ...l }) => l) },
    }
  }

  async supply(input: Input): Promise<ProposedAction> {
    this.adminOnly('log a delivery')
    const store = await this.store(input.store)
    const today = lagosDateString()
    const suppliedOn = isDate(input.supplied_on) && input.supplied_on <= today ? input.supplied_on : today
    const resolved = await this.resolveLines(input.lines)
    const lines = resolved.map(({ line, product }) => {
      const quantity = Math.round(Number(line.quantity ?? line.units ?? 0))
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
        throw new Error(`Give a whole number of units for ${product.name}.`)
      }
      const batch = str(line.batch, 60)
      const expiry = isDate(line.expiry_date) ? line.expiry_date : isDate(line.expiry) ? (line.expiry as string) : null
      if (expiry && expiry < suppliedOn) throw new Error(`The expiry for ${product.name} is before the delivery date.`)
      return { product_id: product.id, quantity, batch, expiry_date: expiry, _name: product.name }
    })
    const shown = lines
      .slice(0, 8)
      .map((l) => `${l._name}: ${l.quantity} units${l.expiry_date ? `, expires ${longDate(l.expiry_date)}` : ''}`)
    return {
      key: key('xmsupply'),
      kind: 'xm_supply',
      title: `Log a delivery to ${store.name}`,
      lines: [
        `Store: ${store.name}`,
        `Delivered: ${longDate(suppliedOn)}`,
        ...shown,
        ...(lines.length > 8 ? [`and ${lines.length - 8} more`] : []),
      ],
      warning: null,
      verb: 'Log delivery',
      payload: { outlet_id: store.id, supplied_on: suppliedOn, lines: lines.map(({ _name, ...l }) => l) },
    }
  }

  async xmStore(input: Input): Promise<ProposedAction> {
    this.adminOnly('change which stores X Metrics scores')
    const store = await this.store(input.store)
    const active = input.enrol !== false
    return {
      key: key('xm'),
      kind: 'xm_store',
      title: `${active ? 'Add' : 'Remove'} ${store.name} ${active ? 'to' : 'from'} X Metrics`,
      lines: [active ? 'Its stock, sales and expiry will be scored from now on.' : 'Its history is kept; it is no longer scored.'],
      warning: null,
      verb: active ? 'Add store' : 'Remove store',
      payload: { outlet_id: store.id, active },
    }
  }

  async deactivate(input: Input): Promise<ProposedAction> {
    const p = await this.person(input.person)
    return {
      key: key('deactivate'),
      kind: 'deactivate',
      title: `Deactivate ${p.name}`,
      lines: [`${p.role}${p.stores.length ? `, ${names(p.stores, 4)}` : ''}`, 'They can no longer sign in. Their records are kept, and an admin can turn them back on from Staff.'],
      warning: 'They are signed out of the app the next time it checks.',
      verb: 'Deactivate',
      payload: { user_id: p.id },
    }
  }

  /**
   * Fixing someone's day (0090), as on Fix today's record: today only.
   * Their day is read here under the caller's RLS (a supervisor sees only
   * their team); the database decides again when Apply is pressed.
   */
  async fieldCorrection(input: Input): Promise<ProposedAction> {
    const p = await this.person(input.person)
    const action = input.action as CorrectionAction
    if (!CORRECTION_ACTIONS.includes(action)) throw new Error('Say what to do: clock in or out, check in or out, or ask them to do it again.')
    const storeId = input.store ? (await this.store(input.store)).id : null
    const today = lagosDateString()
    const [profile, clocks, visits, allowed] = await Promise.all([
      this.supabase.from('profiles').select('role, is_active, outlet_id').eq('id', p.id).maybeSingle(),
      this.supabase.from('attendance').select('type').eq('user_id', p.id).eq('attendance_date', today),
      this.supabase
        .from('store_visits')
        .select('id, status, outlet_id, outlets(name)')
        .eq('user_id', p.id)
        .eq('visit_date', today)
        .order('arrived_at'),
      this.supabase.rpc('outlets_for_user', { target: p.id }),
    ])
    if (!profile.data) throw new Error('That person is not one you can manage.')
    const ids = ((allowed.data ?? []) as { outlet_id: string }[]).map((r) => r.outlet_id)
    const { data: stores } = ids.length
      ? await this.supabase.from('outlets').select('id, name').in('id', ids).eq('is_active', true).not('lat', 'is', null).order('name')
      : { data: [] }
    const types = ((clocks.data ?? []) as { type: string }[]).map((c) => c.type)
    const day: CorrectionDay = {
      name: p.name,
      role: profile.data.role as string,
      active: Boolean(profile.data.is_active),
      homeStoreId: (profile.data.outlet_id as string | null) ?? null,
      stores: (stores ?? []) as { id: string; name: string }[],
      clockedIn: types.includes('opening'),
      clockedOut: types.includes('closing'),
      visits: ((visits.data ?? []) as unknown as { id: string; status: string; outlet_id: string | null; outlets: { name: string } | null }[]).map(
        (v) => ({ id: v.id, status: v.status, storeId: v.outlet_id, name: v.outlets?.name ?? 'a store' }),
      ),
    }
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
    const time = input.time == null || input.time === '' ? null : normTime(input.time)
    if (input.time && !time) throw new Error('Give the time like 08:05 or 8am.')
    const plan = planCorrection(p.id, day, { action, storeId, time, reason: str(input.reason, 500) }, today, now)
    return {
      key: key('fix'),
      kind: 'field_correction',
      title: plan.title,
      lines: plan.lines,
      warning: plan.warning,
      verb: action.startsWith('redo_') ? 'Ask them' : 'Record it',
      payload: plan.payload,
    }
  }

  /**
   * A new store from a Google Maps link (or a name, address and position the
   * user gave), optionally allocated to people (2026-11-26). The link is read
   * as the outlet form reads it: the place's pin, and its name and address as
   * Google Maps shows them. Admins only, as on Outlets.
   */
  async newStore(input: Input): Promise<ProposedAction> {
    this.adminOnly('add a store')
    const link = str(input.link, 2000)
    let name = str(input.name, 160) || null
    let address = str(input.address, 300) || null
    let point: { lat: number; lng: number } | null = null
    if (link) {
      const found = await placeFromMapLink(link)
      if (!found.point && found.places.length === 1) {
        point = { lat: found.places[0].lat, lng: found.places[0].lng }
        name ??= found.places[0].name
        address ??= found.places[0].address
      } else if (found.point) {
        point = found.point
        // The user's own words win; the link fills in the rest.
        name ??= found.name
        address ??= found.address
      } else {
        throw new Error(
          found.short
            ? 'That shared link could not be opened. Ask for the link from the address bar in Google Maps, or the numbers (like 6.6019, 3.3516).'
            : 'No position in that link. Ask for the Google Maps link of the place itself, or its numbers (like 6.6019, 3.3516).',
        )
      }
    } else if (typeof input.lat === 'number' && typeof input.lng === 'number') {
      point = { lat: input.lat, lng: input.lng }
    }
    if (!point || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180 || (point.lat === 0 && point.lng === 0)) {
      throw new Error('A new store needs its Google Maps link (or its position).')
    }
    if (!name) throw new Error('Say the store\'s name: the link does not give one.')
    const radius = typeof input.radius === 'number' && input.radius >= 25 && input.radius <= 2000 ? Math.round(input.radius) : 150
    const refs = Array.isArray(input.people) ? input.people : []
    const people = []
    for (const ref of refs.slice(0, 50)) people.push(await this.person(ref))

    // Already on the list? Same name, or a store within 50 m.
    await this.people.load()
    const { data: near } = await this.supabase.from('outlets').select('name, lat, lng').eq('is_active', true).limit(5000)
    const close = ((near ?? []) as { name: string; lat: number | null; lng: number | null }[]).find(
      (o) =>
        o.name.trim().toLowerCase() === name!.trim().toLowerCase() ||
        (o.lat != null && o.lng != null && Math.hypot((o.lat - point!.lat) * 111_000, (o.lng - point!.lng) * 111_000) < 50),
    )
    return {
      key: key('store'),
      kind: 'new_store',
      title: `Add the store ${name}${people.length ? ` and allocate it to ${names(people.map((p) => p.name), 3)}` : ''}`,
      lines: [
        `Name: ${name}`,
        `Address: ${address ?? 'none given'}`,
        `Location: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} (area ${radius} m)`,
        people.length ? `Allocate to: ${names(people.map((p) => p.name))}` : 'Not allocated to anyone yet.',
      ],
      warning: close
        ? `${close.name} is already on Outlets${close.name.trim().toLowerCase() === name.trim().toLowerCase() ? '' : ' within 50 m of this spot'}. Check it is not the same store.`
        : 'Check the address and the spot on Outlets after adding it.',
      verb: people.length ? 'Add and allocate' : 'Add store',
      payload: { name, address, lat: point.lat, lng: point.lng, geofence_radius_m: radius, user_ids: people.map((p) => p.id) },
    }
  }

  /** A link to a page, filtered to who and when the question was about. */
  async link(input: Input): Promise<PageLink> {
    const page = input.page as PageName
    if (!(page in PAGES)) throw new Error('Unknown page.')
    const person = input.person ? await this.person(input.person) : null
    const from = isDate(input.from) ? input.from : null
    const to = isDate(input.to) ? input.to : null
    const q = new URLSearchParams()
    if (page === 'movement' || page === 'excuse' || page === 'audit_log') {
      if (person && page !== 'audit_log') q.set('person', person.id)
      if (from) q.set(page === 'audit_log' ? 'from' : 'date', from)
      if (to) q.set(page === 'audit_log' ? 'to' : 'until', to)
    } else if (page === 'integrity') {
      if (person) q.set('person', person.id)
      if (from) q.set('from', from)
      if (to) q.set('to', to)
    } else if (page === 'attendance' || page === 'visits') {
      if (person) q.set('user_id', person.id)
      if (from) q.set('from', from)
      if (to) q.set('to', to)
    }
    const label = str(input.label, 60) || `${PAGES[page].label}${person ? `: ${person.name}` : ''}`
    return { label, href: `${PAGES[page].path}${q.size ? `?${q}` : ''}` }
  }
}
