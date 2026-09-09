import { apiError, requireApiSession } from '@/lib/auth'

/**
 * Reverse geocoding proxied server-side: keeps the contact header on one
 * place, avoids CORS, and lets us fail soft. An address is a convenience,
 * never a gate — the coordinates are the record.
 */
export async function GET(request: Request) {
  try {
    await requireApiSession()
    const url = new URL(request.url)
    const lat = Number(url.searchParams.get('lat'))
    const lng = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    const endpoint = new URL('https://nominatim.openstreetmap.org/reverse')
    endpoint.searchParams.set('format', 'jsonv2')
    endpoint.searchParams.set('lat', String(lat))
    endpoint.searchParams.set('lon', String(lng))
    endpoint.searchParams.set('zoom', '18')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': process.env.GEOCODER_USER_AGENT ?? 'Xtend/1.0',
          'Accept-Language': 'en',
        },
        signal: controller.signal,
        next: { revalidate: 0 },
      })
      if (!res.ok) throw new Error(`geocoder ${res.status}`)
      const body = (await res.json()) as { display_name?: string }
      return Response.json({ address: body.display_name ?? null })
    } catch {
      return Response.json({ address: null })
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    return apiError(error)
  }
}
