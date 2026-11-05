/**
 * Somebody whose password was set by the office (a new account, or a reset)
 * must choose their own before doing anything else. Pages already send them
 * to /change-password; the API refuses them too, except the few calls the
 * change itself needs (setting the password, signing out, recording that
 * the app was opened or which version it runs).
 */
export const CHANGE_PASSWORD_CODE = 'change_password'
export const CHANGE_PASSWORD_MESSAGE = 'Choose your own password first.'

export function passwordChangeBlocks(mustChangePassword: boolean, allowedDuringChange: boolean): boolean {
  return mustChangePassword && !allowedDuringChange
}

/**
 * Whether a password change must prove the current password. The first
 * change after the office set it does not: the person was just given it
 * and signed in with it a moment ago. Every other change does, so a phone
 * left signed in cannot be used to take the account over.
 */
export function currentPasswordRequired(mustChangePassword: boolean): boolean {
  return !mustChangePassword
}
