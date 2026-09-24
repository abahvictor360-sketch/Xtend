import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

const schema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        sku: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
})

/**
 * Adds products to the list merchandisers count against. Names already on
 * the list, in any capitalisation, are skipped rather than failing the batch.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid products' },
        { status: 400 },
      )
    }

    const supabase = await createServerSupabase()
    const { data: existing, error: readError } = await supabase.from('products').select('name')
    if (readError) return Response.json({ error: readError.message }, { status: 400 })

    const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
    const seen = new Set((existing ?? []).map((p) => key(p.name as string)))
    const fresh = []
    for (const item of parsed.data.items) {
      const k = key(item.name)
      if (seen.has(k)) continue
      seen.add(k)
      fresh.push({ name: item.name.replace(/\s+/g, ' '), sku: item.sku || null })
    }

    if (fresh.length) {
      const { error } = await supabase.from('products').insert(fresh)
      if (error) return Response.json({ error: error.message }, { status: 400 })
      await audit(supabase, 'product.create', 'products', null, { count: fresh.length })
    }

    return Response.json(
      { added: fresh.length, skipped: parsed.data.items.length - fresh.length },
      { status: 201 },
    )
  } catch (error) {
    return apiError(error)
  }
}
