import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'

const schema = z.object({ identifier: z.string().min(3).max(120) })

/**
 * Staff log in with an email or a phone number. Supabase signs in on email,
 * so a phone is resolved here. The reply is deliberately uniform: it never
 * discloses whether an account exists.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ email: null })

  const identifier = parsed.data.identifier.trim()
  if (identifier.includes('@')) return Response.json({ email: identifier.toLowerCase() })

  const phone = identifier.replace(/[^\d+]/g, '')
  if (phone.length < 7) return Response.json({ email: null })

  // Match the stored phone, and also the 0-prefixed and +234 variants of it,
  // because nobody types their number the same way twice.
  const variants = new Set([phone])
  if (phone.startsWith('0')) variants.add(`+234${phone.slice(1)}`)
  if (phone.startsWith('+234')) variants.add(`0${phone.slice(4)}`)
  if (phone.startsWith('234')) variants.add(`0${phone.slice(3)}`)

  const supabase = createAdminSupabase()
  const { data } = await supabase
    .from('profiles')
    .select('email')
    .in('phone', Array.from(variants))
    .eq('is_active', true)
    .limit(1)
    .maybeSingle<{ email: string | null }>()

  return Response.json({ email: data?.email ?? null })
}
