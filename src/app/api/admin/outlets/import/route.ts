import { z } from 'zod'
import { optional, zAddress, zPlaceName } from '@/lib/validation'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { apiError, requireApiSession, dbErrorMessage } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { locateAddress } from '@/lib/geocode'

export const maxDuration = 60

const rowSchema = z.object({
  name: zPlaceName,
  address: optional(zAddress),
  // Coordinates may be supplied outright; then nothing is looked up.
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  geofence_radius_m: z.number().int().min(25).max(2000).optional(),
})

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(40),
  geofence_radius_m: z.number().int().min(25).max(2000).default(150),
  shift_start: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
  shift_end: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  commit: z.boolean().default(false),
})

export interface OutletImportRow {
  line: number
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number
  /** Where the coordinates came from, so a rough one can be spotted. */
  source: string | null
  /** The address the provider settled on, when it differs from the input. */
  resolved_address: string | null
  error: string | null
  created?: boolean
  outlet_id?: string | null
}

/**
 * Stores arrive as a list of names and addresses. A geofence needs a point,
 * so each row is looked up before anything is written — and the whole list
 * is shown back for checking first, because a store pinned on the wrong
 * street quietly marks everyone who works there as off site.
 */
export async function POST(request: Request) {
  try {
    await requireApiSession(['admin'])
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid import' },
        { status: 400 },
      )
    }
    const { rows, commit, geofence_radius_m, shift_start, shift_end } = parsed.data

    const admin = createAdminSupabase()
    const { data: existing } = await admin.from('outlets').select('name')
    const taken = new Set(
      (existing ?? []).map((o: { name: string }) => o.name.trim().toLowerCase()),
    )

    const seen = new Set<string>()
    const results: OutletImportRow[] = []

    // Duplicate checks first, in order, so "appears twice" always blames the
    // second one no matter how the lookups below interleave.
    for (const [index, row] of rows.entries()) {
      const name = row.name.trim()
      const key = name.toLowerCase()
      const result: OutletImportRow = {
        line: index + 1,
        name,
        address: row.address?.trim() || null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        geofence_radius_m: row.geofence_radius_m ?? geofence_radius_m,
        source: row.lat != null && row.lng != null ? 'given' : null,
        resolved_address: null,
        error: null,
      }

      if (taken.has(key)) result.error = 'A store with that name already exists'
      else if (seen.has(key)) result.error = 'That store appears twice in this list'
      else seen.add(key)

      results.push(result)
    }

    // A few at a time: one at a time is too slow for a list of hundreds,
    // and all at once gets rate-limited by the geocoder.
    const pending = results.filter((r) => !r.error && (r.lat == null || r.lng == null))
    const CONCURRENCY = 5
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.all(
        pending.slice(i, i + CONCURRENCY).map(async (result) => {
          const found = await locateAddress(result.name, result.address)
          if (!found) {
            result.error = 'Could not find that address on the map'
            return
          }
          result.lat = found.lat
          result.lng = found.lng
          result.source = found.source
          result.resolved_address = found.address
        }),
      )
    }

    const usable = results.filter((r) => !r.error && r.lat != null && r.lng != null)

    if (!commit) {
      return Response.json({ dry_run: true, rows: results, ready: usable.length })
    }

    if (usable.length === 0) {
      return Response.json({ error: 'Nothing in that list could be imported.' }, { status: 400 })
    }

    const { data: inserted, error } = await admin
      .from('outlets')
      .insert(
        usable.map((r) => ({
          name: r.name,
          address: r.resolved_address ?? r.address,
          lat: r.lat as number,
          lng: r.lng as number,
          geofence_radius_m: r.geofence_radius_m,
          shift_start,
          shift_end,
        })),
      )
      .select('id, name')

    if (error) return Response.json({ error: dbErrorMessage(error) }, { status: 400 })

    const idByName = new Map(
      (inserted ?? []).map((o: { id: string; name: string }) => [o.name, o.id]),
    )
    for (const row of results) {
      if (row.error) continue
      row.outlet_id = idByName.get(row.name) ?? null
      row.created = Boolean(row.outlet_id)
    }

    const supabase = await createServerSupabase()
    await audit(supabase, 'outlet.import', 'outlets', null, {
      requested: rows.length,
      created: inserted?.length ?? 0,
      skipped: results.filter((r) => r.error).length,
    })

    return Response.json({
      dry_run: false,
      rows: results,
      created: inserted?.length ?? 0,
    })
  } catch (error) {
    return apiError(error)
  }
}
