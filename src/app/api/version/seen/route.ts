import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const schema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  app_version: z.string().max(40).nullable(),
  app_build: z.number().int().min(0).nullable(),
  web_build: z.string().max(80).nullable(),
})

/** Which app build and site version this person is on, for the Updates page. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid' }, { status: 400 })
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ ok: false }, { status: 401 })
  await supabase.rpc('report_app_install', {
    p_platform: parsed.data.platform,
    p_app_version: parsed.data.app_version,
    p_app_build: parsed.data.app_build,
    p_web_build: parsed.data.web_build,
  })
  return Response.json({ ok: true })
}
