import { z } from 'zod'

/*
 * What each kind of field accepts, shared by the forms (to say what is
 * wrong before sending) and the API routes (which decide). Each rule tidies
 * the value (trims, single spaces, a phone in one format) and refuses what
 * cannot be what the field asks for: a name with digits, a phone that is
 * not a Nigerian mobile number, a message that is only punctuation or a
 * link.
 */

const LETTER = /\p{L}/gu
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ng|io|co|xyz|info|biz|link|me|app)\b)/i
const REPEAT = /(.)\1{5,}/u // the same character six or more times in a row

/** Trims and turns runs of spaces into one; keeps up to one blank line. */
export function tidy(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const letters = (value: string) => (value.match(LETTER) ?? []).length

/** A Nigerian mobile number as 0XXXXXXXXXX, or null if it is not one. */
export function normalisePhone(value: string): string | null {
  let digits = value.replace(/[\s().-]/g, '')
  if (digits.startsWith('+234')) digits = `0${digits.slice(4)}`
  else if (digits.startsWith('234') && digits.length === 13) digits = `0${digits.slice(3)}`
  return /^0[789][01]\d{8}$/.test(digits) ? digits : null
}

/** Why a value is not right for a field, or null when it is. */
export type Check = (value: string) => string | null

export const check = {
  personName: ((value) => {
    const v = tidy(value)
    if (v.length < 3 || v.length > 80) return 'Enter the full name (3 to 80 letters).'
    if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(v)) return 'A name can only have letters, spaces, hyphens and apostrophes.'
    if (letters(v) < 3 || REPEAT.test(v)) return 'Enter a real name.'
    if (!/\p{L}{2,}/u.test(v)) return 'Enter a real name.'
    return null
  }) as Check,

  email: ((value) => {
    const v = value.trim().toLowerCase()
    if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v) || v.length > 120) {
      return 'Enter a valid email address, like name@gmail.com.'
    }
    return null
  }) as Check,

  phone: ((value) => (normalisePhone(value) ? null : 'Enter a Nigerian mobile number, like 08031234567.')) as Check,

  /** A store, shop or place name. */
  placeName: ((value) => {
    const v = tidy(value)
    if (v.length < 2 || v.length > 120) return 'Enter the name (2 to 120 characters).'
    if (letters(v) < 2) return 'A name needs letters, not only numbers or symbols.'
    if (!/^[\p{L}\p{M}\p{N} &'.,()/+#:-]+$/u.test(v)) return 'Use letters, numbers and simple punctuation only.'
    if (LINK.test(v)) return 'A name cannot be a web link.'
    if (REPEAT.test(v)) return 'Enter the real name.'
    return null
  }) as Check,

  address: ((value) => {
    const v = tidy(value)
    if (v.length < 5 || v.length > 300) return 'Enter the address (5 to 300 characters).'
    if (letters(v) < 3) return 'Enter a real address with the street or area name.'
    if (LINK.test(v)) return 'An address cannot be a web link.'
    if (REPEAT.test(v)) return 'Enter the real address.'
    return null
  }) as Check,

  /** A product typed on a store count. */
  productName: ((value) => {
    const v = tidy(value)
    if (v.length < 2 || v.length > 120) return 'Enter the product name (2 to 120 characters).'
    if (letters(v) < 2) return 'A product name needs letters, not only numbers.'
    if (LINK.test(v) || REPEAT.test(v)) return 'Enter the real product name.'
    return null
  }) as Check,
}

/** Free text: a message, a note, a report. */
export function checkText(
  value: string,
  { min = 2, max = 2000, what = 'message', links = false }: { min?: number; max?: number; what?: string; links?: boolean } = {},
): string | null {
  const v = tidy(value)
  if (v.length < min) return min <= 1 ? `Write your ${what} first.` : `Write a bit more: at least ${min} characters.`
  if (v.length > max) return `Keep the ${what} under ${max} characters.`
  if (letters(v) < Math.min(2, v.length)) return `Write your ${what} in words.`
  if (/([\p{L}\p{N}])\1{7,}/u.test(v)) return `Write your ${what} in words.`
  if (!links && LINK.test(v)) return `A ${what} cannot contain web links.`
  return null
}

// ---------------------------------------------------------------------
// The same rules as zod schemas, for the API routes.
// ---------------------------------------------------------------------

const rule = (c: Check, clean: (v: string) => string = tidy) =>
  z
    .string()
    .max(1000)
    .superRefine((value, ctx) => {
      const problem = c(value)
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
    })
    .transform(clean)

export const zPersonName = rule(check.personName)
export const zEmail = rule(check.email, (v) => v.trim().toLowerCase())
export const zPhone = rule(check.phone, (v) => normalisePhone(v) ?? v)
export const zPlaceName = rule(check.placeName)
export const zAddress = rule(check.address)
export const zProductName = rule(check.productName)

/** An optional field: empty becomes null, anything else must pass. */
export const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    schema.nullable().optional(),
  )

export const zText = (options: Parameters<typeof checkText>[1] = {}) =>
  z
    .string()
    .max((options.max ?? 2000) * 2)
    .superRefine((value, ctx) => {
      const problem = checkText(value, options)
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
    })
    .transform(tidy)

/** A note that may be left empty. */
export const zNote = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    zText({ min: 2, max, what: 'note' }).nullable().optional(),
  )

/** A text field that may be left empty (stored as ''); anything written must pass. */
export const zMaybeText = (max: number, what: string) =>
  z.preprocess(
    (v) => (v == null ? '' : v),
    z
      .string()
      .max(max * 2)
      .superRefine((value, ctx) => {
        if (!value.trim()) return
        const problem = checkText(value, { min: 2, max, what })
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
      })
      .transform(tidy),
  )
