import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AllocationContext } from '@/lib/assistant-allocate'
import { PAGES, type PageLink, type PageName, type ProposedAction } from '@/lib/assistant-action-types'
import { addDays, lagosDateString, longDate, monthLabel } from '@/lib/utils'

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
