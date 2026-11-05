/**
 * What an error from Supabase's account service (creating an account,
 * changing its email or password) may tell the person who asked. A few
 * known cases get plain words; anything else describes the service, so it
 * is logged and the caller gets the fallback.
 */
export function authAdminError(
  error: { code?: string; message?: string; status?: number } | null | undefined,
  fallback = 'The account could not be changed. Try again.',
): { message: string; status: number } {
  const code = error?.code ?? ''
  const text = (error?.message ?? '').toLowerCase()
  if (code === 'email_exists' || code === 'user_already_exists' || text.includes('already been registered') || text.includes('already registered') || text.includes('already exists')) {
    return { message: 'Somebody already uses that email.', status: 409 }
  }
  if (code === 'email_address_invalid' || text.includes('invalid email') || text.includes('unable to validate email')) {
    return { message: 'Check the email address.', status: 400 }
  }
  if (code === 'weak_password' || text.includes('password should be')) {
    return { message: 'That password is too easy to guess.', status: 400 }
  }
  if (error) console.error('account service error', error)
  return { message: fallback, status: 400 }
}
