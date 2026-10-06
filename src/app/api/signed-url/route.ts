import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'

const schema = z.object({
  bucket: z.enum(['selfies', 'reports']),
  paths: z.array(z.string().min(1)).min(1).max(200),
  expires_in: z.number().int().min(30).max(3600).default(300),
})

/** Buckets are private. Images reach the browser only as short-lived URLs. */
export async function POST(request: Request) {
  try {
    await requireApiSession()
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

    // Storage RLS decides what the caller may sign, so the user-scoped client
    // is used deliberately here.
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.storage
      .from(parsed.data.bucket)
      .createSignedUrls(parsed.data.paths, parsed.data.expires_in)

    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const urls: Record<string, string> = {}
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) urls[row.path] = row.signedUrl
    }
    return Response.json({ urls })
  } catch (error) {
    return apiError(error)
  }
}
