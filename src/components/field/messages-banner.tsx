import Link from 'next/link'
import { ChevronRight, MessagesSquare } from 'lucide-react'

/** A reminder on the home screen while there are unread messages (0073). */
export function MessagesBanner({ unread }: { unread: number }) {
  return (
    <Link
      href="/field/messages"
      className="brand-surface mb-4 flex items-center gap-3 p-4 shadow-lift transition-transform active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
        <MessagesSquare className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">
          {unread === 1 ? 'You have a new message' : `You have ${unread} new messages`}
        </span>
        <span className="block text-xs text-white/85">Tap to read and reply</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0" />
    </Link>
  )
}
