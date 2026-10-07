import { z } from 'zod'

/**
 * What every form field accepts, in one place, so a name is a name, a phone
 * is a phone and a report says something. The server checks with these;
 * the forms use the same messages. Postgres repeats the essentials for the
 * tables staff can write to directly (migration 039).
 */

/** Control characters, keeping tab and newline for multi-line text. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g

/** A link, written as a URL or a bare domain: what spam is made of. */
const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|ng|io|co|xyz|info|biz|me|link|click|top|site|online|shop|app|ru|cn)\b)/i

const LETTER = /\p{L}/gu

/** Tidies text: no hidden characters, single spaces, trimmed. */
export function cleanText(value: string, multiLine = false): string {
  const stripped = value.normalize('NFC').replace(CONTROL, '')
  return multiLine
    ? stripped
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : stripped.replace(/\s+/g, ' ').trim()
}

/** Says something: enough letters, and not one key held down. */
export function hasWords(value: string, minLetters = 2): boolean {
  return (value.match(LETTER) ?? []).length >= minLetters && !/(.)\1{5,}/u.test(value.replace(/\s/g, ''))
}

export function hasLink(value: string): boolean {
  return LINK.test(value)
}

/** A person's name: letters, spaces, apostrophes, hyphens and full stops. */
export const personName = z
  .string()
  .transform((v) => cleanText(v))
  .pipe(
    z
      .string()
      .min(2, 'Type the full name')
      .max(80, 'That name is too long')
      .regex(/^[\p{L}][\p{L}\p{M}' .-]*$/u, 'A name can only have letters, spaces, hyphens and apostrophes')
      .refine((v) => hasWords(v), 'Type the full name'),
  )

/**
 * A Nigerian mobile number, as the WhatsApp number staff give: 0803…,
 * +234 803… or 234803…, with or without spaces. Stored as 0803….
 */
export function normalisePhone(value: string): string | null {
  let digits = value.replace(/[\s().-]/g, '')
  if (digits.startsWith('+234')) digits = `0${digits.slice(4)}`
  else if (digits.startsWith('234') && digits.length === 13) digits = `0${digits.slice(3)}`
  return /^0[789][01]\d{8}$/.test(digits) ? digits : null
}

export const phoneNumber = z
  .string()
  .transform((v, ctx) => {
    const phone = normalisePhone(v)
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Type a Nigerian mobile number, like 08031234567' })
      return z.NEVER
    }
    return phone
  })

/** A phone that may be left out: empty means none. */
export const optionalPhone = z
  .union([z.literal(''), z.null(), phoneNumber])
  .optional()
  .transform((v) => (v ? v : null))

export const emailAddress = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().email('Type a real email address, like name@example.com').max(200))

/** The name of a store, a place or a product. */
export function thingName(max: number, what = 'name', minLetters = 2) {
  return z
    .string()
    .transform((v) => cleanText(v))
    .pipe(
      z
        .string()
        .min(2, `Type the ${what}`)
        .max(max, `That ${what} is too long`)
        .refine((v) => hasWords(v, minLetters), `Type the ${what} in words`)
        .refine((v) => !hasLink(v), `A ${what} cannot be a link`),
    )
}

/** An address: optional, but if given it is an address, not a link. */
export const address = z
  .union([z.literal(''), z.null(), z.string()])
  .optional()
  .transform((v) => (v ? cleanText(v) : null))
  .refine((v) => v === null || v.length <= 400, 'That address is too long')
  .refine((v) => v === null || !hasLink(v), 'An address cannot be a link')

/**
 * Written text: a report section, a message, a note. No hidden characters,
 * real words, and no links unless `allowLinks` (an admin's own message).
 * `min` is the shortest acceptable answer; 0 makes the field optional (but
 * anything typed must still be words).
 */
export function writtenText(max: number, min = 0, what = 'this', allowLinks = false) {
  return z
    .string()
    .default('')
    .transform((v) => cleanText(v, true))
    .refine((v) => v.length <= max, `Keep ${what} under ${max} characters`)
    .refine((v) => (min === 0 && v === '') || v.length >= min, `Write a little more for ${what}`)
    .refine((v) => v === '' || hasWords(v, Math.min(min || 2, 10)), `Write ${what} in words`)
    .refine((v) => allowLinks || !hasLink(v), `Leave links out of ${what}`)
}

/** A short note, optional: an alert resolution, a review, a count request. */
export function note(max = 500) {
  return z
    .union([z.null(), z.string()])
    .optional()
    .transform((v) => (v ? cleanText(v, true) : ''))
    .refine((v) => v.length <= max, `Keep the note under ${max} characters`)
    .refine((v) => v === '' || hasWords(v), 'Write the note in words')
    .refine((v) => !hasLink(v), 'Leave links out of the note')
}

/** A file name to show people: no paths, no hidden characters. */
export const fileName = z
  .string()
  .max(200)
  .default('')
  .transform((v) => cleanText(v).replace(/[\\/]+/g, ' ').trim())

/**
 * A place name or address the phone worked out from a map, sent with a
 * clock-in or visit. Never refused, because the clock-in matters more:
 * tidied, cut to length, and dropped if it is a link.
 */
export function mapText(max: number) {
  return z
    .union([z.null(), z.string()])
    .optional()
    .transform((v) => {
      if (!v) return null
      const clean = cleanText(v).slice(0, max)
      return clean && !hasLink(clean) ? clean : null
    })
}
