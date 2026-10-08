import { createServerSupabase } from '@/lib/supabase/server'
import { ApiError, apiError, requireApiSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { renderExport, type ExportRow } from '@/lib/export/render'
import { duration, journey, mergeTrails, summarise } from '@/lib/movement'
import { MAX_DAYS, daysBetween, fetchTrails } from '@/lib/movement-server'
import { addDays, formatLagos, lagosDateString, metres } from '@/lib/utils'

export const maxDuration = 60

/** One person's journey, as on the Movement page: stops, travel and silences. */
export async function GET(request: Request, ctx: { params: Promise<{ format: string }> }) {
  try {
    await requireApiSession(['admin', 'supervisor'])
    const { format } = await ctx.params
    const url = new URL(request.url)
    const person = url.searchParams.get('person') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(person)) throw new ApiError('Pick a person', 400)
    const today = lagosDateString()
    const isDate = (v: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '')
    const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date')! : today
    let until = isDate(url.searchParams.get('until')) ? url.searchParams.get('until')! : date
    if (until < date) until = date
    if (until > addDays(date, MAX_DAYS - 1)) until = addDays(date, MAX_DAYS - 1)

    const supabase = await createServerSupabase()
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', person).maybeSingle()
    if (!profile) throw new ApiError('Not found', 404)
    const { trails, error } = await fetchTrails(supabase, person, daysBetween(date, until))
    if (error) throw new ApiError(error, 400)
    const trail = mergeTrails(trails)
    const trip = journey(trail)
    const summary = summarise(trail)

    const rows: ExportRow[] = trip.legs.map((l) => {
      const map = l.kind === 'stop' ? `https://www.google.com/maps?q=${l.lat},${l.lng}` : null
      return {
        values: [
          formatLagos(l.from),
          formatLagos(l.to, false),
          duration(l.minutes),
          { stop: l.kind === 'stop' && l.inStore ? 'At a store' : 'Stayed elsewhere', move: 'Travelling', gap: 'Nothing heard', off: 'Clocked out' }[l.kind],
          l.kind === 'stop' ? l.name : '',
          l.kind === 'move' ? metres(l.distanceM) : '',
          l.kind === 'move' && l.kmh ? `${Math.round(l.kmh)} km/h` : '',
          map ? 'Open map' : '',
        ],
        link: map,
      }
    })
    const t = trip.totals
    const notes = [
      `Moved ${metres(summary.distanceM)}. At their stores ${duration(t.storeMinutes)}, stayed elsewhere ${duration(t.elsewhereMinutes)}, travelling ${duration(t.movingMinutes)}, nothing heard ${duration(t.silentMinutes)}.`,
      trip.jumps.length
        ? `${trip.jumps.length} impossible jump${trip.jumps.length === 1 ? '' : 's'} (faster than 150 km/h), first at ${formatLagos(trip.jumps[0].from)}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    const response = await renderExport(format, {
      title: `Movement: ${profile.full_name}`,
      subtitle: date === until ? date : `${date} to ${until}`,
      notes,
      wrap: true,
      sheetName: 'Journey',
      columns: ['From', 'To', 'How long', 'What', 'Where', 'Distance', 'Speed', 'Map'],
      rows,
      widths: { xlsx: [18, 8, 12, 16, 34, 10, 10, 10], pdf: [110, 50, 70, 100, 240, 70, 70, 60] },
      linkColumn: 7,
      linkText: 'Open map',
      noLinkText: '',
      fileBase: `xtend-movement-${profile.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    })
    await audit(supabase, `export.movement.${format}`, 'profiles', person, { date, until, legs: rows.length })
    return response
  } catch (error) {
    return apiError(error)
  }
}
