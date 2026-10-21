import assert from 'node:assert/strict'
import { checkPhoto, PermanentJobError } from '@/lib/offline/sync'

async function main() {
  const original = globalThis.fetch
  try {
    for (const status of [401, 429, 500, 400, 403, 422]) {
      globalThis.fetch = async () => Response.json({ error: 'Test response' }, { status })
      await assert.rejects(checkPhoto('selfies', 'sample/photo.jpg'), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error instanceof PermanentJobError, [400, 403, 422].includes(status))
        return true
      })
    }
    globalThis.fetch = async () => Response.json({ verdict: 'pass' })
    assert.equal(await checkPhoto('selfies', 'sample/photo.jpg'), 'pass')
    globalThis.fetch = async () => { throw new TypeError('Network unavailable') }
    await assert.rejects(checkPhoto('selfies', 'sample/photo.jpg'), TypeError)
    console.log('ALL PHOTO RETRY CHECKS PASSED')
  } finally {
    globalThis.fetch = original
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
