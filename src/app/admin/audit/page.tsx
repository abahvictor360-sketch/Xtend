import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Audit log — Xtend' }

interface AuditRow {
  id: string
  action: string
  target_table: string | null
  target_id: string | null
  meta: Record<string, unknown>
  created_at: string
  actor: { full_name: string } | null
}

export default async function AuditPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()

  const { data } = await supabase
    .from('audit_log')
    .select('id, action, target_table, target_id, meta, created_at, actor:actor_id (full_name)')
    .order('created_at', { ascending: false })
    .limit(300)

  const rows = (data ?? []) as unknown as AuditRow[]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every admin mutation, newest first. Written by the database, not the client.
        </p>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatLagos(row.created_at)}
                </TableCell>
                <TableCell>{row.actor?.full_name ?? 'system'}</TableCell>
                <TableCell className="font-mono text-xs">{row.action}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.target_table ?? '—'}
                </TableCell>
                <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                  {JSON.stringify(row.meta)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
