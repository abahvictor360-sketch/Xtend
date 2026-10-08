import { z } from 'zod'
import { xmAdminAction } from '@/lib/metrics/admin-route'
import { thingName, writtenText } from '@/lib/fields'

const schema = z.object({
  title: thingName(120, 'title'),
  body: writtenText(20000, 20, 'the policy'),
  change_note: writtenText(300, 0, 'the note on what changed'),
})

/** Publishes a new version of the scoring policy. Earlier ones are kept. */
export async function POST(request: Request) {
  return xmAdminAction(request, schema, async (b, db) => {
    const { data, error } = await db.rpc('xm_publish_policy', {
      p_title: b.title,
      p_body: b.body,
      p_note: b.change_note || null,
    })
    return {
      data,
      error,
      // The policy text is in the table; the audit row only says it changed.
      audit: ['xm.policy.publish', 'xm_policy_versions', (data as string) ?? null, { body: undefined }],
    }
  })
}
