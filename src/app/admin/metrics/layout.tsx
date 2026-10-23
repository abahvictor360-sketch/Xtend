import { createServerSupabase } from '@/lib/supabase/server'
import { readXmFeatures } from '@/lib/metrics/features-server'
import { XmFeaturesProvider } from '@/components/admin/xm/features-context'

/** Every X Metrics page knows which parts are switched on (0063). */
export default async function MetricsLayout({ children }: { children: React.ReactNode }) {
  const features = await readXmFeatures(await createServerSupabase())
  return <XmFeaturesProvider features={features}>{children}</XmFeaturesProvider>
}
