import Image from 'next/image'
import { FIELD_ROLES, requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { profileAvatarUrl } from '@/lib/avatars'
import { SheetScreen } from '@/components/field/screen'
import { Conversation } from '@/components/messages/conversation'
import type { ChatMessage } from '@/lib/messages'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Messages — Xtend' }

interface Supervisor {
  id: string
  full_name: string
  avatar_path: string | null
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  )
}

export default async function FieldMessagesPage() {
  const session = await requireSession(FIELD_ROLES)
  const supabase = await createServerSupabase()

  // Always their own conversation, whatever is passed (0073).
  const [{ data: messages }, { data: supervisorRows }] = await Promise.all([
    supabase.rpc('conversation', { p_staff: null }),
    supabase.rpc('my_supervisor'),
  ])
  const supervisor = ((supervisorRows ?? []) as Supervisor[])[0] ?? null
  const name = supervisor?.full_name ?? 'The office'
  const to = supervisor?.full_name ?? 'the office'
  const photo = supervisor?.avatar_path ? await profileAvatarUrl(supabase, supervisor.avatar_path) : null

  return (
    <SheetScreen title="Messages" back="/field/account">
      <div className="mb-4 flex items-center gap-3">
        {photo ? (
          <Image
            src={photo}
            alt={name}
            width={48}
            height={48}
            unoptimized
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-tint-foreground">
            {supervisor ? initials(name) : 'XO'}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {supervisor ? 'Your supervisor' : 'Xtend office'}
          </p>
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Talk to {to} about your work: stock, the store, your shift or anything you need.
      </p>
      <Conversation
        messages={(messages ?? []) as ChatMessage[]}
        userId={session.userId}
        emptyText={`No messages yet. Write to ${to} below.`}
        placeholder={`Message ${to}`}
      />
    </SheetScreen>
  )
}
