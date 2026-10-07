import type { ZodTypeAny } from 'zod'

/**
 * The message a field rule in src/lib/fields.ts gives for a value, or null
 * when it is fine: lets a form say what is wrong before sending, with the
 * same words the server would use.
 */
export function problemWith(rule: ZodTypeAny, value: unknown): string | null {
  const result = rule.safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? 'Check this field.')
}
