import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession } from '@/lib/auth'
import { buildCountSheet, countSheetFileName, sheetProducts } from '@/lib/count-sheet'

/**
 * The blank count sheet staff fill in. It is the Xpel stock count sheet
 * (migration 038), built as Excel for the month being counted: with
 * ?store=<id> for one of the caller's stores it also carries that store's
 * name, address and today's date.
 *
 * Only while no product is on the sheet does it fall back to the PDF an
 * admin uploaded (migration 035). That file sits in the admin's folder,
 * which staff cannot read, so it is fetched with the service role once the
 * table, read as the caller, has said which file it is.
 */
export async function GET(request: Request) {
  try {
    await requireApiSession()
    const supabase = await createServerSupabase()

    const products = await sheetProducts(supabase)
    if (products.length) {
      const { data: today } = await supabase.rpc('business_date')
      const date = (today as string | null) ?? new Date().toISOString().slice(0, 10)

      let store: { name: string; address: string | null } | null = null
      const storeId = new URL(request.url).searchParams.get('store')
      if (storeId) {
        // Only one of the caller's own stores; my_outlets() says which.
        const { data: mine } = await supabase.rpc('my_outlets')
        const own = ((mine ?? []) as { id: string; name: string; address: string | null }[]).find(
          (o) => o.id === storeId,
        )
        if (own) store = { name: own.name, address: own.address }
      }

      const file = await buildCountSheet({
        products,
        date,
        store: store?.name ?? null,
        location: store?.address ?? null,
      })
      return new Response(file, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${countSheetFileName(date, store?.name)}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const { data: template } = await supabase
      .from('count_sheet_templates')
      .select('path, file_name')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ path: string; file_name: string }>()
    if (!template) {
      return Response.json(
        { error: 'The office has not set up the count sheet yet.' },
        { status: 404 },
      )
    }

    const { data: file, error } = await createAdminSupabase()
      .storage.from('reports')
      .download(template.path)
    if (error || !file) {
      return Response.json({ error: 'The count sheet could not be loaded.' }, { status: 502 })
    }

    const name = template.file_name.replace(/[^\w .()-]+/g, '_')
    return new Response(file, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return apiError(error)
  }
}
