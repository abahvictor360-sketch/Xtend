/**
 * Logic checks for signing in with a fingerprint, face or passkey (0089):
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-quick-sign-in.ts
 *
 * The app's fingerprint key (secret, hash, rotation, storage format), when
 * the login page offers it, and a real passkey round trip: a software
 * authenticator makes a passkey and signs in with it, through the same
 * library calls and key storage as the routes.
 */
import assert from 'node:assert/strict'
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'
import { newAppSecret, secretHash, secretMatches } from '../src/lib/quick-sign-in'
import { APP_KEY_SERVER, keyLabelFrom, offerDue, packAppKey, unpackAppKey } from '../src/lib/quick-sign-in-rules'

let passed = 0
function check(condition: boolean, label: string) {
  assert.ok(condition, `FAIL: ${label}`)
  passed += 1
  console.log(`ok: ${label}`)
}

async function main() {
  // --- The app's fingerprint key -------------------------------------------
  const a = newAppSecret()
  const b = newAppSecret()
  check(a.secret !== b.secret && a.secret.length >= 40, 'each fingerprint key secret is new and long')
  check(a.hash === secretHash(a.secret) && /^[0-9a-f]{64}$/.test(a.hash), 'the server keeps only a SHA-256 of it')
  check(!a.hash.includes(a.secret), 'the hash does not contain the secret')
  check(secretMatches(a.secret, a.hash), 'the right secret matches')
  check(!secretMatches(b.secret, a.hash), 'another secret does not')
  check(!secretMatches(a.secret, b.hash), 'an old secret stops matching once replaced')
  check(!secretMatches('short', a.hash) && !secretMatches(a.secret, null), 'a short secret or a missing key never matches')
  check(!secretMatches('x'.repeat(500), a.hash), 'an oversized secret never matches')

  const id = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const packed = packAppKey(id, a.secret)
  const back = unpackAppKey(packed)
  check(back?.keyId === id && back.secret === a.secret, 'the phone stores the key id and secret and reads them back')
  check(unpackAppKey({ username: 'not-a-uuid', password: a.secret }) === null, 'something not stored by Xtend is ignored')
  check(unpackAppKey({ username: id, password: 'short' }) === null, 'a damaged secret is ignored')
  check(unpackAppKey(null) === null, 'nothing stored is nothing')
  check(APP_KEY_SERVER === 'xtend-sign-in', 'one fixed place in the phone keeps it')

  // --- Offering it after a password sign-in ---------------------------------
  const now = Date.parse('2026-11-17T12:00:00Z')
  check(offerDue(null, now), 'never declined: offered')
  check(!offerDue(now - 5 * 86_400_000, now), '"Not now" 5 days ago: not offered')
  check(offerDue(now - 31 * 86_400_000, now), '"Not now" over 30 days ago: offered again')
  check(keyLabelFrom('Chrome on Android (phone)', 'x') === 'Chrome on Android (phone)', 'a device is named from its browser')
  check(keyLabelFrom('  ', 'Xtend app') === 'Xtend app', 'an unknown device gets a plain name')
  check(keyLabelFrom('a'.repeat(300), 'x').length === 120, 'names are kept short')

  // --- A passkey, made and used by a software authenticator -----------------
  const rpID = 'www.withxtend.com'
  const origin = `https://${rpID}`
  const userId = '11111111-2222-4333-8444-555555555555'
  const reg = await generateRegistrationOptions({
    rpName: 'Xtend',
    rpID,
    userName: 'ada@xpel.ng',
    userDisplayName: 'Ada Okafor',
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  check(reg.authenticatorSelection?.userVerification === 'required', 'adding a passkey needs the fingerprint, face or screen lock')
  check(reg.authenticatorSelection?.residentKey === 'required', 'the passkey lives on the device, so no name is typed to use it')

  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const cose = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, isoBase64URL.toBuffer(jwk.x)],
    [-3, isoBase64URL.toBuffer(jwk.y)],
  ])
  const credId = randomBytes(16)
  const rpHash = createHash('sha256').update(rpID).digest()
  const u32 = (n: number) => {
    const out = Buffer.alloc(4)
    out.writeUInt32BE(n)
    return out
  }
  const u16 = (n: number) => {
    const out = Buffer.alloc(2)
    out.writeUInt16BE(n)
    return out
  }
  // Flags: user present (0x01) + user verified (0x04) + attested data (0x40).
  const regAuthData = Buffer.concat([
    rpHash,
    Buffer.from([0x45]),
    u32(0),
    Buffer.alloc(16),
    u16(credId.length),
    credId,
    Buffer.from(isoCBOR.encode(cose)),
  ])
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(regAuthData)],
    ]) as never,
  )
  const clientData = (type: string, challenge: string, from = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: from, crossOrigin: false }))
  const credIdText = isoBase64URL.fromBuffer(new Uint8Array(credId))
  const regResponse: RegistrationResponseJSON = {
    id: credIdText,
    rawId: credIdText,
    type: 'public-key',
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientData('webauthn.create', reg.challenge))),
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: ['internal'],
    },
    clientExtensionResults: {},
  }
  const verifiedReg = await verifyRegistrationResponse({
    response: regResponse,
    expectedChallenge: reg.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  })
  check(verifiedReg.verified, 'a new passkey is checked and accepted')
  // Kept as the route keeps it: base64url text in sign_in_keys.public_key.
  const stored = {
    credential_id: verifiedReg.registrationInfo!.credential.id,
    public_key: isoBase64URL.fromBuffer(verifiedReg.registrationInfo!.credential.publicKey),
    sign_count: verifiedReg.registrationInfo!.credential.counter,
  }
  check(stored.credential_id === credIdText, 'the passkey is found again by its credential id')

  const wrongOrigin = await verifyRegistrationResponse({
    response: {
      ...regResponse,
      response: {
        ...regResponse.response,
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientData('webauthn.create', reg.challenge, 'https://evil.example'))),
      },
    },
    expectedChallenge: reg.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).then(
    (r) => r.verified,
    () => false,
  )
  check(!wrongOrigin, 'a passkey made on another site is refused')

  async function signIn(counter: number, challengeOverride?: string, flags = 0x05) {
    const auth = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
    const authData = Buffer.concat([rpHash, Buffer.from([flags]), u32(counter)])
    const cd = clientData('webauthn.get', challengeOverride ?? auth.challenge)
    const signer = createSign('SHA256')
    signer.update(Buffer.concat([authData, createHash('sha256').update(cd).digest()]))
    const response: AuthenticationResponseJSON = {
      id: credIdText,
      rawId: credIdText,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(cd)),
        authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signer.sign(privateKey))),
        userHandle: isoBase64URL.fromBuffer(new TextEncoder().encode(userId)),
      },
      clientExtensionResults: {},
    }
    return verifyAuthenticationResponse({
      response,
      expectedChallenge: auth.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.sign_count),
        transports: ['internal'],
      },
      requireUserVerification: true,
    }).then(
      (r) => r,
      () => ({ verified: false as const, authenticationInfo: undefined }),
    )
  }

  const first = await signIn(1)
  check(first.verified === true, 'signing in with the passkey works, with the key as stored')
  if (first.verified) stored.sign_count = first.authenticationInfo.newCounter
  check(stored.sign_count === 1, 'the signature counter is kept after each sign-in')
  check((await signIn(2, 'another-challenge')).verified === false, 'an answer to another challenge (a replay) is refused')
  check((await signIn(3, undefined, 0x01)).verified === false, 'a passkey used without the fingerprint, face or lock is refused')

  console.log(`\nALL ${passed} QUICK SIGN-IN CHECKS PASSED`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
