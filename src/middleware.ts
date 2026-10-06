import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

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
    // the logo the signed-out login page shows.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|brand/|api/cron).*)',
  ],
}
