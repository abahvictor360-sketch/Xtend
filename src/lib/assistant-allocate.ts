import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChangePlan } from '@/lib/assistant-plan'

/**
 * Turning "Ada Okafor — Ikeja City Mall, Justrite Bariga" into people and
 * stores. The model never handles ids: every candidate it is shown gets a
 * short reference (P3, S12, V1) that only means something within this one
 * request, and the plan it proposes is built from those references here.
 */

interface Person {
  id: string
  name: string
  role: string
  home: string | null
  stores: string[]
  supervisor_id: string | null
}

interface Store {
  id: string
  name: string
  address: string | null
}

interface Supervisor {
  id: string
  name: string
  role: string
}

type Ref = { kind: 'person' | 'store' | 'supervisor'; id: string }

export class AllocationContext {
  private loaded: Promise<void> | null = null
  people: Person[] = []
  stores: Store[] = []
  supervisors: Supervisor[] = []
  private refs = new Map<string, Ref>()
  private refOf = new Map<string, string>()
  private counters = { person: 0, store: 0, supervisor: 0 }

  constructor(
    private readonly supabase: SupabaseClient,
    readonly isAdmin: boolean,
  ) {}

  /** Everything the caller may allocate, read once per request under their RLS. */
  load() {
    this.loaded ??= (async () => {
      const [staff, outlets, sups, profiles] = await Promise.all([
        this.supabase
          .from('staff_allocation')
          .select('user_id, staff_name, role, is_active, home_outlet_name, outlet_names')
          .eq('is_active', true),
        this.supabase.from('outlets').select('id, name, address').eq('is_active', true).limit(5000),
        this.isAdmin
          ? this.supabase.rpc('available_supervisors')
          : Promise.resolve({ data: [], error: null }),
        this.supabase.rpc('my_staff'),
      ])
      for (const r of [staff, outlets, sups, profiles]) {
        if (r.error) throw new Error(r.error.message)
      }
      const supervisorOf = new Map(
        ((profiles.data ?? []) as { id: string; supervisor_id: string | null }[]).map((p) => [
          p.id,
          p.supervisor_id ?? null,
        ]),
      )
      this.people = ((staff.data ?? []) as Record<string, unknown>[]).map((p) => ({
        id: p.user_id as string,
        name: p.staff_name as string,
        role: p.role as string,
        home: (p.home_outlet_name as string | null) ?? null,
        stores: (p.outlet_names as string[] | null) ?? [],
        supervisor_id: supervisorOf.get(p.user_id as string) ?? null,
      }))
      this.stores = (outlets.data ?? []) as Store[]
      this.supervisors = ((sups.data ?? []) as { id: string; full_name: string; role: string }[]).map(
        (s) => ({ id: s.id, name: s.full_name, role: s.role }),
      )
    })()
    return this.loaded
  }

  private ref(kind: Ref['kind'], id: string) {
    const key = `${kind}:${id}`
    const existing = this.refOf.get(key)
    if (existing) return existing
    const prefix = kind === 'person' ? 'P' : kind === 'store' ? 'S' : 'V'
    const ref = `${prefix}${++this.counters[kind]}`
    this.refs.set(ref, { kind, id })
    this.refOf.set(key, ref)
    return ref
  }

  resolve(ref: unknown, kind: Ref['kind']) {
    const found = typeof ref === 'string' ? this.refs.get(ref.trim().toUpperCase()) : undefined
    if (!found || found.kind !== kind) {
      throw new Error(`"${String(ref)}" is not a ${kind} reference from match_names`)
    }
    return found.id
  }

  supervisorName(id: string | null) {
    if (!id) return null
    return (
      this.supervisors.find((s) => s.id === id)?.name ??
      this.people.find((p) => p.id === id)?.name ??
      'another supervisor'
    )
  }

  /** Up to three likely matches for each name, best first. */
  async match(input: { people?: unknown; stores?: unknown; supervisors?: unknown }) {
    await this.load()
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 400) : []

