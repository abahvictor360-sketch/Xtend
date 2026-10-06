import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { SheetScreen } from '@/components/field/screen'
import { StaffGuide } from '@/components/staff-guide'

export const metadata = { title: 'How to use Xtend' }

/** The staff guide inside the app, with the menu bar still to hand. */
export default async function FieldGuidePage() {
  await requireSession(FIELD_ROLES)
  return (
    <SheetScreen title="How to use Xtend" back="/field/account">
      <StaffGuide />
    </SheetScreen>
  )
}
