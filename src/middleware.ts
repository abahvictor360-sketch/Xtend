import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { BOT_BLOCKED_BODY, botDecision } from '@/lib/bot-guard'
import { LAST_SEEN_COOKIE, LAST_SEEN_HEADER, OFFICE_SESSION_HOURS, originAllowed } from '@/lib/zero-trust'

const PUBLIC_PATHS = ['/login', '/deactivated', '/offline', '/download', '/guide']

/**
 * Refreshes the Supabase session cookie on every navigation so field staff
 * are not logged out mid-shift, and keeps unauthenticated users off the app.
 * Role enforcement itself lives in Postgres; this is only routing.
 *
 * It must live in src/, beside app/: Next.js ignores a middleware file at
 * the project root when the app is under src/.
 */
export async function middleware(request: NextRequest) {
  // Crawlers, scrapers, AI bots and scripts are turned away before anything
  // else (lib/bot-guard.ts). Scheduled jobs, the phone's tracker, health
  // checks and static files are never refused. Off under `next dev`, so
  // local screenshots with a headless browser keep working.
  if (process.env.NODE_ENV === 'production') {
    const verdict = botDecision(request.nextUrl.pathname, request.headers.get('user-agent'))
    if (verdict.block) {
      return new NextResponse(BOT_BLOCKED_BODY, {
        status: 403,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      })
    }
  }

  // Zero trust: a request that changes something must come from Xtend's
  // own pages (or not from a browser at all), never from another site.
  if (
    !originAllowed({
      method: request.method,
      path: request.nextUrl.pathname,
      host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
    })
  ) {
    return NextResponse.json(
      { error: 'This request did not come from Xtend, so it was refused.', code: 'origin' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // When this browser last made a request, for the office idle limit
  // (lib/auth.ts). Only the middleware may say: anything a caller sent
  // under that name is dropped.
  request.headers.delete(LAST_SEEN_HEADER)
  const lastSeen = request.cookies.get(LAST_SEEN_COOKIE)?.value
  if (lastSeen && /^\d{10,16}$/.test(lastSeen)) request.headers.set(LAST_SEEN_HEADER, lastSeen)

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: OFFICE_SESSION_HOURS * 3600,
    })
  }

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))

  // API routes check the session themselves and answer 401 in JSON, which
  // the app relies on (the offline outbox, the login form). A redirect to
  // the login page would hand them HTML instead. Some must work signed
  // out: signing in, the phone answering a check, the health check.
  if (path.startsWith('/api/')) return response

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker, the manifest and
    // the logo the signed-out login page shows, and robots.txt (which tells
    // every crawler to stay out, so it must reach them).
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|robots.txt|icons/|brand/|api/cron).*)',
  ],
}
