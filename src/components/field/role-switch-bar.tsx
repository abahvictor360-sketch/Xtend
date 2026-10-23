import { Eye } from 'lucide-react'
import { RoleSwitch } from '@/components/role-switch'
import type { ActingRole } from '@/lib/acting'

/**
 * Shown at the top of the field app only when an admin is viewing it. It says
 * which role they are testing as and lets them switch role or go back to the
 * dashboard, so they are never stuck in the field app.
 */
export function RoleSwitchBar({ acting }: { acting: ActingRole | null }) {
  return (
    <div className="mb-4 space-y-2 rounded-2xl border border-dashed border-brand/40 bg-tint px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-tint-foreground">
        <Eye className="h-3.5 w-3.5 shrink-0" />
        {acting === 'marketer'
          ? 'Viewing the field app as a marketer'
          : acting === 'merchandiser'
            ? 'Viewing the field app as a merchandiser'
            : 'Viewing the field app'}
      </p>
      <RoleSwitch current={acting ?? 'merchandiser'} />
    </div>
  )
}
