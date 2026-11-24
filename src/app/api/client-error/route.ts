import { z } from 'zod'
import { allowAttempt } from '@/lib/rate-limit'
import { requestIp } from '@/lib/client-ip'
import { HOUR_MS } from '@/lib/usage-limits'

const schema = z.object({
  kind: z.enum(['offline', 'new_version', 'server', 'unknown']),
  code: z.string().max(20),
  message: z.string().max(300).optional().default(''),
  digest: z.string().max(40).nullable().optional(),
  where: z.string().max(40),
  path: z.string().max(200),
  build: z.string().max(60).nullable().optional(),
  online: z.boolean().optional(),
})

/**
 * A screen crashed on someone's phone (lib/app-recover.ts reportAppError):
 * written to the server log with its code, so the office can find what
 * happened from the code the person reads out. Works before sign-in (a
 * crash can come first); only the error, the page and the app version are
 * kept, nothing about the person. At most 30 an hour from one address.
 */
export async function POST(request: Request) {
  const ip = requestIp(request.headers) ?? 'unknown'
  if (!(await allowAttempt(`client-error:${ip}`, 30, HOUR_MS))) return new Response(null, { status: 204 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response(null, { status: 204 })
  const e = parsed.data
  console.error('app screen crashed', {
    code: e.code,
    kind: e.kind,
    where: e.where,
    path: e.path,
    build: e.build ?? null,
    online: e.online ?? null,
    digest: e.digest ?? null,
    message: e.message,
    agent: (request.headers.get('user-agent') ?? '').slice(0, 160),
  })
  return new Response(null, { status: 204 })
}
