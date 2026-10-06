import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { getCountStatus } from '@/lib/store-count-status'
import { renderCountSheet } from '@/lib/count-sheet'

const query = z.object({ outlet_id: z.string().uuid() })

/**
 * The count sheet for one of the caller's stores, as a PDF to fill in on
 * the phone or print. The products from their last count there are filled
 * in. Available whenever, so a sheet can be printed ahead of the count.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiSession(['merchandiser', 'marketer', 'admin'])
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return Response.json({ error: 'Pick a store' }, { status: 400 })

    const supabase = await createServerSupabase()
    const { data: mine } = await supabase.rpc('my_outlets')
    const store = ((mine ?? []) as { id: string; name: string }[]).find(
      (o) => o.id === parsed.data.outlet_id,
    )
    if (!store) return Response.json({ error: 'That store is not one of yours' }, { status: 403 })

    const [{ data: today }, status, { data: counted }] = await Promise.all([
      supabase.rpc('business_date'),
      getCountStatus(supabase),
      supabase
        .from('store_count_detail')
        .select('product_name, count_date')
        .eq('user_id', session.userId)
        .eq('outlet_id', store.id)
        .order('count_date', { ascending: false })
        .order('product_name')
        .limit(500),
    ])

    // The products of the most recent count at this store.
    const rows = (counted ?? []) as { product_name: string; count_date: string }[]
    const last = rows[0]?.count_date
    const products = rows.filter((r) => r.count_date === last).map((r) => r.product_name)

    const date = (today as string) ?? new Date().toISOString().slice(0, 10)
    const pdf = await renderCountSheet({
      storeName: store.name,
      staffName: session.profile.full_name,
      date,
      occasion: status.open && status.reason === 'request' ? 'Requested count' : 'Month-end count',
      products,
    })

    const file = `count-sheet-${store.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${date}.pdf`
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
