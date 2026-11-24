import { requireSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/admin/page-kit'
import { AiSettings, type SavedKey, type FeatureChoice } from '@/components/admin/ai-settings'
import { aiFor } from '@/lib/ai/config'
import type { AiFeature } from '@/lib/ai/providers'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AI keys — Xtend' }

/** Settings → AI (0102): the keys and which AI answers staff and Ask Xtend. Admins only. */
export default async function AiPage() {
  await requireSession(['admin'])
  // The tables are the server's alone; only the hint and dates come out.
  const admin = createAdminSupabase()
  const [{ data: keys, error }, { data: features }, staff, office] = await Promise.all([
    admin.from('ai_provider_keys').select('provider, key_hint, updated_at'),
    admin.from('ai_feature_settings').select('feature, provider, model'),
    aiFor('staff_helper'),
    aiFor('admin_assistant'),
  ])
  const using: Record<AiFeature, { provider: string; model: string } | null> = {
    staff_helper: staff ? { provider: staff.provider, model: staff.model } : null,
    admin_assistant: office ? { provider: office.provider, model: office.model } : null,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI keys"
        note="Add a key for any of these AI services, then choose which one answers staff (the helper that explains what to do when something does not work) and which one answers Ask Xtend. Keys are stored encrypted and never shown again: only their last 4 characters."
      />
      {error && (
        <p className="rounded-xl bg-warning/15 p-3 text-sm">Run migration 0102 in Supabase to save AI keys here.</p>
      )}
      <AiSettings
        saved={(keys ?? []) as SavedKey[]}
        choices={(features ?? []) as FeatureChoice[]}
        using={using}
        serverAnthropic={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  )
}
