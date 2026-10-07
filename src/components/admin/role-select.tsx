'use client'

import { Select } from '@/components/ui/select'
import { BASE_LABEL, BUILT_IN_ROLES, type StaffRole } from '@/lib/staff-roles'

/**
 * Picks a built-in role or one an admin added. Supervisors only hand out
 * roles that work like a merchandiser or marketer.
 */
export function RoleSelect({
  value,
  onChange,
  roles,
  isAdmin,
  className,
  id,
}: {
  value: string
  onChange: (value: string) => void
  roles: StaffRole[]
  isAdmin: boolean
  className?: string
  id?: string
}) {
  const builtIn = BUILT_IN_ROLES.filter(
    (r) => isAdmin || r.value === 'merchandiser' || r.value === 'marketer',
  )
  // A retired role still shows for the people who have it, so the picker
  // never loses their current value.
  const added = roles.filter(
    (r) =>
      (r.is_active || value === `custom:${r.id}`) &&
      (isAdmin || r.base_role === 'merchandiser' || r.base_role === 'marketer'),
  )
  return (
    <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {builtIn.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
      {added.length > 0 && (
        <optgroup label="Added roles">
          {added.map((r) => (
            <option key={r.id} value={`custom:${r.id}`}>
              {r.name} ({BASE_LABEL[r.base_role]})
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  )
}
