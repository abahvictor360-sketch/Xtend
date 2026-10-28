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
  /** A picture or PDF on the message, or null. Opened at /api/message-files/<id>. */
  attachment_mime: string | null
  attachment_name: string | null
  attachment_size_bytes: number | null
  attachment_kind: 'image' | 'pdf' | null
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

/** The one bucket message attachments live in. */
export const MESSAGE_FILE_BUCKET = 'message-files'
export const MAX_MESSAGE_FILE_BYTES = 10 * 1024 * 1024

/** The picture and PDF types a message may carry, with the ending stored. */
const MESSAGE_FILE_TYPES: Record<string, { kind: 'image' | 'pdf'; ext: string; endings: string[] }> = {
  'application/pdf': { kind: 'pdf', ext: 'pdf', endings: ['pdf'] },
  'image/jpeg': { kind: 'image', ext: 'jpg', endings: ['jpg', 'jpeg'] },
  'image/png': { kind: 'image', ext: 'png', endings: ['png'] },
  'image/webp': { kind: 'image', ext: 'webp', endings: ['webp'] },
  'image/heic': { kind: 'image', ext: 'heic', endings: ['heic'] },
  'image/heif': { kind: 'image', ext: 'heif', endings: ['heif'] },
}

const MESSAGE_FILE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
}

/** For the attachment picker's accept="…". */
export const MESSAGE_FILE_ACCEPT = [
  ...Object.keys(MESSAGE_FILE_TYPES),
  ...Object.values(MESSAGE_FILE_TYPES).flatMap((t) => t.endings.map((e) => `.${e}`)),
].join(',')

/** The type a picked file is stored as, or null when it is not a picture or PDF. */
export function messageAttachmentType(file: { name: string; type?: string | null }): string | null {
  const given = MESSAGE_FILE_ALIASES[(file.type ?? '').toLowerCase()] ?? (file.type ?? '').toLowerCase()
  if (given && MESSAGE_FILE_TYPES[given]) return given
  const end = /\.([a-z0-9]{1,6})$/i.exec(file.name.trim())?.[1]?.toLowerCase() ?? ''
  return Object.entries(MESSAGE_FILE_TYPES).find(([, t]) => t.endings.includes(end))?.[0] ?? null
}

/** 'image' or 'pdf' for a stored type, or null. */
export function messageAttachmentKind(mime: string | null | undefined): 'image' | 'pdf' | null {
  return mime ? MESSAGE_FILE_TYPES[mime.toLowerCase()]?.kind ?? null : null
}

/** The ending the stored copy gets. */
export function messageFileExt(mime: string) {
  return MESSAGE_FILE_TYPES[mime]?.ext ?? 'bin'
}

/** The path an attachment is stored at: always under the sender's own folder. */
export function messageFilePath(userId: string, mime: string, id: string) {
  return `${userId}/msg-${id}.${messageFileExt(mime)}`
}

const attachmentSchema = z.object({
  path: z.string().min(1).max(300),
  name: z.string().max(200),
  mime: z.string().refine((m) => messageAttachmentKind(m) !== null, 'Attach a picture or a PDF.'),
  size: z.number().int().min(1).max(MAX_MESSAGE_FILE_BYTES),
})

export const sendMessageSchema = z
  .object({
    /** The staff member's conversation. Ignored for staff, who write in their own. */
    staff_id: z.string().uuid().nullable().optional(),
    body: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length <= MESSAGE_MAX, 'Keep the message under 2,000 characters.'),
    attachment: attachmentSchema.nullable().optional(),
  })
  .refine((v) => v.body.length >= 1 || v.attachment != null, {
    message: 'Write your message first.',
    path: ['body'],
  })

export const readMessagesSchema = z.object({
  staff_id: z.string().uuid().nullable().optional(),
})

/** A short preview for a push notification. */
export function preview(body: string, max = 120) {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
