/** Accept only a local page after sign-in, never a protocol-relative or external URL. */
export function loginDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return '/'
  try {
    const url = new URL(value, 'https://xtend.invalid')
    if (url.origin !== 'https://xtend.invalid' || url.pathname.startsWith('//')) return '/'
    const path = decodeURIComponent(url.pathname)
    if (path.startsWith('//') || path.includes('\\')) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}
