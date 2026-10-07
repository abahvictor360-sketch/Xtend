import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { monthStart } from '@/lib/metrics/shared'

const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}/, 'Choose the month') })

/** Keeps a finished month's grades as they stand. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_finalise_month', { p_month: monthStart(b.month) })
    return { data, error, audit: ['xm.grades.finalise', 'xm_monthly_grades', null, { kept: data }] }
  })
}
