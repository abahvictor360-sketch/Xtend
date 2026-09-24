import { requireSession } from '@/lib/auth'
import { assistantConfigured } from '@/lib/assistant'
import { AttendanceAssistant } from '@/components/admin/attendance-assistant'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ask Xtend — Xtend' }

export default async function AskPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Ask Xtend</h1>
        <p className="text-sm text-muted-foreground">
          Ask in plain words who clocked in, who clocked out, and who hasn&apos;t.
          {readOnly ? ' Answers cover your own team only.' : ''} Times are Africa/Lagos.
        </p>
      </div>
      <AttendanceAssistant configured={assistantConfigured()} />
    </div>
  )
}
