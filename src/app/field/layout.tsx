import { requireSession } from '@/lib/auth'
import { FieldNav } from '@/components/field/field-nav'

export const dynamic = 'force-dynamic'

/**
 * The phone shell. Each screen owns its own header, because the home screen
 * greets and the sheet screens carry a brand block instead.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requireSession(['merchandiser', 'admin'])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden">
      <main className="flex-1 px-4 pb-8 pt-4">{children}</main>
      <FieldNav />
    </div>
  )
}
