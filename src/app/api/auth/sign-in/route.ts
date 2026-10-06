import { z } from 'zod'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { allowAttempt, clientAddress } from '@/lib/rate-limit'

const schema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
})

const WRONG = 'Those details are not correct.'
const WINDOW_MS = 15 * 60 * 1000

/**
 * Staff sign in with an email or a phone number. Supabase signs in on
 * email, so a phone is turned into the email here, on the server, and the
 * sign-in happens here too: the email never goes back to the browser, so
 * nobody can use this to find out a staff member's email from their phone
 * number. Every failure gives the same answer, and attempts are limited
 * per address and per account.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: WRONG }, { status: 400 })
  const { identifier, password } = parsed.data

  const tooMany = Response.json(
    { error: 'Too many attempts. Wait 15 minutes, then try again.' },
    { status: 429 },
  )
  if (!allowAttempt(`sign-in:ip:${clientAddress(request)}`, 30, WINDOW_MS)) return tooMany
  if (!allowAttempt(`sign-in:id:${identifier.toLowerCase()}`, 10, WINDOW_MS)) return tooMany

  const email = identifier.includes('@') ? identifier.toLowerCase() : await emailForPhone(identifier)
  if (!email) return Response.json({ error: WRONG }, { status: 401 })

  // The user-scoped client writes the session cookies onto this response.
  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return Response.json({ error: WRONG }, { status: 401 })

  return Response.json({ ok: true })
}

async function emailForPhone(identifier: string): Promise<string | null> {
  const phone = identifier.replace(/[^\d+]/g, '')
  if (phone.length < 7) return null

  // Match the stored phone, and also the 0-prefixed and +234 variants of it,
  // because nobody types their number the same way twice.
  const variants = new Set([phone])
  if (phone.startsWith('0')) variants.add(`+234${phone.slice(1)}`)
  if (phone.startsWith('+234')) variants.add(`0${phone.slice(4)}`)
  if (phone.startsWith('234')) variants.add(`0${phone.slice(3)}`)

  const { data } = await createAdminSupabase()
    .from('profiles')
    .select('email')
    .in('phone', Array.from(variants))
    .eq('is_active', true)
    .limit(1)
    .maybeSingle<{ email: string | null }>()
  return data?.email ?? null
}
