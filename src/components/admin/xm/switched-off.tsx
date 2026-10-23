import Link from 'next/link'
import { Alert } from '@/components/ui/alert'
import { XmHeader } from '@/components/admin/xm/widgets'
import { XM_OFF_MESSAGE } from '@/lib/metrics/features'

/** What a switched-off X Metrics page shows instead (0063). */
export function XmSwitchedOff({ title, readOnly }: { title: string; readOnly: boolean }) {
  return (
    <div className="space-y-5">
      <XmHeader title={title} intro="Not in use at the moment." readOnly={readOnly} />
      <Alert variant="info">
        {XM_OFF_MESSAGE}{' '}
        {!readOnly && (
          <Link href="/admin/metrics/settings" className="font-semibold underline">
            Open Settings
          </Link>
        )}
      </Alert>
    </div>
  )
}
