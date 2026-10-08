import { requireSession } from '@/lib/auth'
import { assistantConfigured } from '@/lib/assistant'
import { AttendanceAssistant } from '@/components/admin/attendance-assistant'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ask Xtend — Xtend' }

export default async function AskPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Ask Xtend</h1>
        <p className="text-sm text-muted-foreground">
          Ask in plain words about attendance, store visits, stock counts, X Metrics, integrity flags, location
          alerts, support issues and notifications. It can make reports to download, and prepare notifications,
          count requests and reviews for you to approve.
          {readOnly ? ' Answers cover your own team only.' : ''} Every chat is kept under Earlier chats for you
          alone; rename or delete it there. Times are Africa/Lagos.
        </p>
      </div>
      <AttendanceAssistant configured={assistantConfigured()} />
    </div>
  )
}
