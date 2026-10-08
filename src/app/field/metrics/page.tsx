import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { SheetScreen } from '@/components/field/screen'
import { Alert } from '@/components/ui/alert'
import { XmFieldForms, type XmBatch, type XmRecent } from '@/components/field/xm-forms'
import { monthStart, type XmGrade, type XmProduct, type XmSettings } from '@/lib/metrics/shared'
import type { XmPolicy } from '@/components/metrics/policy'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'X Metrics — Xtend' }

/**
 * X Metrics on the phone (migration 043): the stock count, by batch, and
 * the day's sales, for the stores allocated to this person that are in X
 * Metrics. Both work offline and are sent when there is signal.
 */
export default async function FieldMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await requireSession()
  if (!['merchandiser', 'marketer', 'admin'].includes(session.profile.role)) redirect('/field')
  const { tab } = await searchParams
  const supabase = await createServerSupabase()

  const [{ data: mine }, { data: enrolled }, { data: products }, { data: today }, { data: settings }] =
    await Promise.all([
      supabase.rpc('my_outlets'),
      supabase.from('xm_stores').select('outlet_id').eq('is_active', true),
      supabase
        .from('products')
        .select('id, name, sku, category, unit, is_active')
        .eq('is_active', true)
        .order('name')
        .limit(2000),
      supabase.rpc('business_date'),
      supabase.from('xm_settings').select('*').maybeSingle<XmSettings>(),
    ])

  const inXm = new Set(((enrolled ?? []) as { outlet_id: string }[]).map((s) => s.outlet_id))
  const stores = ((mine ?? []) as { id: string; name: string }[])
    .filter((o) => inXm.has(o.id))
    .map((o) => ({ id: o.id, name: o.name }))
  const ids = stores.map((s) => s.id)
  const businessDate = (today as string) ?? new Date().toISOString().slice(0, 10)

  // Their own score this month, and the scoring policy (044).
  const [{ data: grade }, { data: policy }] = await Promise.all([
    supabase.rpc('xm_grade', { p_user: session.userId, p_month: monthStart(businessDate) }),
    supabase.from('xm_current_policy').select('id, title, body, change_note, published_at').maybeSingle<XmPolicy>(),
  ])
  const { data: readRow } = policy
    ? await supabase.from('xm_policy_reads').select('policy_id').eq('policy_id', policy.id).eq('user_id', session.userId).maybeSingle()
    : { data: null }
  const weekAgo = new Date(Date.parse(businessDate) - 7 * 86_400_000).toISOString().slice(0, 10)

  // The batches last counted at each store, to start the next count from;
  // and what this person sent this week.
  const [{ data: onHand }, { data: counts }, { data: sales }] = ids.length
    ? await Promise.all([
        supabase.rpc('xm_my_store_batches'),
        supabase
          .from('xm_counts')
          .select('id, outlet_id, count_date, captured_at, voided_at')
          .eq('user_id', session.userId)
          .gte('count_date', weekAgo)
          .order('captured_at', { ascending: false })
          .limit(30),
        supabase
          .from('xm_sales')
          .select('id, outlet_id, sale_date, captured_at, voided_at, superseded_by')
          .eq('user_id', session.userId)
          .gte('sale_date', weekAgo)
          .is('superseded_by', null)
          .order('sale_date', { ascending: false })
          .limit(30),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const name = new Map(stores.map((s) => [s.id, s.name]))
  const recent: XmRecent[] = [
    ...((counts ?? []) as { id: string; outlet_id: string; count_date: string; captured_at: string; voided_at: string | null }[]).map(
      (c) => ({ id: c.id, kind: 'count' as const, store: name.get(c.outlet_id) ?? '', date: c.count_date, at: c.captured_at, voided: !!c.voided_at }),
    ),
    ...((sales ?? []) as { id: string; outlet_id: string; sale_date: string; captured_at: string; voided_at: string | null }[]).map(
      (s) => ({ id: s.id, kind: 'sales' as const, store: name.get(s.outlet_id) ?? '', date: s.sale_date, at: s.captured_at, voided: !!s.voided_at }),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <SheetScreen title="X Metrics" back="/field">
      {stores.length === 0 ? (
        <Alert variant="info">
          None of your stores is in X Metrics yet. When the office adds your store, its stock count
          and daily sales appear here.
        </Alert>
      ) : (
        <XmFieldForms
          initialTab={tab === 'sales' ? 'sales' : tab === 'score' ? 'score' : 'count'}
          stores={stores}
          products={(products ?? []) as XmProduct[]}
          batches={(onHand ?? []) as XmBatch[]}
          businessDate={businessDate}
          salesPhotoRequired={settings?.sales_photo_required !== false}
          recent={recent}
          grade={(grade as XmGrade | null) ?? null}
          settings={settings ?? null}
          policy={policy ?? null}
          policyRead={!!readRow}
        />
      )}
    </SheetScreen>
  )
}
