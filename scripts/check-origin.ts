/**
 * Checks for the site's own address and moves within it (src/lib/origin.ts):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-origin.ts
 *
 * Behind a proxy the server may only know itself as localhost. Nothing it
 * sends to a phone may point there: the app then opened Chrome on
 * "localhost refused to connect".
 */
import assert from 'node:assert/strict'
import { isLocalHost, publicOrigin, sameSiteRedirect } from '../src/lib/origin'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

const req = (headers: Record<string, string>) => new Request('http://localhost:3000/api/auth/expired', { headers })

async function main() {
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.SITE_URL

  check(
    publicOrigin(req({ host: 'localhost:3000', 'x-forwarded-host': 'www.withxtend.com', 'x-forwarded-proto': 'https' })) ===
      'https://www.withxtend.com',
    'the proxy\'s forwarded host and scheme win over the container\'s own name',
  )
  check(publicOrigin(req({ host: 'www.withxtend.com' })) === 'https://www.withxtend.com', 'a real host with no scheme given is https')
  check(
    publicOrigin(req({ host: 'localhost:3000', 'x-forwarded-proto': 'https', referer: 'https://www.withxtend.com/field' })) ===
      'https://www.withxtend.com',
    'a proxy that passes only localhost: the address the page itself is on is used',
  )
  check(
    publicOrigin(req({ host: 'localhost:3000', origin: 'https://www.withxtend.com' })) === 'https://www.withxtend.com',
    'the browser\'s Origin works the same way',
  )
  check(
    publicOrigin(req({ host: 'localhost:3000', referer: 'http://127.0.0.1:3000/x' })).includes('localhost'),
    'a local Referer is not trusted as the real address (local testing keeps working)',
  )
  process.env.SITE_URL = 'https://www.withxtend.com/'
  check(publicOrigin(req({ host: 'localhost:3000' })) === 'https://www.withxtend.com', 'SITE_URL, when set, always wins')
  delete process.env.SITE_URL

  check(isLocalHost('localhost:3000') && isLocalHost('127.0.0.1') && isLocalHost('0.0.0.0:80') && isLocalHost('[::1]:3000'), 'local names are recognised')
  check(!isLocalHost('www.withxtend.com') && !isLocalHost('localhost.example.com'), 'real names are not')

  const moved = sameSiteRedirect('/login?reason=clocked-out')
  const html = await moved.text()
  check(moved.status === 200 && !moved.headers.get('location'), 'leaving after clock-out is not a server redirect (no host is named)')
  check(html.includes('location.replace("/login?reason=clocked-out")'), 'the phone moves itself to the login page on the address it is on')
  check(html.includes('http-equiv="refresh" content="0;url=/login?reason=clocked-out"'), 'and without scripts too')
  check(!/https?:\/\//.test(html), 'the page names no address at all')
  check(moved.headers.get('cache-control') === 'no-store', 'it is never cached')

  const outside = await sameSiteRedirect('//evil.example/x').text()
  check(outside.includes('location.replace("/")') && !outside.includes('evil'), 'only paths within the site: anything else goes to Home')
  const odd = await sameSiteRedirect('/a?b=</script><script>x()</script>&c="d"').text()
  check(!odd.includes('</script><script>x()') && !odd.includes('"d""'), 'odd characters cannot break out of the page')

  console.log(`\nALL ${passed} ORIGIN CHECKS PASSED`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
