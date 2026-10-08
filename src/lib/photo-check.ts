import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Looks at a photo the way a supervisor would: is this a live selfie of a
 * real person, or a shelf in a real store, or is it a photo of a screen, a
 * printed photo, or too poor to show anything? Only a clear problem is a
 * rejection; anything uncertain passes, because blocking an honest clock-in
 * is worse than letting a doubtful one through to the integrity flags.
 */

export type PhotoKind = 'selfie' | 'shelf' | 'storefront' | 'product_selfie'

/** Where the photo was taken, as far as the background shows. */
export type PhotoSetting = 'shop' | 'market' | 'street' | 'office' | 'home' | 'unclear'

export interface PhotoVerdict {
  verdict: 'pass' | 'reject'
  problem:
    | 'none'
    | 'screen'
    | 'printed_photo'
    | 'no_face'
    | 'face_unclear'
    | 'not_a_shelf'
    | 'not_a_business'
    | 'no_product'
    | 'blurry'
    | 'too_dark'
    | 'other'
  /** One or two sentences to the person who took it, on what to do. */
  message: string
  setting: PhotoSetting
}

const MODEL = 'claude-opus-5'

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'reject'] },
    problem: {
      type: 'string',
      enum: [
        'none',
        'screen',
        'printed_photo',
        'no_face',
        'face_unclear',
        'not_a_shelf',
        'not_a_business',
        'no_product',
        'blurry',
        'too_dark',
        'other',
      ],
    },
    message: { type: 'string' },
    setting: { type: 'string', enum: ['shop', 'market', 'street', 'office', 'home', 'unclear'] },
  },
  required: ['verdict', 'problem', 'message', 'setting'],
  additionalProperties: false,
}

const COMMON = `You check photos that field staff of a Nigerian beauty brand take in a phone app, to stop cheating. Reject only when the problem is clear. When unsure, pass: blocking an honest worker is worse than letting a doubtful photo through, because doubtful photos are reviewed by a supervisor later.

Reject as "screen" when the photo shows another screen: a phone, tablet, laptop or monitor displaying an image. Signs: moiré or rainbow patterns, visible pixels or scan lines, screen glare or reflections, a bezel, phone frame or on-screen buttons, a picture-in-a-picture.
Reject as "printed_photo" when it is a photograph of a printed photo or ID card: paper edges, flat look, print texture, glossy glare, fingers holding a picture.
Reject as "blurry" or "too_dark" only when the subject cannot be made out at all.

Write "message" to the worker in one or two short, plain sentences: what is wrong and what to do. For a pass, message is "OK". Never mention supervisors, admins, the office, reviews, checks, flags or anything being recorded; only say what is wrong with the photo and how to retake it.

Also say in "setting" where the photo was taken, from the background: "shop" (inside a shop, pharmacy, supermarket or mall), "market" (a market stall or open market), "street" (outdoors by a road or building), "office", "home" (a bedroom, sitting room, kitchen or compound of a house: beds, sofas, curtains, wardrobes, home decor, family photos), or "unclear". Say "home" only when the signs are plain. The setting alone never decides the verdict.`

const PROMPTS: Record<PhotoKind, string> = {
  selfie: `${COMMON}

This should be a selfie taken live for clocking in: one real person's face, clearly visible, in front of the camera. Reject as "no_face" if there is no human face, and as "face_unclear" if the face is covered (mask over most of the face is fine only if the eyes are visible), turned away, cut off, or too small to recognise. Other people in the background are fine. The background can be a shop, street or anywhere.`,
  shelf: `${COMMON}

This should be a photo of a store shelf, display or stock room showing products, taken to prove a stock count. Reject as "not_a_shelf" if it shows no products at all (a face, a floor, a ceiling, a wall, a blank photo). Any retail products count; it does not have to be one brand.`,
  storefront: `${COMMON}

This should be a photo of the front, sign or entrance of a business, taken to name the place where the worker is standing: a shop, pharmacy, supermarket, mall, plaza, market, salon, kiosk or similar, inside or outside. The worker will name the place from it, and the office relies on it being a real business and not somebody's house.
Reject as "not_a_business" when it plainly shows a home and no business: a house front, gate or compound with nothing for sale and no sign, a bedroom, sitting room or kitchen, or a residential estate street. Also reject as "not_a_business" a photo with no place in it at all (a face, the sky, the floor, a blank photo). A small kiosk, a stall, or a shop built into the front of a house is a business: pass it.`,
  product_selfie: `${COMMON}

This should be a selfie taken live outside a shop or plaza the worker is naming: the worker's own face, clearly visible, holding one of the brand's products (a skincare, body or hair care product: a jar, tub, tube, bottle or pack) up to the camera. It proves they were there in person with the product.
Reject as "no_face" if there is no human face, and as "face_unclear" if the face is covered, turned away, cut off or too small to recognise.
Reject as "no_product" if no product is being held or shown at all. Do not reject because the brand name cannot be read, or because it may be another brand's product: the label is often turned away or too small.`,
}

const ASK: Record<PhotoKind, string> = {
  selfie: 'Check this clock-in selfie.',
  shelf: 'Check this shelf photo.',
  storefront: 'Check this photo of the place being named.',
  product_selfie: 'Check this selfie with a product.',
}

export function photoCheckConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Returns the verdict, or throws if the service could not give one. */
export async function judgePhoto(image: ArrayBuffer, kind: PhotoKind): Promise<PhotoVerdict> {
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: [{ type: 'text', text: PROMPTS[kind], cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: Buffer.from(image).toString('base64'),
            },
          },
          { type: 'text', text: ASK[kind] },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') throw new Error('The photo check declined this image')
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = JSON.parse(text) as PhotoVerdict
  parsed.setting ??= 'unclear'
  if (parsed.verdict !== 'pass' && parsed.verdict !== 'reject') {
    throw new Error('The photo check gave no verdict')
  }
  return parsed
}
