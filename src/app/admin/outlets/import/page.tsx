import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { StoreImporter } from '@/components/admin/store-importer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add stores — Xtend' }

export default async function OutletImportPage() {
  await requireSession(['admin'])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Add stores in bulk</h1>
          <p className="text-sm text-muted-foreground">
            Paste a stockist list — the names and addresses are enough. Xtend looks up the
            coordinates for each one and shows you where it landed before anything is saved.
          </p>
        </div>
        <Link href="/admin/outlets" className={buttonVariants({ variant: 'outline' })}>
          Back to outlets
        </Link>
      </div>

      <StoreImporter />
    </div>
  )
}
