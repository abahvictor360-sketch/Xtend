import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { CsvImporter } from '@/components/admin/csv-importer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Bulk import — Xtend' }

export default async function ImportPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const { data: outlets } = await supabase.from('outlets').select('name').order('name')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Bulk import staff</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV with the columns <code>full_name, email, phone, outlet_name, role</code>.
          The whole file is validated first; nothing is created until you commit.
        </p>
      </div>

      <CsvImporter outletNames={(outlets ?? []).map((o: { name: string }) => o.name)} />
    </div>
  )
}
