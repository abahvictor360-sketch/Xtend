import Link from 'next/link'
import { requireSession } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PublishUpdate, RemindToUpdate, WithdrawRelease } from '@/components/admin/update-tools'
import { publishedAndroidApk } from '@/lib/app-release'
import { installStatus, type InstallStatus } from '@/lib/app-update'
import { cn, formatLagos } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Updates — Xtend' }

interface Release {
  id: string
  title: string
  notes: string
  audience: 'everyone' | 'field' | 'office'
  required: boolean
  min_android_build: number | null
  min_ios_build: number | null
  created_at: string
  withdrawn_at: string | null
}

interface Install {
  user_id: string
  platform: 'android' | 'ios' | 'web'
  app_version: string | null
  app_build: number | null
  web_build: string | null
  last_seen: string
}

const STATUS: Record<InstallStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }> = {
  current: { label: 'Up to date', variant: 'success' },
  old_site: { label: 'Not reloaded yet', variant: 'outline' },
  old_app: { label: 'Older app', variant: 'warning' },
  must_update: { label: 'Must update', variant: 'destructive' },
}
const PLATFORM = { android: 'Android app', ios: 'iPhone app', web: 'Browser' }
const AUDIENCE = { everyone: 'Everyone', field: 'Field staff', office: 'Office' }

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireSession(['admin'])
  const { show } = await searchParams
  const supabase = await createServerSupabase()
  const build = process.env.NEXT_PUBLIC_BUILD_ID ?? ''

  const [{ data: releases, error }, { data: installs }, { data: minimum }, apk] = await Promise.all([
    supabase.from('app_releases').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('app_installs').select('*').order('last_seen', { ascending: false }).limit(2000),
    supabase.from('app_minimum_builds').select('android, ios').maybeSingle(),
    process.env.ANDROID_APK_URL ? Promise.resolve(null) : publishedAndroidApk(),
  ])
  const rows = (installs ?? []) as Install[]
  const ids = [...new Set(rows.map((r) => r.user_id))]
  const { data: people } = ids.length
    ? await supabase.from('profiles').select('id, full_name, role, is_active').in('id', ids)
    : { data: [] }
  const who = new Map(((people ?? []) as { id: string; full_name: string; role: string; is_active: boolean }[]).map((p) => [p.id, p]))

  const androidLatest = Number(process.env.ANDROID_LATEST_BUILD) || apk?.build || null
  const iosLatest = Number(process.env.IOS_LATEST_BUILD) || null
  const min = (minimum ?? { android: null, ios: null }) as { android: number | null; ios: number | null }
  const live = {
    build,
    android: { latest: androidLatest, minimum: min.android },
    ios: { latest: iosLatest, minimum: min.ios },
  }

  // One line per person and device, the most recent first; the browser line
  // only for people who never used the app.
  const appUsers = new Set(rows.filter((r) => r.platform !== 'web').map((r) => r.user_id))
  const listed = rows
    .filter((r) => who.get(r.user_id)?.is_active !== false)
    .filter((r) => r.platform !== 'web' || !appUsers.has(r.user_id))
    .map((r) => ({ ...r, status: installStatus(r, live) }))
  const behind = listed.filter((r) => r.status === 'old_app' || r.status === 'must_update')
  const shown = show === 'behind' ? behind : listed
  const counts = {
    current: listed.filter((r) => r.status === 'current').length,
    old_site: listed.filter((r) => r.status === 'old_site').length,
    old_app: listed.filter((r) => r.status === 'old_app').length,
    must_update: listed.filter((r) => r.status === 'must_update').length,
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Updates</h1>
        <p className="text-sm text-muted-foreground">
          Xtend updates itself: every phone and browser runs the live site, and anyone with Xtend open is told when a newer
          version is ready (&ldquo;A new version of Xtend is ready&rdquo;) and moves to it with one tap. A new phone app is only
          needed when something on the phone itself changes; then they are offered the download, or required to install it
          if you set the lowest app allowed. Publish a short &ldquo;What&apos;s new&rdquo; so people know what changed.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">The updates could not be loaded. Has migration 057 been run in Supabase?</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Fact label="Site version live" value={build ? build.slice(0, 10) : '—'} note="Changes with every deploy" />
        <Fact
          label="Newest Android app"
          value={apk?.version ?? (androidLatest ? `build ${androidLatest}` : '—')}
          note={min.android ? `Lowest allowed: build ${min.android}` : 'No lowest build set'}
        />
        <Fact label="iPhone app" value={iosLatest ? `build ${iosLatest}` : process.env.IOS_APP_URL ? 'Published' : 'Not yet'} note={min.ios ? `Lowest allowed: build ${min.ios}` : 'No lowest build set'} />
        <Fact label="On an older app" value={String(counts.old_app + counts.must_update)} note={`${counts.must_update} must update`} warn={counts.old_app + counts.must_update > 0} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Publish what&apos;s new</CardTitle>
            <CardDescription>
              Shown once to each person, the next time Xtend opens or comes back to the screen after the update.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PublishUpdate androidLatest={androidLatest} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Published</CardTitle>
            <CardDescription>The newest live one is what people see.</CardDescription>
          </CardHeader>
          <CardContent>
            {(releases ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing published yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {((releases ?? []) as Release[]).map((r) => (
                  <li key={r.id} className={cn('space-y-1 py-3', r.withdrawn_at && 'opacity-60')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.title}</span>
                      <Badge variant="outline">{AUDIENCE[r.audience]}</Badge>
                      {r.required && <Badge variant="destructive">Required</Badge>}
                      {r.min_android_build && <Badge variant="warning">Android ≥ {r.min_android_build}</Badge>}
                      {r.min_ios_build && <Badge variant="warning">iPhone ≥ {r.min_ios_build}</Badge>}
                      {r.withdrawn_at && <Badge variant="outline">Withdrawn</Badge>}
                    </div>
                    {r.notes && <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{r.notes}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{formatLagos(r.created_at)}</span>
                      {!r.withdrawn_at && <WithdrawRelease id={r.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who is on which version</CardTitle>
          <CardDescription>
            Recorded each time someone opens Xtend. {counts.current} up to date, {counts.old_site} not reloaded onto the
            newest site yet (it happens by itself next time they open it), {counts.old_app} on an older app,{' '}
            {counts.must_update} below the lowest app allowed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/admin/updates" className={cn('rounded-full border px-3 py-1 font-semibold', show !== 'behind' ? 'border-brand bg-tint' : 'border-border bg-card')}>
              Everyone ({listed.length})
            </Link>
            <Link href="/admin/updates?show=behind" className={cn('rounded-full border px-3 py-1 font-semibold', show === 'behind' ? 'border-brand bg-tint' : 'border-border bg-card')}>
              On an older app ({behind.length})
            </Link>
            <span className="ml-auto">
              <RemindToUpdate userIds={[...new Set(behind.map((r) => r.user_id))]} />
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {show === 'behind' ? 'Nobody is on an older app.' : 'Nobody has opened Xtend since this was set up.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium">On</th>
                    <th className="py-2 pr-3 font-medium">App version</th>
                    <th className="py-2 pr-3 font-medium">Last opened</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const p = who.get(r.user_id)
                    return (
                      <tr key={`${r.user_id}-${r.platform}`} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{p?.full_name ?? 'Unknown'}</span>
                          <span className="block text-xs capitalize text-muted-foreground">{p?.role}</span>
                        </td>
                        <td className="py-2 pr-3">{PLATFORM[r.platform]}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {r.platform === 'web' ? '—' : r.app_version ? `${r.app_version} (build ${r.app_build ?? '?'})` : 'Before updates were tracked'}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{formatLagos(r.last_seen)}</td>
                        <td className="py-2">
                          <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Fact({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-4">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className={cn('truncate text-xl font-semibold tabular-nums', warn && 'text-warning')}>{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  )
}
