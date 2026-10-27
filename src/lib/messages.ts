import { z } from 'zod'

/**
 * Messages between a merchandiser or marketer and their supervisor
 * (migration 0073). Admins and HR can read and reply in any conversation.
 * Who may write where is decided in Postgres (can_message, send_message).
 */

/** One message, as conversation() returns it. */
export interface ChatMessage {
  id: string
  body: string
  created_at: string
  sender_name: string
  /** Written by the staff member whose conversation it is. */
  from_staff: boolean
  /** Written by the person looking at it. */
  mine: boolean
}

/** One line of the office inbox, as message_inbox() returns it. */
export interface InboxRow {
  staff_id: string
  full_name: string
  role: 'merchandiser' | 'marketer'
  outlet_name: string | null
  supervisor_name: string | null
  last_message_at: string | null
  last_body: string | null
  last_from_staff: boolean | null
  unread: number
}

export const MESSAGE_MAX = 2000

export const sendMessageSchema = z.object({
  /** The staff member's conversation. Ignored for staff, who write in their own. */
  staff_id: z.string().uuid().nullable().optional(),
  body: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1, 'Write your message first.')
    .refine((v) => v.length <= MESSAGE_MAX, 'Keep the message under 2,000 characters.'),
})

export const readMessagesSchema = z.object({
  staff_id: z.string().uuid().nullable().optional(),
})

/** A short preview for a push notification. */
export function preview(body: string, max = 120) {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
