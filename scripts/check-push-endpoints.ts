/**
 * Checks the rule for which push addresses the server will send to: the real
 * push services only, never an address inside the server's own network.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-push-endpoints.ts
 */
import { isWebPushEndpoint } from '@/lib/push-endpoint'
const cases: [string, boolean][] = [
  ['https://fcm.googleapis.com/fcm/send/abc:APA91b', true],
  ['https://updates.push.services.mozilla.com/wpush/v2/gAAA', true],
  ['https://web.push.apple.com/QGuQyavXutnMH', true],
  ['https://wns2-par02p.notify.windows.com/w/?token=AwYAAA', true],
  ['http://fcm.googleapis.com/fcm/send/x', false],
  ['https://fcm.googleapis.com:8443/x', false],
  ['https://fcm.googleapis.com@169.254.169.254/latest', false],
  ['https://user:pw@fcm.googleapis.com/x', false],
  ['https://fcm.googleapis.com.evil.com/x', false],
  ['https://evil.com/fcm.googleapis.com/', false],
  ['https://evil.com#.notify.windows.com/', false],
  ['http://127.0.0.1:5432/', false],
  ['http://169.254.169.254/latest/meta-data/', false],
  ['https://localhost/', false],
  ['native-fcm:abcdefghijklmnopqrstuvwxyz', false],
  ['not a url', false],
]
let bad = 0
for (const [u, want] of cases) {
  const got = isWebPushEndpoint(u)
  console.log(got === want ? 'ok  ' : 'FAIL', got ? 'allowed' : 'refused', u)
  if (got !== want) bad++
}
process.exit(bad)
