import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage, ApiError } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { bestMatch, readSupplyFile } from '@/lib/metrics/supply-import'
import { lagosDateString } from '@/lib/utils'

export const maxDuration = 120

/**
 * Reads supplies from an uploaded file (CSV, Excel, PDF or Word invoice)
 * and suggests the store and product for each line. Nothing is logged
 * here: the admin checks every line, then sends them to /import/[id].
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File) || !file.size) throw new ApiError('Choose a file to import', 400)

    const read = await readSupplyFile(file)
    if (!read.lines.length) {
      throw new ApiError('No product lines with a quantity were found in that file', 400)
    }

    const supabase = await createServerSupabase()
    const [{ data: products }, { data: stores }] = await Promise.all([
      supabase.from('products').select('id, name, sku, unit, units_per_carton').eq('is_active', true),
      supabase.from('xm_stores').select('outlet_id, outlets(name)').eq('is_active', true),
    ])
    const productList = (products ?? []) as { id: string; name: string; sku: string | null; unit: string; units_per_carton: number | null }[]
    const storeList = ((stores ?? []) as unknown as { outlet_id: string; outlets: { name: string } | { name: string }[] | null }[]).map(
      (s) => ({ id: s.outlet_id, name: (Array.isArray(s.outlets) ? s.outlets[0]?.name : s.outlets?.name) ?? '' }),
    )

    const today = lagosDateString()
    const docStore = bestMatch(storeList, read.deliver_to)
    const lines = read.lines.slice(0, 500).map((l, i) => {
      const product = bestMatch(productList, l.description, l.sku)
      const store = bestMatch(storeList, l.store) ?? docStore
      const per = l.units_per_carton ?? product?.item.units_per_carton ?? null
      return {
        line: i + 1,
        description: l.description,
        sku: l.sku,
        product_id: product?.item.id ?? null,
        product_match: product?.how ?? null,
        outlet_id: store?.item.id ?? null,
        store_text: l.store ?? read.deliver_to,
        // Cartons when the document gives them; units otherwise.
        unit: l.cartons ? ('cartons' as const) : ('units' as const),
        amount: l.cartons ?? l.quantity,
        units_per_carton: per,
        stated_units: l.quantity,
        batch: l.batch ?? '',
        expiry_date: l.expiry_date ?? '',
        supplied_on: l.supplied_on && l.supplied_on <= today ? l.supplied_on : read.invoice_date && read.invoice_date <= today ? read.invoice_date : today,
      }
    })

    const { data: importId, error } = await supabase.rpc('xm_create_supply_import', {
      p_file_name: file.name,
      p_kind: read.kind,
      p_read_by: read.read_by,
      p_supplier: read.supplier,
      p_invoice_no: read.invoice_no,
      p_invoice_date: read.invoice_date,
      p_rows: lines.length,
    })
    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })
    await audit(supabase, 'xm.supply.import_read', 'xm_supply_imports', importId as string, {
      file_name: file.name,
      kind: read.kind,
      read_by: read.read_by,
      lines: lines.length,
    })

    return Response.json({
      import_id: importId,
      file_name: file.name,
      read_by: read.read_by,
      supplier: read.supplier,
      invoice_no: read.invoice_no,
      invoice_date: read.invoice_date,
      deliver_to: read.deliver_to,
      lines,
    })
  } catch (error) {
    return apiError(error)
  }
}
