import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonthPicker, XmHeader } from '@/components/admin/xm/widgets'
import { TargetForm } from '@/components/admin/xm/forms'
import { monthLabel, monthStart } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Targets — X Metrics' }

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireSession(['admin'])
  const month = monthStart((await searchParams).month)
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const supabase = await createServerSupabase()

  const [{ data: people }, { data: stores }, { data: targets }, { data: sales }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role').in('role', ['merchandiser', 'marketer']).eq('is_active', true).order('full_name'),
    supabase.from('xm_stores').select('outlet_id, outlets(name)').eq('is_active', true),
    supabase.from('xm_current_targets').select('id, user_id, outlet_id, target_units, created_at').eq('month', month),
    supabase.from('xm_live_sale_lines').select('user_id, outlet_id, units').gte('sale_date', month).lte('sale_date', end).limit(50000),
  ])
  const personName = new Map(((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
  const storeOptions = ((stores ?? []) as unknown as { outlet_id: string; outlets: { name: string } | { name: string }[] | null }[])
    .map((s) => ({ id: s.outlet_id, name: (Array.isArray(s.outlets) ? s.outlets[0]?.name : s.outlets?.name) ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const storeName = new Map(storeOptions.map((s) => [s.id, s.name]))
  const soldByUser = new Map<string, number>()
  const soldByStore = new Map<string, number>()
  for (const r of (sales ?? []) as { user_id: string; outlet_id: string; units: number }[]) {
    soldByUser.set(r.user_id, (soldByUser.get(r.user_id) ?? 0) + r.units)
    soldByStore.set(r.outlet_id, (soldByStore.get(r.outlet_id) ?? 0) + r.units)
  }
  const rows = ((targets ?? []) as { id: string; user_id: string | null; outlet_id: string | null; target_units: number }[])
    .map((t) => ({
      ...t,
      who: t.user_id ? (personName.get(t.user_id) ?? 'Former staff') : (storeName.get(t.outlet_id!) ?? 'Store'),
      kind: t.user_id ? 'Person' : 'Store',
      sold: t.user_id ? (soldByUser.get(t.user_id) ?? 0) : (soldByStore.get(t.outlet_id!) ?? 0),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.who.localeCompare(b.who))

  return (
    <div className="space-y-5">
      <XmHeader
        title="Sales targets"
        intro="A monthly target in units, for a person or a store. A person's own target is used for their grade; without one, the targets of their stores are."
      />
      <MonthPicker month={month} />
      <Card>
        <CardHeader>
          <CardTitle>Set a target for {monthLabel(month)}</CardTitle>
          <CardDescription>Setting one again replaces it; the earlier one is kept.</CardDescription>
        </CardHeader>
        <CardContent>
          <TargetForm
            month={month}
            people={((people ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, name: p.full_name }))}
            stores={storeOptions}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No targets for {monthLabel(month)}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>For</TableHead>
                  <TableHead />
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Sold so far</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.who}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.kind}</TableCell>
                    <TableCell className="text-right">{r.target_units}</TableCell>
                    <TableCell className="text-right">{r.sold}</TableCell>
                    <TableCell className="text-right">{Math.round((100 * r.sold) / r.target_units)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
