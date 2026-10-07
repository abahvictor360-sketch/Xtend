import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { note } from '@/lib/fields'

const schema = z.object({ note: note(500) })

/** An admin's review note on a kept grade. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return xmAdminAction(request, schema, async (b, db) => {
    const { error } = await db.rpc('xm_review_grade', { p_grade: id, p_note: b.note || null })
    return { error, audit: ['xm.grade.review', 'xm_monthly_grades', id] }
  })
}
