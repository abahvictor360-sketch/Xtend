import { cookies } from 'next/headers'
import { apiError, requireApiSession } from '@/lib/auth'
import { ACTING_COOKIE } from '@/lib/acting'

/**
 * An admin picks whether to view the app as an admin, a merchandiser or a
 * marketer. Only an admin may call this; the cookie is otherwise ignored, so
 * it can never grant a field member more than their role allows.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const { role } = (await request.json().catch(() => ({}))) as { role?: string }
    const jar = await cookies()

    if (role === 'merchandiser' || role === 'marketer') {
      jar.set(ACTING_COOKIE, role, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      return Response.json({ ok: true, to: '/field' })
    }
    if (role === 'admin') {
      jar.delete(ACTING_COOKIE)
      return Response.json({ ok: true, to: '/admin' })
    }
    return Response.json({ error: 'Pick admin, merchandiser or marketer.' }, { status: 400 })
  } catch (error) {
    return apiError(error)
  }
}
