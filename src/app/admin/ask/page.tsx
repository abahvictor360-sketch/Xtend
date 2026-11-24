import { requireSession } from '@/lib/auth'
import { assistantConfigured } from '@/lib/assistant'
import { AttendanceAssistant } from '@/components/admin/attendance-assistant'
import { CheckCircle2, Clock3, FileDown, History, Sparkles } from 'lucide-react'
import { Chip, IconTile, PageHeader } from '@/components/admin/page-kit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ask Xtend — Xtend' }

export default async function AskPage() {
  const session = await requireSession(['admin', 'supervisor'])
  const readOnly = session.profile.role === 'supervisor'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Ask Xtend"
        note={`Ask in plain words about attendance, store visits, stock counts, X Metrics, integrity, alerts, support and notifications. It makes reports to download and prepares notifications, count requests and reviews for you to approve.${readOnly ? ' Your own team only.' : ''}`}
        chips={
          <>
            <Chip icon={Sparkles}>Answers from your records</Chip>
            <Chip icon={Clock3}>Lagos time</Chip>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: FileDown, title: 'Reports', text: 'Ask for a day, a week or a person, and download it.' },
          { icon: CheckCircle2, title: 'You approve', text: 'Notifications, count requests and fixes wait for your yes.' },
          { icon: History, title: 'Earlier chats', text: 'Every chat is kept for you alone; rename or delete it there.' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="surface flex items-start gap-3 p-4">
            <IconTile icon={Icon} />
            <div className="min-w-0">
              <p className="text-sm font-bold">{title}</p>
              <p className="text-xs leading-snug text-muted-foreground">{text}</p>
            </div>
          </div>
        ))}
      </div>
      <AttendanceAssistant configured={await assistantConfigured()} />
    </div>
  )
}
