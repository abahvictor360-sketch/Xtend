import { z } from 'zod'
import { thingName } from '@/lib/fields'

/** A product in the catalogue, as an admin adds or edits it. */
export const productSchema = z.object({
  name: thingName(120, 'product name', 1),
  sku: z
    .string()
    .trim()
    .max(40, 'That SKU is too long')
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._\/-]*$|^$/, 'A SKU is letters, numbers, dashes and dots')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  category: thingName(60, 'category', 1).nullable().optional().or(z.literal('').transform(() => null)),
  unit: thingName(30, 'unit', 1).default('unit'),
  /** How many units come in a carton, for supplies logged in cartons. */
  units_per_carton: z.number().int('Whole units only').min(1).max(100_000).nullable().optional(),
})
