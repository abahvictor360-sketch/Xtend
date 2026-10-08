import { z } from 'zod'
import type { UserRole } from '@/lib/types'

/**
 * Roles an admin adds (migration 042): a name such as "Account Receivable"
 * on top of a built-in role it works like. What a person can do comes from
 * profiles.role (the base); the name is what people see.
 */
export interface StaffRole {
  id: string
  name: string
  base_role: Exclude<UserRole, 'admin'>
  is_active: boolean
  /** Whether people with it take store counts (migration 046). */
  counts_stock: boolean
}

/** Built-in roles that take store counts unless an admin turns it off (migration 046). */
export type CountingRole = 'merchandiser' | 'marketer'
export type BuiltInCounts = Partial<Record<CountingRole, boolean>>

/** Whether a person takes store counts, as person_counts_stock() decides in Postgres. */
export function takesStoreCounts(
  person: { role: UserRole; staff_role_id?: string | null },
  roles: Map<string, Pick<StaffRole, 'id' | 'counts_stock'>>,
  builtIn: BuiltInCounts,
) {
  if (person.role !== 'merchandiser' && person.role !== 'marketer') return false
  const added = person.staff_role_id ? roles.get(person.staff_role_id) : undefined
  return added ? added.counts_stock : (builtIn[person.role] ?? true)
}

export const BUILT_IN_ROLES: { value: UserRole; label: string; plural: string }[] = [
  { value: 'merchandiser', label: 'Merchandiser', plural: 'Merchandisers' },
  { value: 'marketer', label: 'Marketer', plural: 'Marketers' },
  { value: 'supervisor', label: 'Supervisor', plural: 'Supervisors' },
  { value: 'admin', label: 'Admin', plural: 'Admins' },
]

export const BASE_LABEL: Record<UserRole, string> = {
  merchandiser: 'Merchandiser',
  marketer: 'Marketer',
  supervisor: 'Supervisor',
  admin: 'Admin',
}

/** One value for a role picker: a built-in role, or "custom:<id>". */
export function roleValue(person: { role: UserRole; staff_role_id?: string | null }) {
  return person.staff_role_id ? `custom:${person.staff_role_id}` : person.role
}

/** What to send for a picked value. */
export function parseRoleValue(value: string): { role?: UserRole; staff_role_id: string | null } {
  return value.startsWith('custom:')
    ? { staff_role_id: value.slice('custom:'.length) }
    : { role: value as UserRole, staff_role_id: null }
}

/** The name people see: the added role's name, or the built-in one. */
export function roleLabel(
  person: { role: UserRole; staff_role_id?: string | null },
  roles: Map<string, StaffRole> | StaffRole[],
) {
  const byId = roles instanceof Map ? roles : new Map(roles.map((r) => [r.id, r]))
  const added = person.staff_role_id ? byId.get(person.staff_role_id) : undefined
  return added?.name ?? BASE_LABEL[person.role]
}

/** A role's name: words only, as people will see it on the Staff page. */
export const roleName = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .refine((v) => v.length >= 2 && v.length <= 40, 'A role name is 2 to 40 characters')
  .refine((v) => /^\p{L}[\p{L} &/'-]*$/u.test(v), 'Use letters only, like "Account Receivable"')
  .refine(
    (v) => !/^(merchandisers?|marketers?|supervisors?|admins?|administrator)$/i.test(v),
    'That is already a built-in role',
  )

