import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { XmHeader } from '@/components/admin/xm/widgets'
import { SettingsForm } from '@/components/admin/xm/forms'
import type { XmSettings } from '@/lib/metrics/shared'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings — X Metrics' }

export default async function SettingsPage() {
  await requireSession(['admin'])
  const supabase = await createServerSupabase()
  const [{ data: settings }, { data: history }] = await Promise.all([
    supabase.from('xm_settings').select('*').maybeSingle<XmSettings>(),
    supabase.from('xm_settings_history').select('id, settings, changed_at, profiles:changed_by(full_name)').order('changed_at', { ascending: false }).limit(20),
  ])

  return (
    <div className="space-y-5">
      <XmHeader title="X Metrics settings" intro="The rules X Metrics applies. Every change is kept, with who made it." />
      {!settings ? (
        <Alert variant="destructive">The settings could not be read. Has migration 043 been run?</Alert>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <SettingsForm settings={settings} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Earlier versions</CardTitle>
        </CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Not changed yet.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {((history ?? []) as unknown as { id: number; settings: XmSettings; changed_at: string; profiles: { full_name: string } | { full_name: string }[] | null }[]).map((h) => {
                const by = Array.isArray(h.profiles) ? h.profiles[0]?.full_name : h.profiles?.full_name
                const s = h.settings
                return (
                  <li key={h.id} className="py-2">
                    <span className="font-semibold">
                      Replaced {new Date(h.changed_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}
                      {by ? ` by ${by}` : ''}
                    </span>
                    <span className="block text-muted-foreground">
                      Was: tolerance {s.tolerance_pct}% · weights {s.weight_sales}/{s.weight_accuracy}/{s.weight_consistency}/{s.weight_expiry} ·
                      bands {s.band_poor_below}/{s.band_strong_from} · windows {s.alert_windows_days.join(', ')} days
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