    return {
      people: list(input.people).map((query) => ({
        query,
        candidates: best(query, this.people, (p) => [p.name]).map(({ item, score }) => ({
          ref: this.ref('person', item.id),
          name: item.name,
          role: item.role,
          score,
          home_store: item.home,
          allocated_stores: item.stores,
          supervisor: this.supervisorName(item.supervisor_id),
        })),
      })),
      stores: list(input.stores).map((query) => ({
        query,
        candidates: best(query, this.stores, (s) => [s.name, `${s.name} ${s.address ?? ''}`]).map(
          ({ item, score }) => ({
            ref: this.ref('store', item.id),
            name: item.name,
            address: item.address,
            score,
          }),
        ),
      })),
      supervisors: this.isAdmin
        ? list(input.supervisors).map((query) => ({
            query,
            candidates: best(query, this.supervisors, (s) => [s.name]).map(({ item, score }) => ({
              ref: this.ref('supervisor', item.id),
              name: item.name,
              role: item.role,
              score,
            })),
          }))
        : list(input.supervisors).length
          ? 'Only an admin can change who somebody reports to.'
          : [],
    }
  }

  /** Builds the plan the person will see, from references the model chose. */
  async plan(input: {
    store_allocations?: unknown
    supervisor_assignments?: unknown
    unmatched?: unknown
  }): Promise<ChangePlan> {
    await this.load()
    const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
    const personById = new Map(this.people.map((p) => [p.id, p]))
    const storeById = new Map(this.stores.map((s) => [s.id, s]))

    const stores = new Map<string, ChangePlan['stores'][number]>()
    for (const row of arr(input.store_allocations)) {
      const person = personById.get(this.resolve(row.person, 'person'))!
      const ids = [...new Set((Array.isArray(row.stores) ? row.stores : []).map((s) => this.resolve(s, 'store')))]
      const mode = row.mode === 'replace' ? 'replace' : 'add'
      const existing = stores.get(person.id)
      if (existing) {
        // The same person on two lines of the file: one change with both stores.
        for (const id of ids) {
          if (!existing.outlet_ids.includes(id)) {
            existing.outlet_ids.push(id)
            existing.outlet_names.push(storeById.get(id)!.name)
          }
        }
        if (mode === 'replace') existing.mode = 'replace'
        continue
      }
      stores.set(person.id, {
        user_id: person.id,
        user_name: person.name,
        mode,
        outlet_ids: ids,
        outlet_names: ids.map((id) => storeById.get(id)!.name),
        current_names: person.stores,
      })
    }

    const supervisors = new Map<string, ChangePlan['supervisors'][number]>()
    const sups = arr(input.supervisor_assignments)
    if (sups.length && !this.isAdmin) {
      throw new Error('Only an admin can change who somebody reports to.')
    }
    for (const row of sups) {
      const person = personById.get(this.resolve(row.person, 'person'))!
      const supervisorId =
        row.supervisor === null || row.supervisor === '' ? null : this.resolve(row.supervisor, 'supervisor')
      supervisors.set(person.id, {
        user_id: person.id,
        user_name: person.name,
        supervisor_id: supervisorId,
        supervisor_name: this.supervisorName(supervisorId),
        current_name: this.supervisorName(person.supervisor_id),
      })
    }

    if (stores.size + supervisors.size === 0) {
      throw new Error('The plan is empty: propose at least one change.')
    }

    return {
      stores: [...stores.values()],
      supervisors: [...supervisors.values()],
      unmatched: (Array.isArray(input.unmatched) ? input.unmatched : [])
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .slice(0, 100),
    }
  }
}

// ---------------------------------------------------------------------
// Fuzzy matching. Good enough for "Justrite Bariga" against
// "Justrite Superstore Bariga, Lagos", and cheap enough for a few thousand
// stores.
// ---------------------------------------------------------------------

function normalise(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bigrams(text: string) {
  const s = text.replace(/ /g, '')
  const grams = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return grams
}

function dice(a: string, b: string) {
  const A = bigrams(a)
  const B = bigrams(b)
  let overlap = 0
  let total = 0
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0)
    total += n
  }
  for (const n of B.values()) total += n
  return total ? (2 * overlap) / total : 0
}

export function similarity(query: string, candidate: string) {
  const q = normalise(query)
  const c = normalise(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  const qTokens = q.split(' ')
  const cTokens = new Set(c.split(' '))
  // How much of what was typed appears in the candidate, word for word.
  const covered = qTokens.filter((t) => cTokens.has(t)).length / qTokens.length
  const contained = c.includes(q) || q.includes(c) ? 0.9 : 0
  return Math.max(contained, covered * 0.95, dice(q, c))
}

function best<T>(query: string, items: T[], texts: (item: T) => string[], limit = 3) {
  return items
    .map((item) => ({ item, score: Math.max(...texts(item).map((t) => similarity(query, t))) }))
    .filter((m) => m.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => ({ item: m.item, score: Math.round(m.score * 100) / 100 }))
}
