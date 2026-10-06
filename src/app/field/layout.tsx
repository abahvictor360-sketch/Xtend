import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { FieldNav } from '@/components/field/field-nav'
import { PhoneBeacon } from '@/components/field/phone-beacon'
import { NativeBridge } from '@/components/native-bridge'
import { getCountStatus } from '@/lib/store-count-status'

export const dynamic = 'force-dynamic'

/**
 * The phone shell. Each screen owns its own header, because the home screen
 * greets and the sheet screens carry a brand block instead.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requireSession(FIELD_ROLES)

  // Postgres is the authority on who may file a report; the nav just asks it.
  const supabase = await createServerSupabase()
  // The Count tab only appears while a count is due: asked for, or month end.
  const [{ data: canFileReport }, countStatus] = await Promise.all([
    supabase.rpc('can_file_report'),
    getCountStatus(supabase),
  ])

  return (
    <div className="field-shell min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden">
        <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
        <PhoneBeacon />
        <NativeBridge />
        <FieldNav canFileReport={canFileReport === true} canCountStock={countStatus.open} />
      </div>
    </div>
  )
}
