import { z } from 'zod'
import { apiError, requireApiSession } from '@/lib/auth'
import { assignSupervisor } from '@/lib/teams'

const schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
  supervisor_id: z.string().uuid().nullable(),
})

/** Assigns many people to one supervisor at once, or removes them from one. */
export async function PUT(request: Request) {
  try {
    const session = await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid change' }, { status: 400 })
    const result = await assignSupervisor(session, parsed.data.user_ids, parsed.data.supervisor_id)
    return Response.json(result)
  } catch (error) {
    return apiError(error)
  }
}
