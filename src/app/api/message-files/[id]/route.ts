import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, apiError, requireApiSession } from '@/lib/auth'
import { MESSAGE_FILE_BUCKET } from '@/lib/messages'

const id = z.string().uuid()

/**
 * Opens a message's attachment (0075) through a link that lasts five
 * minutes, shown inline so pictures load in the chat. Read as the caller,
 * so the message's own RLS (can_message) decides who may; anyone else gets
 * "not found". The <id> is the message id: one attachment per message.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireApiSession(['merchandiser', 'marketer', 'supervisor', 'admin', 'hr'])
    const parsed = id.safeParse((await ctx.params).id)
    if (!parsed.success) throw new ApiError('That attachment was not found', 404)

    const supabase = await createServerSupabase()
    const { data: message } = await supabase
      .from('messages')
      .select('attachment_path')
      .eq('id', parsed.data)
      .maybeSingle<{ attachment_path: string | null }>()
    if (!message?.attachment_path) throw new ApiError('That attachment was not found', 404)

    const { data: signed, error } = await supabase.storage
      .from(MESSAGE_FILE_BUCKET)
      .createSignedUrl(message.attachment_path, 300)
    if (error || !signed?.signedUrl) throw new ApiError('The attachment could not be opened. Try again.', 502)

    return Response.redirect(signed.signedUrl, 302)
  } catch (error) {
    return apiError(error)
  }
}
