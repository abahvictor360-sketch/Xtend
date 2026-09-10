import { apiError, requireApiSession } from '@/lib/auth'
import { isVisitableStore, stockistQuery } from '@/lib/stockists'
import { STOCKISTS_JULY } from '@/lib/stockists-july'

/**
 * The supplied customer list, ready for the importer. Admin-only: it is a
 * customer list, so it is not served from public/.
 */
export async function GET() {
  try {
    await requireApiSession(['admin'])

    const rows = STOCKISTS_JULY.map((row) => ({
      name: row.name,
      region: row.region,
      query: stockistQuery(row),
      visitable: isVisitableStore(row),
    }))

    return Response.json({
      rows,
      total: rows.length,
      visitable: rows.filter((r) => r.visitable).length,
    })
  } catch (error) {
    return apiError(error)
  }
}
