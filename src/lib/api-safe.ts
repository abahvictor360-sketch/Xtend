import 'server-only'
import { apiError } from '@/lib/auth'
import { logError } from '@/lib/log'
import { sameSiteRedirect } from '@/lib/origin'

/**
 * A route handler that always answers in JSON (2026-11-27): anything it
 * throws becomes apiError() (logged and recorded, "Something went wrong.
 * Try again." to the caller) instead of Next's HTML error page, which the
 * phone apps cannot read.
 */
export function withErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      return apiError(error)
    }
  }
}

/**
 * A route that answers with a redirect (signing out, a paused account):
 * if it throws, it is logged and the person still lands on the login page
 * rather than an error page.
 */
export function withRedirectOnError<A extends unknown[]>(handler: (...args: A) => Promise<Response>, to: string) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      logError('api.redirect_route_failed', error, { path: to })
      return sameSiteRedirect(to)
    }
  }
}
