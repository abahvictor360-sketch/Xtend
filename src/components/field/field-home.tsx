'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Clock3, FileText, LogIn, LogOut, MapPin, Store } from 'lucide-react'
import { GreetingHeader } from '@/components/field/greeting-header'
import { LocationGate } from '@/components/field/location-gate'
import { useLocationGate } from '@/components/field/use-location-gate'
import { useHeartbeat } from '@/components/field/heartbeat'
import { usePlace } from '@/components/field/use-place'
import { OutboxBanner } from '@/components/field/outbox-banner'
import { ClockPanel } from '@/components/field/clock-panel'
import { TrackingPanel } from '@/components/field/tracking-panel'
import { TaskRow } from '@/components/field/task-row'
import { SectionHeader } from '@/components/field/screen'
import { Chip } from '@/components/ui/chip'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { haversineMetres } from '@/lib/geo'
import { formatLagos, metres } from '@/lib/utils'
import type { ClockSummary, Coverage, DayState } from '@/lib/types'

type Tab = 'day' | 'outlet' | 'tracking'

const TABS: { id: Tab; label: string }[] = [
  { id: 'day', label: 'My day' },
  { id: 'outlet', label: 'Outlet' },
  { id: 'tracking', label: 'Tracking' },
]

export function FieldHome({ day, coverage }: { day: DayState; coverage: Coverage | null }) {
  const router = useRouter()
  const gate = useLocationGate()
  const [tab, setTab] = useState<Tab>('day')

  const onShift = Boolean(day.opening) && !day.closing
  const heartbeat = useHeartbeat(onShift && gate.status === 'ready')

  const { place, loading: placeLoading } = usePlace(gate.fix)
  const whereIAm = place?.place ?? place?.address ?? null

  const liveDistance =
    gate.fix && day.outlet
      ? haversineMetres(gate.fix.lat, gate.fix.lng, day.outlet.lat, day.outlet.lng)
      : null
  const inside = liveDistance !== null && day.outlet ? liveDistance <= day.outlet.radius_m : null

  const steps = [
    { done: Boolean(day.opening), label: 'Clock in' },
    { done: onShift || Boolean(day.closing), label: 'On shift' },
    ...(day.can_file_report ? [{ done: day.report_filed, label: 'Daily report' }] : []),
    { done: Boolean(day.closing), label: 'Clock out' },
  ]
  const progress = Math.round((steps.filter((s) => s.done).length / steps.length) * 100)

  return (
    <div className="space-y-5">
      <GreetingHeader
        fullName={day.profile?.full_name ?? 'there'}
        subtitle={
          onShift
            ? 'You are on shift. Have a good one.'
            : day.closing
              ? 'Shift closed for today. Nice work.'
              : 'Have a nice day!'
        }
      />

      <OutboxBanner onFlushed={() => router.refresh()} />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {TABS.map((item) => (
          <Chip key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </Chip>
        ))}
      </div>

      {/* The two clock events as brand cards, exactly the shape of the
          project cards in the reference. */}
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        <ClockCard
          kind="opening"
          state={day.opening}
          outletName={day.outlet?.name}
          progress={progress}
          date={day.date}
        />
        <ClockCard
          kind="closing"
          state={day.closing}
          outletName={day.outlet?.name}
          progress={progress}
          date={day.date}
        />
      </div>

      {gate.status === 'ready' && (
        <div className="flex items-start gap-2 rounded-2xl bg-tint px-3 py-2.5 text-tint-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs leading-snug">
            <span className="font-semibold">You are at </span>
            {whereIAm ?? (placeLoading ? 'finding the place name…' : 'an unnamed spot')}
            {gate.fix && (
              <span className="block text-[11px] opacity-80">
                {gate.fix.lat.toFixed(5)}, {gate.fix.lng.toFixed(5)} · accurate to ±
                {Math.round(gate.fix.accuracy_m)} m
                {liveDistance !== null && ` · ${metres(liveDistance)} from your outlet`}
              </span>
            )}
          </p>
        </div>
      )}

      <LocationGate
        status={gate.status}
        reason={gate.reason}
        message={gate.message}
        onRetry={() => void gate.retry()}
      >
        <ClockPanel day={day} />
      </LocationGate>

      {tab === 'day' && (
        <section className="space-y-3">
          <SectionHeader
            title="Progress"
            action={<span className="text-xs font-semibold text-brand">{progress}% done</span>}
          />

          <TaskRow
            icon={<LogIn className="h-5 w-5" />}
            title="Clock in"
            meta={
              day.opening
                ? `${formatLagos(day.opening.at, false)} · ${metres(day.opening.distance_m)} from outlet`
                : 'Not yet today'
            }
            muted={!day.opening}
            trailing={<StatusDot summary={day.opening} />}
          />

          {day.can_file_report && (
            <TaskRow
              icon={<FileText className="h-5 w-5" />}
              title="Daily report"
              meta={day.report_filed ? 'Filed. Editable until midnight.' : 'Not filed yet'}
              muted={!day.report_filed}
              trailing={
                <Link href="/field/report" className="text-xs font-semibold text-brand">
                  {day.report_filed ? 'Edit' : 'File'}
                </Link>
              }
            />
          )}

          <TaskRow
            icon={<LogOut className="h-5 w-5" />}
            title="Clock out"
            meta={
              day.closing
                ? `${formatLagos(day.closing.at, false)} · ${metres(day.closing.distance_m)} from outlet`
                : day.opening
                  ? 'At the end of your shift'
                  : 'Clock in first'
            }
            muted={!day.closing}
            trailing={<StatusDot summary={day.closing} />}
          />
        </section>
      )}

      {tab === 'outlet' && (
        <section className="space-y-3">
          <SectionHeader title="Your outlet" />
          {day.outlet ? (
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="flex items-start gap-3">
                  <span className="icon-tile">
                    <Store className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{day.outlet.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {day.outlet.address ?? 'No address on file'}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Detail label="Shift" value={`${day.outlet.shift_start.slice(0, 5)} – ${day.outlet.shift_end.slice(0, 5)}`} />
                  <Detail label="Geofence" value={`${day.outlet.radius_m} m`} />
                  <Detail
                    label="You are"
                    value={liveDistance === null ? 'Locating…' : `${metres(liveDistance)} away`}
                    tone={inside === null ? undefined : inside ? 'good' : 'bad'}
                  />
                  <Detail label="Your location" value={whereIAm ?? 'Unnamed spot'} />
                  <Detail
                    label="Fix accuracy"
                    value={gate.fix ? `±${Math.round(gate.fix.accuracy_m)} m` : '—'}
                  />
                </dl>

                {gate.fix && (
                  <a
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand"
                    href={`https://www.openstreetmap.org/?mlat=${day.outlet.lat}&mlon=${day.outlet.lng}#map=17/${day.outlet.lat}/${day.outlet.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Open the outlet on a map
                  </a>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                No outlet is assigned to you yet.
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {tab === 'tracking' && (
        <section className="space-y-3">
          <SectionHeader title="Location tracking" />
          <TrackingPanel onShift={onShift} status={heartbeat} coverage={coverage} />
        </section>
      )}
    </div>
  )
}

function ClockCard({
  kind,
  state,
  outletName,
  progress,
  date,
}: {
  kind: 'opening' | 'closing'
  state: ClockSummary | null
  outletName?: string
  progress: number
  date: string
}) {
  const label = kind === 'opening' ? 'Clock in' : 'Clock out'
  const done = Boolean(state)

  return (
    <article
      className={`min-w-[62%] snap-start rounded-3xl p-4 ${
        done ? 'brand-surface shadow-lift' : 'surface border border-dashed border-brand/25'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`text-[11px] font-semibold ${done ? 'text-white/75' : 'text-muted-foreground'}`}>
          {date}
        </span>
        {done ? (
          <Badge variant="onBrand">
            {state!.status === 'on_site' ? 'On site' : state!.status === 'off_site' ? 'Off site' : 'Flagged'}
          </Badge>
        ) : (
          <Badge variant="outline">Pending</Badge>
        )}
      </div>

      <p className={`mt-6 text-lg font-extrabold ${done ? 'text-white' : 'text-foreground'}`}>{label}</p>
      <p className={`text-sm ${done ? 'text-white/80' : 'text-muted-foreground'}`}>
        {done ? formatLagos(state!.at, false) : outletName ?? 'Awaiting'}
      </p>

      <div className="mt-5">
        <div className={`flex items-center justify-between text-[11px] ${done ? 'text-white/80' : 'text-muted-foreground'}`}>
          <span>Day progress</span>
          <span className="font-semibold">{progress}%</span>
        </div>
        <div className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${done ? 'bg-white/25' : 'bg-muted'}`}>
          <div
            className={`h-full rounded-full ${done ? 'bg-white' : 'bg-brand'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </article>
  )
}

function StatusDot({ summary }: { summary: ClockSummary | null }) {
  if (!summary) return <Circle className="h-5 w-5 text-muted-foreground/40" />
  return summary.status === 'on_site' ? (
    <CheckCircle2 className="h-5 w-5 text-success" />
  ) : (
    <Clock3 className="h-5 w-5 text-destructive" />
  )
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd
        className={`mt-0.5 font-semibold ${
          tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
